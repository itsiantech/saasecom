/* ==========================================================================
   Retail EMI order conversion. An approved InstallmentApplication becomes a
   normal Order (paymentMode "installment") plus OrderInstallment rows, so the
   shipped ledger, payment, reminder and receipt machinery keeps working.
   Stock was already reserved at application time; the order inherits it and
   never decrements a second time.
   ========================================================================== */
const crypto = require("crypto");
const Order = require("../models/Order");
const OrderInstallment = require("../models/OrderInstallment");
const Product = require("../models/Product");
const ProductVariation = require("../models/ProductVariation");
const InstallmentApplication = require("../models/InstallmentApplication");
const { fromPaisa } = require("../lib/money");
const { writeAudit } = require("../lib/audit");
const { outstandingPaisa } = require("./installmentLedger");

class RetailInstallmentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "RetailInstallmentError";
    this.status = status;
  }
}

function newOrderNumber() {
  return (
    "ORD-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    crypto.randomBytes(2).toString("hex").toUpperCase()
  );
}

// Same day next month, clamped to the shorter month's last day.
function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

// Down payment on the approval date, then one row per financed month.
function buildRetailSchedule(quote, startDate = new Date()) {
  if (!quote || typeof quote !== "object") {
    throw new RetailInstallmentError("Application quote nei — schedule banano jabe na");
  }
  const totalPaisa = Math.round(Number(quote.totalPayablePaisa) || 0);
  const downPaisa = Math.round(Number(quote.downPaymentPaisa) || 0);
  const rows = (Array.isArray(quote.schedule) ? quote.schedule : []).map((row, index) => ({
    number: 0,
    amountPaisa: Math.round(Number(row.amountPaisa) || 0),
    dueDate: addMonths(startDate, index + 1),
    status: "pending",
  }));

  if (!rows.length) throw new RetailInstallmentError("Application schedule faka");

  if (downPaisa > 0) {
    rows.unshift({
      number: 0,
      amountPaisa: downPaisa,
      dueDate: new Date(startDate.getTime()),
      status: "pending",
    });
  }
  rows.forEach((row, index) => {
    row.number = index + 1;
  });

  const sum = rows.reduce((acc, row) => acc + row.amountPaisa, 0);
  if (sum !== totalPaisa) {
    throw new RetailInstallmentError(
      `Schedule total ${fromPaisa(sum)} taka, quote total ${fromPaisa(totalPaisa)} taka — milche na`
    );
  }
  return rows;
}

// Application stock is reserved exactly once; release is idempotent.
async function releaseApplicationStock(applicationId, storeId, note = "stock release") {
  const app = await InstallmentApplication.findOne({ _id: applicationId, store: storeId });
  if (!app) return false;
  if (!app.stockReserved || app.stockReleased) return false;

  for (const item of app.items || []) {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const target = item.variation ? ProductVariation : Product;
    const targetId = item.variation || item.product;
    if (!targetId) continue;
    await target
      .updateOne({ _id: targetId, store: storeId }, { $inc: { stock: quantity } })
      .catch((err) => console.error("retail emi stock release:", note, err.message));
  }

  app.stockReleased = true;
  app.stockReserved = false;
  await app.save();
  return true;
}

function orderSnapshot(application, quote) {
  return {
    source: "retail",
    name: `${quote.months} months EMI`,
    months: quote.months,
    method: quote.method,
    annualRatePct: quote.annualRatePct || 0,
    markupPct: quote.markupPct || 0,
    effectiveAnnualRatePct: quote.effectiveAnnualRatePct || 0,
    basePaisa: quote.basePaisa,
    cashPaisa: quote.cashPaisa,
    downPaymentPaisa: quote.downPaymentPaisa || 0,
    financedPaisa: quote.financedPaisa || 0,
    profitPaisa: quote.profitPaisa || 0,
    serviceChargePaisa: quote.serviceChargePaisa || 0,
    totalPaisa: quote.totalPayablePaisa,
    goodsReleaseRule: "after_advance",
    application: String(application._id),
    applicationNumber: application.number || "",
    offerName: (application.offerSnapshot && application.offerSnapshot.name) || "",
  };
}

async function createOrderForApplication({ application, actorUserId = null, note = "" }) {
  const quote = application.quote;
  const schedule = buildRetailSchedule(quote);
  const totalPaisa = Math.round(Number(quote.totalPayablePaisa) || 0);
  const applicant = application.applicant || {};
  const items = (application.items || []).map((item) => ({
    product: item.product,
    variation: item.variation || null,
    image: item.image || "",
    unitPrice: fromPaisa(item.unitBasePaisa),
    unitPricePaisa: Number(item.unitBasePaisa) || 0,
    retailUnitPricePaisa: Number(item.unitBasePaisa) || 0,
    pricingMode: "retail",
    quantity: Math.max(1, Number(item.quantity) || 1),
    price: fromPaisa(item.lineBasePaisa),
  }));
  if (!items.length) throw new RetailInstallmentError("Application e product nei");

  const order = await Order.create({
    store: application.store,
    orderNumber: newOrderNumber(),
    customer: application.user || null,
    customerName: applicant.name,
    customerEmail: applicant.email || "",
    customerPhone: applicant.phone,
    address: applicant.address || "",
    billing: { name: applicant.name, address: applicant.address || "", email: applicant.email || "", phone: applicant.phone },
    shipping: { name: applicant.name, address: applicant.address || "", email: applicant.email || "", phone: applicant.phone },
    items,
    totalAmount: fromPaisa(totalPaisa),
    paymentMode: "installment",
    paymentMethod: "emi",
    paymentLabel: "Retail EMI",
    paidAmount: 0,
    dueAmount: totalPaisa,
    installmentPlan: orderSnapshot(application, quote),
    // stock moved at application time — never deduct twice
    stockDeducted: true,
    stockRestored: false,
    status: "pending",
    paymentStatus: "pending",
    orderNote: note ? String(note).slice(0, 500) : "",
  });

  const installments = await OrderInstallment.insertMany(
    schedule.map((row) => ({
      store: application.store,
      order: order._id,
      plan: null,
      planName: order.installmentPlan.name,
      number: row.number,
      amountPaisa: row.amountPaisa,
      dueDate: row.dueDate,
      status: "pending",
    }))
  );

  await InstallmentApplication.updateOne(
    { _id: application._id, store: application.store },
    {
      $set: {
        order: order._id,
        status: "approved",
        stockReserved: false,
        "review.reviewedBy": actorUserId || null,
        "review.reviewedAt": new Date(),
        "review.note": String(note || "").slice(0, 1000),
      },
    }
  );

  await writeAudit({
    store: application.store,
    user: actorUserId,
    action: "installment_application.approve",
    entity: "InstallmentApplication",
    entityId: application._id,
    oldValue: { status: application.status, number: application.number },
    newValue: {
      status: "approved",
      order: String(order._id),
      orderNumber: order.orderNumber,
      totalPaisa,
      installments: installments.length,
    },
  });

  return { order, installments };
}

// Claims the application first so two admins cannot create two orders.
async function approveApplication({ applicationId, storeId, actorUserId = null, note = "" }) {
  const claimed = await InstallmentApplication.findOneAndUpdate(
    {
      _id: applicationId,
      store: storeId,
      order: null,
      status: { $in: ["pending_review", "info_requested", "approved"] },
    },
    { $set: { status: "approved", "review.reviewedBy": actorUserId || null, "review.reviewedAt": new Date() } },
    { new: false }
  ).lean();
  if (!claimed) {
    const existing = await InstallmentApplication.findOne({ _id: applicationId, store: storeId }).lean();
    if (!existing) throw new RetailInstallmentError("Application pawa jayni", 404);
    if (existing.order) throw new RetailInstallmentError("Ei application theke agei order hoye geche", 409);
    throw new RetailInstallmentError("Ei application ekhon approve kora jabe na", 409);
  }

  try {
    return await createOrderForApplication({ application: claimed, actorUserId, note });
  } catch (err) {
    await InstallmentApplication.updateOne(
      { _id: claimed._id, store: storeId, order: null },
      { $set: { status: claimed.status } }
    );
    throw err;
  }
}

async function rejectApplication({ applicationId, storeId, actorUserId = null, note = "" }) {
  const app = await InstallmentApplication.findOneAndUpdate(
    { _id: applicationId, store: storeId, order: null, status: { $in: ["pending_review", "info_requested"] } },
    {
      $set: {
        status: "rejected",
        "review.reviewedBy": actorUserId || null,
        "review.reviewedAt": new Date(),
        "review.note": String(note || "").slice(0, 1000),
      },
    },
    { new: true }
  );
  if (!app) {
    const existing = await InstallmentApplication.findOne({ _id: applicationId, store: storeId }).lean();
    if (!existing) throw new RetailInstallmentError("Application pawa jayni", 404);
    if (existing.order) throw new RetailInstallmentError("Approved application reject kora jay na", 409);
    throw new RetailInstallmentError("Ei application reject kora jabe na", 409);
  }
  await releaseApplicationStock(app._id, storeId, "reject");

  await writeAudit({
    store: storeId,
    user: actorUserId,
    action: "installment_application.reject",
    entity: "InstallmentApplication",
    entityId: app._id,
    oldValue: { status: "pending_review" },
    newValue: { status: "rejected", note: app.review.note },
  });
  return app;
}

async function requestApplicationInfo({ applicationId, storeId, actorUserId = null, infoRequest = "" }) {
  const message = String(infoRequest || "").trim().slice(0, 1000);
  if (!message) throw new RetailInstallmentError("Ki information lagbe likhe din");
  const app = await InstallmentApplication.findOneAndUpdate(
    { _id: applicationId, store: storeId, order: null, status: { $in: ["pending_review", "info_requested"] } },
    {
      $set: {
        status: "info_requested",
        "review.infoRequest": message,
        "review.reviewedBy": actorUserId || null,
        "review.reviewedAt": new Date(),
      },
    },
    { new: true }
  );
  if (!app) throw new RetailInstallmentError("Ei application ekhon info request kora jabe na", 409);

  await writeAudit({
    store: storeId,
    user: actorUserId,
    action: "installment_application.info_request",
    entity: "InstallmentApplication",
    entityId: app._id,
    oldValue: null,
    newValue: { status: "info_requested", infoRequest: message },
  });
  return app;
}

async function cancelApplication({ applicationId, storeId, actorUserId = null, note = "" }) {
  const app = await InstallmentApplication.findOneAndUpdate(
    { _id: applicationId, store: storeId, order: null, status: { $in: ["pending_review", "info_requested"] } },
    {
      $set: {
        status: "cancelled",
        "review.reviewedBy": actorUserId || null,
        "review.reviewedAt": new Date(),
        "review.note": String(note || "").slice(0, 1000),
      },
    },
    { new: true }
  );
  if (!app) throw new RetailInstallmentError("Ei application cancel kora jabe na", 409);
  await releaseApplicationStock(app._id, storeId, "cancel");

  await writeAudit({
    store: storeId,
    user: actorUserId,
    action: "installment_application.cancel",
    entity: "InstallmentApplication",
    entityId: app._id,
    oldValue: null,
    newValue: { status: "cancelled" },
  });
  return app;
}

function nextOpenRow(installments) {
  return (installments || [])
    .filter((row) => row.status !== "paid" && row.status !== "cancelled")
    .filter((row) => outstandingPaisa(row) > 0)
    .sort((a, b) => Number(a.number) - Number(b.number))[0] || null;
}

module.exports = {
  RetailInstallmentError,
  addMonths,
  buildRetailSchedule,
  releaseApplicationStock,
  approveApplication,
  rejectApplication,
  requestApplicationInfo,
  cancelApplication,
  nextOpenRow,
};
