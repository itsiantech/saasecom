const mongoose = require("mongoose");
const SupplierInvoice = require("../models/SupplierInvoice");
const SupplierPayment = require("../models/SupplierPayment");
const SupplierOrder = require("../models/SupplierOrder");
const Supplier = require("../models/Supplier");
const Store = require("../models/Store");
const { SupplierError } = require("../lib/supplierErrors");
const {
  validPeriod,
  reportWindow,
  bucketLabel,
  mongoDateFormat,
} = require("../lib/supplierDomain");
const { getSupplierSettings } = require("./supplierSettings");
const { invoiceRow } = require("./supplierQueryService");
const { buildSupplierInvoiceHtml } = require("../lib/supplierInvoiceHtml");

const PAGE_SIZES = [10, 20, 50];

function pageArgs(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const wanted = parseInt(query.limit, 10);
  const limit = PAGE_SIZES.includes(wanted) ? wanted : 10;
  return { page, limit, skip: (page - 1) * limit };
}

async function reportContext(store, query) {
  const settings = await getSupplierSettings(store._id);
  const period = validPeriod(String(query.period || "daily"));
  if (!period) throw new SupplierError("Report period daily, monthly ba yearly hote hobe");
  const rawCount = parseInt(query.buckets, 10);
  const now = new Date();
  const window = reportWindow(period, rawCount || undefined, now, settings.timezone);
  const match = {
    store: store._id,
    state: "active",
    issueDate: { $gte: window.start, $lte: now },
  };
  if (query.supplierId) {
    if (!mongoose.isValidObjectId(query.supplierId)) throw new SupplierError("Supplier pawa jayni", 404);
    match.supplier = new mongoose.Types.ObjectId(query.supplierId);
  }
  return { settings, period, window, now, match };
}

async function getReport(store, query) {
  const { settings, period, window, match } = await reportContext(store, query);
  const { page, limit, skip } = pageArgs(query);
  const fmt = mongoDateFormat(period);

  const [bucketRows, summaryRows, invoiceDocs, invoiceCount] = await Promise.all([
    SupplierInvoice.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { date: "$issueDate", format: fmt, timezone: settings.timezone } },
          invoiceCount: { $sum: 1 },
          total: { $sum: "$totalAmountPaisa" },
          paid: { $sum: "$paidAmountPaisa" },
        },
      },
      {
        $project: {
          invoiceCount: 1,
          total: 1,
          paid: 1,
          due: {
            $cond: [{ $gt: ["$paid", "$total"] }, 0, { $subtract: ["$total", "$paid"] }],
          },
        },
      },
    ]),
    SupplierInvoice.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          invoiceCount: { $sum: 1 },
          total: { $sum: "$totalAmountPaisa" },
          paid: { $sum: "$paidAmountPaisa" },
        },
      },
      {
        $project: {
          invoiceCount: 1,
          total: 1,
          paid: 1,
          due: {
            $cond: [{ $gt: ["$paid", "$total"] }, 0, { $subtract: ["$total", "$paid"] }],
          },
        },
      },
    ]),
    SupplierInvoice.find(match)
      .sort({ issueDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("supplier", "name companyName")
      .populate("order", "orderNo status")
      .lean(),
    SupplierInvoice.countDocuments(match),
  ]);

  const byKey = new Map(bucketRows.map((row) => [row._id, row]));
  const buckets = window.keys.map((key) => {
    const row = byKey.get(key) || {};
    return {
      key,
      label: bucketLabel(key, period),
      invoiceCount: row.invoiceCount || 0,
      totalAmountPaisa: row.total || 0,
      paidAmountPaisa: row.paid || 0,
      dueAmountPaisa: row.due || 0,
    };
  });

  const summary = summaryRows[0] || {};
  return {
    period,
    timezone: settings.timezone,
    from: window.start,
    to: window.end,
    buckets,
    summary: {
      invoiceCount: summary.invoiceCount || 0,
      totalAmountPaisa: summary.total || 0,
      paidAmountPaisa: summary.paid || 0,
      dueAmountPaisa: summary.due || 0,
    },
    invoices: invoiceDocs.map(invoiceRow),
    total: invoiceCount,
    page,
    pages: Math.max(1, Math.ceil(invoiceCount / limit)),
    limit,
  };
}

function csvCell(value) {
  const s = String(value == null ? "" : value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function exportReportCsv(store, query) {
  const { settings, period, window, match } = await reportContext(store, query);
  const rows = await SupplierInvoice.find(match)
    .sort({ issueDate: -1, createdAt: -1 })
    .limit(5000)
    .populate("supplier", "name companyName")
    .populate("order", "orderNo")
    .lean();

  const lines = [
    ["Invoice No", "Issue Date", "Supplier", "Company", "Order No", "Qty", "Total (BDT)", "Paid (BDT)", "Due (BDT)", "Status", "Hold"],
  ];
  for (const inv of rows) {
    const row = invoiceRow(inv);
    lines.push([
      row.invoiceNo,
      new Date(inv.issueDate).toISOString().slice(0, 10),
      row.supplierName,
      row.companyName,
      row.orderNo,
      row.totalQty,
      (row.totalAmountPaisa / 100).toFixed(2),
      (row.paidAmountPaisa / 100).toFixed(2),
      (row.dueAmountPaisa / 100).toFixed(2),
      row.paymentStatus,
      row.holdFlag ? "yes" : "no",
    ]);
  }
  const csv = "\uFEFF" + lines.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const file = `supplier-orders-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
  return { csv, file, period, timezone: settings.timezone, from: window.start, count: rows.length };
}

async function invoicePrintHtml(store, invoiceId) {
  if (!mongoose.isValidObjectId(invoiceId)) throw new SupplierError("Invoice pawa jayni", 404);
  const invoice = await SupplierInvoice.findOne({ _id: invoiceId, store: store._id }).lean();
  if (!invoice) throw new SupplierError("Invoice pawa jayni", 404);
  const [supplier, order, payments, storeDoc] = await Promise.all([
    Supplier.findOne({ _id: invoice.supplier, store: store._id }).lean(),
    SupplierOrder.findOne({ _id: invoice.order, store: store._id }).lean(),
    SupplierPayment.find({ store: store._id, invoice: invoice._id }).sort({ paidAt: 1 }).lean(),
    Store.findById(store._id).select("name").lean(),
  ]);
  return buildSupplierInvoiceHtml({
    invoice,
    supplier: supplier || {},
    order: order || {},
    payments,
    storeName: (storeDoc && storeDoc.name) || "Store",
  });
}

module.exports = { getReport, exportReportCsv, invoicePrintHtml };
