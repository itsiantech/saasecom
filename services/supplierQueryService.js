const mongoose = require("mongoose");
const Supplier = require("../models/Supplier");
const SupplierInvoice = require("../models/SupplierInvoice");
const SupplierPayment = require("../models/SupplierPayment");
const SupplierOrder = require("../models/SupplierOrder");
const StockMovement = require("../models/StockMovement");
const Product = require("../models/Product");
const { SupplierError } = require("../lib/supplierErrors");
const {
  invoiceDuePaisa,
  invoicePaymentStatus,
  supplierPaymentStatus,
  escapeRegex,
} = require("../lib/supplierDomain");

const PAGE_SIZES = [10, 20, 50];
const FILTERS = ["all", "paid", "due", "hold", "void", "trash"];

function pageArgs(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const wanted = parseInt(query.limit, 10);
  const limit = PAGE_SIZES.includes(wanted) ? wanted : 10;
  return { page, limit, skip: (page - 1) * limit };
}

function supplierMatch(store, filter) {
  const m = { store: store._id ? store._id : store };
  if (filter === "void") return { ...m, state: "void" };
  if (filter === "trash") return { ...m, state: "trashed" };
  return { ...m, state: "active" };
}

function supplierPipeline({ storeId, match }) {
  const baseMatch = { ...match };
  return [
    { $match: baseMatch },
    {
      $lookup: {
        from: SupplierOrder.collection.name,
        let: { sid: "$_id", store: "$store" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$store", "$$store"] },
                  { $eq: ["$supplier", "$$sid"] },
                  { $in: ["$status", ["ordered", "received"]] },
                ],
              },
            },
          },
          {
            $group: {
              _id: null,
              totalQty: { $sum: "$totalQty" },
              orderCount: { $sum: 1 },
            },
          },
        ],
        as: "orderAgg",
      },
    },
    {
      $lookup: {
        from: SupplierInvoice.collection.name,
        let: { sid: "$_id", store: "$store" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$store", "$$store"] },
                  { $eq: ["$supplier", "$$sid"] },
                  { $eq: ["$state", "active"] },
                ],
              },
            },
          },
          {
            $project: {
              total: { $ifNull: ["$totalAmountPaisa", 0] },
              paid: { $ifNull: ["$paidAmountPaisa", 0] },
              status: {
                $cond: [
                  { $gte: ["$paidAmountPaisa", "$totalAmountPaisa"] },
                  "paid",
                  { $cond: [{ $eq: ["$holdFlag", true] }, "hold", "due"] },
                ],
              },
            },
          },
          {
            $group: {
              _id: null,
              invoiceCount: { $sum: 1 },
              total: { $sum: "$total" },
              paid: { $sum: "$paid" },
              holdCount: { $sum: { $cond: [{ $eq: ["$status", "hold"] }, 1, 0] } },
              dueCount: { $sum: { $cond: [{ $eq: ["$status", "due"] }, 1, 0] } },
              paidCount: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
            },
          },
        ],
        as: "invoiceAgg",
      },
    },
    {
      $lookup: {
        from: "products",
        let: { sid: "$_id", store: "$store" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [{ $eq: ["$store", "$$store"] }, { $eq: ["$supplierId", "$$sid"] }],
              },
            },
          },
          {
            $lookup: { from: "productvariations", localField: "_id", foreignField: "product", as: "variations" },
          },
          {
            $lookup: { from: "productswatches", localField: "_id", foreignField: "product", as: "swatches" },
          },
          {
            $project: {
              total: {
                $add: [
                  { $ifNull: ["$stock", 0] },
                  { $sum: "$variations.stock" },
                  { $sum: "$swatches.stock" },
                ],
              },
            },
          },
          { $group: { _id: null, inStock: { $sum: "$total" }, productCount: { $sum: 1 } } },
        ],
        as: "stockAgg",
      },
    },
    {
      $addFields: {
        orderQty: { $ifNull: [{ $first: "$orderAgg.totalQty" }, 0] },
        orderCount: { $ifNull: [{ $first: "$orderAgg.orderCount" }, 0] },
        invoiceCount: { $ifNull: [{ $first: "$invoiceAgg.invoiceCount" }, 0] },
        invoiceTotal: { $ifNull: [{ $first: "$invoiceAgg.total" }, 0] },
        invoicePaid: { $ifNull: [{ $first: "$invoiceAgg.paid" }, 0] },
        holdCount: { $ifNull: [{ $first: "$invoiceAgg.holdCount" }, 0] },
        dueCount: { $ifNull: [{ $first: "$invoiceAgg.dueCount" }, 0] },
        paidCount: { $ifNull: [{ $first: "$invoiceAgg.paidCount" }, 0] },
        inStock: { $ifNull: [{ $first: "$stockAgg.inStock" }, 0] },
        productCount: { $ifNull: [{ $first: "$stockAgg.productCount" }, 0] },
      },
    },
    {
      $addFields: {
        paymentStatus: {
          $cond: [
            { $eq: ["$invoiceCount", 0] },
            "none",
            {
              $cond: [
                { $gt: ["$holdCount", 0] },
                "hold",
                { $cond: [{ $gt: ["$dueCount", 0] }, "due", "paid"] },
              ],
            },
          ],
        },
        dueAmountPaisa: {
          $cond: [
            { $gt: ["$invoicePaid", "$invoiceTotal"] },
            0,
            { $subtract: ["$invoiceTotal", "$invoicePaid"] },
          ],
        },
      },
    },
  ];
}

function listRow(row) {
  return {
    id: String(row._id),
    name: row.name,
    companyName: row.companyName || "",
    address: row.address || "",
    phone: row.phone || "",
    email: row.email || "",
    note: row.note || "",
    state: row.state,
    orderQty: row.orderQty || 0,
    orderCount: row.orderCount || 0,
    invoiceCount: row.invoiceCount || 0,
    paymentStatus: row.paymentStatus || "none",
    totalPurchasePaisa: row.invoiceTotal || 0,
    paidAmountPaisa: row.invoicePaid || 0,
    dueAmountPaisa: row.dueAmountPaisa || 0,
    inStock: row.inStock || 0,
    productCount: row.productCount || 0,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  };
}

async function listSuppliers(store, query) {
  const { page, limit, skip } = pageArgs(query);
  const filter = FILTERS.includes(String(query.filter || "all")) ? String(query.filter || "all") : "all";
  const search = String(query.search || "").trim().slice(0, 120);
  const match = supplierMatch(store, filter);
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    match.$or = [
      { name: rx },
      { companyName: rx },
      { address: rx },
      { phone: rx },
      { email: rx },
      { note: rx },
    ];
  }

  const pipeline = supplierPipeline({ storeId: store._id, match });
  if (["paid", "due", "hold"].includes(filter)) {
    pipeline.push({ $match: { paymentStatus: filter } });
  }

  const sort = String(query.sort || "") === "name" ? { name: 1, updatedAt: -1 } : { updatedAt: -1 };
  pipeline.push({
    $facet: {
      rows: [{ $sort: sort }, { $skip: skip }, { $limit: limit }],
      meta: [{ $count: "total" }],
    },
  });

  const [result] = await Supplier.aggregate(pipeline);
  const total = (result && result.meta && result.meta[0] && result.meta[0].total) || 0;
  return {
    suppliers: (result ? result.rows : []).map(listRow),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    limit,
    filter,
  };
}

async function supplierStats(store, supplierId) {
  if (!mongoose.isValidObjectId(supplierId)) throw new SupplierError("Supplier pawa jayni", 404);
  const pipeline = supplierPipeline({
    storeId: store._id,
    match: { store: store._id, _id: new mongoose.Types.ObjectId(supplierId) },
  });
  pipeline.push({ $limit: 1 });
  const [row] = await Supplier.aggregate(pipeline);
  if (!row) throw new SupplierError("Supplier pawa jayni", 404);
  return listRow(row);
}

async function getSupplierDetail(store, supplierId) {
  if (!mongoose.isValidObjectId(supplierId)) throw new SupplierError("Supplier pawa jayni", 404);
  const supplier = await Supplier.findOne({ _id: supplierId, store: store._id }).lean();
  if (!supplier) throw new SupplierError("Supplier pawa jayni", 404);
  const stats = await supplierStats(store, supplierId);
  const [recentOrders, linkedProducts] = await Promise.all([
    SupplierOrder.find({ store: store._id, supplier: supplierId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    Product.find({ store: store._id, supplierId })
      .select("title name sku stock status")
      .sort({ createdAt: -1 })
      .limit(30)
      .lean(),
  ]);
  return {
    supplier: {
      id: String(supplier._id),
      name: supplier.name,
      companyName: supplier.companyName || "",
      address: supplier.address || "",
      phone: supplier.phone || "",
      email: supplier.email || "",
      note: supplier.note || "",
      state: supplier.state,
      voidReason: supplier.voidReason || "",
      createdAt: supplier.createdAt,
      updatedAt: supplier.updatedAt,
    },
    stats,
    recentOrders: recentOrders.map((o) => ({
      id: String(o._id),
      orderNo: o.orderNo,
      orderDate: o.orderDate,
      totalQty: o.totalQty,
      totalAmountPaisa: o.totalAmountPaisa,
      status: o.status,
      stockApplied: o.stockApplied === true,
    })),
    linkedProducts: linkedProducts.map((p) => ({
      id: String(p._id),
      name: p.title || p.name || "Product",
      sku: p.sku || "",
      stock: p.stock || 0,
      status: p.status,
    })),
  };
}

function invoiceRow(inv) {
  const supplier = inv.supplier && inv.supplier.name ? inv.supplier : null;
  const order = inv.order && inv.order.orderNo ? inv.order : null;
  return {
    id: String(inv._id),
    invoiceNo: inv.invoiceNo,
    issueDate: inv.issueDate,
    supplierId: String(supplier ? supplier._id : inv.supplier || ""),
    supplierName: supplier ? supplier.name : "",
    companyName: supplier ? supplier.companyName || "" : "",
    orderId: String(order ? order._id : inv.order || ""),
    orderNo: order ? order.orderNo : "",
    orderStatus: order ? order.status : "",
    stockApplied: order ? order.stockApplied === true : false,
    totalAmountPaisa: inv.totalAmountPaisa,
    paidAmountPaisa: inv.paidAmountPaisa,
    dueAmountPaisa: invoiceDuePaisa(inv),
    paymentStatus: invoicePaymentStatus(inv),
    holdFlag: inv.holdFlag === true,
    holdReason: inv.holdReason || "",
    state: inv.state,
    lineCount: (inv.lines || []).length,
    totalQty: (inv.lines || []).reduce((sum, l) => sum + (Number(l.quantity) || 0), 0),
  };
}

async function listInvoices(store, query) {
  const { page, limit, skip } = pageArgs(query);
  const match = { store: store._id };
  if (query.supplierId) {
    if (!mongoose.isValidObjectId(query.supplierId)) throw new SupplierError("Supplier pawa jayni", 404);
    match.supplier = query.supplierId;
  }
  const [rows, total] = await Promise.all([
    SupplierInvoice.find(match)
      .sort({ issueDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("supplier", "name companyName")
      .populate("order", "orderNo status")
      .lean(),
    SupplierInvoice.countDocuments(match),
  ]);
  return {
    invoices: rows.map(invoiceRow),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    limit,
  };
}

async function getInvoiceDetail(store, invoiceId) {
  if (!mongoose.isValidObjectId(invoiceId)) throw new SupplierError("Invoice pawa jayni", 404);
  const invoice = await SupplierInvoice.findOne({ _id: invoiceId, store: store._id })
    .populate("supplier", "name companyName phone email address")
    .populate("order", "orderNo status orderDate receivedAt stockApplied")
    .lean();
  if (!invoice) throw new SupplierError("Invoice pawa jayni", 404);

  const payments = await SupplierPayment.find({ store: store._id, invoice: invoiceId })
    .sort({ paidAt: 1, createdAt: 1 })
    .lean();

  return {
    invoice: {
      ...invoiceRow(invoice),
      voidReason: invoice.voidReason || "",
      createdAt: invoice.createdAt,
      lines: (invoice.lines || []).map((line) => ({
        productId: String(line.product),
        productCode: line.productCode,
        name: line.name,
        quantity: line.quantity,
        unitCostPaisa: line.unitCostPaisa,
        lineTotalPaisa: line.lineTotalPaisa,
      })),
    },
    supplier: invoice.supplier
      ? {
          id: String(invoice.supplier._id),
          name: invoice.supplier.name || "",
          companyName: invoice.supplier.companyName || "",
          phone: invoice.supplier.phone || "",
          email: invoice.supplier.email || "",
          address: invoice.supplier.address || "",
        }
      : null,
    order: invoice.order
      ? {
          id: String(invoice.order._id),
          orderNo: invoice.order.orderNo,
          status: invoice.order.status,
          orderDate: invoice.order.orderDate,
          receivedAt: invoice.order.receivedAt || null,
          stockApplied: invoice.order.stockApplied === true,
        }
      : null,
    payments: payments.map((p) => ({
      id: String(p._id),
      amountPaisa: p.amountPaisa,
      method: p.method,
      reference: p.reference || "",
      paidAt: p.paidAt,
      note: p.note || "",
      state: p.state,
      voidReason: p.voidReason || "",
    })),
  };
}

async function listPayments(store, query) {
  const { page, limit, skip } = pageArgs(query);
  const match = { store: store._id };
  if (query.supplierId) {
    if (!mongoose.isValidObjectId(query.supplierId)) throw new SupplierError("Supplier pawa jayni", 404);
    match.supplier = query.supplierId;
  }
  const [rows, total] = await Promise.all([
    SupplierPayment.find(match)
      .sort({ paidAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("invoice", "invoiceNo state")
      .populate("supplier", "name")
      .lean(),
    SupplierPayment.countDocuments(match),
  ]);
  return {
    payments: rows.map((p) => ({
      id: String(p._id),
      supplierId: String(p.supplier && p.supplier._id ? p.supplier._id : p.supplier),
      supplierName: p.supplier && p.supplier.name ? p.supplier.name : "",
      invoiceId: String(p.invoice && p.invoice._id ? p.invoice._id : p.invoice),
      invoiceNo: p.invoice && p.invoice.invoiceNo ? p.invoice.invoiceNo : "",
      invoiceState: p.invoice && p.invoice.state ? p.invoice.state : "",
      amountPaisa: p.amountPaisa,
      method: p.method,
      reference: p.reference || "",
      paidAt: p.paidAt,
      note: p.note || "",
      state: p.state,
      voidReason: p.voidReason || "",
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    limit,
  };
}

async function listStockMovements(store, query) {
  const { page, limit, skip } = pageArgs(query);
  const match = { store: store._id };
  if (query.supplierId) {
    if (!mongoose.isValidObjectId(query.supplierId)) throw new SupplierError("Supplier pawa jayni", 404);
    match.supplier = query.supplierId;
  }
  if (query.productId) {
    if (!mongoose.isValidObjectId(query.productId)) throw new SupplierError("Product pawa jayni", 404);
    match.product = query.productId;
  }
  const [rows, total] = await Promise.all([
    StockMovement.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("product", "title name sku")
      .populate("order", "orderNo")
      .lean(),
    StockMovement.countDocuments(match),
  ]);
  return {
    movements: rows.map((m) => ({
      id: String(m._id),
      productId: String(m.product && m.product._id ? m.product._id : m.product),
      productName: m.product ? m.product.title || m.product.name || "Product" : "",
      productCode: m.product ? m.product.sku || "" : "",
      orderId: m.order && m.order._id ? String(m.order._id) : "",
      orderNo: m.order && m.order.orderNo ? m.order.orderNo : "",
      change: m.change,
      stockAfter: m.stockAfter,
      mode: m.mode,
      reason: m.reason || "",
      createdAt: m.createdAt,
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    limit,
  };
}

async function productOptions(store, query) {
  const search = String(query.search || "").trim().slice(0, 120);
  const match = { store: store._id, status: "published" };
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    match.$or = [{ title: rx }, { name: rx }, { sku: rx }];
  }
  const rows = await Product.find(match)
    .select("title name sku stock supplierId")
    .sort({ createdAt: -1 })
    .limit(300)
    .lean();
  return rows.map((p) => ({
    id: String(p._id),
    name: p.title || p.name || "Product",
    sku: p.sku || "",
    stock: p.stock || 0,
    supplierId: p.supplierId ? String(p.supplierId) : "",
  }));
}

module.exports = {
  PAGE_SIZES,
  FILTERS,
  listSuppliers,
  getSupplierDetail,
  supplierStats,
  listInvoices,
  getInvoiceDetail,
  listPayments,
  listStockMovements,
  productOptions,
  invoiceRow,
};
