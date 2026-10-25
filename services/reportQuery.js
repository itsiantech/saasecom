const mongoose = require("mongoose");
const ReportDaily = require("../models/ReportDaily");
const ReportDailyProduct = require("../models/ReportDailyProduct");
const ReportDailyCategory = require("../models/ReportDailyCategory");
const ReportDailyCoupon = require("../models/ReportDailyCoupon");
const ReportDailyCustomer = require("../models/ReportDailyCustomer");
const { buildDaysData } = require("./reportAggregation");
const cache = require("./reportCache");
const { listDayKeys, todayKey, addDaysKey, chartBuckets } = require("../lib/reportPeriods");
const {
  REPORT_MAX_TIME_MS,
  REPORT_TIMEZONE,
  REPORT_CACHE_TTL_MS,
} = require("../lib/reportConstants");
const {
  averageDailyPaisa,
  netSalesPaisa,
  bdtOf,
} = require("../lib/reportMath");

const EMPTY_DAILY = {
  salesPaisa: 0,
  ordersCount: 0,
  itemsCount: 0,
  shippingPaisa: 0,
  couponDiscountPaisa: 0,
  refundsCount: 0,
  refundsAmountPaisa: 0,
  taxPaisa: 0,
};

function emptyMaps() {
  return {
    daily: new Map(),
    products: new Map(),
    categories: new Map(),
    coupons: new Map(),
    customers: new Map(),
  };
}

function storeObjectId(storeId) {
  return new mongoose.Types.ObjectId(String(storeId));
}

function addRow(map, key, row, sumFields, latestFields = []) {
  let target = map.get(key);
  if (!target) {
    target = { ...row };
    map.set(key, target);
    return;
  }
  for (const field of sumFields) target[field] = (target[field] || 0) + (row[field] || 0);
  for (const field of latestFields) {
    if (row[field] !== undefined && row[field] !== "") target[field] = row[field];
  }
}

function mergeData(target, source) {
  for (const [key, row] of source.daily) target.daily.set(key, { ...row });
  for (const [key, row] of source.products) {
    addRow(target.products, key, row, ["salesPaisa", "quantity", "ordersCount"], ["name"]);
  }
  for (const [key, row] of source.categories) {
    addRow(target.categories, key, row, ["salesPaisa", "quantity", "ordersCount"], ["name"]);
  }
  for (const [key, row] of source.coupons) {
    addRow(target.coupons, key, row, ["discountPaisa", "ordersCount"], ["label"]);
  }
  for (const [key, row] of source.customers) {
    addRow(target.customers, key, row, ["ordersCount", "spentPaisa"], ["name", "isGuest"]);
  }
}

function accumulateDay(target, dayData, dims) {
  if (dims.includes("daily")) target.daily.set(dayData.date, { ...dayData.daily });
  for (const row of dayData.products) {
    addRow(target.products, String(row.productId), row, ["salesPaisa", "quantity", "ordersCount"], ["name"]);
  }
  for (const row of dayData.categories) {
    addRow(target.categories, row.categoryKey, row, ["salesPaisa", "quantity", "ordersCount"], ["name"]);
  }
  for (const row of dayData.coupons) {
    addRow(target.coupons, row.couponCode, row, ["discountPaisa", "ordersCount"], ["label"]);
  }
  for (const row of dayData.customers) {
    addRow(target.customers, row.customerKey, row, ["ordersCount", "spentPaisa"], ["name", "isGuest"]);
  }
}

function aggregatePipe(match, groupId) {
  return [
    { $match: match },
    { $sort: { date: 1 } },
    {
      $group: {
        _id: groupId,
        name: { $last: "$name" },
        isGuest: { $last: "$isGuest" },
        salesPaisa: { $sum: "$salesPaisa" },
        quantity: { $sum: "$quantity" },
        ordersCount: { $sum: "$ordersCount" },
        spentPaisa: { $sum: "$spentPaisa" },
        discountPaisa: { $sum: "$discountPaisa" },
        label: { $last: "$label" },
      },
    },
  ];
}

async function loadRollupRows(storeId, from, to, dims, maxTimeMS) {
  const store = storeObjectId(storeId);
  const match = { store, date: { $gte: from, $lte: to } };
  const data = emptyMaps();
  const tasks = [];

  if (dims.includes("daily")) {
    tasks.push(
      ReportDaily.find({ store: storeId, date: { $gte: from, $lte: to } })
        .select("date salesPaisa ordersCount itemsCount shippingPaisa couponDiscountPaisa refundsCount refundsAmountPaisa taxPaisa")
        .maxTimeMS(maxTimeMS)
        .lean()
        .then((rows) => {
          for (const row of rows) {
            data.daily.set(row.date, {
              salesPaisa: row.salesPaisa || 0,
              ordersCount: row.ordersCount || 0,
              itemsCount: row.itemsCount || 0,
              shippingPaisa: row.shippingPaisa || 0,
              couponDiscountPaisa: row.couponDiscountPaisa || 0,
              refundsCount: row.refundsCount || 0,
              refundsAmountPaisa: row.refundsAmountPaisa || 0,
              taxPaisa: row.taxPaisa || 0,
            });
          }
        })
    );
  }

  if (dims.includes("products")) {
    tasks.push(
      ReportDailyProduct.aggregate(aggregatePipe(match, "$productId"))
        .option({ maxTimeMS })
        .then((rows) => {
          for (const row of rows) {
            const key = String(row._id);
            data.products.set(key, {
              productId: key,
              name: row.name || "",
              salesPaisa: row.salesPaisa || 0,
              quantity: row.quantity || 0,
              ordersCount: row.ordersCount || 0,
            });
          }
        })
    );
  }

  if (dims.includes("categories")) {
    tasks.push(
      ReportDailyCategory.aggregate(aggregatePipe(match, "$categoryKey"))
        .option({ maxTimeMS })
        .then((rows) => {
          for (const row of rows) {
            data.categories.set(String(row._id), {
              categoryKey: String(row._id),
              name: row.name || "",
              salesPaisa: row.salesPaisa || 0,
              quantity: row.quantity || 0,
              ordersCount: row.ordersCount || 0,
            });
          }
        })
    );
  }

  if (dims.includes("coupons")) {
    tasks.push(
      ReportDailyCoupon.aggregate(aggregatePipe(match, "$couponCode"))
        .option({ maxTimeMS })
        .then((rows) => {
          for (const row of rows) {
            data.coupons.set(String(row._id), {
              couponCode: String(row._id),
              label: row.label || "",
              discountPaisa: row.discountPaisa || 0,
              ordersCount: row.ordersCount || 0,
            });
          }
        })
    );
  }

  if (dims.includes("customers")) {
    tasks.push(
      ReportDailyCustomer.aggregate(aggregatePipe(match, "$customerKey"))
        .option({ maxTimeMS })
        .then((rows) => {
          for (const row of rows) {
            data.customers.set(String(row._id), {
              customerKey: String(row._id),
              name: row.name || "Guest",
              isGuest: row.isGuest !== false,
              ordersCount: row.ordersCount || 0,
              spentPaisa: row.spentPaisa || 0,
            });
          }
        })
    );
  }

  await Promise.all(tasks);
  return data;
}

async function loadPast(storeId, from, to, timezone, dims, { maxTimeMS = REPORT_MAX_TIME_MS } = {}) {
  const dimKey = [...dims].sort().join(",");
  const cacheKey = cache.keyFor(storeId, "past", from, to, `${timezone}|${dimKey}`);
  const hit = cache.get(cacheKey);
  if (hit) return hit;

  const keys = listDayKeys(from, to);
  const data = await loadRollupRows(storeId, from, to, dims, maxTimeMS);
  const missing = keys.filter((key) => !data.daily.has(key) && dims.includes("daily"));
  const missingForSubreports = keys.filter((key) => {
    if (dims.includes("daily")) return !data.daily.has(key);
    return false;
  });

  let rawKeys = missing;
  if (!dims.includes("daily")) {
    // Without the daily dimension we still need to know which days were never
    // rebuilt. A single daily projection is cheaper than pulling all orders.
    const rebuilt = await ReportDaily.find({ store: storeId, date: { $gte: from, $lte: to } })
      .select("date")
      .maxTimeMS(maxTimeMS)
      .lean();
    const present = new Set(rebuilt.map((row) => row.date));
    rawKeys = keys.filter((key) => !present.has(key));
  }
  if (missingForSubreports.length) rawKeys = missingForSubreports;

  if (rawKeys.length) {
    const raw = await buildDaysData(storeId, rawKeys, timezone, { dims, maxTimeMS });
    for (const [day, value] of raw.byDay) {
      if (dims.includes("daily")) data.daily.set(day, { ...value.daily });
      for (const row of value.products) {
        addRow(data.products, String(row.productId), row, ["salesPaisa", "quantity", "ordersCount"], ["name"]);
      }
      for (const row of value.categories) {
        addRow(data.categories, row.categoryKey, row, ["salesPaisa", "quantity", "ordersCount"], ["name"]);
      }
      for (const row of value.coupons) {
        addRow(data.coupons, row.couponCode, row, ["discountPaisa", "ordersCount"], ["label"]);
      }
      for (const row of value.customers) {
        addRow(data.customers, row.customerKey, row, ["ordersCount", "spentPaisa"], ["name", "isGuest"]);
      }
    }
  }

  if (dims.includes("daily")) {
    for (const key of keys) {
      if (!data.daily.has(key)) data.daily.set(key, { ...EMPTY_DAILY });
    }
  }
  cache.set(cacheKey, data, REPORT_CACHE_TTL_MS);
  return data;
}

function cloneMaps(data) {
  const out = emptyMaps();
  for (const [key, row] of data.daily) out.daily.set(key, { ...row });
  for (const [key, row] of data.products) out.products.set(key, { ...row });
  for (const [key, row] of data.categories) out.categories.set(key, { ...row });
  for (const [key, row] of data.coupons) out.coupons.set(key, { ...row });
  for (const [key, row] of data.customers) out.customers.set(key, { ...row });
  return out;
}

// Past days come from rollups (cached); today is always aggregated live so the
// page can never be stale.
async function loadRange(storeId, from, to, timezone, dims, { now = new Date(), maxTimeMS = REPORT_MAX_TIME_MS } = {}) {
  const today = todayKey(now, timezone);
  const yesterday = addDaysKey(today, -1);
  const pastTo = to < today ? to : from <= yesterday ? yesterday : null;
  const past = pastTo ? await loadPast(storeId, from, pastTo, timezone, dims, { maxTimeMS }) : emptyMaps();
  const out = cloneMaps(past);

  if (from <= today && today <= to) {
    const live = await buildDaysData(storeId, [today], timezone, { dims, maxTimeMS });
    const day = live.byDay.get(today);
    if (day) accumulateDay(out, day, dims);
  }
  return out;
}

function sumDays(data, from, to) {
  const total = { ...EMPTY_DAILY };
  for (const [day, row] of data.daily) {
    if (day < from || day > to) continue;
    for (const key of Object.keys(total)) total[key] += row[key] || 0;
  }
  return total;
}

async function getSummary(storeId, period, { now = new Date(), timezone = REPORT_TIMEZONE } = {}) {
  const dims = ["daily"];
  const range = await loadRange(storeId, period.from, period.to, timezone, dims, { now });
  const totals = sumDays(range, period.from, period.to);

  const today = todayKey(now, timezone);
  const ytdFrom = `${today.slice(0, 4)}-01-01`;
  const ytdData =
    period.from === ytdFrom && period.to === today
      ? range
      : await loadRange(storeId, ytdFrom, today, timezone, dims, { now });
  const ytd = sumDays(ytdData, ytdFrom, today);

  const chart = chartBuckets(period);
  const buckets = chart.buckets.map((bucket) => {
    let salesPaisa = 0;
    let orders = 0;
    for (const [day, row] of range.daily) {
      if (day < bucket.fromKey || day > bucket.toKey) continue;
      salesPaisa += row.salesPaisa || 0;
      orders += row.ordersCount || 0;
    }
    return { key: bucket.key, label: bucket.label, sales: bdtOf(salesPaisa), orders };
  });

  return {
    period: {
      from: period.from,
      to: period.to,
      days: period.days,
      timezone,
    },
    sales: bdtOf(totals.salesPaisa),
    averageDailySales: bdtOf(averageDailyPaisa(totals.salesPaisa, period.days)),
    netSalesThisYear: bdtOf(
      netSalesPaisa({
        salesPaisa: ytd.salesPaisa,
        refundsPaisa: ytd.refundsAmountPaisa,
        shippingPaisa: ytd.shippingPaisa,
        taxPaisa: ytd.taxPaisa,
      })
    ),
    ordersPlaced: totals.ordersCount,
    itemsPurchased: totals.itemsCount,
    refundedOrders: totals.refundsCount,
    shippingCharged: bdtOf(totals.shippingPaisa),
    couponsWorth: bdtOf(totals.couponDiscountPaisa),
    chart: { granularity: chart.granularity, buckets },
    generatedAt: new Date().toISOString(),
  };
}

function pageArgs(page, limit, defaultLimit = 20, maxLimit = 100) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const wanted = parseInt(limit, 10);
  const safeLimit = Math.min(maxLimit, Math.max(1, Number.isFinite(wanted) ? wanted : defaultLimit));
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
}

async function getSubreport(
  storeId,
  period,
  dimension,
  { now = new Date(), timezone = REPORT_TIMEZONE, sort = "", page = 1, limit = 20, maxLimit = 100 } = {}
) {
  const dims = [dimension];
  const data = await loadRange(storeId, period.from, period.to, timezone, dims, { now });
  let rows;

  if (dimension === "products") {
    rows = [...data.products.values()].map((row) => ({
      id: row.productId,
      name: row.name,
      salesPaisa: row.salesPaisa,
      quantity: row.quantity,
      orders: row.ordersCount,
    }));
    const byQuantity = sort === "quantity";
    rows.sort((a, b) =>
      byQuantity
        ? b.quantity - a.quantity || b.salesPaisa - a.salesPaisa || a.name.localeCompare(b.name)
        : b.salesPaisa - a.salesPaisa || b.quantity - a.quantity || a.name.localeCompare(b.name)
    );
  } else if (dimension === "categories") {
    rows = [...data.categories.values()].map((row) => ({
      key: row.categoryKey,
      name: row.name,
      salesPaisa: row.salesPaisa,
      quantity: row.quantity,
      orders: row.ordersCount,
    }));
    const byQuantity = sort === "quantity";
    rows.sort((a, b) =>
      byQuantity
        ? b.quantity - a.quantity || b.salesPaisa - a.salesPaisa || a.name.localeCompare(b.name)
        : b.salesPaisa - a.salesPaisa || b.quantity - a.quantity || a.name.localeCompare(b.name)
    );
  } else if (dimension === "coupons") {
    rows = [...data.coupons.values()].map((row) => ({
      code: row.couponCode,
      label: row.label,
      discountPaisa: row.discountPaisa,
      orders: row.ordersCount,
    }));
    rows.sort((a, b) => b.discountPaisa - a.discountPaisa || a.code.localeCompare(b.code));
  } else {
    throw Object.assign(new Error("Sub-report pawa jayni"), { status: 400 });
  }

  const total = rows.length;
  const paging = pageArgs(page, limit, 20, maxLimit);
  const paged = rows.slice(paging.skip, paging.skip + paging.limit);
  return {
    period: { from: period.from, to: period.to, days: period.days, timezone },
    dimension,
    rows: paged.map((row) => {
      const out = { ...row };
      if (out.salesPaisa !== undefined) {
        out.sales = bdtOf(out.salesPaisa);
        delete out.salesPaisa;
      }
      if (out.discountPaisa !== undefined) {
        out.discount = bdtOf(out.discountPaisa);
        delete out.discountPaisa;
      }
      return out;
    }),
    total,
    page: paging.page,
    pages: Math.max(1, Math.ceil(total / paging.limit)),
    limit: paging.limit,
    sort: (dimension === "products" || dimension === "categories") && sort === "quantity" ? "quantity" : "sales",
    generatedAt: new Date().toISOString(),
  };
}

async function getTopCustomers(
  storeId,
  period,
  { now = new Date(), timezone = REPORT_TIMEZONE, limit = 10 } = {}
) {
  const data = await loadRange(storeId, period.from, period.to, timezone, ["customers"], { now });
  const rows = [...data.customers.values()]
    .sort(
      (a, b) =>
        b.spentPaisa - a.spentPaisa ||
        b.ordersCount - a.ordersCount ||
        String(a.name).localeCompare(String(b.name))
    )
    .slice(0, Math.min(100, Math.max(1, parseInt(limit, 10) || 10)))
    .map((row) => ({
      name: row.name,
      isGuest: row.isGuest !== false,
      orders: row.ordersCount,
      totalSpent: bdtOf(row.spentPaisa),
    }));
  return {
    range: period.range,
    period: { from: period.from, to: period.to, timezone },
    rows,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  loadRange,
  loadPast,
  getSummary,
  getSubreport,
  getTopCustomers,
  pageArgs,
  emptyMaps,
};
