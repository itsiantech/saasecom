const express = require("express");
const router = express.Router();
const Store = require("../models/Store");
const Plan = require("../models/Plan");
const User = require("../models/User");
const Product = require("../models/Product");
const Settings = require("../models/Settings");
const { auth, requireSuperAdmin } = require("../middleware/auth");

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

// SaaS on/off status (public — frontend redirect er jonno)
router.get("/settings/saas", async (req, res) => {
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

module.exports = router;
