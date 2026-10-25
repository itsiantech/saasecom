const Store = require("../models/Store");
const { rebuildDay } = require("./reportRollups");
const { todayKey, addDaysKey } = require("../lib/reportPeriods");
const { zonedMidnightUtc } = require("../lib/supplierDomain");
const { REPORT_TIMEZONE, REPORT_REBUILD_MAX_TIME_MS } = require("../lib/reportConstants");

let timer = null;
let started = false;

function nextRunAt(now, hour, minute, timezone = REPORT_TIMEZONE) {
  const day = todayKey(now, timezone);
  const midnight = zonedMidnightUtc(day, timezone).getTime();
  let candidate = midnight + (Number(hour) * 60 + Number(minute)) * 60 * 1000;
  if (candidate <= now.getTime()) {
    candidate = zonedMidnightUtc(addDaysKey(day, 1), timezone).getTime() +
      (Number(hour) * 60 + Number(minute)) * 60 * 1000;
  }
  return new Date(candidate);
}

// Recomputes the last N completed local days for every store. Any error is
// contained per store/day so one bad store cannot stop the pass.
async function runReconciliation({ now = new Date(), timezone = REPORT_TIMEZONE, days = 3 } = {}) {
  const yesterday = addDaysKey(todayKey(now, timezone), -1);
  const dayKeys = [];
  for (let i = Math.max(1, Number(days) || 3) - 1; i >= 0; i -= 1) {
    dayKeys.push(addDaysKey(yesterday, -i));
  }

  const stores = await Store.find({}).select("_id").lean();
  const summary = { stores: stores.length, days: dayKeys.length, rebuilt: 0, errors: 0 };
  for (const store of stores) {
    for (const dayKey of dayKeys) {
      try {
        await rebuildDay(store._id, dayKey, timezone, {
          maxTimeMS: REPORT_REBUILD_MAX_TIME_MS,
          clearCache: false,
        });
        summary.rebuilt += 1;
      } catch (err) {
        summary.errors += 1;
        console.error("report reconciliation failed:", String(store._id), dayKey, err.message);
      }
    }
  }
  try {
    const cache = require("./reportCache");
    for (const store of stores) cache.clearStore(store._id);
  } catch {
    /* cache is best effort */
  }
  return summary;
}

function startReportScheduler({ hour = 2, minute = 30, timezone = REPORT_TIMEZONE } = {}) {
  if (started) return timer;
  started = true;

  const arm = () => {
    const next = nextRunAt(new Date(), hour, minute, timezone);
    const delay = Math.max(1000, next.getTime() - Date.now());
    timer = setTimeout(async () => {
      try {
        const result = await runReconciliation({ timezone });
        console.log("report reconciliation:", JSON.stringify(result));
      } catch (err) {
        console.error("report reconciliation failed:", err.message);
      } finally {
        arm();
      }
    }, delay);
    if (timer.unref) timer.unref();
  };
  arm();
  return timer;
}

function stopReportScheduler() {
  if (timer) clearTimeout(timer);
  timer = null;
  started = false;
}

module.exports = {
  nextRunAt,
  runReconciliation,
  startReportScheduler,
  stopReportScheduler,
};
