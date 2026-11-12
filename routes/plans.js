const express = require("express");
const router = express.Router();
const Plan = require("../models/Plan");
const { auth, requireSuperAdmin } = require("../middleware/auth");
const { FEATURES } = require("../lib/features");
const { syncPlanStores } = require("../lib/storeProvisioning");
const { writeAudit } = require("../lib/audit");

function featuresFromInput(input, existing) {
  const out = {};
  FEATURES.forEach((def) => {
    if (existing && input[def.key] === undefined) {
      out[def.key] = existing[def.key];
    } else {
      out[def.key] = Boolean(input && input[def.key]);
    }
  });
  return out;
}

function dependencyError(features) {
  for (const def of FEATURES) {
    if (!def.requires || features[def.key] !== true) continue;
    if (features[def.requires] === true) continue;
    const parent = FEATURES.find((f) => f.key === def.requires);
    return def.bn + " চালু করতে আগে " + (parent ? parent.bn : def.requires) + " চালু করুন";
  }
  return null;
}

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
    const featInput = featuresFromInput(features);
    const depErr = dependencyError(featInput);
    if (depErr) return res.status(400).json({ message: depErr });
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
      features: featInput,
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
    const plan = await Plan.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: "Plan pawa jayni" });

    if (name !== undefined) plan.name = name;
    if (slug !== undefined) plan.slug = slug;
    if (price !== undefined) plan.price = Number(price);
    if (durationDays !== undefined) plan.durationDays = Number(durationDays);
    if (trialDays !== undefined) plan.trialDays = Number(trialDays);
    if (active !== undefined) plan.active = Boolean(active);
    if (order !== undefined) plan.order = Number(order);
    if (limits !== undefined) {
      plan.limits = {
        products: Number(limits?.products) || 0,
        orders: Number(limits?.orders) || 0,
        storageMB: Number(limits?.storageMB) || 0,
        staffMembers: Number(limits?.staffMembers) || 1,
      };
    }
    let featuresChanged = false;
    const before = { ...(plan.features || {}) };
    if (features !== undefined) {
      const next = featuresFromInput(features, plan.features || {});
      const depErr = dependencyError(next);
      if (depErr) return res.status(400).json({ message: depErr });
      plan.features = next;
      plan.markModified("features");
      featuresChanged = FEATURES.some((def) => before[def.key] !== plan.features[def.key]);
    }

    await plan.save();

    if (featuresChanged) {
      await syncPlanStores(plan);
      await writeAudit({
        user: req.user.id,
        action: "plan.features.update",
        entity: "Plan",
        entityId: plan._id,
        oldValue: before,
        newValue: plan.features,
      });
    }
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
