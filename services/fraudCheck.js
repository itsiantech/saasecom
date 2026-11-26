/* Courier fraud check orchestration — runs the enabled couriers' check(phone),
 * caches results per phone+courier for 6h, computes the shared risk and stores
 * it on the order. Checkout fires this asynchronously; a courier failure never
 * breaks order placement. */
const Order = require("../models/Order");
const cache = require("../lib/cache");
const steadfast = require("../lib/couriers/steadfast");
const pathao = require("../lib/couriers/pathao");
const { calculateRisk, normalizeBdPhone } = require("../lib/fraudRisk");
const { loadValues, pathaoConfig, steadfastConfig } = require("./courierSettings");

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function fraudSettingsOf(values) {
  return {
    enabled: values.fraud_check_enabled === "true",
    steadfastEnabled: values.fraud_steadfast_enabled === "true",
    pathaoEnabled: values.fraud_pathao_enabled === "true",
    lowFrom: Number(values.fraud_low_from) || 80,
    highBelow: Number(values.fraud_high_below) || 50,
  };
}

function orderPhone(order) {
  return normalizeBdPhone(order.customerPhone || (order.shipping && order.shipping.phone) || "");
}

async function courierResult(storeId, provider, phone, values, force) {
  const key = `fraud:${storeId}:${provider}:${phone}`;
  if (!force) {
    const hit = cache.get(key);
    if (hit) return hit;
  }
  const result =
    provider === "steadfast"
      ? await steadfast.fraudCheck(steadfastConfig(values), phone)
      : await pathao.fraudCheck(pathaoConfig(values), phone);
  if (!result.error) cache.set(key, result, CACHE_TTL_MS);
  return result;
}

/* Runs the check and saves the result on the order. Returns the fraud subdoc
 * or null when the feature is off / order missing. `force` bypasses both the
 * already-checked guard and the phone cache (Re-check button). */
async function checkOrderNow(storeId, orderId, { force = false } = {}) {
  const values = await loadValues(storeId);
  const s = fraudSettingsOf(values);
  if (!s.enabled || (!s.steadfastEnabled && !s.pathaoEnabled)) return null;

  const order = await Order.findOne({ _id: orderId, store: storeId });
  if (!order) return null;
  const prev = order.fraud || {};
  if (!force && (prev.checkedAt || prev.status === "checking")) return prev;

  if (!order.fraud) order.fraud = {};
  order.fraud.status = "checking";
  await order.save();

  const phone = orderPhone(order);
  let sf = null;
  let pa = null;
  if (phone) {
    [sf, pa] = await Promise.all([
      s.steadfastEnabled ? courierResult(storeId, "steadfast", phone, values, force) : Promise.resolve(null),
      s.pathaoEnabled ? courierResult(storeId, "pathao", phone, values, force) : Promise.resolve(null),
    ]);
  }
  const risk = phone
    ? calculateRisk(sf, pa, s)
    : { level: "unavailable", combinedPercent: null, perCourier: {} };

  order.fraud = {
    status: "done",
    riskLevel: risk.level,
    combinedPercent: risk.combinedPercent,
    steadfast: sf,
    pathao: pa,
    checkedAt: new Date(),
    callDoneAt: prev.callDoneAt || null,
  };
  await order.save();
  return order.fraud;
}

/* Fire-and-forget wrapper for checkout / order-open triggers. */
function queueOrderCheck(storeId, orderId, opts = {}) {
  setImmediate(() => {
    checkOrderNow(storeId, orderId, opts).catch((err) => {
      console.error("fraud check:", err.message);
    });
  });
}

module.exports = { fraudSettingsOf, orderPhone, checkOrderNow, queueOrderCheck, CACHE_TTL_MS };