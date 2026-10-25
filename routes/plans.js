const express = require("express");
const router = express.Router();
const Plan = require("../models/Plan");
const { auth, requireSuperAdmin } = require("../middleware/auth");

// public: active plan gulo (signup/setup page e dekhay)
router.get("/", async (req, res) => {
  const plans = await Plan.find({ active: true }).sort({ order: 1, price: 1 });
  res.json(plans);
});

// super admin: notun plan
router.post("/", auth, requireSuperAdmin, async (req, res) => {
  try {
    const { name, slug, price, durationDays, trialDays, limits, features, order } = req.body;
    if (!name) return res.status(400).json({ message: "Plan er naam lagbe" });
    const finalSlug = (slug || name).toLowerCase().trim().replace(/\s+/g, "-");
    if (await Plan.exists({ slug: finalSlug })) {
      return res.status(409).json({ message: "Ei slug er plan age theke ache" });
    }
    const plan = await Plan.create({
      name,
      slug: finalSlug,
      price: Number(price) || 0,
      durationDays: Number(durationDays) || 30,
      trialDays: Number(trialDays) || 0,
      limits: {
        products: Number(limits?.products) || 0,
        orders: Number(limits?.orders) || 0,
        storageMB: Number(limits?.storageMB) || 0,
        staffMembers: Number(limits?.staffMembers) || 1,
      },
      features: {
        customDomain: Boolean(features?.customDomain),
        analytics: Boolean(features?.analytics),
        apiAccess: Boolean(features?.apiAccess),
        prioritySupport: Boolean(features?.prioritySupport),
      },
      order: Number(order) || 0,
    });
    res.status(201).json(plan);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// super admin: plan update
router.put("/:id", auth, requireSuperAdmin, async (req, res) => {
  try {
    const { name, slug, price, durationDays, trialDays, limits, features, order, active } = req.body;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = slug;
    if (price !== undefined) updateData.price = Number(price);
    if (durationDays !== undefined) updateData.durationDays = Number(durationDays);
    if (trialDays !== undefined) updateData.trialDays = Number(trialDays);
    if (active !== undefined) updateData.active = Boolean(active);
    if (limits !== undefined) {
      updateData.limits = {
        products: Number(limits?.products) || 0,
        orders: Number(limits?.orders) || 0,
        storageMB: Number(limits?.storageMB) || 0,
        staffMembers: Number(limits?.staffMembers) || 1,
      };
    }
    if (features !== undefined) {
      updateData.features = {
        customDomain: Boolean(features?.customDomain),
        analytics: Boolean(features?.analytics),
        apiAccess: Boolean(features?.apiAccess),
        prioritySupport: Boolean(features?.prioritySupport),
      };
    }
    if (order !== undefined) updateData.order = Number(order);

    const plan = await Plan.findByIdAndUpdate(req.params.id, updateData, {
      returnDocument: "after",
      runValidators: true,
    });
    if (!plan) return res.status(404).json({ message: "Plan pawa jayni" });
    res.json(plan);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// super admin: plan delete
router.delete("/:id", auth, requireSuperAdmin, async (req, res) => {
  try {
    const plan = await Plan.findByIdAndDelete(req.params.id);
    if (!plan) return res.status(404).json({ message: "Plan pawa jayni" });
    res.json({ message: "Plan delete hoyeche" });
  } catch (err) {
    res.status(400).json({ message: "Invalid id" });
  }
});

module.exports = router;
