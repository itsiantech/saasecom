const express = require("express");
const path = require("path");
const router = express.Router();
const Store = require("../models/Store");
const Plan = require("../models/Plan");
const User = require("../models/User");
const Product = require("../models/Product");
const Settings = require("../models/Settings");
const PlatformPayment = require("../models/PlatformPayment");
const { auth, requireSuperAdmin } = require("../middleware/auth");
const { makeImageUpload, singleImage, finalizeImage } = require("../middleware/upload");
const { normalizeTheme, parseTheme } = require("../lib/adminTheme");
const { getBranding, saveBranding } = require("../lib/landingBranding");
const { normalizeDomain, platformDomain, platformTarget } = require("../lib/hostStore");
const { getReservedSlugs, saveReservedSlugs, getSlugCooldownDays, DEFAULT_COOLDOWN_DAYS } = require("../lib/shopAddress");
const sharedShopAddress = require("../public/js/shop-address");
const billing = require("../lib/platformBilling");
const { approvePayment, rejectPayment } = require("../lib/billingApproval");
const { cleanKeys, featuresForStore, featureList, overridesForSelection } = require("../lib/features");
const { syncFeatureEntitlements, createStoreWithSubscription } = require("../lib/storeProvisioning");
const { assertShopName } = require("../lib/shopAddress");
const { writeAudit } = require("../lib/audit");

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

// the feature registry — plan editor and store access UI read the same list
router.get("/features", auth, requireSuperAdmin, (_req, res) => {
  res.json(featureList());
});

// sobgulo store (owner er naam/email + effective feature access soho)
router.get("/stores", auth, requireSuperAdmin, async (req, res) => {
  const stores = await Store.find().sort({ createdAt: -1 }).populate("owner", "name email").populate("plan");
  const rows = await Promise.all(
    stores.map(async (store) => {
      const row = store.toObject();
      row.access = await featuresForStore(store, store.plan);
      return row;
    })
  );
  res.json(rows);
});

// super admin notun dokan khola — owner age theke registered thakte hobe
router.post("/stores", auth, requireSuperAdmin, async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || "").trim().toLowerCase();
    const name = String((req.body && req.body.name) || "").trim();
    if (!email) return res.status(400).json({ message: "মালিকের ইমেইল দিন" });
    if (!name) return res.status(400).json({ message: "দোকানের নাম দিন" });

    const owner = await User.findOne({ email }).select("_id name email");
    if (!owner) {
      return res.status(404).json({ message: "এই ইমেইলে কোনো অ্যাকাউন্ট নেই — মালিককে আগে সাইনআপ করতে বলুন" });
    }

    const planSlug = String((req.body && req.body.planSlug) || "").trim().toLowerCase();
    const plan = planSlug
      ? await Plan.findOne({ slug: planSlug, active: true })
      : await Plan.findOne({ slug: "free", active: true });
    if (!plan) return res.status(404).json({ message: "প্যাকেজ পাওয়া যায়নি" });

    const wanted = String((req.body && req.body.slug) || "").trim();
    const finalSlug = wanted ? await assertShopName(wanted) : "";

    const { store, subscription } = await createStoreWithSubscription({
      ownerId: owner._id,
      name,
      slug: finalSlug,
      plan,
      strictSlug: Boolean(wanted),
    });

    const selected = req.body && req.body.features;
    if (Array.isArray(selected)) {
      const ov = overridesForSelection(plan, selected);
      store.featureOverrides = {
        granted: ov.granted,
        revoked: ov.revoked,
        updatedAt: new Date(),
        updatedBy: req.user.id,
      };
      await store.save();
      await syncFeatureEntitlements(store, plan);
    }

    await writeAudit({
      store: store._id,
      user: req.user.id,
      action: "store.create",
      entity: "Store",
      entityId: store._id,
      newValue: {
        name: store.name,
        slug: store.slug,
        owner: String(owner._id),
        plan: plan.slug,
        features: Array.isArray(selected) ? cleanKeys(selected) : null,
      },
    });

    res.status(201).json({
      store: store.toObject(),
      subscription,
      access: await featuresForStore(store, plan),
    });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message, code: err.code, reason: err.reason });
  }
});

// kono store er plan bodla — feature entitlement sathe sathe apply hoy
router.put("/stores/:id/plan", auth, requireSuperAdmin, async (req, res) => {
  try {
    const { planSlug } = req.body;
    const plan = await Plan.findOne({ slug: planSlug });
    if (!plan) return res.status(404).json({ message: "Plan pawa jayni" });
    const store = await Store.findById(req.params.id);
    if (!store) return res.status(404).json({ message: "Store pawa jayni" });
    const previous = String(store.plan);
    store.plan = plan._id;
    await store.save();
    const access = await syncFeatureEntitlements(store, plan);
    await writeAudit({
      store: store._id,
      user: req.user.id,
      action: "store.plan.change",
      entity: "Store",
      entityId: store._id,
      oldValue: { plan: previous },
      newValue: { plan: String(plan._id), slug: plan.slug },
    });
    res.json({ ...store.toObject(), access });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// per-store extra access — granted = plan er baire, revoked = plan e thakleo bondho
router.patch("/stores/:id/features", auth, requireSuperAdmin, async (req, res) => {
  try {
    const store = await Store.findById(req.params.id).populate("plan");
    if (!store) return res.status(404).json({ message: "Store pawa jayni" });
    const granted = cleanKeys(req.body && req.body.granted);
    const revoked = cleanKeys(req.body && req.body.revoked);
    const before = {
      granted: cleanKeys(store.featureOverrides && store.featureOverrides.granted),
      revoked: cleanKeys(store.featureOverrides && store.featureOverrides.revoked),
    };
    store.featureOverrides = {
      granted: granted.filter((key) => !revoked.includes(key)),
      revoked,
      updatedAt: new Date(),
      updatedBy: req.user.id,
    };
    await store.save();
    const access = await syncFeatureEntitlements(store, store.plan);
    await writeAudit({
      store: store._id,
      user: req.user.id,
      action: "store.features.update",
      entity: "Store",
      entityId: store._id,
      oldValue: before,
      newValue: { granted: store.featureOverrides.granted, revoked: store.featureOverrides.revoked },
    });
    res.json(access);
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

// platform addressing: the domain every shop lives under + the reserved names
router.get("/settings/platform", auth, requireSuperAdmin, async (req, res) => {
  try {
    res.json({
      platformDomain: (await platformDomain()) || "",
      platformIp: (await platformTarget()) || "",
      reservedSlugs: await getReservedSlugs(),
      defaultReservedSlugs: sharedShopAddress.DEFAULT_RESERVED,
      slugCooldownDays: await getSlugCooldownDays(),
      defaultCooldownDays: DEFAULT_COOLDOWN_DAYS,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/settings/platform", auth, requireSuperAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    if (body.platformDomain !== undefined) {
      const raw = String(body.platformDomain || "").trim();
      const domain = raw ? normalizeDomain(raw) : "";
      if (raw && !domain) {
        return res.status(400).json({ message: "ডোমেইন ঠিকভাবে লিখুন (যেমন: myshop.com)" });
      }
      await Settings.findOneAndUpdate({ key: "platformDomain" }, { $set: { value: domain } }, { upsert: true });
    }
    if (body.platformIp !== undefined) {
      const ip = String(body.platformIp || "").trim().slice(0, 120);
      await Settings.findOneAndUpdate({ key: "platformIp" }, { $set: { value: ip } }, { upsert: true });
    }
    if (body.reservedSlugs !== undefined) {
      await saveReservedSlugs(body.reservedSlugs);
    }
    if (body.slugCooldownDays !== undefined) {
      const days = Number(body.slugCooldownDays);
      if (!Number.isFinite(days) || days < 0 || days > 365) {
        return res.status(400).json({ message: "কুলডাউন ০–৩৬৫ দিনের মধ্যে হতে হবে" });
      }
      await Settings.findOneAndUpdate(
        { key: "slugChangeCooldownDays" },
        { $set: { value: String(Math.floor(days)) } },
        { upsert: true }
      );
    }
    res.json({
      platformDomain: (await platformDomain()) || "",
      platformIp: (await platformTarget()) || "",
      reservedSlugs: await getReservedSlugs(),
      slugCooldownDays: await getSlugCooldownDays(),
      defaultCooldownDays: DEFAULT_COOLDOWN_DAYS,
    });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
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

/* ------------------------------------------------- landing page branding */

const BRANDING_DIR = path.join(__dirname, "..", "public", "uploads", "branding");
const brandingImage = makeImageUpload({ maxBytes: 10 * 1024 * 1024, allowSvg: true });

router.get("/settings/landing", auth, requireSuperAdmin, async (req, res) => {
  try {
    res.json({ branding: await getBranding() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/settings/landing", auth, requireSuperAdmin, async (req, res) => {
  try {
    const patch = (req.body && req.body.branding) || req.body || {};
    res.json({ branding: await saveBranding(patch) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

for (const field of ["logo", "favicon"]) {
  router.post(`/settings/landing/${field}`, auth, requireSuperAdmin, singleImage(brandingImage, field), finalizeImage({ dir: BRANDING_DIR, allowSvg: true }), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const url = "/uploads/branding/" + req.file.filename;
      const branding = await saveBranding({ [field]: url });
      res.json({ [field]: url, branding });
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });

  router.delete(`/settings/landing/${field}`, auth, requireSuperAdmin, async (req, res) => {
    try {
      const branding = await saveBranding({ [field]: "" });
      res.json({ [field]: "", branding });
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
}

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
    const out = await approvePayment({
      paymentId: req.params.id,
      adminId: req.user.id,
      features: req.body && req.body.features,
    });
    if (Array.isArray(req.body && req.body.features) && out.store) {
      await writeAudit({
        store: out.store._id,
        user: req.user.id,
        action: "store.features.update",
        entity: "Store",
        entityId: out.store._id,
        newValue: {
          granted: (out.store.featureOverrides && out.store.featureOverrides.granted) || [],
          revoked: (out.store.featureOverrides && out.store.featureOverrides.revoked) || [],
          via: "payment.approve",
        },
      });
    }
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
