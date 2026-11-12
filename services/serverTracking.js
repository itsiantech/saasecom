/* Server-side tracking service — per-store config storage (secrets encrypted),
 * connection tests, and best-effort purchase dispatch after checkout.
 * Never throws to checkout: every failure is swallowed and logged. */
const Settings = require("../models/Settings");
const Store = require("../models/Store");
const { scopedKey, keysForStore, isScopedKey, unscopeKey } = require("../lib/settingsScope");
const { encrypt, decrypt, maskSecret, isMasked } = require("../lib/secretBox");
const { storefrontUrl } = require("../lib/storefrontUrl");
const tracking = require("../lib/serverTracking");

const TRACKING_KEYS = Object.keys(tracking.TRACKING_DEFAULTS);
const REQUEST_TIMEOUT_MS = 8000;

function decryptSecret(map, key) {
  return String(decrypt((map && map[key]) || "").value || "");
}

/* DB rows (secrets encrypted) -> flat plaintext values used everywhere else. */
async function loadValues(storeId) {
  const docs = await Settings.find({ key: { $in: keysForStore(storeId, TRACKING_KEYS) } }).lean();
  const rows = { ...tracking.TRACKING_DEFAULTS };
  docs.forEach((d) => { if (!isScopedKey(storeId, d.key)) rows[d.key] = d.value; });
  docs.forEach((d) => { if (isScopedKey(storeId, d.key)) rows[unscopeKey(storeId, d.key)] = d.value; });
  const values = {};
  TRACKING_KEYS.forEach((key) => {
    const v = rows[key];
    values[key] = String(v == null ? tracking.TRACKING_DEFAULTS[key] : v);
  });
  tracking.SECRET_FIELDS.forEach((key) => { values[key] = decryptSecret(rows, key); });
  return values;
}

/* Merge a partial admin form over stored values. Masked/blank secrets keep
 * whatever is already stored, so the dashboard never needs the plaintext.
 * `current` may be either plaintext (loadValues) or raw encrypted rows. */
function resolveValues(current, input = {}) {
  const values = { ...tracking.TRACKING_DEFAULTS };
  TRACKING_KEYS.forEach((key) => {
    if (current && current[key] !== undefined && current[key] !== null) values[key] = String(current[key]);
  });
  tracking.SECRET_FIELDS.forEach((key) => {
    if (!current) return;
    const raw = String(current[key] || "");
    values[key] = raw.startsWith("v1:") ? decryptSecret(current, key) : raw;
  });
  TRACKING_KEYS.forEach((key) => {
    if (input[key] === undefined) return;
    if (tracking.isSecretKey(key)) {
      const raw = String(input[key] == null ? "" : input[key]).trim();
      if (raw && !isMasked(raw)) values[key] = raw;
      return;
    }
    values[key] = tracking.normalizeTrackingValue(key, input[key]);
  });
  return values;
}

/* GET /api/settings admin view: plaintext secrets replaced with ••••last4,
 * every other settings key passes through untouched. */
function adminSettings(current) {
  const values = resolveValues(current || {}, {});
  tracking.SECRET_FIELDS.forEach((key) => {
    values[key] = maskSecret(values[key]);
  });
  const out = { ...(current || {}) };
  TRACKING_KEYS.forEach((key) => { out[key] = values[key]; });
  return out;
}

/* Validate + build upserts for the keys present in the admin form. */
function prepareSave(storeId, current, input = {}) {
  const values = resolveValues(current || {}, input);
  const error = tracking.trackingErrors(values);
  if (error) return { error };

  const ops = [];
  TRACKING_KEYS.forEach((key) => {
    if (input[key] === undefined) return;
    let value;
    if (tracking.isSecretKey(key)) {
      const raw = String(input[key] == null ? "" : input[key]).trim();
      if (!raw || isMasked(raw)) return; // empty/masked = keep stored secret
      value = encrypt({ value: raw });
    } else {
      value = String(values[key] == null ? "" : values[key]);
    }
    const storageKey = scopedKey(storeId, key);
    ops.push({
      updateOne: { filter: { key: storageKey }, update: { $set: { key: storageKey, value } }, upsert: true },
    });
  });
  return { ops, values };
}

async function configForStore(storeId) {
  return tracking.buildConfig(await loadValues(storeId));
}

/* ------------------------------------------------------------------ *
 * HTTP helpers
 * ------------------------------------------------------------------ */
async function readBody(res) {
  try {
    if (typeof res.text === "function") {
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return { raw: String(text).slice(0, 300) };
      }
    }
    if (typeof res.json === "function") return await res.json();
  } catch {
    return null;
  }
  return null;
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { ok: res.ok, status: res.status, data: await readBody(res) };
}

async function getJson(url) {
  const res = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { ok: res.ok, status: res.status, data: await readBody(res) };
}

function graphErrorMessage(data) {
  if (!data) return "";
  if (data.error && data.error.message) return String(data.error.message);
  if (data.message) return String(data.message);
  return "";
}

function testOrder(user) {
  return {
    orderNumber: "TEST-" + Date.now().toString(36).toUpperCase(),
    totalAmount: 1,
    currency: "BDT",
    customerEmail: (user && user.email) || "",
    customerPhone: "",
    customer: null,
    items: [{ product: { _id: "test-product", name: "Test Product" }, quantity: 1, price: 1 }],
    clickIds: {},
  };
}

async function sourceUrlFor(storeId) {
  const store = await Store.findById(storeId).select("slug subdomain customDomain customDomainStatus").lean();
  return storefrontUrl(store).catch(() => "");
}

/* ------------------------------------------------------------------ *
 * Test connection — validates credentials against the provider API
 * ------------------------------------------------------------------ */
async function testMeta(cfg) {
  if (!cfg.pixelId || !cfg.accessToken) return { ok: false, message: "Pixel ID ar Access Token din" };
  const version = tracking.metaApiVersion(cfg.apiVersion);
  const url =
    `https://graph.facebook.com/${version}/${encodeURIComponent(cfg.pixelId)}` +
    `?fields=id,name&access_token=${encodeURIComponent(cfg.accessToken)}`;
  const res = await getJson(url);
  if (res.ok) return { ok: true, message: "Meta connection OK" + (res.data && res.data.name ? ` — ${res.data.name}` : "") };
  return { ok: false, message: graphErrorMessage(res.data) || `Meta error (HTTP ${res.status})` };
}

async function testTiktok(cfg) {
  if (!cfg.pixelId || !cfg.accessToken) return { ok: false, message: "Pixel ID ar Access Token din" };
  const res = await postJson(
    tracking.TIKTOK_URL,
    {
      event_source: "web",
      event_source_id: cfg.pixelId,
      data: [
        {
          event: "ViewContent",
          event_time: tracking.tiktokEventTime(Date.now()),
          page: { url: "https://example.com/" },
          properties: { currency: "BDT", value: 0 },
        },
      ],
    },
    { "Access-Token": cfg.accessToken }
  );
  if (res.ok && res.data && Number(res.data.code) === 0) return { ok: true, message: "TikTok connection OK" };
  const msg = (res.data && (res.data.message || res.data.msg)) || `TikTok error (HTTP ${res.status})`;
  return { ok: false, message: String(msg) };
}

async function testGa4(cfg) {
  if (!cfg.measurementId || !cfg.apiSecret) return { ok: false, message: "Measurement ID ar API secret din" };
  const url =
    `${tracking.GA4_DEBUG_URL}?measurement_id=${encodeURIComponent(cfg.measurementId)}` +
    `&api_secret=${encodeURIComponent(cfg.apiSecret)}`;
  const res = await postJson(url, {
    client_id: "sst.test",
    events: [{ name: "page_view", params: { page_location: "https://example.com/", engagement_time_msec: 100 } }],
  });
  if (!res.ok) return { ok: false, message: `GA4 error (HTTP ${res.status})` };
  const messages = (res.data && res.data.validationMessages) || [];
  if (messages.length) {
    const first = messages[0];
    return { ok: false, message: String(first.description || first.validationCode || "GA4 validation failed") };
  }
  return { ok: true, message: "GA4 connection OK" };
}

function gadsConfigError(cfg) {
  if (!cfg.conversionId) return "Conversion ID din";
  if (!cfg.conversionLabel) return "Conversion Label din";
  return "";
}

/* ------------------------------------------------------------------ *
 * Test event — sends one synthetic purchase through the provider
 * ------------------------------------------------------------------ */
async function sendMetaTest(cfg, order, ctx) {
  if (!cfg.pixelId || !cfg.accessToken) return { ok: false, message: "Pixel ID ar Access Token din" };
  if (cfg.testMode && !cfg.testEventCode) {
    return { ok: false, message: "Test mode ON — Test Event Code din (Meta Events Manager → Test Events)" };
  }
  const payload = tracking.metaPurchase(cfg, order, ctx);
  const res = await postJson(payload.url, payload.body);
  if (res.ok && res.data && Number(res.data.events_received) > 0) {
    return { ok: true, message: "Meta test event pathano hoyeche" };
  }
  return { ok: false, message: graphErrorMessage(res.data) || `Meta error (HTTP ${res.status})` };
}

async function sendTiktokTest(cfg, order, ctx) {
  if (!cfg.pixelId || !cfg.accessToken) return { ok: false, message: "Pixel ID ar Access Token din" };
  const payload = tracking.tiktokPurchase(cfg, order, ctx);
  const res = await postJson(payload.url, payload.body, payload.headers);
  if (res.ok && res.data && Number(res.data.code) === 0) return { ok: true, message: "TikTok test event pathano hoyeche" };
  const msg = (res.data && (res.data.message || res.data.msg)) || `TikTok error (HTTP ${res.status})`;
  return { ok: false, message: String(msg) };
}

async function sendGa4Test(cfg, order, ctx) {
  if (!cfg.measurementId || !cfg.apiSecret) return { ok: false, message: "Measurement ID ar API secret din" };
  const payload = tracking.ga4Purchase(cfg, order, ctx);
  const res = await postJson(payload.url, payload.body);
  if (res.ok) return { ok: true, message: "GA4 test event pathano hoyeche (Realtime e 1-2 min er moddhe)" };
  return { ok: false, message: `GA4 error (HTTP ${res.status})` };
}

async function resolveTestTarget(storeId, provider, input) {
  const current = await loadValues(storeId);
  const values = resolveValues(current, input || {});
  const cfg = tracking.buildConfig(values);
  return { cfg, providerCfg: cfg[provider] };
}

function providerLabel(provider) {
  return { meta: "Meta", tiktok: "TikTok", ga4: "GA4", gads: "Google Ads" }[provider] || provider;
}

async function testConnection(storeId, provider, input = {}) {
  if (!tracking.PROVIDERS.includes(provider)) return { ok: false, message: "Provider chena jayni" };
  try {
    const { providerCfg } = await resolveTestTarget(storeId, provider, input);
    if (provider === "meta") return await testMeta(providerCfg);
    if (provider === "tiktok") return await testTiktok(providerCfg);
    if (provider === "ga4") return await testGa4(providerCfg);
    const err = gadsConfigError(providerCfg);
    return err
      ? { ok: false, message: err }
      : { ok: true, message: "Format thik ache — conversion ping shudhu gclid wala order e pathano hoy" };
  } catch (err) {
    return { ok: false, message: `${providerLabel(provider)} test fail: ${err.message}` };
  }
}

async function sendTestEvent(storeId, provider, input = {}, user = null) {
  if (!tracking.PROVIDERS.includes(provider)) return { ok: false, message: "Provider chena jayni" };
  try {
    const { providerCfg } = await resolveTestTarget(storeId, provider, input);
    const order = testOrder(user);
    const ctx = { sourceUrl: await sourceUrlFor(storeId), time: Math.floor(Date.now() / 1000), timeMs: Date.now() };
    if (provider === "meta") {
      if (providerCfg.testMode && !providerCfg.testEventCode) {
        return { ok: false, message: "Test mode ON — Test Event Code din" };
      }
      return await sendMetaTest(providerCfg, order, ctx);
    }
    if (provider === "tiktok") {
      if (providerCfg.testMode && !providerCfg.testEventCode) {
        return { ok: false, message: "Test mode ON — Test Event Code din" };
      }
      return await sendTiktokTest(providerCfg, order, ctx);
    }
    if (provider === "ga4") return await sendGa4Test(providerCfg, order, ctx);
    const err = gadsConfigError(providerCfg);
    return err
      ? { ok: false, message: err }
      : { ok: true, message: "Format thik ache — Google Ads ping order er gclid diye automatic pathabe" };
  } catch (err) {
    return { ok: false, message: `${providerLabel(provider)} test fail: ${err.message}` };
  }
}

/* ------------------------------------------------------------------ *
 * Checkout purchase dispatch — called from notifyOrderPlaced
 * ------------------------------------------------------------------ */
async function sendMetaPurchase(cfg, order, ctx) {
  const payload = tracking.metaPurchase(cfg, order, ctx);
  return postJson(payload.url, payload.body);
}

async function sendTiktokPurchase(cfg, order, ctx) {
  const payload = tracking.tiktokPurchase(cfg, order, ctx);
  return postJson(payload.url, payload.body, payload.headers);
}

async function sendGa4Purchase(cfg, order, ctx) {
  const payload = tracking.ga4Purchase(cfg, order, ctx);
  return postJson(payload.url, payload.body);
}

async function sendGadsPurchase(cfg, order) {
  const url = tracking.gadsConversionUrl(cfg, order);
  if (!url) return null;
  return getJson(url);
}

async function trackOrderPlaced(order) {
  try {
    if (!order || !order.store) return;
    const cfg = await configForStore(order.store);
    if (!cfg.enabled) return;

    const clickIds = order.clickIds || {};
    const ctx = {
      sourceUrl: await sourceUrlFor(order.store),
      time: Math.floor(Date.now() / 1000),
      timeMs: Date.now(),
      fbclid: clickIds.fbclid || "",
      ttclid: clickIds.ttclid || "",
    };

    const jobs = [];
    if (tracking.providerReady(cfg, "meta")) jobs.push(sendMetaPurchase(cfg.meta, order, ctx));
    if (tracking.providerReady(cfg, "tiktok")) jobs.push(sendTiktokPurchase(cfg.tiktok, order, ctx));
    if (tracking.providerReady(cfg, "ga4")) jobs.push(sendGa4Purchase(cfg.ga4, order, ctx));
    if (tracking.providerReady(cfg, "gads")) jobs.push(sendGadsPurchase(cfg.gads, order));
    if (!jobs.length) return;

    const results = await Promise.allSettled(jobs);
    results.forEach((r) => {
      if (r.status === "rejected") console.error("serverTracking:", r.reason && r.reason.message);
    });
  } catch (err) {
    console.error("trackOrderPlaced:", err.message);
  }
}

module.exports = {
  TRACKING_KEYS,
  loadValues,
  resolveValues,
  adminSettings,
  prepareSave,
  configForStore,
  testConnection,
  sendTestEvent,
  trackOrderPlaced,
};
