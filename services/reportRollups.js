// Rebuilds report_daily* from raw orders. A day is always replaced as a whole,
// so retries and duplicate events can never double count.
const ReportDaily = require("../models/ReportDaily");
const ReportDailyProduct = require("../models/ReportDailyProduct");
const ReportDailyCategory = require("../models/ReportDailyCategory");
const ReportDailyCoupon = require("../models/ReportDailyCoupon");
const ReportDailyCustomer = require("../models/ReportDailyCustomer");
const { buildDaysData, ALL_DIMS } = require("./reportAggregation");
const { isDayKey, listDayKeys } = require("../lib/reportPeriods");
const {
  REPORT_TIMEZONE,
  REPORT_REBUILD_MAX_TIME_MS,
} = require("../lib/reportConstants");
const cache = require("./reportCache");

function invalidDay(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function rebuildDay(
  storeId,
  dayKey,
  timezone = REPORT_TIMEZONE,
  { maxTimeMS = REPORT_REBUILD_MAX_TIME_MS, clearCache = true } = {}
) {
  if (!isDayKey(dayKey)) throw invalidDay("Report date YYYY-MM-DD format e hote hobe");
  const { byDay } = await buildDaysData(storeId, [dayKey], timezone, {
    dims: ALL_DIMS,
    maxTimeMS,
  });
  const day = byDay.get(dayKey);
  const scope = { store: storeId, date: dayKey };

  await ReportDaily.updateOne(
    scope,
    { $set: { ...day.daily, ...scope } },
    { upsert: true }
  );

  await Promise.all([
    ReportDailyProduct.deleteMany(scope),
    ReportDailyCategory.deleteMany(scope),
    ReportDailyCoupon.deleteMany(scope),
    ReportDailyCustomer.deleteMany(scope),
  ]);

  const rows = (list, map) => list.map((row) => ({ ...scope, ...map(row) }));
  const writes = [
    [ReportDailyProduct, rows(day.products, (row) => ({ ...row }))],
    [ReportDailyCategory, rows(day.categories, (row) => ({ ...row }))],
    [ReportDailyCoupon, rows(day.coupons, (row) => ({ ...row }))],
    [ReportDailyCustomer, rows(day.customers, (row) => ({ ...row }))],
  ];
  for (const [Model, docs] of writes) {
    if (docs.length) await Model.insertMany(docs, { ordered: true });
  }

  if (clearCache) cache.clearStore(storeId);
  return {
    date: dayKey,
    orders: day.daily.ordersCount,
    products: day.products.length,
    categories: day.categories.length,
    coupons: day.coupons.length,
    customers: day.customers.length,
  };
}

async function rebuildRange(
  storeId,
  from,
  to,
  { timezone = REPORT_TIMEZONE, delayMs = 0, onProgress = null, maxTimeMS } = {}
) {
  if (!isDayKey(from) || !isDayKey(to)) throw invalidDay("Report date YYYY-MM-DD format e hote hobe");
  if (from > to) throw invalidDay("Start date end date er pore hote parbe na");

  const results = [];
  for (const dayKey of listDayKeys(from, to)) {
    results.push(
      await rebuildDay(storeId, dayKey, timezone, { maxTimeMS, clearCache: false })
    );
    if (onProgress) onProgress(results[results.length - 1]);
    if (delayMs > 0) await sleep(delayMs);
  }
  cache.clearStore(storeId);
  return results;
}

module.exports = { rebuildDay, rebuildRange, sleep };
