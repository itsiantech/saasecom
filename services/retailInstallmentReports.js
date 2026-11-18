/* ==========================================================================
   Retail EMI reports — live aggregation over the retail-tagged orders,
   installments, payments and applications. No rollup tables: a shop's retail
   EMI book is small enough that correctness beats caching, and one source of
   truth keeps the numbers identical to the review screens.
   ========================================================================== */
const mongoose = require("mongoose");
const InstallmentApplication = require("../models/InstallmentApplication");
const Order = require("../models/Order");
const OrderInstallment = require("../models/OrderInstallment");
const Payment = require("../models/Payment");
const { outstandingPaisa } = require("./installmentLedger");
const { buildXlsx } = require("../lib/xlsx");
const { fromPaisa } = require("../lib/money");

const DAY_MS = 24 * 60 * 60 * 1000;
const AGING = [
  { key: "current", label: "Not due yet" },
  { key: "1_30", label: "1–30 days" },
  { key: "31_60", label: "31–60 days" },
  { key: "61_90", label: "61–90 days" },
  { key: "91_plus", label: "91+ days" },
];
const METHOD_LABELS = { cash: "Cash", mobile: "Mobile banking", bank: "Bank transfer", manual: "Manual" };

function oid(value) {
  return new mongoose.Types.ObjectId(String(value));
}

function retailOrderFilter(storeId, extra = {}) {
  return {
    store: oid(storeId),
    paymentMode: "installment",
    "installmentPlan.source": "retail",
    ...extra,
  };
}

function periodRange(period) {
  return { $gte: period.startUtc, $lt: period.endExclusiveUtc };
}

function daysOverdue(dueDate, now) {
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - due.getTime()) / DAY_MS));
}

function bucketFor(dueDate, now) {
  const days = daysOverdue(dueDate, now);
  if (days <= 0) return "current";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "91_plus";
}

function sumBy(rows, pick) {
  return rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);
}

async function overview(storeId, period, { now = new Date() } = {}) {
  const range = periodRange(period);
  const store = oid(storeId);

  const [appRows, orders, payments] = await Promise.all([
    InstallmentApplication.aggregate([
      { $match: { store, createdAt: range } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          basePaisa: { $sum: "$basePaisa" },
          totalPaisa: { $sum: "$quote.totalPayablePaisa" },
        },
      },
    ]),
    Order.find(retailOrderFilter(storeId, { status: { $ne: "cancelled" } }))
      .select("_id orderNumber customerName customerPhone totalAmount paidAmount dueAmount createdAt installmentPlan")
      .lean(),
    Payment.aggregate([
      { $match: { store, status: "verified", $or: [{ verifiedAt: range }, { verifiedAt: null, createdAt: range }] } },
      {
        $group: {
          _id: {
            month: { $dateToString: { format: "%Y-%m", date: { $ifNull: ["$verifiedAt", "$createdAt"] } } },
            method: "$method",
          },
          count: { $sum: 1 },
          amountPaisa: { $sum: "$amountPaisa" },
        },
      },
      { $sort: { "_id.month": 1 } },
    ]),
  ]);

  const statusCount = {};
  let basePaisa = 0;
  let totalPaisa = 0;
  appRows.forEach((row) => {
    statusCount[row._id] = row.count;
    if (row._id === "approved") {
      basePaisa = row.basePaisa || 0;
      totalPaisa = row.totalPaisa || 0;
    }
  });
  const approved = statusCount.approved || 0;
  const decided = approved + (statusCount.rejected || 0) + (statusCount.expired || 0) + (statusCount.cancelled || 0);

  const orderIds = orders.map((order) => order._id);
  const rows = orderIds.length
    ? await OrderInstallment.find({
        store,
        order: { $in: orderIds },
        status: { $in: ["pending", "overdue"] },
      }).lean()
    : [];

  const agingMap = {};
  AGING.forEach((bucket) => {
    agingMap[bucket.key] = { ...bucket, count: 0, amountPaisa: 0 };
  });
  let overdueCount = 0;
  let overduePaisa = 0;
  for (const row of rows) {
    const due = outstandingPaisa(row);
    if (due <= 0) continue;
    const bucket = agingMap[bucketFor(row.dueDate, now)];
    bucket.count += 1;
    bucket.amountPaisa += due;
    if (new Date(row.dueDate).getTime() < now.getTime()) {
      overdueCount += 1;
      overduePaisa += due;
    }
  }

  const byMonth = new Map();
  const byMethod = new Map();
  for (const row of payments) {
    const month = row._id.month;
    const method = String(row._id.method || "cash").split(":")[0];
    if (!byMonth.has(month)) byMonth.set(month, { month, count: 0, amountPaisa: 0 });
    const m = byMonth.get(month);
    m.count += row.count;
    m.amountPaisa += row.amountPaisa;
    if (!byMethod.has(method)) {
      byMethod.set(method, { method, label: METHOD_LABELS[method] || method, count: 0, amountPaisa: 0 });
    }
    const b = byMethod.get(method);
    b.count += row.count;
    b.amountPaisa += row.amountPaisa;
  }

  const orderMap = new Map(orders.map((order) => [String(order._id), order]));
  const topOverdue = rows
    .map((row) => {
      const due = outstandingPaisa(row);
      const days = daysOverdue(row.dueDate, now);
      if (due <= 0 || days <= 0) return null;
      const order = orderMap.get(String(row.order));
      if (!order) return null;
      return {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        customerName: order.customerName || "",
        customerPhone: order.customerPhone || "",
        installmentNumber: row.number,
        dueDate: row.dueDate,
        daysOverdue: days,
        outstandingPaisa: due,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstandingPaisa - a.outstandingPaisa)
    .slice(0, 8);

  const earnings = {
    profitPaisa: sumBy(orders, (order) => (order.installmentPlan || {}).profitPaisa),
    serviceChargePaisa: sumBy(orders, (order) => (order.installmentPlan || {}).serviceChargePaisa),
  };
  earnings.totalPaisa = earnings.profitPaisa + earnings.serviceChargePaisa;

  return {
    generatedAt: now,
    period: { from: period.from, to: period.to, preset: period.preset || null, days: period.days },
    applications: {
      total: Object.values(statusCount).reduce((sum, n) => sum + n, 0),
      pending: statusCount.pending_review || 0,
      infoRequested: statusCount.info_requested || 0,
      approved,
      rejected: statusCount.rejected || 0,
      cancelled: statusCount.cancelled || 0,
      expired: statusCount.expired || 0,
      decided,
      approvalRatePct: decided ? Math.round((approved / decided) * 1000) / 10 : 0,
      avgBasePaisa: approved ? Math.round(basePaisa / approved) : 0,
      avgTotalPayablePaisa: approved ? Math.round(totalPaisa / approved) : 0,
    },
    portfolio: {
      orders: orders.length,
      financedPaisa: sumBy(orders, (order) => Math.round((Number(order.totalAmount) || 0) * 100)),
      collectedPaisa: sumBy(orders, (order) => order.paidAmount),
      outstandingPaisa: sumBy(orders, (order) => order.dueAmount),
      openInstallments: rows.length,
      overdueCount,
      overduePaisa,
    },
    aging: AGING.map((bucket) => agingMap[bucket.key]),
    collections: {
      count: Array.from(byMonth.values()).reduce((sum, row) => sum + row.count, 0),
      amountPaisa: Array.from(byMonth.values()).reduce((sum, row) => sum + row.amountPaisa, 0),
      byMonth: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)),
      byMethod: Array.from(byMethod.values()).sort((a, b) => b.amountPaisa - a.amountPaisa),
    },
    earnings,
    topOverdue,
  };
}

function bdt(paisa) {
  return fromPaisa(Number(paisa) || 0);
}

function exportWorkbook(data) {
  const summaryRows = [
    ["Retail EMI report", `${data.period.from} to ${data.period.to}`],
    [],
    ["Applications", ""],
    ["Total", data.applications.total],
    ["Approved", data.applications.approved],
    ["Pending review", data.applications.pending],
    ["Info requested", data.applications.infoRequested],
    ["Rejected", data.applications.rejected],
    ["Cancelled", data.applications.cancelled],
    ["Expired", data.applications.expired],
    ["Approval rate %", data.applications.approvalRatePct],
    ["Average ticket (BDT)", bdt(data.applications.avgTotalPayablePaisa)],
    [],
    ["Portfolio (open retail EMI orders)", ""],
    ["Orders", data.portfolio.orders],
    ["Financed (BDT)", bdt(data.portfolio.financedPaisa)],
    ["Collected (BDT)", bdt(data.portfolio.collectedPaisa)],
    ["Outstanding (BDT)", bdt(data.portfolio.outstandingPaisa)],
    ["Overdue amount (BDT)", bdt(data.portfolio.overduePaisa)],
    ["Overdue installments", data.portfolio.overdueCount],
    [],
    ["Collections in period", ""],
    ["Verified payments", data.collections.count],
    ["Collected (BDT)", bdt(data.collections.amountPaisa)],
    [],
    ["Earnings", ""],
    ["Profit (BDT)", bdt(data.earnings.profitPaisa)],
    ["Service charge (BDT)", bdt(data.earnings.serviceChargePaisa)],
    ["Total (BDT)", bdt(data.earnings.totalPaisa)],
  ];

  const agingRows = [
    ["Bucket", "Installments", "Amount (BDT)"],
    ...data.aging.map((row) => [row.label, row.count, bdt(row.amountPaisa)]),
  ];

  const monthRows = [
    ["Month", "Payments", "Amount (BDT)"],
    ...data.collections.byMonth.map((row) => [row.month, row.count, bdt(row.amountPaisa)]),
  ];

  const methodRows = [
    ["Method", "Payments", "Amount (BDT)"],
    ...data.collections.byMethod.map((row) => [row.label, row.count, bdt(row.amountPaisa)]),
  ];

  const overdueRows = [
    ["Order", "Customer", "Phone", "Installment", "Due date", "Days overdue", "Outstanding (BDT)"],
    ...data.topOverdue.map((row) => [
      row.orderNumber,
      row.customerName,
      row.customerPhone,
      row.installmentNumber,
      new Date(row.dueDate).toISOString().slice(0, 10),
      row.daysOverdue,
      bdt(row.outstandingPaisa),
    ]),
  ];

  const buffer = buildXlsx([
    { name: "Summary", rows: summaryRows },
    { name: "Aging", rows: agingRows },
    { name: "Collections", rows: monthRows },
    { name: "Methods", rows: methodRows },
    { name: "Overdue", rows: overdueRows },
  ]);

  return {
    buffer,
    filename: `retail-emi-${data.period.from}-to-${data.period.to}.xlsx`,
  };
}

module.exports = { overview, exportWorkbook, AGING, bucketFor, daysOverdue };
