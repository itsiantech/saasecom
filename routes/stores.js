const express = require("express");
const router = express.Router();
const { randomBytes } = require("crypto");
const Store = require("../models/Store");
const Plan = require("../models/Plan");
const Subscription = require("../models/Subscription");
const { auth } = require("../middleware/auth");

// notun dokan khola (saas mode e plan soho)
router.post("/", auth, async (req, res) => {
  try {
    const { name, slug, planSlug } = req.body;
    if (!name) return res.status(400).json({ message: "Store er naam lagbe" });

    let finalSlug = (slug || "").toLowerCase().trim();
    if (!finalSlug) finalSlug = "store-" + randomBytes(3).toString("hex");

    if (!/^[a-z0-9-]+$/.test(finalSlug)) {
      return res.status(400).json({ message: "Slug e shudhu choto hater, number, hyphen hobe" });
    }
    if (await Store.exists({ slug: finalSlug })) {
      return res.status(409).json({ message: "Ei slug age theke nie neya hoyeche" });
    }

    // planSlug dile validate kore store er plan set hoy
    let plan;
    if (planSlug) {
      plan = await Plan.findOne({ slug: String(planSlug).toLowerCase(), active: true });
      if (!plan) return res.status(404).json({ message: "Plan pawa jayni" });
    } else {
      plan = await Plan.findOne({ slug: "free", active: true });
      if (!plan) return res.status(404).json({ message: "Free plan pawa jayni" });
    }

    const store = await Store.create({ name, slug: finalSlug, owner: req.user.id, plan: plan._id });

    // Subscription create kora
    const now = new Date();
    const startDate = now;
    const endDate = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
    const trialEndsAt = plan.trialDays > 0
      ? new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000)
      : null;

    const subscription = await Subscription.create({
      store: store._id,
      plan: plan._id,
      status: plan.trialDays > 0 ? "trial" : "active",
      startDate,
      endDate,
      trialEndsAt,
    });

    res.status(201).json({ store, subscription });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// public: slug diye store er basic info (storefront page e dekhay)
router.get("/public/:slug", async (req, res) => {
  const store = await Store.findOne({ slug: req.params.slug.toLowerCase() }).select("name slug");
  if (!store) return res.status(404).json({ message: "Store pawa jayni" });
  res.json(store);
});

// amar dokan gulo
router.get("/mine", auth, async (req, res) => {
  const stores = await Store.find({ owner: req.user.id }).populate("plan").sort({ createdAt: 1 });
  res.json(stores);
});

module.exports = router;
