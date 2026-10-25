const mongoose = require("mongoose");
const crypto = require("crypto");
const Order = require("../models/Order");
const OrderInstallment = require("../models/OrderInstallment");
const Payment = require("../models/Payment");
const InstallmentPlan = require("../models/InstallmentPlan");
const User = require("../models/User");
const Store = require("../models/Store");
const PaymentMobileManual = require("../models/PaymentMobileManual");
const PaymentBankManual = require("../models/PaymentBankManual");
const { getStoreId } = require("../lib/tenantContext");
const { getWholesaleSettings } = require("../lib/wholesaleSettings");
const { toPaisa, fromPaisa } = require("../lib/money");
const { quoteWholesaleShipping } = require("../services/wholesaleShippingQuote");
const { getOrCreateCart, refreshCartPricing, cartCouponInfo } = require("./cartController");
const { prepareInstallmentCheckout } = require("../services/installmentCheckout");
const { outstandingPaisa } = require("../services/installmentLedger");
const {
  verifyPendingPayment,
  rejectPendingPayment,
} = require("../services/installmentPayments");
const { runInstallmentScheduler } = require("../services/installmentScheduler");

const PHONE_RE = /^01[3-9]\d{8}$/;
const PAYMENT_METHODS = /^(mobile|bank):/;

function storeOf(req) {
  if (req.store && req.store._id) return req.store._id;
  return getStoreId();
}

function normalizePhone(value) {
  let s = String(value || "").replace(/[^\d+]/g, "");
  if (s.startsWith("+880")) s = "0" + s.slice(4);
  return s;
}

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function money(paisa) {
  return "৳ " + fromPaisa(paisa).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function publicPlan(plan) {
  return {
    id: plan._id,
    name: plan.name,
    installmentsCount: plan.installmentsCount,
    advanceType: plan.advanceType,
    advanceValue: plan.advanceValue,
    gapDays: plan.gapDays,
    minOrderAmountPaisa: plan.minOrderAmountPaisa,
    feeType: plan.feeType,
    feeValue: plan.feeValue,
  };
}

function publicInstallment(row) {
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
  };
}

function publicPayment(row) {
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

function groupByOrder(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = String(row.order);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
}

function shapeOrder(order, installments, payments) {
  const rows = (installments || []).sort((a, b) => Number(a.number) - Number(b.number));
  const nextDue = rows
    .filter((row) => row.status !== "paid" && row.status !== "cancelled")
    .filter((row) => outstandingPaisa(row) > 0)
    .sort((a, b) => Number(a.number) - Number(b.number))[0] || null;

  return {
    _id: order._id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalAmount: order.totalAmount,
    paidAmount: order.paidAmount || 0,
    dueAmount: order.dueAmount || 0,
    installmentPlan: order.installmentPlan,
    shippingLabel: order.shippingLabel,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customer: order.customer,
    installments: rows.map(publicInstallment),
    payments: (payments || []).map(publicPayment),
    nextDue: nextDue ? publicInstallment(nextDue) : null,
    pendingPayments: (payments || []).filter((p) => p.status === "pending").length,
  };
}

async function isAdminUser(req) {
  if (!req.user || !req.user.id) return false;
  const user = await User.findById(req.user.id).select("role");
  return !!user && (user.role === "admin" || user.role === "superadmin");
}

async function loadCartPricing(req, storeId) {
  const cart = await getOrCreateCart(req);
  const { settings, pricingErrors } = await refreshCartPricing(req, cart, storeId);
  if (pricingErrors.length) {
    const err = new Error(pricingErrors[0].message);
    err.status = 400;
    throw err;
  }
  return { cart, settings };
}

function itemsAmountOf(cart) {
  return cart.items.reduce(
    (sum, item) => sum + (Number(item.unitPricePaisa) || 0) * (Number(item.quantity) || 0),
    0
  );
}

async function discountedItemsOf(storeId, cart) {
  if (!cart || !cart.couponCode) return itemsAmountOf(cart);
  const info = await cartCouponInfo(storeId, cart);
  if (info.couponError) return itemsAmountOf(cart);
  return Math.max(0, info.subtotalPaisa - (info.discountPaisa || 0));
}

/* ------------------------------------------------------------------ *
 * GET /api/installments/plans — checkout config + buyer eligibility
 * ------------------------------------------------------------------ */
async function getConfig(req, res, next) {
  try {
    const storeId = storeOf(req);
    const settings = await getWholesaleSettings(storeId);
    if (!settings.enabled || !settings.partialPaymentEnabled) {
      return res.json({ enabled: false });
    }

    let cart = null;
    try {
      ({ cart } = await loadCartPricing(req, storeId));
    } catch {
      cart = await getOrCreateCart(req);
    }

    const plans = await InstallmentPlan.find({ store: storeId, isActive: true })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();

    const loginRequired = !(req.user && req.user.id);
    let buyer = null;
    let openOrders = 0;
    if (!loginRequired) {
      buyer = await User.findById(req.user.id).select("phone wholesaleApproved");
      if (buyer) {
        openOrders = await Order.countDocuments({
          customer: req.user.id,
          paymentMode: "installment",
          status: { $nin: ["cancelled", "delivered"] },
          dueAmount: { $gt: 0 },
        });
      }
    }

    const approvedRequired = settings.installmentBuyers === "approved";
    const maxOpen = Number(settings.maxOpenInstallmentOrders) || 0;
    let reason = "";
    if (loginRequired) reason = "Installment order dite age login korun";
    else if (!buyer) reason = "Buyer account pawa jayni";
    else if (!buyer.phone) reason = "Account e phone number add korun";
    else if (approvedRequired && buyer.wholesaleApproved !== true) {
      reason = "Approved wholesale buyer holei installment plan pabe";
    } else if (maxOpen > 0 && openOrders >= maxOpen) {
      reason = `Ek sathe ${maxOpen} ti installment order cholte pare — kichhu order complete korun`;
    }

    res.json({
      enabled: true,
      eligible: !reason,
      reason,
      loginRequired,
      loginRequiredForCheckout: loginRequired,
      openOrders,
      maxOpenInstallmentOrders: maxOpen,
      installmentBuyers: settings.installmentBuyers,
      goodsReleaseRule: settings.goodsReleaseRule,
      shippingInFirstInstallment: settings.shippingInFirstInstallment,
      graceDays: settings.graceDays,
      itemsAmountPaisa: cart ? await discountedItemsOf(storeId, cart) : 0,
      plans: plans.map(publicPlan),
    });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * POST /api/installments/preview — authoritative first-payment schedule
 * ------------------------------------------------------------------ */
async function preview(req, res, next) {
  try {
    const storeId = storeOf(req);
    const planId = req.body && req.body.planId;
    if (!planId) return res.status(400).json({ message: "Installment plan select korun" });

    const { cart, settings } = await loadCartPricing(req, storeId);
    if (!cart.items.length) return res.status(400).json({ message: "Cart faka" });

    const shipping = await quoteWholesaleShipping({
      storeId,
      items: cart.items,
      speedId: req.body.speedId || "",
    });
    if (!shipping.enabled) {
      return res.status(400).json({ message: "Wholesale shipping active nei" });
    }

    const coupon = await cartCouponInfo(storeId, cart, shipping.totalPaisa);
    if (coupon.couponError) return res.status(400).json({ message: coupon.couponError });
    const discountedItemsPaisa = Math.max(
      0,
      coupon.subtotalPaisa - (coupon.discountPaisa || 0)
    );
    const shippingPaisa = coupon.freeDelivery ? 0 : shipping.totalPaisa;

    const checkout = await prepareInstallmentCheckout({
      storeId,
      user: req.user,
      settings,
      planId,
      itemsAmountPaisa: discountedItemsPaisa,
      shippingAmountPaisa: shippingPaisa,
    });

    res.json({
      plan: publicPlan(checkout.plan),
      schedule: checkout.schedule.map((row) => ({
        number: row.number,
        amountPaisa: row.amountPaisa,
        dueDate: row.dueDate,
        status: row.status,
      })),
      itemsPaisa: discountedItemsPaisa,
      couponDiscountPaisa: coupon.discountPaisa || 0,
      shippingPaisa,
      feePaisa: checkout.feePaisa,
      totalPaisa: checkout.totalPaisa,
      firstPaisa: checkout.firstPaisa,
      remainingPaisa: checkout.remainingPaisa,
      shippingInFirstInstallment: settings.shippingInFirstInstallment !== false,
      speed: shipping.speed,
    });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}

/* ------------------------------------------------------------------ *
 * Customer account
 * ------------------------------------------------------------------ */
async function myOrders(req, res, next) {
  try {
    const orders = await Order.find({ customer: req.user.id, paymentMode: "installment" })
      .sort({ createdAt: -1 })
      .lean();
    const ids = orders.map((order) => order._id);
    const [installments, payments] = ids.length
      ? await Promise.all([
          OrderInstallment.find({ order: { $in: ids } }).sort({ number: 1 }).lean(),
          Payment.find({ order: { $in: ids } }).sort({ createdAt: -1 }).lean(),
        ])
      : [[], []];
    const installmentMap = groupByOrder(installments);
    const paymentMap = groupByOrder(payments);

    res.json({
      orders: orders.map((order) =>
        shapeOrder(
          order,
          installmentMap.get(String(order._id)) || [],
          paymentMap.get(String(order._id)) || []
        )
      ),
    });
  } catch (err) {
    next(err);
  }
}

async function loadScopedOrder(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  const order = await Order.findById(req.params.id);
  if (!order || order.paymentMode !== "installment") return null;
  const owner = order.customer && String(order.customer) === String(req.user.id);
  if (!owner && !(await isAdminUser(req))) return null;
  return order;
}

async function myOrder(req, res, next) {
  try {
    const order = await loadScopedOrder(req);
    if (!order) return res.status(404).json({ message: "Installment order pawa jayni" });
    const [installments, payments] = await Promise.all([
      OrderInstallment.find({ order: order._id }).sort({ number: 1 }).lean(),
      Payment.find({ order: order._id }).sort({ createdAt: -1 }).lean(),
    ]);
    res.json({ order: shapeOrder(order.toObject(), installments, payments) });
  } catch (err) {
    next(err);
  }
}

async function payInstallment(req, res, next) {
  try {
    const order = await loadScopedOrder(req);
    if (!order || (order.customer && String(order.customer) !== String(req.user.id))) {
      return res.status(404).json({ message: "Installment order pawa jayni" });
    }
    if (order.status === "cancelled" || order.paymentStatus === "cancelled") {
      return res.status(400).json({ message: "Cancelled order e payment kora jay na" });
    }

    const installment = await OrderInstallment.findOne({
      _id: req.body.installmentId,
      order: order._id,
    });
    if (!installment) return res.status(404).json({ message: "Installment pawa jayni" });
    if (installment.status === "paid") {
      return res.status(400).json({ message: "Ei installment age theke paid" });
    }
    if (installment.status === "cancelled") {
      return res.status(400).json({ message: "Ei installment cancelled" });
    }

    const duePaisa = outstandingPaisa(installment);
    if (duePaisa <= 0) return res.status(400).json({ message: "Ei installment e baki nei" });

    const pending = await Payment.findOne({
      order: order._id,
      installment: installment._id,
      status: "pending",
    });
    if (pending) {
      return res.status(400).json({
        message: "Ei installment er payment age theke verification er jonno pending ache",
      });
    }

    const method = String(req.body.method || "").trim();
    const senderNumber = normalizePhone(req.body.senderNumber);
    const transactionId = String(req.body.transactionId || "").trim();
    if (!PAYMENT_METHODS.test(method)) {
      return res.status(400).json({ message: "Manual mobile/bank payment method select korun" });
    }
    if (!transactionId) return res.status(400).json({ message: "Transaction ID lagbe" });

    const name = method.slice(method.indexOf(":") + 1).trim().toLowerCase();
    const [mobileRows, bankRows] = await Promise.all([
      PaymentMobileManual.find({}).lean(),
      PaymentBankManual.find({}).lean(),
    ]);

    let labelName = name;
    if (method.startsWith("mobile:")) {
      const row = mobileRows.find((item) => String(item.name).toLowerCase() === name);
      if (!row) {
        return res.status(400).json({ message: "Mobile banking option pawa jayni" });
      }
      labelName = row.name;
      if (!PHONE_RE.test(senderNumber)) {
        return res.status(400).json({ message: "Sender number valid Bangladesh number hote hobe" });
      }
    } else {
      const row = bankRows.find((item) => String(item.bankName).toLowerCase() === name);
      if (!row) return res.status(400).json({ message: "Bank option pawa jayni" });
      labelName = row.bankName;
    }

    const label =
      method.startsWith("mobile:")
        ? `Mobile banking — ${labelName}`
        : `Bank transfer — ${labelName}`;

    const payment = await Payment.create({
      store: order.store,
      order: order._id,
      installment: installment._id,
      method,
      methodLabel: label,
      senderNumber,
      trxId: transactionId,
      amountPaisa: duePaisa,
      status: "pending",
      note: `Installment ${installment.number}`,
    });

    res.status(201).json({
      ok: true,
      payment: publicPayment(payment),
      message: "Payment joma hoyeche — admin verify korle schedule update hobe",
    });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Receipt HTML
 * ------------------------------------------------------------------ */
async function receipt(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Payment pawa jayni" });
    }
    const payment = await Payment.findById(req.params.id).lean();
    if (!payment) return res.status(404).json({ message: "Payment pawa jayni" });
    const order = await Order.findById(payment.order).lean();
    if (!order) return res.status(404).json({ message: "Order pawa jayni" });

    const owner = order.customer && String(order.customer) === String(req.user.id);
    if (!owner && !(await isAdminUser(req))) {
      return res.status(403).json({ message: "Ei receipt dekhar permission nei" });
    }

    const [installment, store] = await Promise.all([
      payment.installment ? OrderInstallment.findById(payment.installment).lean() : null,
      Store.findById(payment.store).select("name").lean(),
    ]);

    const rows = [
      ["Order", order.orderNumber],
      ["Customer", order.customerName],
      ["Installment", installment ? "#" + installment.number : "—"],
      ["Amount", money(payment.amountPaisa)],
      ["Method", payment.methodLabel || payment.method],
      ["Transaction ID", payment.trxId || "—"],
      ["Sender number", payment.senderNumber || "—"],
      ["Status", payment.status],
      [
        "Verified at",
        payment.verifiedAt ? new Date(payment.verifiedAt).toLocaleString("en-GB") : "—",
      ],
    ];

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Receipt ${esc(order.orderNumber)}</title>
<style>
  body{margin:0;background:#f5f2ea;color:#211d16;font-family:Segoe UI,system-ui,sans-serif;padding:32px}
  .card{max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4dccb;border-radius:14px;padding:28px}
  h1{font-family:Georgia,serif;font-size:24px;margin:0 0 4px}
  .muted{color:#7a7264;font-size:13px;margin:0 0 22px}
  table{width:100%;border-collapse:collapse}
  td{padding:10px 0;border-bottom:1px solid #eee7d9;font-size:14px;vertical-align:top}
  td:first-child{color:#7a7264;width:42%}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;background:#efe8d8;font-size:12px;text-transform:capitalize}
  .foot{margin-top:22px;font-size:12px;color:#7a7264;text-align:center}
  @media print{body{background:#fff;padding:0}.card{border:none}}
</style></head>
<body><div class="card">
  <h1>${esc((store && store.name) || "Store")}</h1>
  <p class="muted">Installment payment receipt</p>
  <table>${rows
    .map(
      ([label, value]) =>
        `<tr><td>${esc(label)}</td><td>${label === "Status" ? `<span class="badge">${esc(value)}</span>` : esc(value)}</td></tr>`
    )
    .join("")}</table>
  <p class="foot">This receipt is generated automatically. Keep it for your records.</p>
</div></body></html>`;

    res.type("html").send(html);
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Admin
 * ------------------------------------------------------------------ */
async function adminListOrders(req, res, next) {
  try {
    const orders = await Order.find({ paymentMode: "installment" })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("customer", "name phone email wholesaleApproved")
      .lean();
    const ids = orders.map((order) => order._id);
    const [installments, payments] = ids.length
      ? await Promise.all([
          OrderInstallment.find({ order: { $in: ids } }).sort({ number: 1 }).lean(),
          Payment.find({ order: { $in: ids } }).sort({ createdAt: -1 }).lean(),
        ])
      : [[], []];

    const installmentMap = groupByOrder(installments);
    const paymentMap = groupByOrder(payments);
    const data = orders.map((order) =>
      shapeOrder(
        order,
        installmentMap.get(String(order._id)) || [],
        paymentMap.get(String(order._id)) || []
      )
    );

    res.json({
      orders: data,
      stats: {
        orders: data.length,
        dueAmountPaisa: data.reduce((sum, order) => sum + (Number(order.dueAmount) || 0), 0),
        pendingPayments: data.reduce((sum, order) => sum + order.pendingPayments, 0),
        overdue: installments.filter(
          (row) => row.status === "overdue" || (row.status !== "paid" && row.status !== "cancelled" && new Date(row.dueDate) < new Date())
        ).length,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function adminOrder(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Installment order pawa jayni" });
    }
    const order = await Order.findOne({ _id: req.params.id, paymentMode: "installment" })
      .populate("customer", "name phone email wholesaleApproved")
      .lean();
    if (!order) return res.status(404).json({ message: "Installment order pawa jayni" });

    const [installments, payments] = await Promise.all([
      OrderInstallment.find({ order: order._id }).sort({ number: 1 }).lean(),
      Payment.find({ order: order._id }).sort({ createdAt: -1 }).lean(),
    ]);
    res.json({ order: shapeOrder(order, installments, payments) });
  } catch (err) {
    next(err);
  }
}

async function adminListPayments(req, res, next) {
  try {
    const status = ["pending", "verified", "rejected", "refunded"].includes(req.query.status)
      ? req.query.status
      : "pending";
    const payments = await Payment.find({ installment: { $ne: null }, status })
      .sort({ createdAt: 1 })
      .limit(200)
      .populate("order", "orderNumber customerName customerPhone paymentMode status")
      .populate("installment", "number amountPaisa paidPaisa dueDate status")
      .lean();
    res.json({
      payments: payments.map((row) => ({
        ...publicPayment(row),
        order: row.order,
        installmentInfo: row.installment,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function adminVerifyPayment(req, res, next) {
  try {
    const result = await verifyPendingPayment({
      paymentId: req.params.id,
      actorUserId: req.user.id,
      source: "admin",
    });
    res.json({
      ok: true,
      released: result.released,
      payment: publicPayment(result.payment),
      installment: publicInstallment(result.installment),
      order: {
        _id: result.order._id,
        paidAmount: result.order.paidAmount,
        dueAmount: result.order.dueAmount,
        paymentStatus: result.order.paymentStatus,
        status: result.order.status,
      },
    });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}

async function adminRejectPayment(req, res, next) {
  try {
    const payment = await rejectPendingPayment({
      paymentId: req.params.id,
      actorUserId: req.user.id,
      note: (req.body && req.body.note) || "Admin rejected",
    });
    res.json({ ok: true, payment: publicPayment(payment) });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}

// Manual trigger for the daily scheduler (this store only).
async function adminRunScheduler(req, res, next) {
  try {
    const storeId = storeOf(req) || null;
    const summary = await runInstallmentScheduler({ storeId });
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}

/* ------------------------------------------------------------------ *
 * Webhook scaffold — set INSTALLMENT_WEBHOOK_SECRET to enable.
 * POST /api/installments/webhook/:provider?store=slug
 * header: x-webhook-secret
 * body: { paymentId | trxId, amountPaisa, status: "verified" }
 * ------------------------------------------------------------------ */
function secretMatches(received, expected) {
  const a = Buffer.from(String(received || ""));
  const b = Buffer.from(String(expected || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

async function webhook(req, res, next) {
  try {
    const secret = process.env.INSTALLMENT_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(501).json({ message: "Installment webhook configured nei" });
    }
    if (!secretMatches(req.header("x-webhook-secret"), secret)) {
      return res.status(401).json({ message: "Webhook secret valid na" });
    }

    const body = req.body || {};
    const status = String(body.status || "").toLowerCase();
    if (!["verified", "paid", "success"].includes(status)) {
      return res.status(400).json({ message: "Webhook status verified/paid hote hobe" });
    }

    let payment = null;
    if (body.paymentId && mongoose.isValidObjectId(body.paymentId)) {
      payment = await Payment.findById(body.paymentId);
    } else if (body.trxId) {
      payment = await Payment.findOne({ trxId: String(body.trxId).trim(), status: "pending" });
    }
    if (!payment) return res.status(404).json({ message: "Pending payment pawa jayni" });

    const result = await verifyPendingPayment({
      paymentId: payment._id,
      source: "webhook",
      expectedAmountPaisa: body.amountPaisa == null ? null : Number(body.amountPaisa),
    });

    res.json({
      ok: true,
      provider: req.params.provider,
      payment: { _id: result.payment._id, status: result.payment.status },
      order: { _id: result.order._id, paymentStatus: result.order.paymentStatus },
    });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}

module.exports = {
  getConfig,
  preview,
  myOrders,
  myOrder,
  payInstallment,
  receipt,
  adminListOrders,
  adminOrder,
  adminListPayments,
  adminVerifyPayment,
  adminRejectPayment,
  adminRunScheduler,
  webhook,
};
