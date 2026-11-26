/* Steadfast Courier API adapter. Auth is the Api-Key / Secret-Key header pair. */

const { normalizeBdPhone } = require("../fraudRisk");

const BASE = "https://portal.packzy.com/api/v1";
const TIMEOUT_MS = 12000;
const FRAUD_TIMEOUT_MS = 5000;

function errorMessage(data, fallback) {
  if (!data) return fallback;
  if (data.errors && typeof data.errors === "object") {
    const first = Object.values(data.errors)[0];
    if (Array.isArray(first) && first.length) return String(first[0]);
    if (first) return String(first);
  }
  if (data.message) return String(data.message);
  return fallback;
}

async function request(cfg, path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Api-Key": cfg.apiKey,
      "Secret-Key": cfg.secretKey,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let data = null;
  try {
    const text = await res.text();
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

function apiFailed(res) {
  if (!res.ok) return true;
  const code = Number(res.data && res.data.status);
  return Number.isFinite(code) && code >= 400;
}

async function getBalance(cfg) {
  const res = await request(cfg, "/get_balance", { method: "GET" });
  if (apiFailed(res)) throw new Error(errorMessage(res.data, `Steadfast error (HTTP ${res.status})`));
  return Number(res.data && res.data.current_balance) || 0;
}

async function createOrder(cfg, payload) {
  const res = await request(cfg, "/create_order", { method: "POST", body: JSON.stringify(payload) });
  if (apiFailed(res)) throw new Error(errorMessage(res.data, `Steadfast order fail (HTTP ${res.status})`));
  const consignment = (res.data && res.data.consignment) || {};
  if (!consignment.consignment_id) throw new Error(errorMessage(res.data, "Steadfast consignment ID pai ni"));
  return {
    consignmentId: String(consignment.consignment_id),
    trackingCode: String(consignment.tracking_code || ""),
    status: String(consignment.status || ""),
  };
}

/* Fraud check: one retry on network error/timeout, ~5s per attempt.
 * HTTP errors are not retried. Never throws — returns { error } instead. */
async function fraudRequest(cfg, path) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: {
          "Api-Key": cfg.apiKey,
          "Secret-Key": cfg.secretKey,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(FRAUD_TIMEOUT_MS),
      });
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

/* Score endpoint fields (total_parcels/delivered_count/cancelled_count) with
 * legacy fraud_check fields (total_parcel/success_parcel/cancelled_parcel) as
 * fallback; payload may sit under a `data` wrapper. */
function parcelCounts(data) {
  const row = data && data.data && typeof data.data === "object" ? data.data : data || {};
  const total = Number(row.total_parcels != null ? row.total_parcels : row.total_parcel);
  const success = Number(row.delivered_count != null ? row.delivered_count : row.success_parcel);
  const cancel = Number(row.cancelled_count != null ? row.cancelled_count : row.cancelled_parcel);
  if (![total, success, cancel].every(Number.isFinite)) return null;
  return { success, cancel, total };
}

async function fraudCheck(cfg, phone) {
  const clean = normalizeBdPhone(phone);
  if (!clean) return { error: "Phone number valid BD number na (01XXXXXXXXX)" };
  if (!cfg || !cfg.apiKey || !cfg.secretKey) return { error: "Steadfast API Key / Secret Key set kora nei" };
  try {
    let res = await fraudRequest(cfg, `/fraud_check/score/${clean}`);
    if (res.status === 404) res = await fraudRequest(cfg, `/fraud_check/${clean}`);
    if (apiFailed(res)) {
      return { error: errorMessage(res.data, `Steadfast fraud check fail (HTTP ${res.status})`) };
    }
    const counts = parcelCounts(res.data);
    if (!counts) return { error: "Steadfast theke parcel count pawa jayni" };
    return counts;
  } catch (err) {
    return { error: `Steadfast fraud check: ${err.message}` };
  }
}

module.exports = { BASE, getBalance, createOrder, fraudCheck };
