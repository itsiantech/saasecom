/* ==========================================================================
   PayGate client — hosted bKash / Nagad checkout whose payment is confirmed by
   an SMS-matched webhook. Config comes from the superadmin Payment settings
   (secrets encrypted at rest) and falls back to PAYGATE_* env vars, so going
   live is a settings save rather than a deploy.
   ========================================================================== */
const crypto = require("crypto");
const billing = require("./platformBilling");

// A replayed webhook older than this is rejected. PayGate re-stamps every
// delivery attempt, so its retries never trip the window.
const MAX_SKEW_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 15000;

function cleanBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function envConfig() {
  return {
    baseUrl: cleanBase(process.env.PAYGATE_BASE_URL),
    publicKey: String(process.env.PAYGATE_PUBLIC_KEY || "").trim(),
    webhookSecret: String(process.env.PAYGATE_WEBHOOK_SECRET || "").trim(),
  };
}

/* Which PayGate app do we talk to? The settings card wins when it is complete;
 * env is the deploy-time fallback. A half-filled card is reported as
 * unconfigured — otherwise payments would be created that nothing can verify. */
async function getConfig() {
  let settings = null;
  try {
    settings = await billing.loadSettings();
  } catch {
    settings = null;
  }
  const api = (settings && settings.api) || {};
  if (api.enabled && api.baseUrl && api.publicKey && api.secretKey) {
    return {
      configured: true,
      source: "settings",
      baseUrl: cleanBase(api.baseUrl),
      publicKey: String(api.publicKey).trim(),
      webhookSecret: String(api.secretKey).trim(),
    };
  }
  const env = envConfig();
  if (env.baseUrl && env.publicKey && env.webhookSecret) {
    return { configured: true, source: "env", ...env };
  }
  return { configured: false, source: "", baseUrl: "", publicKey: "", webhookSecret: "" };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// PayGate errors come back as { error: { code, message } }.
function detail(body, status) {
  const e = body && body.error;
  if (e && typeof e === "object") return String(e.code || e.message || status);
  return String((body && body.message) || status);
}

async function request(config, path, options = {}) {
  if (!config || !config.baseUrl) throw httpError(503, "PayGate ঠিকানা (Base URL) দেওয়া নেই");
  let res;
  try {
    res = await fetch(config.baseUrl + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + (config.publicKey || ""),
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw httpError(502, "PayGate সার্ভারে পৌঁছানো যায়নি — " + (err && err.message ? err.message : "network"));
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

/* Creates a hosted checkout. `amount` is Taka — PayGate keeps poisha internally
 * but its API takes and returns Taka on both sides. checkout_url comes from the
 * top level of the response (the one inside payment needs a public base url). */
async function createPayment({ amount, senderNumber, metadata, returnUrl, expiresIn, config }) {
  const cfg = config || (await getConfig());
  if (!cfg.configured) throw httpError(503, "PayGate এখনো চালু করা হয়নি — অন্য পেমেন্ট মেথড বেছে নিন");

  const payload = { amount: Number(amount) || 0, currency: "BDT", metadata: metadata || {} };
  const phone = String(senderNumber || "").replace(/[\s-]/g, "");
  if (/^01[3-9]\d{8}$/.test(phone)) payload.sender_number = phone;
  if (returnUrl) payload.return_url = returnUrl;
  if (Number(expiresIn) > 0) payload.expires_in = Math.round(Number(expiresIn));

  const res = await request(cfg, "/api/payments", { method: "POST", body: JSON.stringify(payload) });
  const payment = res.body && res.body.payment;
  if (!res.ok || !payment || !payment.id) {
    throw httpError(502, "PayGate চেকআউট তৈরি হয়নি — " + detail(res.body, res.status));
  }
  return {
    payment,
    checkoutUrl: String((res.body && res.body.checkout_url) || payment.checkout_url || ""),
    paymentMethods: (res.body && res.body.payment_methods) || [],
  };
}

/* Direct lookup by PayGate payment id — used when a webhook is late and the
 * checkout page is still open. */
async function fetchPayment(id, config) {
  const cfg = config || (await getConfig());
  if (!cfg.configured) throw httpError(503, "PayGate এখনো চালু করা হয়নি");
  const res = await request(cfg, "/api/payments/" + encodeURIComponent(String(id)), { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw httpError(502, "PayGate স্ট্যাটস নেওয়া যায়নি — " + detail(res.body, res.status));
  }
  return (res.body && res.body.payment) || null;
}

/* PayGate signs "<timestamp>.<raw body>" with the app's whsec_ key and sends
 * `X-PayGate-Signature: sha256=<hex>`. The body must be the exact signed bytes,
 * so callers pass req.rawBody — re-serializing req.body breaks the HMAC. */
function verifyWebhook({ rawBody, signature, timestamp, secret }) {
  const body = String(rawBody || "");
  const got = String(signature || "").trim().replace(/^sha256=/i, "");
  const ts = String(timestamp || "").trim();
  if (!body || !got || !ts || !secret) return false;
  if (!/^[a-f0-9]{64}$/i.test(got)) return false;
  if (!/^\d{1,20}$/.test(ts)) return false;

  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (skew > MAX_SKEW_SECONDS) return false;

  const expected = crypto.createHmac("sha256", secret).update(ts + "." + body).digest("hex");
  const a = Buffer.from(got, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseEvent(rawBody) {
  try {
    return JSON.parse(String(rawBody || ""));
  } catch {
    return null;
  }
}

// Where PayGate sends the buyer back. PAYGATE_RETURN_URL wins, then the
// platform domain, then the current host (dev boxes set neither).
function defaultReturnUrl(req) {
  const direct = cleanBase(process.env.PAYGATE_RETURN_URL);
  if (direct) return direct;
  const platform = String(process.env.PLATFORM_DOMAIN || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (platform) return "https://" + platform + "/plan-checkout.html";
  if (!req) return "";
  // Behind nginx req.protocol is http unless trust proxy is set — the hosted
  // page must send the buyer back to the https origin, not through a redirect.
  const https = req.secure || req.get("x-forwarded-proto") === "https";
  return (https ? "https" : "http") + "://" + req.get("host") + "/plan-checkout.html";
}

module.exports = {
  MAX_SKEW_SECONDS,
  getConfig,
  createPayment,
  fetchPayment,
  verifyWebhook,
  parseEvent,
  defaultReturnUrl,
  envConfig,
  cleanBaseUrl: cleanBase,
};
