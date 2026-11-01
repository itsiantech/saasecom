const express = require("express");
const router = express.Router();
const Store = require("../models/Store");
const Plan = require("../models/Plan");
const User = require("../models/User");
const Product = require("../models/Product");
const Settings = require("../models/Settings");
const PlatformPayment = require("../models/PlatformPayment");
const { auth, requireSuperAdmin } = require("../middleware/auth");
const { normalizeTheme, parseTheme } = require("../lib/adminTheme");
const billing = require("../lib/platformBilling");
const { approvePayment, rejectPayment } = require("../lib/billingApproval");

// platform stats
router.get("/stats", auth, requireSuperAdmin, async (req, res) => {
  const stores = await Store.countDocuments();
  const users = await User.countDocuments();
  const products = await Product.countDocuments();
  res.json({ stores, users, products });
});

// sobgulo plan (super admin management er jonno — active ba inactive sob)
router.get("/plans", auth, requireSuperAdmin, async (req, res) => {
  const plans = await Plan.find().sort({ order: 1, price: 1 });
  res.json(plans);
});

// sobgulo store (owner er naam/email soho)
router.get("/stores", auth, requireSuperAdmin, async (req, res) => {
  const stores = await Store.find().sort({ createdAt: -1 }).populate("owner", "name email").populate("plan");
  res.json(stores);
});

// kono store er plan bodla
router.put("/stores/:id/plan", auth, requireSuperAdmin, async (req, res) => {
  try {
    const { planSlug } = req.body;
    const plan = await Plan.findOne({ slug: planSlug });
    if (!plan) return res.status(404).json({ message: "Plan pawa jayni" });
    const store = await Store.findByIdAndUpdate(
      req.params.id,
      { $set: { plan: plan._id } },
      { returnDocument: "after" }
    );
    if (!store) return res.status(404).json({ message: "Store pawa jayni" });
    res.json(store);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// SaaS on/off switch (super admin) — panel er baire keu platform flag parbe na
router.get("/settings/saas", auth, requireSuperAdmin, async (req, res) => {
  if (process.env.APP_MODE === "single") return res.json({ saasEnabled: false });
  if (process.env.APP_MODE === "saas") return res.json({ saasEnabled: true });
  const doc = await Settings.findOne({ key: "saasEnabled" });
  res.json({ saasEnabled: doc ? doc.value === "true" : true });
});

// SaaS on/off switch (super admin)
router.put("/settings/saas", auth, requireSuperAdmin, async (req, res) => {
  const enabled = req.body.enabled ? "true" : "false";
  await Settings.findOneAndUpdate(
    { key: "saasEnabled" },
    { $set: { value: enabled } },
    { upsert: true }
  );
  res.json({ saasEnabled: enabled === "true" });
});

// super admin panel er design colors (platform level, kono store er noy)
router.get("/settings/theme", auth, requireSuperAdmin, async (req, res) => {
  const doc = await Settings.findOne({ key: "adminTheme" });
  res.json({ theme: parseTheme(doc ? doc.value : "") });
});

router.put("/settings/theme", auth, requireSuperAdmin, async (req, res) => {
  const theme = normalizeTheme(req.body && req.body.theme);
  await Settings.findOneAndUpdate(
    { key: "adminTheme" },
    { $set: { value: JSON.stringify(theme) } },
    { upsert: true }
  );
  res.json({ theme });
});

/* ------------------------------------------------------------ billing */

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// sob platform payment (invoice) — status filter + search
router.get("/billing/payments", auth, requireSuperAdmin, async (req, res) => {
  const status = String(req.query.status || "").trim().toLowerCase();
  const filter = {};
  if (["pending", "approved", "rejected"].includes(status)) filter.status = status;

  const q = String(req.query.q || "").trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ invoiceNo: rx }, { storeName: rx }, { trxid: rx }, { senderNumber: rx }];
  }

  const [rows, grouped] = await Promise.all([
    PlatformPayment.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("user", "name email phone")
      .populate("plan", "name slug"),
    PlatformPayment.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
  ]);

  const counts = { pending: 0, approved: 0, rejected: 0 };
  grouped.forEach((row) => {
    if (counts[row._id] !== undefined) counts[row._id] = row.n;
  });

  res.json({
    counts,
    payments: rows.map((row) => ({
      ...billing.paymentView(row),
      user: row.user
        ? { name: row.user.name || "", email: row.user.email || "", phone: row.user.phone || "" }
        : null,
    })),
  });
});

// approve → store create / plan upgrade (atomic claim bhitore hoy)
router.put("/billing/payments/:id/approve", auth, requireSuperAdmin, async (req, res) => {
  try {
    const out = await approvePayment({ paymentId: req.params.id, adminId: req.user.id });
    res.json({
      payment: billing.paymentView(out.payment),
      storeSlug: out.store ? out.store.slug : null,
      slugAdjusted: Boolean(out.payment.slugAdjusted),
      message: "পেমেন্ট অনুমোদিত হয়েছে",
    });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
});

router.put("/billing/payments/:id/reject", auth, requireSuperAdmin, async (req, res) => {
  try {
    const row = await rejectPayment({
      paymentId: req.params.id,
      adminId: req.user.id,
      reason: req.body && req.body.reason,
    });
    res.json({ payment: billing.paymentView(row), message: "পেমেন্ট বাতিল হয়েছে" });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
});

// manual payment instruction + API settings (secret key masked)
router.get("/billing/settings", auth, requireSuperAdmin, async (req, res) => {
  const settings = await billing.loadSettings();
  res.json({ settings: billing.maskedSettings(settings) });
});

router.put("/billing/settings", auth, requireSuperAdmin, async (req, res) => {
  try {
    const incoming = (req.body && req.body.settings) || req.body || {};
    const settings = await billing.saveSettings(incoming);
    res.json({ settings: billing.maskedSettings(settings) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
