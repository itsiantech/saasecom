const express = require("express");
const router = express.Router();
const Store = require("../models/Store");
const Plan = require("../models/Plan");
const Subscription = require("../models/Subscription");
const { auth, requireAdmin } = require("../middleware/auth");

// current store er subscription dekha
router.get("/current", auth, async (req, res) => {
  try {
    if (!req.store) return res.status(400).json({ message: "Store pawa jayni" });

    const subscription = await Subscription.findOne({ store: req.store._id })
      .populate("plan")
      .populate("store");

    if (!subscription) return res.status(404).json({ message: "Subscription pawa jayni" });

    res.json(subscription);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// plan upgrade (admin only)
router.post("/upgrade", auth, requireAdmin, async (req, res) => {
  try {
    if (!req.store) return res.status(400).json({ message: "Store pawa jayni" });

    const { planSlug } = req.body;
    if (!planSlug) return res.status(400).json({ message: "Plan slug lagbe" });

    const newPlan = await Plan.findOne({ slug: String(planSlug).toLowerCase(), active: true });
    if (!newPlan) return res.status(404).json({ message: "Plan pawa jayni" });

    let subscription = await Subscription.findOne({ store: req.store._id });
    const now = new Date();

    if (subscription) {
      // Existing subscription update
      subscription.plan = newPlan._id;
      subscription.status = "active";
      subscription.startDate = now;
      subscription.endDate = new Date(now.getTime() + newPlan.durationDays * 24 * 60 * 60 * 1000);
      subscription.trialEndsAt = newPlan.trialDays > 0
        ? new Date(now.getTime() + newPlan.trialDays * 24 * 60 * 60 * 1000)
        : null;
      subscription.status = newPlan.trialDays > 0 ? "trial" : "active";
      subscription.cancelledAt = null;
      subscription.autoRenew = true;
      subscription.lastPaymentAt = now;

      await subscription.save();
    } else {
      // New subscription create
      const startDate = now;
      const endDate = new Date(now.getTime() + newPlan.durationDays * 24 * 60 * 60 * 1000);
      const trialEndsAt = newPlan.trialDays > 0
        ? new Date(now.getTime() + newPlan.trialDays * 24 * 60 * 60 * 1000)
        : null;

      subscription = await Subscription.create({
        store: req.store._id,
        plan: newPlan._id,
        status: newPlan.trialDays > 0 ? "trial" : "active",
        startDate,
        endDate,
        trialEndsAt,
        lastPaymentAt: now,
      });
    }

    // Update store plan
    await Store.findByIdAndUpdate(req.store._id, { plan: newPlan._id });

    res.json({ subscription, message: "Plan upgrade hoyeche" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// subscription cancel (admin only)
router.post("/cancel", auth, requireAdmin, async (req, res) => {
  try {
    if (!req.store) return res.status(400).json({ message: "Store pawa jayni" });

    const subscription = await Subscription.findOne({ store: req.store._id });
    if (!subscription) return res.status(404).json({ message: "Subscription pawa jayni" });

    subscription.status = "cancelled";
    subscription.cancelledAt = new Date();
    subscription.autoRenew = false;

    await subscription.save();

    res.json({ subscription, message: "Subscription cancel hoyeche" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// subscription resume (admin only)
router.post("/resume", auth, requireAdmin, async (req, res) => {
  try {
    if (!req.store) return res.status(400).json({ message: "Store pawa jayni" });

    const subscription = await Subscription.findOne({ store: req.store._id });
    if (!subscription) return res.status(404).json({ message: "Subscription pawa jayni" });

    const plan = await Plan.findById(subscription.plan);
    if (!plan) return res.status(404).json({ message: "Plan pawa jayni" });

    subscription.status = "active";
    subscription.cancelledAt = null;
    subscription.autoRenew = true;
    subscription.startDate = new Date();
    subscription.endDate = new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000);

    await subscription.save();

    res.json({ subscription, message: "Subscription resume hoyeche" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
