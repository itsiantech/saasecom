// Best-effort rollup refreshes triggered by order/refund changes. Every path is
// caught: a report failure must never make an order or refund fail.
const { zonedDateKey } = require("../lib/supplierDomain");
const { refundAtOf } = require("../lib/reportMath");
const { REPORT_TIMEZONE } = require("../lib/reportConstants");

const DELAY_MS = 2000;
const pending = new Map();

function scheduleDay(storeId, dayKey) {
  if (!storeId || !dayKey) return;
  const key = `${String(storeId)}:${dayKey}`;
  if (pending.has(key)) return;
  const timer = setTimeout(() => {
    pending.delete(key);
    try {
      const { rebuildDay } = require("./reportRollups");
      rebuildDay(storeId, dayKey, REPORT_TIMEZONE).catch((err) => {
        console.error("report hook rebuild failed:", String(storeId), dayKey, err.message);
      });
    } catch (err) {
      console.error("report hook load failed:", String(storeId), dayKey, err.message);
    }
  }, DELAY_MS);
  if (timer.unref) timer.unref();
  pending.set(key, timer);
}

function scheduleOrder(order) {
  try {
    if (!order || !order.store || !order.createdAt) return;
    scheduleDay(order.store, zonedDateKey(order.createdAt, REPORT_TIMEZONE));
    const refundAt = refundAtOf(order);
    if (refundAt) scheduleDay(order.store, zonedDateKey(refundAt, REPORT_TIMEZONE));
  } catch (err) {
    console.error("report hook schedule failed:", err.message);
  }
}

function orderChanged(order) {
  scheduleOrder(order);
}

function refundRecorded(order) {
  scheduleOrder(order);
}

function pendingCount() {
  return pending.size;
}

module.exports = { orderChanged, refundRecorded, scheduleOrder, scheduleDay, pendingCount };
