const Order = require("../models/Order");
const OrderStatusHistory = require("../models/OrderStatusHistory");
const Supplier = require("../models/Supplier");
const SupplierOrder = require("../models/SupplierOrder");
const SupplierInvoice = require("../models/SupplierInvoice");
const SupplierPayment = require("../models/SupplierPayment");
const FinanceEntry = require("../models/FinanceEntry");
const { buildXlsx } = require("../lib/xlsx");
const { REPORT_TIMEZONE } = require("../lib/reportConstants");
const { zonedDateKey } = require("../lib/supplierDomain");
const {
  KINDS,
  VOID_TYPES,
  KIND_META,
  MAX_ROW_SCAN,
  accountsError,
  isKind,
  kindLabel,
  cleanText,
  escapeRegex,
  toPaisa,
  parseAmountPaisa,
  parseEntryDate,
  parseMethod,
} = require("../lib/accounts");

const MAX_EXPORT_ROWS = 5000;
const MAX_LIST_ROWS = 300;
const MAX_SUPPLIERS = 1000;
const MAX_LEDGER_ROWS = 5000;

/* ------------------------------- utilities ------------------------------- */

function rangeOf(period) {
  return { $gte: period.startUtc, $lt: period.endExclusiveUtc };
}

function dayKey(date) {
  return zonedDateKey(date || new Date(), REPORT_TIMEZONE);
}

function money(paisa) {
  return Math.round(toPaisa(paisa) || 0) / 100;
}

function amountPaisa(value) {
  return Math.round(Number(value) || 0);
}

function orderMoney(order) {
  const totalPaisa = amountPaisa(Number(order.totalAmount || 0) * 100);
  const shippingPaisa = amountPaisa(Number(order.shippingAmount || 0) * 100);
  const discountPaisa = Number.isFinite(Number(order.couponDiscountPaisa)) && Number(order.couponDiscountPaisa) > 0
    ? amountPaisa(order.couponDiscountPaisa)
    : amountPaisa(Number(order.couponDiscount || 0) * 100);
  const grossPaisa = Math.max(0, totalPaisa - shippingPaisa + discountPaisa);

  const cancellation = order.installmentPlan && order.installmentPlan.cancellation;
  const refundPaisa = cancellation
    ? Math.max(0, amountPaisa(cancellation.refundPaisa))
    : order.paymentStatus === "refunded"
      ? totalPaisa
      : 0;

  let collectedPaisa = 0;
  if (order.status !== "cancelled") {
    if (order.paymentMode === "installment") {
      collectedPaisa = Math.max(0, amountPaisa(order.paidAmount));
    } else if (order.paymentStatus === "paid") {
      collectedPaisa = totalPaisa;
    } else if (order.paymentStatus === "partially_paid") {
      collectedPaisa = Math.max(0, amountPaisa(order.paidAmount));
    }
  } else if (order.paymentMode === "installment") {
    collectedPaisa = Math.max(0, amountPaisa(order.paidAmount) - refundPaisa);
  }

  return {
    totalPaisa,
    shippingPaisa,
    discountPaisa,
    grossPaisa,
    refundPaisa,
    collectedPaisa,
    cancelled: order.status === "cancelled",
    cancellationAt: cancellation && cancellation.at ? new Date(cancellation.at) : null,
  };
}

const ORDER_FIELDS =
  "orderNumber customerName customerEmail totalAmount shippingAmount couponDiscount couponDiscountPaisa " +
  "status paymentStatus paymentMode paidAmount dueAmount installmentPlan createdAt updatedAt";

async function loadOrders(storeId, period) {
  const cancellationWindow = {
    "installmentPlan.cancellation.at": rangeOf(period),
  };
  return Order.find({
    store: storeId,
    $or: [{ createdAt: rangeOf(period) }, cancellationWindow],
  })
    .select(ORDER_FIELDS)
    .sort({ createdAt: -1 })
    .limit(MAX_ROW_SCAN)
    .lean();
}

function emptySales() {
  return {
    orders: 0,
    items: 0,
    grossPaisa: 0,
    discountPaisa: 0,
    shippingPaisa: 0,
    netSalesPaisa: 0,
    collectedPaisa: 0,
    refundsPaisa: 0,
    refundedOrders: 0,
    cancelledOrders: 0,
    cancelledValuePaisa: 0,
  };
}

async function salesSnapshot(storeId, period) {
  const orders = await loadOrders(storeId, period);
  const totals = emptySales();
  const daily = new Map();
  const rows = [];

  orders.forEach((order) => {
    const moneyOf = orderMoney(order);
    const inSalesWindow = order.createdAt >= period.startUtc && order.createdAt < period.endExclusiveUtc;
    if (inSalesWindow) {
      const key = dayKey(order.createdAt);
      if (!daily.has(key)) {
        daily.set(key, {
          date: key,
          orders: 0,
          grossPaisa: 0,
          discountPaisa: 0,
          shippingPaisa: 0,
          netSalesPaisa: 0,
          cancelledOrders: 0,
          cancelledValuePaisa: 0,
          refundsPaisa: 0,
        });
      }
      const bucket = daily.get(key);
      if (moneyOf.cancelled) {
        totals.cancelledOrders += 1;
        totals.cancelledValuePaisa += moneyOf.totalPaisa;
        bucket.cancelledOrders += 1;
        bucket.cancelledValuePaisa += moneyOf.totalPaisa;
      } else {
        totals.orders += 1;
        totals.grossPaisa += moneyOf.grossPaisa;
        totals.discountPaisa += moneyOf.discountPaisa;
        totals.shippingPaisa += moneyOf.shippingPaisa;
        totals.netSalesPaisa += moneyOf.totalPaisa;
        bucket.orders += 1;
        bucket.grossPaisa += moneyOf.grossPaisa;
        bucket.discountPaisa += moneyOf.discountPaisa;
        bucket.shippingPaisa += moneyOf.shippingPaisa;
        bucket.netSalesPaisa += moneyOf.totalPaisa;
      }
      totals.collectedPaisa += moneyOf.collectedPaisa;
    }

    if (moneyOf.refundPaisa > 0) {
      totals.refundsPaisa += moneyOf.refundPaisa;
      totals.refundedOrders += 1;
      const refundKey = moneyOf.cancellationAt ? dayKey(moneyOf.cancellationAt) : dayKey(order.updatedAt || order.createdAt);
      if (daily.has(refundKey)) daily.get(refundKey).refundsPaisa += moneyOf.refundPaisa;
    }

    rows.push({
      id: String(order._id),
      date: order.createdAt,
      orderNumber: order.orderNumber || "",
      customer: order.customerName || "Guest",
      status: order.status || "",
      paymentStatus: order.paymentStatus || "",
      grossPaisa: moneyOf.grossPaisa,
      discountPaisa: moneyOf.discountPaisa,
      shippingPaisa: moneyOf.shippingPaisa,
      netPaisa: moneyOf.cancelled ? 0 : moneyOf.totalPaisa,
      refundPaisa: moneyOf.refundPaisa,
      cancelledValuePaisa: moneyOf.cancelled ? moneyOf.totalPaisa : 0,
      cancelled: moneyOf.cancelled,
    });
  });

  return {
    totals,
    rows: rows.slice(0, MAX_EXPORT_ROWS),
    totalRows: rows.length,
    daily: [...daily.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  };
}

/* -------------------------------- expenses ------------------------------- */

async function expenseSnapshot(storeId, period, kinds = KINDS) {
  const entries = await FinanceEntry.find({
    store: storeId,
    state: "active",
    kind: { $in: kinds },
    entryDate: rangeOf(period),
  })
    .select("kind title amountPaisa entryDate method reference note createdBy")
    .sort({ entryDate: -1, createdAt: -1 })
    .limit(MAX_EXPORT_ROWS)
    .lean();

  const byKind = {};
  kinds.forEach((kind) => {
    byKind[kind] = { kind, label: kindLabel(kind), count: 0, amountPaisa: 0 };
  });
  let totalPaisa = 0;
  let investedPaisa = 0;
  entries.forEach((entry) => {
    if (!byKind[entry.kind]) byKind[entry.kind] = { kind: entry.kind, label: kindLabel(entry.kind), count: 0, amountPaisa: 0 };
    byKind[entry.kind].count += 1;
    byKind[entry.kind].amountPaisa += amountPaisa(entry.amountPaisa);
    if (entry.kind === "investment") investedPaisa += amountPaisa(entry.amountPaisa);
    else totalPaisa += amountPaisa(entry.amountPaisa);
  });

  return { entries, byKind, totalPaisa, investedPaisa };
}

async function listEntries(storeId, kinds, period) {
  const wanted = kinds && kinds.length ? kinds : KINDS;
  const snapshot = await expenseSnapshot(storeId, period, wanted);
  const voided = await FinanceEntry.countDocuments({
    store: storeId,
    state: "void",
    kind: { $in: wanted },
    entryDate: rangeOf(period),
  });
  return {
    rows: snapshot.entries.slice(0, MAX_LIST_ROWS).map((entry) => ({
      id: String(entry._id),
      kind: entry.kind,
      label: kindLabel(entry.kind),
      title: entry.title,
      amountPaisa: amountPaisa(entry.amountPaisa),
      entryDate: entry.entryDate,
      method: entry.method,
      reference: entry.reference || "",
      note: entry.note || "",
    })),
    total: snapshot.entries.length,
    totals: snapshot.byKind,
    costPaisa: snapshot.totalPaisa,
    investmentPaisa: snapshot.investedPaisa,
    voided,
  };
}

async function createEntry(storeId, userId, body = {}) {
  const kind = String(body.kind || "").trim();
  if (!isKind(kind)) throw accountsError("Expense type valid na");
  const title = cleanText(body.title, "Title", 120);
  if (!title) throw accountsError("Title lagbe");
  const note = cleanText(body.note, "Note", 300);
  const reference = cleanText(body.reference, "Reference", 120);

  const entry = await FinanceEntry.create({
    store: storeId,
    kind,
    title,
    amountPaisa: parseAmountPaisa(body.amount),
    entryDate: parseEntryDate(body.entryDate),
    method: parseMethod(body.method),
    reference,
    note,
    createdBy: userId || null,
  });
  return {
    id: String(entry._id),
    kind: entry.kind,
    label: kindLabel(entry.kind),
    title: entry.title,
    amountPaisa: entry.amountPaisa,
    entryDate: entry.entryDate,
    method: entry.method,
    reference: entry.reference,
    note: entry.note,
  };
}

async function voidEntry(storeId, userId, id, reason) {
  const why = cleanText(reason, "Void reason", 300);
  if (!why) throw accountsError("Void reason lagbe");
  const updated = await FinanceEntry.findOneAndUpdate(
    { _id: id, store: storeId, state: "active" },
    { $set: { state: "void", voidReason: why, voidedAt: new Date(), voidedBy: userId || null } },
    { new: true }
  ).lean();
  if (updated) {
    return {
      id: String(updated._id),
      state: "void",
      title: updated.title,
      amountPaisa: updated.amountPaisa,
      kind: updated.kind,
    };
  }
  const existing = await FinanceEntry.findOne({ _id: id, store: storeId }).select("state").lean();
  if (!existing) throw accountsError("Entry pawa jayni", 404);
  return { id: String(id), state: "void", alreadyVoid: true };
}

/* -------------------------------- suppliers ------------------------------ */

async function supplierLedger(storeId, period, { q = "", limit = MAX_LIST_ROWS } = {}) {
  const needle = String(q || "").trim();
  const supplierQuery = { store: storeId };
  if (needle) {
    const rx = new RegExp(escapeRegex(needle), "i");
    supplierQuery.$or = [{ name: rx }, { phone: rx }, { companyName: rx }];
  }
  const suppliers = await Supplier.find(supplierQuery)
    .select("name companyName phone state")
    .sort({ name: 1 })
    .limit(MAX_SUPPLIERS)
    .lean();
  const supplierIds = suppliers.map((supplier) => supplier._id);
  if (!supplierIds.length) {
    return {
      rows: [],
      totals: { purchasesPaisa: 0, paidPaisa: 0, outstandingPaisa: 0, invoices: 0 },
      recent: [],
    };
  }

  const [invoices, payments] = await Promise.all([
    SupplierInvoice.find({ store: storeId, supplier: { $in: supplierIds }, state: "active" })
      .select("supplier invoiceNo totalAmountPaisa paidAmountPaisa holdFlag issueDate")
      .limit(MAX_LEDGER_ROWS)
      .lean(),
    SupplierPayment.find({
      store: storeId,
      supplier: { $in: supplierIds },
      state: "active",
      paidAt: rangeOf(period),
    })
      .select("supplier amountPaisa paidAt method reference invoice")
      .limit(MAX_LEDGER_ROWS)
      .lean(),
  ]);

  const map = new Map();
  suppliers.forEach((supplier) => {
    map.set(String(supplier._id), {
      id: String(supplier._id),
      name: supplier.name || "Supplier",
      company: supplier.companyName || "",
      phone: supplier.phone || "",
      state: supplier.state || "active",
      purchasesPaisa: 0,
      paidPaisa: 0,
      outstandingPaisa: 0,
      invoices: 0,
      holds: 0,
      lastPaymentAt: null,
    });
  });

  const invoiceNoById = new Map();
  invoices.forEach((invoice) => {
    const row = map.get(String(invoice.supplier));
    if (!row) return;
    invoiceNoById.set(String(invoice._id), invoice.invoiceNo || "");
    const total = amountPaisa(invoice.totalAmountPaisa);
    const paid = amountPaisa(invoice.paidAmountPaisa);
    row.outstandingPaisa += Math.max(0, total - paid);
    row.holds += invoice.holdFlag ? 1 : 0;
    row.invoices += 1;
    if (invoice.issueDate >= period.startUtc && invoice.issueDate < period.endExclusiveUtc) {
      row.purchasesPaisa += total;
    }
  });

  payments.forEach((payment) => {
    const row = map.get(String(payment.supplier));
    if (!row) return;
    row.paidPaisa += amountPaisa(payment.amountPaisa);
    if (!row.lastPaymentAt || payment.paidAt > row.lastPaymentAt) row.lastPaymentAt = payment.paidAt;
  });

  const rows = [...map.values()]
    .filter((row) => row.purchasesPaisa > 0 || row.paidPaisa > 0 || row.outstandingPaisa > 0)
    .sort((a, b) => b.outstandingPaisa - a.outstandingPaisa || b.purchasesPaisa - a.purchasesPaisa);

  const totals = rows.reduce(
    (acc, row) => {
      acc.purchasesPaisa += row.purchasesPaisa;
      acc.paidPaisa += row.paidPaisa;
      acc.outstandingPaisa += row.outstandingPaisa;
      acc.invoices += row.invoices;
      return acc;
    },
    { purchasesPaisa: 0, paidPaisa: 0, outstandingPaisa: 0, invoices: 0 }
  );

  const invoiceIds = payments.map((payment) => payment.invoice).filter(Boolean);
  const invoiceDocs = invoiceIds.length
    ? await SupplierInvoice.find({ store: storeId, _id: { $in: invoiceIds } })
        .select("invoiceNo")
        .lean()
    : [];
  invoiceDocs.forEach((invoice) => invoiceNoById.set(String(invoice._id), invoice.invoiceNo || ""));

  const recent = [
    ...invoices
      .filter((invoice) => invoice.issueDate >= period.startUtc && invoice.issueDate < period.endExclusiveUtc)
      .map((invoice) => ({
        at: invoice.issueDate,
        type: "purchase",
        supplier: (map.get(String(invoice.supplier)) || {}).name || "Supplier",
        reference: invoice.invoiceNo || "",
        amountPaisa: amountPaisa(invoice.totalAmountPaisa),
      })),
    ...payments.map((payment) => ({
      at: payment.paidAt,
      type: "payment",
      supplier: (map.get(String(payment.supplier)) || {}).name || "Supplier",
      reference: invoiceNoById.get(String(payment.invoice)) || payment.reference || "",
      amountPaisa: amountPaisa(payment.amountPaisa),
      method: payment.method || "",
    })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 100);

  return { rows: rows.slice(0, limit), totalSuppliers: rows.length, totals, recent };
}

/* -------------------------------- dashboard ------------------------------ */

async function dashboard(storeId, period) {
  const sales = await salesSnapshot(storeId, period);
  const scope = { store: storeId };
  const [invoiceTotals, paymentsPaid, expenses] = await Promise.all([
    SupplierInvoice.aggregate([
      { $match: { ...scope, state: "active", issueDate: rangeOf(period) } },
      {
        $group: {
          _id: null,
          totalPaisa: { $sum: "$totalAmountPaisa" },
          count: { $sum: 1 },
        },
      },
    ]),
    SupplierPayment.aggregate([
      { $match: { ...scope, state: "active", paidAt: rangeOf(period) } },
      { $group: { _id: null, totalPaisa: { $sum: "$amountPaisa" }, count: { $sum: 1 } } },
    ]),
    expenseSnapshot(storeId, period),
  ]);

  const purchasesPaisa = amountPaisa(invoiceTotals[0] && invoiceTotals[0].totalPaisa);
  const purchaseCount = (invoiceTotals[0] && invoiceTotals[0].count) || 0;
  const supplierPaidPaisa = amountPaisa(paymentsPaid[0] && paymentsPaid[0].totalPaisa);
  const supplierPaymentCount = (paymentsPaid[0] && paymentsPaid[0].count) || 0;
  const netProfitPaisa =
    sales.totals.netSalesPaisa - sales.totals.refundsPaisa - purchasesPaisa - expenses.totalPaisa;
  const cashPaisa =
    sales.totals.collectedPaisa + expenses.investedPaisa - supplierPaidPaisa - expenses.totalPaisa;

  return {
    period: { from: period.from, to: period.to, days: period.days, preset: period.preset },
    sales: sales.totals,
    purchases: { totalPaisa: purchasesPaisa, invoices: purchaseCount },
    supplierPayments: { totalPaisa: supplierPaidPaisa, count: supplierPaymentCount },
    expenses: {
      costPaisa: expenses.totalPaisa,
      investmentPaisa: expenses.investedPaisa,
      byKind: Object.values(expenses.byKind),
    },
    profit: { netPaisa: netProfitPaisa },
    cash: { balancePaisa: cashPaisa },
  };
}

/* ------------------------------- void logs ------------------------------- */

async function voidLogs(storeId, period, { type = "all", limit = MAX_LIST_ROWS } = {}) {
  const wanted = type && type !== "all" ? String(type) : "";
  if (wanted && !VOID_TYPES.includes(wanted)) throw accountsError("Log type valid na");
  const include = (kind) => !wanted || wanted === kind;
  const range = rangeOf(period);

  const [historyRows, legacyCancelled, supplierOrders, invoices, payments, expenseVoids] = await Promise.all([
    include("order_cancel")
      ? OrderStatusHistory.find({ store: storeId, toStatus: "cancelled", createdAt: range })
          .select("order fromStatus byName note createdAt")
          .sort({ createdAt: -1 })
          .limit(MAX_EXPORT_ROWS)
          .lean()
      : [],
    include("order_cancel")
      ? Order.find({ store: storeId, status: "cancelled", updatedAt: range })
          .select("orderNumber customerName totalAmount updatedAt")
          .sort({ updatedAt: -1 })
          .limit(MAX_EXPORT_ROWS)
          .lean()
      : [],
    include("supplier_order_cancel")
      ? SupplierOrder.find({ store: storeId, status: "cancelled", cancelledAt: range })
          .select("supplier orderNo totalAmountPaisa cancelReason cancelledAt")
          .sort({ cancelledAt: -1 })
          .limit(MAX_EXPORT_ROWS)
          .lean()
      : [],
    include("supplier_invoice_void")
      ? SupplierInvoice.find({ store: storeId, state: "void", voidedAt: range })
          .select("supplier invoiceNo totalAmountPaisa voidReason voidedAt")
          .sort({ voidedAt: -1 })
          .limit(MAX_EXPORT_ROWS)
          .lean()
      : [],
    include("supplier_payment_void")
      ? SupplierPayment.find({ store: storeId, state: "void", voidedAt: range })
          .select("supplier invoice amountPaisa voidReason voidedAt")
          .sort({ voidedAt: -1 })
          .limit(MAX_EXPORT_ROWS)
          .lean()
      : [],
    include("expense_void")
      ? FinanceEntry.find({ store: storeId, state: "void", voidedAt: range })
          .select("kind title amountPaisa voidReason voidedAt")
          .sort({ voidedAt: -1 })
          .limit(MAX_EXPORT_ROWS)
          .lean()
      : [],
  ]);

  const orderIds = historyRows.map((row) => row.order);
  const orders = orderIds.length
    ? await Order.find({ store: storeId, _id: { $in: orderIds } })
        .select("orderNumber customerName totalAmount")
        .lean()
    : [];
  const orderMap = new Map(orders.map((order) => [String(order._id), order]));

  const supplierIds = new Set();
  [supplierOrders, invoices, payments].forEach((list) => {
    list.forEach((row) => row.supplier && supplierIds.add(String(row.supplier)));
  });
  const suppliers = supplierIds.size
    ? await Supplier.find({ store: storeId, _id: { $in: [...supplierIds] } })
        .select("name")
        .lean()
    : [];
  const supplierMap = new Map(suppliers.map((supplier) => [String(supplier._id), supplier.name || "Supplier"]));

  const paymentInvoiceIds = payments.map((row) => row.invoice).filter(Boolean);
  const invoiceDocs = paymentInvoiceIds.length
    ? await SupplierInvoice.find({ store: storeId, _id: { $in: paymentInvoiceIds } })
        .select("invoiceNo")
        .lean()
    : [];
  const invoiceMap = new Map(invoiceDocs.map((invoice) => [String(invoice._id), invoice.invoiceNo || ""]));

  const rows = [];
  const seenOrders = new Set();
  historyRows.forEach((row) => {
    const order = orderMap.get(String(row.order));
    if (!order) return;
    seenOrders.add(String(row.order));
    rows.push({
      at: row.createdAt,
      type: "order_cancel",
      reference: order.orderNumber || "",
      party: order.customerName || "Guest",
      amountPaisa: amountPaisa(Number(order.totalAmount || 0) * 100),
      reason: row.note || (row.fromStatus ? `${row.fromStatus} → cancelled` : "Order cancelled"),
      actor: row.byName || "Admin",
    });
  });
  legacyCancelled.forEach((order) => {
    if (seenOrders.has(String(order._id))) return;
    rows.push({
      at: order.updatedAt,
      type: "order_cancel",
      reference: order.orderNumber || "",
      party: order.customerName || "Guest",
      amountPaisa: amountPaisa(Number(order.totalAmount || 0) * 100),
      reason: "Order cancelled",
      actor: "Admin",
    });
  });
  supplierOrders.forEach((row) => {
    rows.push({
      at: row.cancelledAt,
      type: "supplier_order_cancel",
      reference: row.orderNo || "",
      party: supplierMap.get(String(row.supplier)) || "Supplier",
      amountPaisa: amountPaisa(row.totalAmountPaisa),
      reason: row.cancelReason || "Purchase order cancelled",
      actor: "Admin",
    });
  });
  invoices.forEach((row) => {
    rows.push({
      at: row.voidedAt,
      type: "supplier_invoice_void",
      reference: row.invoiceNo || "",
      party: supplierMap.get(String(row.supplier)) || "Supplier",
      amountPaisa: amountPaisa(row.totalAmountPaisa),
      reason: row.voidReason || "Invoice voided",
      actor: "Admin",
    });
  });
  payments.forEach((row) => {
    rows.push({
      at: row.voidedAt,
      type: "supplier_payment_void",
      reference: invoiceMap.get(String(row.invoice)) || "",
      party: supplierMap.get(String(row.supplier)) || "Supplier",
      amountPaisa: amountPaisa(row.amountPaisa),
      reason: row.voidReason || "Payment voided",
      actor: "Admin",
    });
  });
  expenseVoids.forEach((row) => {
    rows.push({
      at: row.voidedAt,
      type: "expense_void",
      reference: row.title || "",
      party: kindLabel(row.kind),
      amountPaisa: amountPaisa(row.amountPaisa),
      reason: row.voidReason || "Expense voided",
      actor: "Admin",
    });
  });

  rows.sort((a, b) => new Date(b.at) - new Date(a.at));
  const totalsByType = {};
  VOID_TYPES.forEach((kind) => {
    totalsByType[kind] = { type: kind, count: 0, amountPaisa: 0 };
  });
  rows.forEach((row) => {
    totalsByType[row.type].count += 1;
    totalsByType[row.type].amountPaisa += row.amountPaisa;
  });

  return {
    rows: rows.slice(0, limit),
    total: rows.length,
    totals: totalsByType,
  };
}

/* --------------------------------- export -------------------------------- */

function bdt(paisa) {
  return money(paisa);
}

async function exportWorkbook(storeId, period) {
  const [summary, sales, ledger, expenses, voids] = await Promise.all([
    dashboard(storeId, period),
    salesSnapshot(storeId, period),
    supplierLedger(storeId, period, { limit: MAX_EXPORT_ROWS }),
    expenseSnapshot(storeId, period),
    voidLogs(storeId, period, { type: "all", limit: MAX_EXPORT_ROWS }),
  ]);

  const summaryRows = [
    ["Accounts & Finance report", ""],
    ["Store period", `${period.from} to ${period.to}`],
    ["Generated at", new Date().toISOString()],
    [],
    ["Metric", "Amount (BDT)", "Notes"],
    ["Net sales", bdt(summary.sales.netSalesPaisa), `${summary.sales.orders} orders`],
    ["Collected from customers", bdt(summary.sales.collectedPaisa), ""],
    ["Refunds", bdt(summary.sales.refundsPaisa), `${summary.sales.refundedOrders} refunded orders`],
    ["Cancelled order value", bdt(summary.sales.cancelledValuePaisa), `${summary.sales.cancelledOrders} cancelled orders`],
    ["Supplier purchases", bdt(summary.purchases.totalPaisa), `${summary.purchases.invoices} invoices`],
    ["Supplier payments", bdt(summary.supplierPayments.totalPaisa), `${summary.supplierPayments.count} payments`],
    ["Operating expenses", bdt(summary.expenses.costPaisa), "office + tech + marketing + salary"],
    ["Investment (capital in)", bdt(summary.expenses.investmentPaisa), ""],
    ["Net profit", bdt(summary.profit.netPaisa), "sales - refunds - purchases - expenses"],
    ["Cash balance", bdt(summary.cash.balancePaisa), "collected + investment - supplier payments - expenses"],
    [],
    ["Expense breakdown", "Amount (BDT)", "Entries"],
    ...summary.expenses.byKind.map((row) => [row.label, bdt(row.amountPaisa), row.count]),
  ];

  const salesRows = [
    ["Date", "Order", "Customer", "Status", "Payment", "Gross (BDT)", "Discount (BDT)", "Delivery (BDT)", "Net sales (BDT)", "Refund (BDT)", "Cancelled value (BDT)"],
    ...sales.rows.map((row) => [
      row.date,
      row.orderNumber,
      row.customer,
      row.status,
      row.paymentStatus,
      bdt(row.grossPaisa),
      bdt(row.discountPaisa),
      bdt(row.shippingPaisa),
      bdt(row.netPaisa),
      bdt(row.refundPaisa),
      bdt(row.cancelledValuePaisa),
    ]),
  ];

  const dailyRows = [
    ["Date", "Orders", "Gross (BDT)", "Discount (BDT)", "Delivery (BDT)", "Net sales (BDT)", "Cancelled orders", "Cancelled value (BDT)", "Refunds (BDT)"],
    ...sales.daily.map((row) => [
      row.date,
      row.orders,
      bdt(row.grossPaisa),
      bdt(row.discountPaisa),
      bdt(row.shippingPaisa),
      bdt(row.netSalesPaisa),
      row.cancelledOrders,
      bdt(row.cancelledValuePaisa),
      bdt(row.refundsPaisa),
    ]),
  ];

  const ledgerRows = [
    ["Supplier", "Company", "Phone", "Purchases (BDT)", "Paid (BDT)", "Outstanding (BDT)", "Invoices", "Hold invoices", "Last payment"],
    ...ledger.rows.map((row) => [
      row.name,
      row.company,
      row.phone,
      bdt(row.purchasesPaisa),
      bdt(row.paidPaisa),
      bdt(row.outstandingPaisa),
      row.invoices,
      row.holds,
      row.lastPaymentAt || "",
    ]),
    [],
    ["TOTAL", "", "", bdt(ledger.totals.purchasesPaisa), bdt(ledger.totals.paidPaisa), bdt(ledger.totals.outstandingPaisa), ledger.totals.invoices, "", ""],
  ];

  const expenseRows = [
    ["Date", "Category", "Title", "Amount (BDT)", "Method", "Reference", "Note"],
    ...expenses.entries.map((row) => [
      row.entryDate,
      kindLabel(row.kind),
      row.title,
      bdt(row.amountPaisa),
      row.method,
      row.reference || "",
      row.note || "",
    ]),
  ];

  const voidRows = [
    ["Date", "Type", "Reference", "Party", "Amount (BDT)", "Reason", "Actor"],
    ...voids.rows.map((row) => [
      row.at,
      row.type,
      row.reference,
      row.party,
      bdt(row.amountPaisa),
      row.reason,
      row.actor,
    ]),
  ];

  const buffer = buildXlsx([
    { name: "Summary", rows: summaryRows },
    { name: "Sales & Returns", rows: salesRows },
    { name: "Daily Sales", rows: dailyRows },
    { name: "Supplier Ledger", rows: ledgerRows },
    { name: "Expenses", rows: expenseRows },
    { name: "Void & Cancel Logs", rows: voidRows },
  ]);

  return {
    buffer,
    filename: `accounts-${period.from}-to-${period.to}.xlsx`,
  };
}

module.exports = {
  VOID_TYPES,
  dashboard,
  salesSnapshot,
  supplierLedger,
  listEntries,
  createEntry,
  voidEntry,
  voidLogs,
  exportWorkbook,
  orderMoney,
};
