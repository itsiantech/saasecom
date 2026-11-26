/* Pathao Merchant API adapter.
 * Token is cached in memory per env + client id; city/zone lists are cached
 * briefly because they only change on Pathao's side. */

const { normalizeBdPhone } = require("../fraudRisk");

const TIMEOUT_MS = 12000;
const FRAUD_TIMEOUT_MS = 5000;
const TOKEN_SAFETY_MS = 5 * 60 * 1000;
const CITY_TTL_MS = 6 * 60 * 60 * 1000;
// Customer rating lives on the merchant host, not the aladdin API host.
const MERCHANT_BASE = "https://merchant.pathao.com";

const tokenCache = new Map();
const cityCache = new Map();

function baseUrl(env) {
  return env === "sandbox" ? "https://courier-api-sandbox.pathao.com" : "https://api-hermes.pathao.com";
}

function errorMessage(data, fallback) {
  if (!data) return fallback;
  if (Array.isArray(data.errors) && data.errors.length) {
    const first = data.errors[0];
    return String(first.message || first.reason || JSON.stringify(first));
  }
  if (data.message) return String(data.message);
  return fallback;
}

async function request(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
  let data = null;
  try {
    const text = await res.text();
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

async function issueToken(cfg) {
  const key = `${cfg.env}:${cfg.clientId}`;
  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.token;

  const res = await request(`${baseUrl(cfg.env)}/aladdin/api/v1/issue-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      username: cfg.username,
      password: cfg.password,
      grant_type: "password",
    }),
  });
  if (!res.ok || !res.data || !res.data.access_token) {
    throw new Error(errorMessage(res.data, `Token nite parlam na (HTTP ${res.status})`));
  }
  const ttl = Math.max(60000, (Number(res.data.expires_in) || 0) * 1000 - TOKEN_SAFETY_MS);
  tokenCache.set(key, { token: res.data.access_token, expiresAt: Date.now() + ttl });
  return res.data.access_token;
}

async function authorizedGet(cfg, path) {
  const token = await issueToken(cfg);
  const res = await request(`${baseUrl(cfg.env)}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(errorMessage(res.data, `Pathao error (HTTP ${res.status})`));
  return res.data;
}

function rowsOf(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data.data && Array.isArray(data.data.data)) return data.data.data;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

/* [{ id, name }] — id is numeric but kept as string for form fields. */
async function listCities(cfg) {
  const cacheKey = `${cfg.env}:${cfg.clientId}`;
  const hit = cityCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.cities;

  const data = await authorizedGet(cfg, "/aladdin/api/v1/countries/1/city-list");
  const cities = rowsOf(data)
    .map((row) => ({ id: String(row.city_id || row.id || ""), name: String(row.city_name || row.name || "") }))
    .filter((row) => row.id && row.name);
  cityCache.set(cacheKey, { cities, expiresAt: Date.now() + CITY_TTL_MS });
  return cities;
}

async function listZones(cfg, cityId) {
  if (!cityId) return [];
  const data = await authorizedGet(cfg, `/aladdin/api/v1/cities/${encodeURIComponent(cityId)}/zone-list`);
  return rowsOf(data)
    .map((row) => ({ id: String(row.zone_id || row.id || ""), name: String(row.zone_name || row.name || "") }))
    .filter((row) => row.id && row.name);
}

async function createOrder(cfg, payload) {
  const token = await issueToken(cfg);
  const res = await request(`${baseUrl(cfg.env)}/aladdin/api/v1/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(errorMessage(res.data, `Pathao order fail (HTTP ${res.status})`));
  const data = (res.data && res.data.data) || {};
  if (!data.consignment_id) {
    throw new Error(errorMessage(res.data, "Pathao consignment ID pai ni"));
  }
  return {
    consignmentId: String(data.consignment_id),
    trackingCode: String(data.consignment_id),
    status: String(data.order_status || ""),
    deliveryFee: Number(data.delivery_fee) || 0,
  };
}

/* Case-insensitive match; falls back to partial (district "Dhaka City" ~ city "Dhaka"). */
function matchByName(rows, text) {
  const needle = String(text || "").trim().toLowerCase();
  if (!needle) return null;
  return (
    rows.find((row) => row.name.toLowerCase() === needle) ||
    rows.find((row) => row.name.toLowerCase().includes(needle) || needle.includes(row.name.toLowerCase())) ||
    null
  );
}

function resetCaches() {
  tokenCache.clear();
  cityCache.clear();
}

/* Fraud check: ~5s timeout, one retry on network error, one token refresh on
 * 401. Never throws — returns { error }. Pathao may answer with a categorical
 * rating only (no parcel counts); that is returned as { rating }. */
async function fraudFetch(url, opts) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(FRAUD_TIMEOUT_MS) });
      let data = null;
      try {
        const text = await res.text();
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      if (attempt === 0) continue;
      throw err;
    }
  }
}

async function fraudCheck(cfg, phone) {
  const clean = normalizeBdPhone(phone);
  if (!clean) return { error: "Phone number valid BD number na (01XXXXXXXXX)" };
  if (cfg.env === "sandbox") return { error: "Pathao sandbox e customer history nei — live credential lagbe" };
  if (!cfg.clientId || !cfg.clientSecret || !cfg.username || !cfg.password) {
    return { error: "Pathao credential set kora nei" };
  }
  const call = (token) =>
    fraudFetch(`${MERCHANT_BASE}/api/v1/user/success`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Accept: "application/json" },
      body: JSON.stringify({ phone: clean }),
    });
  try {
    let res = await call(await issueToken(cfg));
    if (res.status === 401) {
      tokenCache.delete(`${cfg.env}:${cfg.clientId}`);
      res = await call(await issueToken(cfg));
    }
    if (!res.ok) return { error: errorMessage(res.data, `Pathao fraud check fail (HTTP ${res.status})`) };
    const raw = res.data || {};
    if (raw.success === false) return { error: errorMessage(raw, "Pathao fraud check fail") };
    const row = raw.data && typeof raw.data === "object" ? raw.data : raw;
    const inner = row.data && typeof row.data === "object" ? row.data : row;
    const rating = String(inner.customer_rating || row.customer_rating || "").trim();
    const total = Number(inner.total_orders);
    const success = Number(inner.delivered_orders);
    const cancel = Number(inner.returned_orders);
    if ([total, success, cancel].every(Number.isFinite)) return { success, cancel, total, rating };
    if (rating) return { rating };
    return { error: "Pathao theke rating ba count kichhui pawa jayni" };
  } catch (err) {
    return { error: `Pathao fraud check: ${err.message}` };
  }
}

module.exports = {
  baseUrl,
  issueToken,
  listCities,
  listZones,
  createOrder,
  matchByName,
  resetCaches,
  fraudCheck,
};
