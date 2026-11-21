/* Pathao Merchant API adapter.
 * Token is cached in memory per env + client id; city/zone lists are cached
 * briefly because they only change on Pathao's side. */

const TIMEOUT_MS = 12000;
const TOKEN_SAFETY_MS = 5 * 60 * 1000;
const CITY_TTL_MS = 6 * 60 * 60 * 1000;

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

module.exports = {
  baseUrl,
  issueToken,
  listCities,
  listZones,
  createOrder,
  matchByName,
  resetCaches,
};
