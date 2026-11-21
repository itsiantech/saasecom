/* Steadfast Courier API adapter. Auth is the Api-Key / Secret-Key header pair. */

const BASE = "https://portal.packzy.com/api/v1";
const TIMEOUT_MS = 12000;

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

module.exports = { BASE, getBalance, createOrder };
