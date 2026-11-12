/* Server-side tracking settings — Meta Conversions API, TikTok Events API,
 * GA4 Measurement Protocol, Google Ads conversion ping.
 * Pure helpers: validation, payload builders, PII hashing. Network calls live
 * in services/serverTracking.js. Secrets never leave the server unmasked. */

const crypto = require("crypto");

const PROVIDERS = ["meta", "tiktok", "ga4", "gads"];

const TRACKING_DEFAULTS = {
  sst_enabled: "false",
  // Meta (Facebook) Conversions API
  sst_meta_enabled: "false",
  sst_meta_name: "Meta Pixel",
  sst_meta_pixel_id: "",
  sst_meta_access_token: "",
  sst_meta_test_event_code: "",
  sst_meta_api_version: "v19.0",
  sst_meta_test_mode: "false",
  // TikTok Events API
  sst_tiktok_enabled: "false",
  sst_tiktok_name: "TikTok Pixel",
  sst_tiktok_pixel_id: "",
  sst_tiktok_access_token: "",
  sst_tiktok_test_event_code: "",
  sst_tiktok_test_mode: "false",
  // GA4 Measurement Protocol
  sst_ga4_enabled: "false",
  sst_ga4_name: "GA4 Server",
  sst_ga4_measurement_id: "",
  sst_ga4_api_secret: "",
  sst_ga4_test_mode: "false",
  // Google Ads (server conversion ping)
  sst_gads_enabled: "false",
  sst_gads_name: "Google Ads",
  sst_gads_conversion_id: "",
  sst_gads_conversion_label: "",
  sst_gads_test_mode: "false",
};

const BOOL_FIELDS = [
  "sst_enabled",
  "sst_meta_enabled",
  "sst_meta_test_mode",
  "sst_tiktok_enabled",
  "sst_tiktok_test_mode",
  "sst_ga4_enabled",
  "sst_ga4_test_mode",
  "sst_gads_enabled",
  "sst_gads_test_mode",
];

const SECRET_FIELDS = ["sst_meta_access_token", "sst_tiktok_access_token", "sst_ga4_api_secret"];

const API_VERSION_RE = /^v\d{1,2}\.\d{1,2}$/;
const META_PIXEL_RE = /^\d{5,20}$/;
const TIKTOK_PIXEL_RE = /^[A-Z0-9]{6,32}$/i;
const GA4_RE = /^G-[A-Z0-9]{4,20}$/;
const GADS_ID_RE = /^(AW-)?\d{6,15}$/i;
const GADS_LABEL_RE = /^[A-Za-z0-9_-]{4,80}$/;

const DEFAULT_API_VERSION = "v19.0";
const GA4_MP_URL = "https://www.google-analytics.com/mp/collect";
const GA4_DEBUG_URL = "https://www.google-analytics.com/debug/mp/collect";
const TIKTOK_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

function isSecretKey(key) {
  return SECRET_FIELDS.includes(key);
}

function boolOf(map, key) {
  return String(map[key]) === "true";
}

function normalizeTrackingValue(key, value) {
  const text = String(value == null ? "" : value).trim();
  if (key === "sst_meta_pixel_id") return text.replace(/[^\d]/g, "").slice(0, 20);
  if (key === "sst_tiktok_pixel_id") return text.replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
  if (key === "sst_ga4_measurement_id") return text.toUpperCase().slice(0, 32);
  if (key === "sst_gads_conversion_id") {
    const clean = text.replace(/\s+/g, "");
    return /^\d+$/.test(clean) ? `AW-${clean}` : clean.toUpperCase().slice(0, 24);
  }
  if (key === "sst_gads_conversion_label") return text.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  if (key === "sst_meta_api_version") return text.toLowerCase().slice(0, 8);
  if (key === "sst_meta_test_event_code" || key === "sst_tiktok_test_event_code") return text.slice(0, 80);
  if (isSecretKey(key)) return text.slice(0, 4000);
  return text.slice(0, 120);
}

/* First validation problem, or "" — secrets here are PLAINTEXT values. */
function trackingErrors(values) {
  if (boolOf(values, "sst_meta_enabled")) {
    const pixel = normalizeTrackingValue("sst_meta_pixel_id", values.sst_meta_pixel_id);
    if (!META_PIXEL_RE.test(pixel)) return "Meta Pixel ID thik nei (digits only)";
    if (!String(values.sst_meta_access_token || "").trim()) return "Meta Access Token din";
  }
  const metaVersion = normalizeTrackingValue("sst_meta_api_version", values.sst_meta_api_version);
  if (metaVersion && !API_VERSION_RE.test(metaVersion)) return "Meta API version thik nei (example: v19.0)";

  if (boolOf(values, "sst_tiktok_enabled")) {
    const pixel = normalizeTrackingValue("sst_tiktok_pixel_id", values.sst_tiktok_pixel_id);
    if (!TIKTOK_PIXEL_RE.test(pixel)) return "TikTok Pixel ID thik nei";
    if (!String(values.sst_tiktok_access_token || "").trim()) return "TikTok Access Token din";
  }

  if (boolOf(values, "sst_ga4_enabled")) {
    const id = normalizeTrackingValue("sst_ga4_measurement_id", values.sst_ga4_measurement_id);
    if (!GA4_RE.test(id)) return "GA4 Measurement ID thik nei (example: G-ABC123XYZ)";
    if (!String(values.sst_ga4_api_secret || "").trim()) return "GA4 API secret din";
  }

  if (boolOf(values, "sst_gads_enabled")) {
    const id = normalizeTrackingValue("sst_gads_conversion_id", values.sst_gads_conversion_id);
    if (!GADS_ID_RE.test(id)) return "Google Ads Conversion ID thik nei (example: AW-123456789)";
    const label = normalizeTrackingValue("sst_gads_conversion_label", values.sst_gads_conversion_label);
    if (!label) return "Google Ads Conversion Label din";
  }
  return "";
}

function metaApiVersion(value) {
  const v = normalizeTrackingValue("sst_meta_api_version", value);
  return API_VERSION_RE.test(v) ? v : DEFAULT_API_VERSION;
}

/* Flat plaintext values -> nested runtime config with re-validated IDs. */
function buildConfig(values) {
  const map = values || {};
  const master = boolOf(map, "sst_enabled");
  const ga4Id = normalizeTrackingValue("sst_ga4_measurement_id", map.sst_ga4_measurement_id);
  const metaPixel = normalizeTrackingValue("sst_meta_pixel_id", map.sst_meta_pixel_id);
  const tiktokPixel = normalizeTrackingValue("sst_tiktok_pixel_id", map.sst_tiktok_pixel_id);
  const gadsId = normalizeTrackingValue("sst_gads_conversion_id", map.sst_gads_conversion_id);
  return {
    enabled: master,
    meta: {
      enabled: master && boolOf(map, "sst_meta_enabled"),
      name: String(map.sst_meta_name || "Meta Pixel"),
      pixelId: META_PIXEL_RE.test(metaPixel) ? metaPixel : "",
      accessToken: String(map.sst_meta_access_token || ""),
      testEventCode: normalizeTrackingValue("sst_meta_test_event_code", map.sst_meta_test_event_code),
      apiVersion: metaApiVersion(map.sst_meta_api_version),
      testMode: boolOf(map, "sst_meta_test_mode"),
    },
    tiktok: {
      enabled: master && boolOf(map, "sst_tiktok_enabled"),
      name: String(map.sst_tiktok_name || "TikTok Pixel"),
      pixelId: TIKTOK_PIXEL_RE.test(tiktokPixel) ? tiktokPixel : "",
      accessToken: String(map.sst_tiktok_access_token || ""),
      testEventCode: normalizeTrackingValue("sst_tiktok_test_event_code", map.sst_tiktok_test_event_code),
      testMode: boolOf(map, "sst_tiktok_test_mode"),
    },
    ga4: {
      enabled: master && boolOf(map, "sst_ga4_enabled"),
      name: String(map.sst_ga4_name || "GA4 Server"),
      measurementId: GA4_RE.test(ga4Id) ? ga4Id : "",
      apiSecret: String(map.sst_ga4_api_secret || ""),
      testMode: boolOf(map, "sst_ga4_test_mode"),
    },
    gads: {
      enabled: master && boolOf(map, "sst_gads_enabled"),
      name: String(map.sst_gads_name || "Google Ads"),
      conversionId: GADS_ID_RE.test(gadsId) ? gadsId : "",
      conversionLabel: normalizeTrackingValue("sst_gads_conversion_label", map.sst_gads_conversion_label),
      testMode: boolOf(map, "sst_gads_test_mode"),
    },
  };
}

function providerReady(cfg, provider) {
  if (!cfg || !cfg[provider] || !cfg[provider].enabled) return false;
  if (provider === "meta") return !!(cfg.meta.pixelId && cfg.meta.accessToken);
  if (provider === "tiktok") return !!(cfg.tiktok.pixelId && cfg.tiktok.accessToken);
  if (provider === "ga4") return !!(cfg.ga4.measurementId && cfg.ga4.apiSecret);
  if (provider === "gads") return !!(cfg.gads.conversionId && cfg.gads.conversionLabel);
  return false;
}

/* ------------------------------------------------------------------ *
 * PII hashing + event payload builders
 * ------------------------------------------------------------------ */
function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hashEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email ? sha256(email) : "";
}

// 01XXXXXXXXX / 8801XXXXXXXXX -> 8801XXXXXXXXX before hashing
function normalizePhoneNumber(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("880")) return digits;
  if (digits.startsWith("0")) return "88" + digits;
  return digits;
}

function hashPhone(value) {
  const phone = normalizePhoneNumber(value);
  return phone ? sha256(phone) : "";
}

function fbcFromClickId(fbclid, timeMs) {
  const id = String(fbclid || "").trim();
  if (!id) return "";
  return `fb.1.${timeMs || Date.now()}.${id}`;
}

function orderCurrency(order) {
  return String((order && order.currency) || "BDT");
}

function orderContents(order) {
  return (order.items || []).map((item) => {
    const product = item.product && typeof item.product === "object" ? item.product : null;
    return {
      id: String((product && product._id) || (item.product ? item.product : "") || item._id || ""),
      name: String((product && product.name) || "Product").slice(0, 200),
      quantity: Math.max(1, Number(item.quantity) || 1),
      price: Number(item.price) || 0,
    };
  });
}

function metaUserData(user = {}) {
  const out = {};
  const em = hashEmail(user.email);
  if (em) out.em = [em];
  const ph = hashPhone(user.phone);
  if (ph) out.ph = [ph];
  const external = String(user.externalId || "").trim();
  if (external) out.external_id = [sha256(external)];
  if (user.ip) out.client_ip_address = user.ip;
  if (user.userAgent) out.client_user_agent = user.userAgent;
  if (user.fbc) out.fbc = user.fbc;
  if (user.fbp) out.fbp = user.fbp;
  return out;
}

function metaEventBody(config, event) {
  const body = {
    data: [
      {
        event_name: event.name,
        event_time: event.time,
        action_source: "website",
        user_data: event.userData || {},
        custom_data: event.customData || {},
        ...(event.eventId ? { event_id: event.eventId } : {}),
        ...(event.sourceUrl ? { event_source_url: event.sourceUrl } : {}),
      },
    ],
  };
  if (event.testEventCode) body.test_event_code = event.testEventCode;
  return body;
}

function metaEventsUrl(config) {
  return (
    `https://graph.facebook.com/${metaApiVersion(config.apiVersion)}/` +
    `${encodeURIComponent(config.pixelId)}/events?access_token=${encodeURIComponent(config.accessToken)}`
  );
}

function metaPurchase(config, order, ctx = {}) {
  const time = ctx.time || Math.floor(Date.now() / 1000);
  const contents = orderContents(order);
  // test mode ON routes purchases to the Test Events tab; OFF sends real events
  const testEventCode = config.testMode ? config.testEventCode : "";
  return {
    url: metaEventsUrl(config),
    body: metaEventBody(config, {
      name: "Purchase",
      time,
      eventId: String(order.orderNumber || order._id || ""),
      sourceUrl: ctx.sourceUrl || "",
      testEventCode,
      userData: metaUserData({
        email: order.customerEmail,
        phone: order.customerPhone,
        externalId: order.customer || order.customerPhone || "",
        fbc: ctx.fbclid ? fbcFromClickId(ctx.fbclid, time * 1000) : "",
        fbp: ctx.fbp || "",
      }),
      customData: {
        currency: orderCurrency(order),
        value: Number(order.totalAmount) || 0,
        order_id: String(order.orderNumber || ""),
        content_type: "product",
        content_ids: contents.map((c) => c.id),
        contents: contents.map((c) => ({ id: c.id, quantity: c.quantity, item_price: c.price })),
        num_items: contents.reduce((sum, c) => sum + c.quantity, 0),
      },
    }),
  };
}

function tiktokEventTime(timeMs) {
  return new Date(timeMs || Date.now()).toISOString().replace("T", " ").slice(0, 19);
}

function tiktokPurchase(config, order, ctx = {}) {
  const contents = orderContents(order);
  return {
    url: TIKTOK_URL,
    headers: {
      "Content-Type": "application/json",
      "Access-Token": config.accessToken,
    },
    body: {
      event_source: "web",
      event_source_id: config.pixelId,
      ...(config.testMode && config.testEventCode ? { test_event_code: config.testEventCode } : {}),
      data: [
        {
          event: "CompletePayment",
          event_time: tiktokEventTime(ctx.timeMs),
          event_id: String(order.orderNumber || order._id || ""),
          user: {
            external_id: order.customer ? sha256(String(order.customer)) : "",
            email: hashEmail(order.customerEmail),
            phone: hashPhone(order.customerPhone),
            ...(ctx.ttclid ? { ttclid: ctx.ttclid } : {}),
            ...(ctx.ip ? { ip: ctx.ip } : {}),
            ...(ctx.userAgent ? { user_agent: ctx.userAgent } : {}),
          },
          page: { url: ctx.sourceUrl || "" },
          properties: {
            currency: orderCurrency(order),
            value: Number(order.totalAmount) || 0,
            order_id: String(order.orderNumber || ""),
            content_type: "product",
            contents: contents.map((c) => ({
              content_id: c.id,
              content_name: c.name,
              quantity: c.quantity,
              price: c.price,
            })),
          },
        },
      ],
    },
  };
}

function ga4ClientId(order) {
  return "srv." + String(order.customer || order.orderNumber || order._id || "");
}

function ga4Purchase(config, order, ctx = {}) {
  const contents = orderContents(order);
  return {
    url: `${GA4_MP_URL}?measurement_id=${encodeURIComponent(config.measurementId)}` +
      `&api_secret=${encodeURIComponent(config.apiSecret)}`,
    body: {
      client_id: ga4ClientId(order),
      ...(order.customer ? { user_id: String(order.customer) } : {}),
      events: [
        {
          name: "purchase",
          params: {
            transaction_id: String(order.orderNumber || ""),
            value: Number(order.totalAmount) || 0,
            currency: orderCurrency(order),
            ...(ctx.sourceUrl ? { page_location: ctx.sourceUrl } : {}),
            items: contents.map((c) => ({
              item_id: c.id,
              item_name: c.name,
              price: c.price,
              quantity: c.quantity,
            })),
          },
        },
      ],
    },
  };
}

function gadsConversionUrl(config, order) {
  const gclid = String((order.clickIds && order.clickIds.gclid) || "").trim();
  if (!gclid || !config.conversionId || !config.conversionLabel) return "";
  const id = config.conversionId.replace(/^AW-/, "");
  const params = new URLSearchParams({
    label: config.conversionLabel,
    value: String(Number(order.totalAmount) || 0),
    currency_code: orderCurrency(order),
    gclid,
    oid: String(order.orderNumber || ""),
  });
  return `https://www.googleadservices.com/pagead/conversion/${encodeURIComponent(id)}/?${params.toString()}`;
}

function testEventPayload(config, order, ctx = {}) {
  const body = metaPurchase(config, order, ctx);
  return {
    url: body.url,
    body: {
      ...body.body,
      data: [{ ...body.body.data[0], event_name: "Purchase", event_id: `TEST-${Date.now()}` }],
    },
  };
}

module.exports = {
  PROVIDERS,
  TRACKING_DEFAULTS,
  BOOL_FIELDS,
  SECRET_FIELDS,
  GA4_MP_URL,
  GA4_DEBUG_URL,
  TIKTOK_URL,
  DEFAULT_API_VERSION,
  isSecretKey,
  normalizeTrackingValue,
  trackingErrors,
  buildConfig,
  providerReady,
  metaApiVersion,
  sha256,
  hashEmail,
  hashPhone,
  normalizePhoneNumber,
  fbcFromClickId,
  metaUserData,
  metaEventBody,
  metaEventsUrl,
  metaPurchase,
  tiktokEventTime,
  tiktokPurchase,
  ga4Purchase,
  ga4ClientId,
  gadsConversionUrl,
  testEventPayload,
};
