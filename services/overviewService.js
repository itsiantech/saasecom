/* Dashboard overview aggregate — one store-scoped call that feeds the admin
 * landing view: KPIs, retail/wholesale trend, order buckets, latest orders,
 * alerts, courier, finance, top products, marketing and the live flash sale.
 * Everything is derived from existing models; nothing here writes. */
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const FlashSale = require("../models/FlashSale");
const Cart = require("../models/Cart");
const Settings = require("../models/Settings");
const SupplierInvoice = require("../models/SupplierInvoice");
const { REPORT_TIMEZONE, MAX_CUSTOM_RANGE_DAYS } = require("../lib/reportConstants");
const { zonedDateKey } = require("../lib/supplierDomain");
const { resolvePeriod } = require("../lib/reportPeriods");
const { keysForStore, isScopedKey } = require("../lib/settingsScope");
const accountsService = require("./accountsService");

const OVERVIEW_SCAN = 20000;
const LOW_STOCK_THRESHOLD = 5;
const PERIODS = ["today", "7d", "30d", "custom"];
const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_BUCKETS = [
  { key: "pending", label: "Pending", statuses: ["pending", "call_not_received"] },
  { key: "processing", label: "Processing", statuses: ["processing", "confirmed"] },
  { key: "shipped", label: "Shipped", statuses: ["shipped", "on_the_way", "in_courier"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered", "completed"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
  { key: "returned", label: "Returned", statuses: ["incomplete", "returned"] },
];

const STATUS_TO_BUCKET = new Map();
STATUS_BUCKETS.forEach((bucket) => {
  bucket.statuses.forEach((status) => STATUS_TO_BUCKET.set(status, bucket.key));
});

const SOURCE_LABELS = {
  facebook: "Facebook",
  google: "Google",
  direct: "Direct",
  instagram: "Instagram",
  youtube: "YouTube",
  other: "Other",
};

function overviewError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function addDaysKey(dayKey, days) {
  const [y, m, d] = String(dayKey).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + Number(days || 0)));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function listDayKeys(from, to) {
  const keys = [];
  let cursor = from;
  while (cursor <= to && keys.length < MAX_CUSTOM_RANGE_DAYS + 2) {
    keys.push(cursor);
    cursor = addDaysKey(cursor, 1);
  }
  return keys;
}

function dayLabel(dayKey, count) {
  const [y, m, d] = String(dayKey).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (count === 1) return "Today";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return count > 14 ? `${d} ${months[m - 1]}` : weekday;
}

function resolveOverviewPeriod(input = {}, now = new Date()) {
  const today = zonedDateKey(now, REPORT_TIMEZONE);
  const preset = String(input.period || "today");
  if (!PERIODS.includes(preset)) {
    throw overviewError("Period today, 7d, 30d ba custom hote hobe");
  }

  let from;
  let to;
  if (preset === "today") {
    from = to = today;
  } else if (preset === "7d") {
    from = addDaysKey(today, -6);
    to = today;
  } else if (preset === "30d") {
    from = addDaysKey(today, -29);
    to = today;
  } else {
    from = String(input.from || "").trim();
    to = String(input.to || "").trim();
  }

  const current = resolvePeriod({ from, to }, { now });
  const days = current.days;
  const prevTo = addDaysKey(current.from, -1);
  const prevFrom = addDaysKey(prevTo, -(days - 1));
  const previous = resolvePeriod({ from: prevFrom, to: prevTo }, { now });

  const compareLabel =
    preset === "today"
      ? "vs yesterday"
      : days === 1
        ? "vs previous day"
        : `vs previous ${days} days`;

  return { preset, current, previous, compareLabel };
}

function bucketOf(status) {
  return STATUS_TO_BUCKET.get(String(status || "")) || "pending";
}

function amountPaisa(value) {
  return Math.round(Number(value) || 0);
}

function percentDelta(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function summarize(orders) {
  const summary = {
    orders: 0,
    salesPaisa: 0,
    activeOrders: 0,
    statusCounts: Object.fromEntries(STATUS_BUCKETS.map((bucket) => [bucket.key, 0])),
    guest: 0,
    registered: 0,
    customerIds: new Set(),
    trend: new Map(),
    couriers: new Map(),
    sources: new Map(),
    products: new Map(),
    codPendingPaisa: 0,
    pendingWholesale: 0,
    failedCourier: 0,
  };

  for (const order of orders) {
    const statusKey = bucketOf(order.status);
    const totalPaisa = amountPaisa(Number(order.totalAmount || 0) * 100);
    const cancelled = statusKey === "cancelled";

    summary.orders += 1;
    summary.statusCounts[statusKey] += 1;
    if (!cancelled) {
      summary.activeOrders += 1;
      summary.salesPaisa += totalPaisa;
    }

    if (order.customer) {
      summary.registered += 1;
      summary.customerIds.add(String(order.customer));
    } else {
      summary.guest += 1;
    }

    const dayKey = zonedDateKey(order.createdAt, REPORT_TIMEZONE);
    const items = Array.isArray(order.items) ? order.items : [];
    if (!cancelled) {
      if (!summary.trend.has(dayKey)) {
        summary.trend.set(dayKey, { retailPaisa: 0, wholesalePaisa: 0 });
      }
      const day = summary.trend.get(dayKey);
      if (!items.length) {
        day.retailPaisa += totalPaisa;
      } else {
        for (const item of items) {
          const linePaisa = amountPaisa(Number(item.price || 0) * Number(item.quantity || 0) * 100);
          if (item.pricingMode === "wholesale") day.wholesalePaisa += linePaisa;
          else day.retailPaisa += linePaisa;
        }
      }

      for (const item of items) {
        if (!item.product) continue;
        const id = String(item.product);
        const row = summary.products.get(id) || { sold: 0, name: "" };
        row.sold += Number(item.quantity || 0);
        summary.products.set(id, row);
      }
    }

    if (statusKey === "delivered") {
      const courier = String(order.courierName || "").trim() || "Unassigned";
      summary.couriers.set(courier, (summary.couriers.get(courier) || 0) + 1);
    }

    const source = String(order.orderSource || "").trim().toLowerCase();
    if (source) summary.sources.set(source, (summary.sources.get(source) || 0) + 1);

    if (!cancelled && order.paymentStatus !== "paid") {
      let paidPaisa = 0;
      if (order.paymentMode === "installment" || order.paymentStatus === "partially_paid") {
        paidPaisa = amountPaisa(order.paidAmount);
      }
      summary.codPendingPaisa += Math.max(0, totalPaisa - paidPaisa);
    }

    if (statusKey === "pending" || statusKey === "processing") {
      if (items.some((item) => item.pricingMode === "wholesale")) summary.pendingWholesale += 1;
    }

    if (statusKey === "shipped" && !String(order.courierName || "").trim()) {
      summary.failedCourier += 1;
    }
  }

  return summary;
}

async function loadOrders(storeId, period) {
  return Order.find({
    store: storeId,
    createdAt: { $gte: period.startUtc, $lt: period.endExclusiveUtc },
  })
    .select(
      "orderNumber customer customerName totalAmount status paymentStatus paymentMode paidAmount " +
        "courierName orderSource items.product items.price items.quantity items.pricingMode createdAt"
    )
    .sort({ createdAt: -1 })
    .limit(OVERVIEW_SCAN)
    .lean();
}

async function countNewCustomers(storeId, period, customerIds) {
  if (!customerIds.size) return 0;
  const ids = [...customerIds]
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!ids.length) return 0;
  const prior = await Order.distinct("customer", {
    store: storeId,
    customer: { $in: ids },
    createdAt: { $lt: period.startUtc },
  });
  const seen = new Set(prior.map(String));
  return ids.filter((id) => !seen.has(String(id))).length;
}

function trendRows(period, summary) {
  const keys = listDayKeys(period.from, period.to);
  return keys.map((dayKey) => {
    const bucket = summary.trend.get(dayKey) || { retailPaisa: 0, wholesalePaisa: 0 };
    return {
      date: dayKey,
      label: dayLabel(dayKey, keys.length),
      retailPaisa: bucket.retailPaisa,
      wholesalePaisa: bucket.wholesalePaisa,
    };
  });
}

async function supplierDuePaisa(storeId) {
  const rows = await SupplierInvoice.aggregate([
    { $match: { store: storeId, state: "active" } },
    {
      $group: {
        _id: null,
        total: { $sum: { $ifNull: ["$totalAmountPaisa", 0] } },
        paid: { $sum: { $ifNull: ["$paidAmountPaisa", 0] } },
      },
    },
  ]);
  const row = rows[0] || { total: 0, paid: 0 };
  return Math.max(0, amountPaisa(row.total) - amountPaisa(row.paid));
}

async function customerDuePaisa(storeId) {
  const rows = await Order.aggregate([
    { $match: { store: storeId, status: { $ne: "cancelled" }, dueAmount: { $gt: 0 } } },
    { $group: { _id: null, total: { $sum: "$dueAmount" } } },
  ]);
  return amountPaisa(rows[0] && rows[0].total);
}

async function trackingEnabled(storeId) {
  const rows = await Settings.find({ key: { $in: keysForStore(storeId, ["sst_enabled"]) } }).lean();
  const own = rows.find((row) => isScopedKey(storeId, row.key));
  const platform = rows.find((row) => row.key === "sst_enabled");
  return String((own || platform || {}).value || "") === "true";
}

async function topProducts(storeId, summary) {
  const ranked = [...summary.products.entries()]
    .filter(([, row]) => row.sold > 0)
    .sort((a, b) => b[1].sold - a[1].sold)
    .slice(0, 3);
  if (!ranked.length) return [];
  const ids = ranked.map(([id]) => id).filter((id) => mongoose.isValidObjectId(id));
  const docs = ids.length
    ? await Product.find({ _id: { $in: ids } }).select("name title").lean()
    : [];
  const names = new Map(docs.map((doc) => [String(doc._id), doc.name || doc.title || "Product"]));
  return ranked.map(([id, row]) => ({ name: names.get(id) || "Product", sold: row.sold }));
}

function marketingSources(summary) {
  const entries = [...summary.sources.entries()].filter(([key]) => key);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  if (!total) return [];
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, count]) => ({
      label: SOURCE_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1),
      percent: Math.round((count / total) * 100),
    }));
}

async function activeFlashSale(storeId) {
  const now = new Date();
  const sale = await FlashSale.findOne({
    store: storeId,
    startAt: { $lte: now },
    endAt: { $gte: now },
  })
    .sort({ endAt: 1 })
    .select("title startAt endAt")
    .lean();
  if (!sale) return { active: false };
  const start = new Date(sale.startAt).getTime();
  const end = new Date(sale.endAt).getTime();
  const progress = end > start ? Math.min(100, Math.max(0, ((now.getTime() - start) / (end - start)) * 100)) : 0;
  return {
    active: true,
    title: sale.title || "Flash sale",
    startAt: sale.startAt,
    endAt: sale.endAt,
    progress: Math.round(progress),
  };
}

async function overview(storeId, input = {}) {
  if (!storeId) throw overviewError("Store context pawa jayni");
  const { preset, current, previous, compareLabel } = resolveOverviewPeriod(input);

  const [
    currentOrders,
    previousOrders,
    financeNow,
    financePrev,
  ] = await Promise.all([
    loadOrders(storeId, current),
    loadOrders(storeId, previous),
    accountsService.dashboard(storeId, current),
    accountsService.dashboard(storeId, previous),
  ]);

  const summary = summarize(currentOrders);
  const prevSummary = summarize(previousOrders);
  const range = { $gte: current.startUtc, $lt: current.endExclusiveUtc };

  const [
    newCustomers,
    prevNewCustomers,
    lowStock,
    outOfStock,
    supplierDue,
    customerDue,
    abandonedCarts,
    flashSale,
    tracking,
    top,
  ] = await Promise.all([
    countNewCustomers(storeId, current, summary.customerIds),
    countNewCustomers(storeId, previous, prevSummary.customerIds),
    Product.countDocuments({ store: storeId, stock: { $gt: 0, $lte: LOW_STOCK_THRESHOLD } }),
    Product.countDocuments({ store: storeId, stock: { $lte: 0 } }),
    supplierDuePaisa(storeId),
    customerDuePaisa(storeId),
    Cart.countDocuments({ store: storeId, updatedAt: range, "items.0": { $exists: true } }),
    activeFlashSale(storeId),
    trackingEnabled(storeId),
    topProducts(storeId, summary),
  ]);

  const salesPaisa = financeNow.sales.netSalesPaisa;
  const prevSalesPaisa = financePrev.sales.netSalesPaisa;
  const profitPaisa = financeNow.profit.netPaisa;
  const prevProfitPaisa = financePrev.profit.netPaisa;
  const avgPaisa = summary.orders ? Math.round(salesPaisa / summary.orders) : 0;
  const prevAvgPaisa = prevSummary.orders ? Math.round(prevSalesPaisa / prevSummary.orders) : 0;
  const expensePaisa = financeNow.purchases.totalPaisa + financeNow.expenses.costPaisa;
  const delivered = summary.statusCounts.delivered;
  const returned = summary.statusCounts.returned;
  const conversionBase = summary.activeOrders + abandonedCarts;
  const conversionRate = conversionBase
    ? Math.round((summary.activeOrders / conversionBase) * 1000) / 10
    : 0;

  const courierRows = [...summary.couriers.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name, deliveries]) => ({ name, delivered: deliveries }));

  return {
    period: {
      preset,
      from: current.from,
      to: current.to,
      days: current.days,
      compareLabel,
    },
    kpis: {
      totalSalesPaisa: salesPaisa,
      totalSalesDelta: percentDelta(salesPaisa, prevSalesPaisa),
      totalOrders: summary.orders,
      totalOrdersDelta: percentDelta(summary.orders, prevSummary.orders),
      pendingOrders: summary.statusCounts.pending,
      pendingDelta: summary.statusCounts.pending - prevSummary.statusCounts.pending,
      netProfitPaisa: profitPaisa,
      netProfitDelta: percentDelta(profitPaisa, prevProfitPaisa),
      newCustomers,
      newCustomersDelta: percentDelta(newCustomers, prevNewCustomers),
      avgOrderPaisa: avgPaisa,
      avgOrderDelta: percentDelta(avgPaisa, prevAvgPaisa),
    },
    trend: trendRows(current, summary),
    status: {
      rows: STATUS_BUCKETS.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        count: summary.statusCounts[bucket.key],
      })),
      guestPercent: summary.orders ? Math.round((summary.guest / summary.orders) * 100) : 0,
      registeredPercent: summary.orders ? Math.round((summary.registered / summary.orders) * 100) : 0,
    },
    latestOrders: currentOrders.slice(0, 5).map((order) => ({
      number: order.orderNumber || "",
      customer: order.customerName || "Guest",
      totalPaisa: amountPaisa(Number(order.totalAmount || 0) * 100),
      statusKey: bucketOf(order.status),
      statusLabel: (STATUS_BUCKETS.find((bucket) => bucket.key === bucketOf(order.status)) || STATUS_BUCKETS[0]).label,
      courier: order.courierName || "",
    })),
    alerts: {
      lowStock,
      outOfStock,
      failedCourier: summary.failedCourier,
      pendingWholesale: summary.pendingWholesale,
      tracking,
    },
    courier: {
      rows: courierRows,
      inTransit: summary.statusCounts.shipped,
      successRate: delivered + returned ? Math.round((delivered / (delivered + returned)) * 100) : 0,
      codPendingPaisa: summary.codPendingPaisa,
    },
    finance: {
      incomePaisa: salesPaisa,
      expensePaisa,
      supplierDuePaisa: supplierDue,
      customerDuePaisa: customerDue,
    },
    topProducts: top,
    marketing: {
      sources: marketingSources(summary),
      conversionRate,
      abandonedCarts,
    },
    flashSale,
  };
}

module.exports = {
  overview,
  resolveOverviewPeriod,
  PERIODS,
  LOW_STOCK_THRESHOLD,
};
