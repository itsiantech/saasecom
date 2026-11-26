const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();
const Store = require("../models/Store");
const Plan = require("../models/Plan");
const PlatformPayment = require("../models/PlatformPayment");
const { auth } = require("../middleware/auth");
const billing = require("../lib/platformBilling");
const paygate = require("../lib/paygate");
const planCycles = require("../lib/planCycles");
const { assertShopName } = require("../lib/shopAddress");
const { buildPlatformInvoiceHtml } = require("../lib/platformInvoice");
const landingBranding = require("../lib/landingBranding");

// Shudhu manual method er row gulo jay — tar sathe PayGate hosted checkout
// cholle seta ekta "gateway" row (kono account number nei, checkout e redirect kore)
function paygateMethod(configured) {
  if (!configured) return null;
  return {
    id: "paygate",
    label: "বিকাশ / নগদ — অনলাইন",
    detail: "অটো যাচাই",
    number: "",
    accountName: "",
    instructions:
      "PayGate-এর নিরাপদ পেজে বিকাশ/নগদ অ্যাপ থেকে টাকা পাঠালে SMS মিলিয়ে আপনার দোকান স্বয়ংক্রিয়ভাবে চালু হয়ে যাবে — TRXID লিখতে হবে না।",
    needsSender: true,
    gateway: true,
  };
}

// public: checkout page kon kon payment method dekhabe (kono key jay na)
router.get("/methods", async (req, res) => {
  try {
    const settings = await billing.loadSettings();
    const config = await paygate.getConfig();
    const methods = billing.publicMethods(settings);
    const gateway = paygateMethod(config.configured);
    if (gateway) methods.unshift(gateway);
    res.json({
      manualEnabled: settings.manualEnabled,
      methods,
      apiEnabled: config.configured,
      paygateEnabled: config.configured,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// paid plan er jonno payment joma — dokan/plan update approval er por
router.post("/payments", auth, async (req, res) => {
  try {
    const body = req.body || {};
    const plan = await Plan.findOne({ slug: String(body.planSlug || "").toLowerCase(), active: true });
    if (!plan) return res.status(404).json({ message: "প্যাকেজ পাওয়া যায়নি" });
    if (Number(plan.price) <= 0) {
      return res.status(400).json({ message: "এই প্যাকেজের জন্য পেমেন্ট লাগে না — সরাসরি দোকান খুলুন" });
    }

    const cycle = planCycles.cycleFor(body.cycle || planCycles.DEFAULT_CYCLE);
    if (!cycle) return res.status(400).json({ message: "মেয়াদ ঠিকভাবে বাছুন" });

    const settings = await billing.loadSettings();
    const check = billing.validateSubmission({
      settings,
      method: body.method,
      senderNumber: body.senderNumber,
      trxid: body.trxid,
    });
    if (check.error) return res.status(400).json({ message: check.error });

    let store = null;
    let storeName = "";
    let storeSlug = "";
    let kind = "new";

    if (body.storeId) {
      store = await Store.findById(body.storeId);
      if (!store) return res.status(404).json({ message: "দোকান পাওয়া যায়নি" });
      const isOwner = String(store.owner) === String(req.user.id);
      if (!isOwner && req.user.role !== "superadmin") {
        return res.status(403).json({ message: "এই দোকানের পেমেন্ট আপনি করতে পারবেন না" });
      }
      kind = "existing";
      storeName = store.name;
      storeSlug = store.slug;
    } else {
      storeName = String(body.storeName || "").trim().slice(0, 80);
      if (!storeName) return res.status(400).json({ message: "দোকানের নাম লিখুন" });
      const checkSlug = await assertShopName(body.storeSlug).catch((err) => err);
      if (checkSlug instanceof Error) {
        return res.status(checkSlug.status || 400).json({
          message: checkSlug.message,
          code: checkSlug.code,
          reason: checkSlug.reason,
        });
      }
      storeSlug = checkSlug;
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
      method: check.method,
      methodLabel: billing.METHOD_LABELS[check.method],
      senderNumber: check.senderNumber,
      trxid: check.trxid,
      trxKey: billing.trxKey(check.method, check.trxid),
      nextDueDate: billing.dueDateAfter(new Date(), cycle.days),
    });

    res.status(201).json({ payment: billing.paymentView(payment) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ message: "এই TRXID আগেই জমা দেওয়া হয়েছে — অন্য TRXID দিন" });
    }
    res.status(400).json({ message: err.message });
  }
});

// nijer payment history (portal + checkout)
router.get("/payments/mine", auth, async (req, res) => {
  try {
    const rows = await PlatformPayment.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("plan", "name slug");
    res.json({ payments: rows.map((row) => billing.paymentView(row)) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// invoice HTML — signed link (checkout/portal/admin) ba Bearer token diye
router.get("/payments/:id/invoice", async (req, res) => {
  try {
    const payment = await PlatformPayment.findById(req.params.id)
      .populate("user", "name email phone")
      .populate("plan", "name slug");
    if (!payment) return res.status(404).send("Invoice pawa jayni");

    let allowed = billing.checkInvoiceToken(payment, req.query.token);
    if (!allowed) {
      const header = req.headers.authorization || "";
      if (header.startsWith("Bearer ")) {
        try {
          const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ["HS256"] });
          allowed = payload.role === "superadmin" || String(payment.user._id) === String(payload.id);
        } catch {
          /* invalid token → 403 nicher line */
        }
      }
    }
    if (!allowed) return res.status(403).send("এই ইনভয়েস দেখার অনুমতি নেই");

    const branding = await landingBranding.getBranding();
    res.type("html").send(buildPlatformInvoiceHtml(payment, { brand: branding.name }));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

module.exports = router;
