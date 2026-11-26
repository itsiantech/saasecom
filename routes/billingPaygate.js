/* ==========================================================================
   PayGate checkout routes — open a hosted bKash / Nagad payment for a plan and
   report its result. The auto-approval itself lives in the webhook
   (routes/paygateWebhook.js); this file only creates and reads a payment.
   ========================================================================== */
const express = require("express");
const router = express.Router();
const Store = require("../models/Store");
const Plan = require("../models/Plan");
const PlatformPayment = require("../models/PlatformPayment");
const { auth } = require("../middleware/auth");
const billing = require("../lib/platformBilling");
const planCycles = require("../lib/planCycles");
const paygate = require("../lib/paygate");
const settlement = require("../lib/paygateSettlement");
const { assertShopName } = require("../lib/shopAddress");

const PHONE_RE = /^01[3-9]\d{8}$/;
// How long the buyer gets to send the money before PayGate expires the request.
const CHECKOUT_TTL_SECONDS = 1800;

function withQuery(url, params = {}) {
  if (!url) return "";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return String(url);
  }
  Object.keys(params).forEach((key) => {
    if (params[key]) parsed.searchParams.set(key, String(params[key]));
  });
  return parsed.toString();
}

// PayGate appends its own status params to return_url, so the ids the checkout
// page needs have to ride along in the query string.
function returnUrlFor(req, payment, plan, store) {
  return withQuery(paygate.defaultReturnUrl(req), {
    pp: String(payment._id),
    plan: plan.slug,
    cycle: payment.cycle,
    store: store ? String(store._id) : "",
  });
}

// POST /api/billing/paygate — paid plan er hosted checkout খোলে
router.post("/", auth, async (req, res) => {
  try {
    const body = req.body || {};
    const plan = await Plan.findOne({ slug: String(body.planSlug || "").toLowerCase(), active: true });
    if (!plan) return res.status(404).json({ message: "প্যাকেজ পাওয়া যায়নি" });
    if (Number(plan.price) <= 0) {
      return res.status(400).json({ message: "এই প্যাকেজের জন্য পেমেন্ট লাগে না — সরাসরি দোকান খুলুন" });
    }

    const cycle = planCycles.cycleFor(body.cycle || planCycles.DEFAULT_CYCLE);
    if (!cycle) return res.status(400).json({ message: "মেয়াদ ঠিকভাবে বাছুন" });

    const senderNumber = String(body.senderNumber || "").replace(/[\s-]/g, "");
    if (!PHONE_RE.test(senderNumber)) {
      return res.status(400).json({ message: "যে নম্বর থেকে পেমেন্ট করবেন সেটি ১১ ডিজিটে লিখুন (যেমন 01712345678)" });
    }

    const config = await paygate.getConfig();
    if (!config.configured) {
      return res.status(503).json({ message: "অনলাইন পেমেন্ট এখন চালু নেই — বিকাশ/নগদ ম্যানুয়াল মেথড ব্যবহার করুন" });
    }

    let store = null;
    let storeName = "";
    let storeSlug = "";
    let kind = "new";

    if (body.storeId) {
      store = await Store.findById(body.storeId);
      if (!store) return res.status(404).json({ message: "দোকান পাওয়া যায়নি" });
      if (String(store.owner) !== String(req.user.id) && req.user.role !== "superadmin") {
        return res.status(403).json({ message: "এই দোকানের পেমেন্ট আপনি করতে পারবেন না" });
      }
      kind = "existing";
      storeName = store.name;
      storeSlug = store.slug;
    } else {
      storeName = String(body.storeName || "").trim().slice(0, 80);
      if (!storeName) return res.status(400).json({ message: "দোকানের নাম লিখুন" });
      const checkedSlug = await assertShopName(body.storeSlug).catch((err) => err);
      if (checkedSlug instanceof Error) {
        return res.status(checkedSlug.status || 400).json({
          message: checkedSlug.message,
          code: checkedSlug.code,
          reason: checkedSlug.reason,
        });
      }
      storeSlug = checkedSlug;
    }

    const pendingFilter = { user: req.user.id, status: "pending" };
    if (store) pendingFilter.store = store._id;
    const pending = await PlatformPayment.findOne(pendingFilter).sort({ createdAt: -1 });
    if (pending) {
      return res.status(409).json({
        message: "আপনার আগের পেমেন্ট এখনো যাচাই হয়নি (ইনভয়েস " + pending.invoiceNo + ")",
        payment: billing.paymentView(pending),
      });
    }

    const invoiceNo = await billing.nextInvoiceNo();
    const payment = await PlatformPayment.create({
      invoiceNo,
      user: req.user.id,
      store: store ? store._id : null,
      kind,
      storeName,
      storeSlug,
      plan: plan._id,
      planName: plan.name,
      planSlug: plan.slug,
      amount: planCycles.priceFor(plan, cycle),
      cycle: cycle.key,
      months: cycle.months,
      durationDays: cycle.days,
      method: "paygate",
      methodLabel: billing.METHOD_LABELS.paygate,
      gateway: "paygate",
      senderNumber,
      nextDueDate: billing.dueDateAfter(new Date(), cycle.days),
    });

    let checkout;
    try {
      checkout = await paygate.createPayment({
        config,
        amount: payment.amount,
        senderNumber,
        expiresIn: CHECKOUT_TTL_SECONDS,
        returnUrl: returnUrlFor(req, payment, plan, store),
        metadata: {
          platformPaymentId: String(payment._id),
          invoiceNo,
          userId: String(req.user.id),
          planSlug: plan.slug,
          cycle: cycle.key,
          storeId: store ? String(store._id) : "",
          storeName,
          storeSlug,
        },
      });
    } catch (err) {
      // No checkout means nothing can ever verify this row — delete it so the
      // pending-payment guard does not block a retry.
      await PlatformPayment.deleteOne({ _id: payment._id, status: "pending" });
      return res.status(err.status === 503 ? 503 : 502).json({ message: err.message });
    }

    payment.paygateId = String(checkout.payment.id || "");
    payment.paygateCheckoutUrl = checkout.checkoutUrl || paygate.cleanBaseUrl(config.baseUrl) + "/pay/" + payment.paygateId;
    payment.paygateStatus = String(checkout.payment.status || "pending");
    try {
      await payment.save();
    } catch (err) {
      // The webhook carries platformPaymentId in its own metadata, so the money
      // is still traceable — let the checkout page poll instead.
      console.error("PayGate checkout save failed for " + invoiceNo + ":", err.message);
    }

    res.status(201).json({ payment: billing.paymentView(payment), checkoutUrl: payment.paygateCheckoutUrl });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ message: "আপনার একটু আগে দেওয়া পেমেন্টের সাথে মিল আছে — সেইটির যাচাই শেষ হোক" });
    }
    res.status(err && err.status >= 400 && err.status < 600 ? err.status : 400).json({ message: err.message });
  }
});

// GET /api/billing/paygate/:id/status — webhook দেরি করলে checkout page নিজে জিজ্ঞেস করে
router.get("/:id/status", auth, async (req, res) => {
  try {
    const payment = await PlatformPayment.findById(req.params.id);
    if (!payment) return res.status(404).json({ message: "পেমেন্ট পাওয়া যায়নি" });
    if (String(payment.user) !== String(req.user.id) && req.user.role !== "superadmin") {
      return res.status(403).json({ message: "এই পেমেন্ট দেখার অনুমতি নেই" });
    }

    if (payment.gateway === "paygate" && payment.status === "pending" && payment.paygateId) {
      try {
        const remote = await paygate.fetchPayment(payment.paygateId);
        if (remote && remote.status === "success") {
          await settlement.settlePayment({ platformPaymentId: payment._id, paygatePayment: remote });
        } else if (remote && (remote.status === "expired" || remote.status === "cancelled")) {
          await settlement.rejectUnpaidPayment({ platformPaymentId: payment._id, paygatePayment: remote });
        }
      } catch (err) {
        // Polling is a convenience — the webhook and a superadmin can still
        // settle this row, so never fail the status call over it.
        console.error("PayGate status poll failed for " + payment.invoiceNo + ":", err.message);
      }
      const after = await PlatformPayment.findById(payment._id);
      return res.json({ payment: billing.paymentView(after || payment) });
    }

    res.json({ payment: billing.paymentView(payment) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
