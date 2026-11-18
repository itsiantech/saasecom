/* ==========================================================================
   Admin API for the retail cash + EMI module: settings, month offers,
   application review, converted orders, manual payment entry and reminders.
   Every route is behind requireFeature("installments") (see routes file).
   ========================================================================== */
const mongoose = require("mongoose");
const InstallmentSettings = require("../models/InstallmentSettings");
const InstallmentOffer = require("../models/InstallmentOffer");
const InstallmentApplication = require("../models/InstallmentApplication");
const Order = require("../models/Order");
const OrderInstallment = require("../models/OrderInstallment");
const Payment = require("../models/Payment");
const Category = require("../models/Category");
const {
  METHODS,
  DEFAULTS,
  normalizeSettings,
  normalizeOffer,
  getInstallmentSettings,
  clearInstallmentSettingsCache,
} = require("../lib/installmentSettings");
const { getStoreId } = require("../lib/tenantContext");
const { writeAudit } = require("../lib/audit");
const { outstandingPaisa } = require("../services/installmentLedger");
const { verifyPendingPayment } = require("../services/installmentPayments");
const { runRetailInstallmentScheduler } = require("../services/retailInstallmentScheduler");
const installmentDocuments = require("../services/installmentDocuments");
const retailReports = require("../services/retailInstallmentReports");
const { resolvePeriod } = require("../lib/reportPeriods");
const {
  approveApplication,
  rejectApplication,
  requestApplicationInfo,
  cancelApplication,
  nextOpenRow,
} = require("../services/retailInstallmentOrders");

const STATUSES = ["pending_review", "info_requested", "approved", "rejected", "cancelled", "expired", "completed"];

function storeOf(req) {
  if (req.store && req.store._id) return req.store._id;
  return getStoreId();
}

function fail(res, err) {
  const status = Number(err && err.status) || 400;
  const message = status >= 500 ? "Retail EMI API te somossa hoyeche" : err.message;
  if (status >= 500) console.error("retail emi:", err);
  return res.status(status).json({ message });
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applicationView(doc) {
  const quote = doc.quote || {};
  const applicant = doc.applicant || {};
  return {
    id: String(doc._id),
    number: doc.number,
    status: doc.status,
    createdAt: doc.createdAt,
    applicant: {
      name: applicant.name || "",
      phone: applicant.phone || "",
      email: applicant.email || "",
      address: applicant.address || "",
      guarantorName: applicant.guarantorName || "",
      guarantorPhone: applicant.guarantorPhone || "",
      guarantorRelation: applicant.guarantorRelation || "",
      note: applicant.note || "",
      // NID is ciphertext only; the admin sees that it exists, never the value
      nidPresent: !!applicant.nidEnc,
    },
    documents: (doc.documents || []).map((row) => ({ type: row.type, uploadedAt: row.uploadedAt })),
    items: (doc.items || []).map((item) => ({
      title: item.title,
      slug: item.slug,
      image: item.image,
      quantity: item.quantity,
      unitBasePaisa: item.unitBasePaisa,
      lineBasePaisa: item.lineBasePaisa,
    })),
    cashPaisa: doc.cashPaisa,
    basePaisa: doc.basePaisa,
    months: quote.months || 0,
    downPaymentPaisa: quote.downPaymentPaisa || 0,
    financedPaisa: quote.financedPaisa || 0,
    profitPaisa: quote.profitPaisa || 0,
    serviceChargePaisa: quote.serviceChargePaisa || 0,
    totalPayablePaisa: quote.totalPayablePaisa || 0,
    monthlyPaisa: quote.monthlyPaisa || 0,
    lastPaisa: quote.lastPaisa || 0,
    effectiveAnnualRatePct: quote.effectiveAnnualRatePct || 0,
    schedule: (quote.schedule || []).map((row) => ({
      number: row.number,
      amountPaisa: row.amountPaisa,
    })),
    review: doc.review || {},
    order: doc.order || null,
    stockReserved: doc.stockReserved === true,
    idempotencyKey: doc.idempotencyKey || "",
  };
}

function installmentView(row) {
  return {
    _id: row._id,
    number: row.number,
    amountPaisa: row.amountPaisa,
    paidPaisa: row.paidPaisa,
    outstandingPaisa: outstandingPaisa(row),
    lateFeePaisa: row.lateFeePaisa,
    dueDate: row.dueDate,
    status: row.status,
    paidAt: row.paidAt,
    remindersSent: row.remindersSent || {},
  };
}

function paymentView(row) {
  return {
    _id: row._id,
    installment: row.installment,
    method: row.method,
    methodLabel: row.methodLabel,
    senderNumber: row.senderNumber,
    trxId: row.trxId,
    amountPaisa: row.amountPaisa,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt,
    verifiedAt: row.verifiedAt,
  };
}

function orderView(order, installments, payments) {
  const rows = (installments || []).sort((a, b) => Number(a.number) - Number(b.number));
  const next = nextOpenRow(rows);
  return {
    _id: order._id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    status: order.status,
    paymentStatus: order.paymentStatus,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerEmail: order.customerEmail,
    address: order.address,
    totalPaisa: Math.round((Number(order.totalAmount) || 0) * 100),
    paidPaisa: order.paidAmount || 0,
    duePaisa: order.dueAmount || 0,
    plan: order.installmentPlan || {},
    items: (order.items || []).map((item) => ({
      product: item.product,
      image: item.image,
      quantity: item.quantity,
      price: item.price,
      unitPricePaisa: item.unitPricePaisa,
    })),
    installments: rows.map(installmentView),
    payments: (payments || []).map(paymentView),
    nextDue: next ? installmentView(next) : null,
  };
}

/* ------------------------------------------------------------------ *
 * Settings / offers
 * ------------------------------------------------------------------ */
async function getConfig(req, res) {
  try {
    const storeId = storeOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    const [settings, offers, categories] = await Promise.all([
      getInstallmentSettings(storeId),
      InstallmentOffer.find({ store: storeId }).sort({ sortOrder: 1, months: 1 }).lean(),
      Category.find({ store: storeId, status: "published" }).sort({ order: 1, name: 1 }).select("name level parent").lean(),
    ]);
    res.json({
      settings,
      defaults: DEFAULTS,
      methods: METHODS,
      offers: offers.map((row) => ({ ...normalizeOffer(row), _id: row._id })),
      categories: categories.map((row) => ({
        _id: row._id,
        name: row.name,
        level: row.level || 0,
        parent: row.parent || null,
      })),
    });
  } catch (err) {
    fail(res, err);
  }
}

async function saveSettings(req, res) {
  try {
    const storeId = storeOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    const input = req.body && req.body.settings ? req.body.settings : req.body || {};
    const clean = normalizeSettings(input);

    const before = await InstallmentSettings.findOne({ store: storeId }).lean();
    await InstallmentSettings.updateOne(
      { store: storeId },
      { $set: { ...clean, store: storeId } },
      { upsert: true }
    );
    clearInstallmentSettingsCache(storeId);

    await writeAudit({
      store: storeId,
      user: req.user && req.user.id,
      action: "installment_settings.update",
      entity: "InstallmentSettings",
      entityId: storeId,
      oldValue: before ? { enabled: before.enabled, method: before.method, annualRatePct: before.annualRatePct } : null,
      newValue: { enabled: clean.enabled, method: clean.method, annualRatePct: clean.annualRatePct },
    });

    res.json({ ok: true, settings: clean });
  } catch (err) {
    fail(res, err);
  }
}

function offerPayload(body = {}) {
  // Validate the raw months first: normalizeOffer clamps, so a typo like
  // "months: 1" would otherwise silently become a 2 month plan.
  const months = Number(body.months);
  if (!Number.isInteger(months) || months < 2 || months > 60) {
    const err = new Error("Months 2 theke 60 er moddhe hote hobe");
    err.status = 400;
    throw err;
  }
  const clean = normalizeOffer({ ...body, _id: undefined, months });
  if (!clean || !clean.name) {
    const err = new Error("Plan name lagbe");
    err.status = 400;
    throw err;
  }
  return {
    name: clean.name,
    months: clean.months,
    downPaymentPercent: clean.downPaymentPercent,
    method: clean.method,
    annualRatePct: clean.annualRatePct,
    markupPct: clean.markupPct,
    serviceChargePercent: clean.serviceChargePercent,
    serviceChargeFlatPaisa: clean.serviceChargeFlatPaisa,
    minProductPricePaisa: clean.minProductPricePaisa,
    isActive: clean.isActive,
    sortOrder: clean.sortOrder,
  };
}

async function createOffer(req, res) {
  try {
    const storeId = storeOf(req);
    const data = offerPayload(req.body);
    const doc = await InstallmentOffer.create({ store: storeId, ...data });
    await writeAudit({
      store: storeId,
      user: req.user && req.user.id,
      action: "installment_offer.create",
      entity: "InstallmentOffer",
      entityId: doc._id,
      newValue: data,
    });
    res.status(201).json({ ok: true, offer: { ...normalizeOffer(doc.toObject()), _id: doc._id } });
  } catch (err) {
    fail(res, err);
  }
}

async function updateOffer(req, res) {
  try {
    const storeId = storeOf(req);
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Plan pawa jayni" });
    const data = offerPayload(req.body);
    const before = await InstallmentOffer.findOne({ _id: req.params.id, store: storeId }).lean();
    if (!before) return res.status(404).json({ message: "Plan pawa jayni" });
    const doc = await InstallmentOffer.findOneAndUpdate(
      { _id: req.params.id, store: storeId },
      { $set: data },
      { new: true }
    );
    await writeAudit({
      store: storeId,
      user: req.user && req.user.id,
      action: "installment_offer.update",
      entity: "InstallmentOffer",
      entityId: doc._id,
      oldValue: normalizeOffer(before),
      newValue: data,
    });
    res.json({ ok: true, offer: { ...normalizeOffer(doc.toObject()), _id: doc._id } });
  } catch (err) {
    fail(res, err);
  }
}

async function deleteOffer(req, res) {
  try {
    const storeId = storeOf(req);
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Plan pawa jayni" });
    const doc = await InstallmentOffer.findOneAndDelete({ _id: req.params.id, store: storeId });
    if (!doc) return res.status(404).json({ message: "Plan pawa jayni" });
    await writeAudit({
      store: storeId,
      user: req.user && req.user.id,
      action: "installment_offer.delete",
      entity: "InstallmentOffer",
      entityId: doc._id,
      oldValue: normalizeOffer(doc.toObject()),
    });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
}

/* ------------------------------------------------------------------ *
 * Applications
 * ------------------------------------------------------------------ */
async function listApplications(req, res) {
  try {
    const storeId = storeOf(req);
    const status = STATUSES.includes(req.query.status) ? req.query.status : "";
    const search = String(req.query.search || "").trim().slice(0, 80);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

    const filter = { store: storeId };
    if (status) filter.status = status;
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ number: rx }, { "applicant.name": rx }, { "applicant.phone": rx }];
    }

    const [rows, grouped] = await Promise.all([
      InstallmentApplication.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      InstallmentApplication.aggregate([
        { $match: { store: new mongoose.Types.ObjectId(String(storeId)) } },
        { $group: { _id: "$status", count: { $sum: 1 }, totalPaisa: { $sum: "$basePaisa" } } },
      ]),
    ]);

    const counts = {};
    STATUSES.forEach((key) => {
      counts[key] = 0;
    });
    grouped.forEach((row) => {
      if (row._id) counts[row._id] = row.count;
    });

    res.json({
      applications: rows.map(applicationView),
      counts,
      total: Object.values(counts).reduce((sum, n) => sum + n, 0),
      status,
    });
  } catch (err) {
    fail(res, err);
  }
}

async function getApplication(req, res) {
  try {
    const storeId = storeOf(req);
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Application pawa jayni" });
    const doc = await InstallmentApplication.findOne({ _id: req.params.id, store: storeId }).lean();
    if (!doc) return res.status(404).json({ message: "Application pawa jayni" });
    const view = applicationView(doc);
    const vault = await installmentDocuments.listForApplication({ storeId, applicationId: doc._id });
    // Vault rows carry ids for the authenticated download; fall back to the
    // embedded summary for applications made before the vault existed.
    view.documents = vault.length ? vault : view.documents;
    res.json({ application: view });
  } catch (err) {
    fail(res, err);
  }
}

async function downloadDocument(req, res) {
  try {
    const storeId = storeOf(req);
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Application pawa jayni" });
    const { row, buffer } = await installmentDocuments.readDocument({
      storeId,
      applicationId: req.params.id,
      documentId: req.params.docId,
    });
    await writeAudit({
      store: storeId,
      user: req.user && req.user.id,
      action: "installment_document.view",
      entity: "InstallmentDocument",
      entityId: row._id,
      oldValue: null,
      newValue: { application: String(row.application), type: row.type, sizeBytes: row.sizeBytes },
    });
    const ext = row.mime === "image/png" ? "png" : row.mime === "image/webp" ? "webp" : "jpg";
    res.setHeader("Content-Type", row.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${row.type || "document"}.${ext}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store, private");
    res.send(buffer);
  } catch (err) {
    fail(res, err);
  }
}

async function purgeDocuments(req, res) {
  try {
    const storeId = storeOf(req);
    const summary = await installmentDocuments.purgeStoreDocuments(storeId);
    await writeAudit({
      store: storeId,
      user: req.user && req.user.id,
      action: "installment_document.purge",
      entity: "InstallmentDocument",
      entityId: storeId,
      oldValue: null,
      newValue: summary,
    });
    res.json({ ok: true, summary });
  } catch (err) {
    fail(res, err);
  }
}

function actionHandler(run) {
  return async function handler(req, res) {
    try {
      const storeId = storeOf(req);
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Application pawa jayni" });
      const result = await run({
        applicationId: req.params.id,
        storeId,
        actorUserId: req.user && req.user.id,
        body: req.body || {},
      });
      const doc = result && result.order ? await InstallmentApplication.findById(req.params.id).lean() : result;
      res.json({
        ok: true,
        application: doc ? applicationView(doc) : null,
        order: result && result.order
          ? {
              _id: result.order._id,
              orderNumber: result.order.orderNumber,
              totalPaisa: Math.round((Number(result.order.totalAmount) || 0) * 100),
              installments: (result.installments || []).length,
            }
          : null,
      });
    } catch (err) {
      fail(res, err);
    }
  };
}

const approve = actionHandler(({ applicationId, storeId, actorUserId, body }) =>
  approveApplication({
    applicationId,
    storeId,
    actorUserId,
    note: String(body.note || "").slice(0, 500),
  })
);

const reject = actionHandler(({ applicationId, storeId, actorUserId, body }) =>
  rejectApplication({
    applicationId,
    storeId,
    actorUserId,
    note: String(body.note || "Admin rejected").slice(0, 500),
  })
);

const info = actionHandler(({ applicationId, storeId, actorUserId, body }) =>
  requestApplicationInfo({
    applicationId,
    storeId,
    actorUserId,
    infoRequest: body.infoRequest || body.note || "",
  })
);

const cancel = actionHandler(({ applicationId, storeId, actorUserId, body }) =>
  cancelApplication({ applicationId, storeId, actorUserId, note: body.note || "" })
);

/* ------------------------------------------------------------------ *
 * Converted orders (retail only)
 * ------------------------------------------------------------------ */
function retailOrderQuery(storeId, extra = {}) {
  return { store: storeId, paymentMode: "installment", "installmentPlan.source": "retail", ...extra };
}

async function listOrders(req, res) {
  try {
    const storeId = storeOf(req);
    const orders = await Order.find(retailOrderQuery(storeId)).sort({ createdAt: -1 }).limit(100).lean();
    const ids = orders.map((order) => order._id);
    const [installments, payments] = ids.length
      ? await Promise.all([
          OrderInstallment.find({ order: { $in: ids } }).sort({ number: 1 }).lean(),
          Payment.find({ order: { $in: ids } }).sort({ createdAt: -1 }).lean(),
        ])
      : [[], []];

    const instMap = new Map();
    installments.forEach((row) => {
      const key = String(row.order);
      if (!instMap.has(key)) instMap.set(key, []);
      instMap.get(key).push(row);
    });
    const payMap = new Map();
    payments.forEach((row) => {
      const key = String(row.order);
      if (!payMap.has(key)) payMap.set(key, []);
      payMap.get(key).push(row);
    });

    const data = orders.map((order) =>
      orderView(order, instMap.get(String(order._id)) || [], payMap.get(String(order._id)) || [])
    );
    res.json({
      orders: data,
      stats: {
        orders: data.length,
        duePaisa: data.reduce((sum, row) => sum + row.duePaisa, 0),
        overdue: installments.filter(
          (row) =>
            row.status === "overdue" ||
            (row.status !== "paid" && row.status !== "cancelled" && new Date(row.dueDate) < new Date())
        ).length,
        pendingPayments: payments.filter((row) => row.status === "pending").length,
      },
    });
  } catch (err) {
    fail(res, err);
  }
}

async function getOrder(req, res) {
  try {
    const storeId = storeOf(req);
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Order pawa jayni" });
    const order = await Order.findOne(retailOrderQuery(storeId, { _id: req.params.id })).lean();
    if (!order) return res.status(404).json({ message: "Order pawa jayni" });
    const [installments, payments] = await Promise.all([
      OrderInstallment.find({ order: order._id }).sort({ number: 1 }).lean(),
      Payment.find({ order: order._id }).sort({ createdAt: -1 }).lean(),
    ]);
    res.json({ order: orderView(order, installments, payments) });
  } catch (err) {
    fail(res, err);
  }
}

function readMethod(body) {
  const method = String(body.method || "cash").trim();
  if (method === "cash") return { method: "cash", label: "Cash" };
  if (/^(mobile|bank|manual):/.test(method)) {
    const name = method.slice(method.indexOf(":") + 1).trim();
    const kind = method.startsWith("mobile") ? "Mobile banking" : method.startsWith("bank") ? "Bank transfer" : "Manual";
    return { method, label: `${kind} — ${name || "Other"}` };
  }
  return { method: "cash", label: "Cash" };
}

// Manual entry: cash at the counter, or a mobile/bank transfer the admin has
// already seen. `verify: false` keeps it pending for the normal verify queue.
async function recordPayment(req, res) {
  try {
    const storeId = storeOf(req);
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Order pawa jayni" });
    const order = await Order.findOne(retailOrderQuery(storeId, { _id: req.params.id }));
    if (!order) return res.status(404).json({ message: "Order pawa jayni" });
    if (order.status === "cancelled" || order.paymentStatus === "cancelled") {
      return res.status(400).json({ message: "Cancelled order e payment neowa jay na" });
    }

    const rows = await OrderInstallment.find({ order: order._id }).sort({ number: 1 });
    let installment = null;
    if (req.body.installmentId) {
      if (!mongoose.isValidObjectId(req.body.installmentId)) {
        return res.status(400).json({ message: "Installment id valid na" });
      }
      installment = rows.find((row) => String(row._id) === String(req.body.installmentId)) || null;
      if (!installment) return res.status(404).json({ message: "Installment pawa jayni" });
    } else {
      installment = nextOpenRow(rows);
    }
    if (!installment) return res.status(400).json({ message: "Kono due installment nei" });
    if (installment.status === "cancelled") return res.status(400).json({ message: "Ei installment cancelled" });

    const due = outstandingPaisa(installment);
    if (due <= 0) return res.status(400).json({ message: "Ei installment e baki nei" });

    const amountPaisa =
      req.body.amountPaisa === undefined || req.body.amountPaisa === null || req.body.amountPaisa === ""
        ? due
        : Number(req.body.amountPaisa);
    if (!Number.isInteger(amountPaisa) || amountPaisa <= 0) {
      return res.status(400).json({ message: "Payment amount valid paisa hote hobe" });
    }
    if (amountPaisa > due) {
      return res.status(400).json({ message: "Amount installment er baki taka er cheye beshi" });
    }

    const { method, label } = readMethod(req.body);
    const payment = await Payment.create({
      store: order.store,
      order: order._id,
      installment: installment._id,
      method,
      methodLabel: label,
      senderNumber: String(req.body.senderNumber || "").trim().slice(0, 20),
      trxId: String(req.body.trxId || "").trim().slice(0, 120),
      amountPaisa,
      status: "pending",
      note: String(req.body.note || `Manual entry — installment ${installment.number}`).slice(0, 300),
    });

    if (req.body.verify === false) {
      return res.status(201).json({ ok: true, verified: false, payment: paymentView(payment) });
    }

    try {
      const result = await verifyPendingPayment({
        paymentId: payment._id,
        actorUserId: req.user && req.user.id,
        source: "admin",
      });
      await writeAudit({
        store: storeId,
        user: req.user && req.user.id,
        action: "installment.payment_record",
        entity: "Payment",
        entityId: payment._id,
        oldValue: null,
        newValue: { amountPaisa, method: label, installment: installment.number },
      });
      res.status(201).json({
        ok: true,
        verified: true,
        payment: paymentView(result.payment),
        installment: installmentView(result.installment),
        order: {
          _id: order._id,
          paidPaisa: result.order.paidAmount,
          duePaisa: result.order.dueAmount,
          paymentStatus: result.order.paymentStatus,
          status: result.order.status,
        },
      });
    } catch (err) {
      await Payment.deleteOne({ _id: payment._id, status: "pending" }).catch(() => {});
      throw err;
    }
  } catch (err) {
    fail(res, err);
  }
}

/* ------------------------------------------------------------------ *
 * Reports — live aggregates, not the rollup pipeline (retail EMI books are
 * small and must match the review screens exactly).
 * ------------------------------------------------------------------ */
function reportPeriod(req) {
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  const preset = String(req.query.preset || "").trim();
  // The default preset must not leak into a custom range — resolvePeriod
  // rejects a preset mixed with from/to.
  return resolvePeriod({
    preset: preset || (from || to ? "" : "this_month"),
    from,
    to,
  });
}

async function reportsOverview(req, res) {
  try {
    const storeId = storeOf(req);
    const period = reportPeriod(req);
    const data = await retailReports.overview(storeId, period);
    res.setHeader("Cache-Control", "no-store");
    res.json(data);
  } catch (err) {
    fail(res, err);
  }
}

async function exportReport(req, res) {
  try {
    const storeId = storeOf(req);
    const period = reportPeriod(req);
    const data = await retailReports.overview(storeId, period);
    const file = retailReports.exportWorkbook(data);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(file.buffer);
  } catch (err) {
    fail(res, err);
  }
}

async function runScheduler(req, res) {
  try {
    const storeId = storeOf(req);
    const summary = await runRetailInstallmentScheduler({ storeId });
    res.json({ ok: true, summary });
  } catch (err) {
    fail(res, err);
  }
}

module.exports = {
  getConfig,
  saveSettings,
  createOffer,
  updateOffer,
  deleteOffer,
  listApplications,
  getApplication,
  downloadDocument,
  purgeDocuments,
  approve,
  reject,
  info,
  cancel,
  listOrders,
  getOrder,
  recordPayment,
  runScheduler,
  reportsOverview,
  exportReport,
};
