const User = require("../models/User");
const { getStoreId } = require("../lib/tenantContext");
const { normalizeSettingsInput } = require("../lib/supplierValidation");
const { auditSupplier } = require("../lib/supplierAudit");
const { getSupplierSettings, saveSupplierSettings } = require("../services/supplierSettings");
const queryService = require("../services/supplierQueryService");
const supplierService = require("../services/supplierService");
const reportService = require("../services/supplierReportService");
const { SupplierError } = require("../lib/supplierErrors");

function storeOf(req) {
  if (req.store && req.store._id) return req.store;
  const id = getStoreId();
  return id ? { _id: id } : null;
}

function requireStore(req, res) {
  const store = storeOf(req);
  if (!store) {
    res.status(400).json({ message: "Store pawa jayni" });
    return null;
  }
  return store;
}

function ctx(req) {
  return { store: storeOf(req)._id, user: req.user.id, req };
}

function wrap(fn) {
  return async function wrapped(req, res, next) {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

/* ------------------------------- suppliers ------------------------------- */

const list = wrap(async (req, res) => {
  const store = requireStore(req, res);
  if (!store) return;
  res.json(await queryService.listSuppliers(store, req.query));
});

const detail = wrap(async (req, res) => {
  const store = requireStore(req, res);
  if (!store) return;
  res.json(await queryService.getSupplierDetail(store, req.params.id));
});

const create = wrap(async (req, res) => {
  const supplier = await supplierService.createSupplier(ctx(req), req.body);
  res.status(201).json({ supplier });
});

const update = wrap(async (req, res) => {
  const supplier = await supplierService.updateSupplier(ctx(req), req.params.id, req.body);
  res.json({ supplier });
});

const voidSupplier = wrap(async (req, res) => {
  const result = await supplierService.voidSupplier(ctx(req), req.params.id, req.body.reason);
  res.json({ ok: true, alreadyVoid: result.alreadyVoid, supplier: result.supplier });
});

const trash = wrap(async (req, res) => {
  const result = await supplierService.trashSupplier(ctx(req), req.params.id, req.body.reason);
  res.json({ ok: true, alreadyTrashed: result.alreadyTrashed });
});

const restore = wrap(async (req, res) => {
  const result = await supplierService.restoreSupplier(ctx(req), req.params.id);
  res.json({ ok: true, alreadyActive: result.alreadyActive, supplier: result.supplier });
});

const purge = wrap(async (req, res) => {
  const deleted = await supplierService.purgeSupplier(ctx(req), req.params.id);
  res.json({ ok: true, deleted });
});

/* -------------------------------- orders --------------------------------- */

const createOrder = wrap(async (req, res) => {
  const result = await supplierService.createOrder(
    ctx(req),
    req.params.id,
    req.body,
    req.get("Idempotency-Key")
  );
  res.status(result.replayed ? 200 : 201).json(result);
});

const receiveOrder = wrap(async (req, res) => {
  const result = await supplierService.receiveOrder(ctx(req), req.params.id);
  res.json(result);
});

const cancelOrder = wrap(async (req, res) => {
  const result = await supplierService.cancelOrder(ctx(req), req.params.id, req.body.reason);
  res.json(result);
});

/* -------------------------------- invoices -------------------------------- */

const listInvoices = wrap(async (req, res) => {
  const store = requireStore(req, res);
  if (!store) return;
  res.json(
    await queryService.listInvoices(store, {
      ...req.query,
      supplierId: req.params.id,
    })
  );
});

const invoiceDetail = wrap(async (req, res) => {
  const store = requireStore(req, res);
  if (!store) return;
  res.json(await queryService.getInvoiceDetail(store, req.params.id));
});

const holdInvoice = wrap(async (req, res) => {
  const invoice = await supplierService.setInvoiceHold(ctx(req), req.params.id, req.body);
  res.json({ ok: true, invoice });
});

const voidInvoice = wrap(async (req, res) => {
  const result = await supplierService.voidInvoice(ctx(req), req.params.id, req.body.reason);
  res.json(result);
});

const printInvoice = wrap(async (req, res) => {
  const store = requireStore(req, res);
  if (!store) return;
  const html = await reportService.invoicePrintHtml(store, req.params.id);
  res.type("html").send(html);
});

/* -------------------------------- payments -------------------------------- */

const listPayments = wrap(async (req, res) => {
  const store = requireStore(req, res);
  if (!store) return;
  res.json(
    await queryService.listPayments(store, {
      ...req.query,
      supplierId: req.params.id,
    })
  );
});

const addPayment = wrap(async (req, res) => {
  const result = await supplierService.addPayment(ctx(req), req.params.id, req.body);
  res.status(201).json(result);
});

const voidPayment = wrap(async (req, res) => {
  const result = await supplierService.voidPayment(ctx(req), req.params.id, req.body.reason);
  res.json(result);
});

/* ------------------------------- stock log -------------------------------- */

const stockLog = wrap(async (req, res) => {
  const store = requireStore(req, res);
  if (!store) return;
  res.json(
    await queryService.listStockMovements(store, {
      ...req.query,
      supplierId: req.params.id,
    })
  );
});

const adjustStock = wrap(async (req, res) => {
  const result = await supplierService.adjustStock(ctx(req), req.params.id, req.body);
  res.status(201).json(result);
});

const productOptions = wrap(async (req, res) => {
  const store = requireStore(req, res);
  if (!store) return;
  res.json({ products: await queryService.productOptions(store, req.query) });
});

/* -------------------------------- reports --------------------------------- */

const report = wrap(async (req, res) => {
  const store = requireStore(req, res);
  if (!store) return;
  res.json(await reportService.getReport(store, req.query));
});

const exportReport = wrap(async (req, res) => {
  const store = requireStore(req, res);
  if (!store) return;
  const result = await reportService.exportReportCsv(store, req.query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${result.file}"`);
  res.send(result.csv);
});

/* -------------------------------- settings -------------------------------- */

const getSettings = wrap(async (req, res) => {
  const store = requireStore(req, res);
  if (!store) return;
  const [settings, user] = await Promise.all([
    getSupplierSettings(store._id),
    User.findById(req.user.id).select("role").lean(),
  ]);
  const superadmin = !!user && user.role === "superadmin";
  res.json({
    settings,
    canManageSettings: superadmin,
    canPurge: superadmin,
  });
});

const updateSettings = wrap(async (req, res) => {
  const store = requireStore(req, res);
  if (!store) return;
  const input = normalizeSettingsInput(req.body);
  const before = await getSupplierSettings(store._id);
  const settings = await saveSupplierSettings(store._id, input, req.user.id);
  await auditSupplier(req, {
    store: store._id,
    user: req.user.id,
    action: "supplier.settings.update",
    entity: "supplier_settings",
    entityId: String(store._id),
    oldValue: before,
    newValue: settings,
  });
  res.json({ settings, canManageSettings: true, canPurge: true });
});

function supplierErrorHandler(err, req, res, next) {
  if (err instanceof SupplierError) {
    return res.status(err.status || 400).json({ message: err.message });
  }
  if (err && err.name === "ValidationError") {
    const first = Object.values(err.errors || {})[0];
    return res.status(400).json({ message: (first && first.message) || "Validation fail" });
  }
  if (err && err.name === "CastError") {
    return res.status(400).json({ message: "ID valid na" });
  }
  if (err && (err.code === 11000 || err.code === 11001)) {
    return res.status(409).json({ message: "Duplicate value — abar check korun" });
  }
  if (err && /Transaction numbers are only allowed|replica set/i.test(String(err.message || ""))) {
    return res.status(503).json({ message: "Supplier order er jonno MongoDB replica set lagbe" });
  }
  return next(err);
}

module.exports = {
  list,
  detail,
  create,
  update,
  voidSupplier,
  trash,
  restore,
  purge,
  createOrder,
  receiveOrder,
  cancelOrder,
  listInvoices,
  invoiceDetail,
  holdInvoice,
  voidInvoice,
  printInvoice,
  listPayments,
  addPayment,
  voidPayment,
  stockLog,
  adjustStock,
  productOptions,
  report,
  exportReport,
  getSettings,
  updateSettings,
  supplierErrorHandler,
};
