const express = require("express");
const router = express.Router();
const { randomBytes } = require("crypto");
const Store = require("../models/Store");
const Plan = require("../models/Plan");
const Subscription = require("../models/Subscription");
const dns = require("dns").promises;
const { auth } = require("../middleware/auth");
const { RESERVED_SUBS, SUB_RE, normalizeDomain, platformDomain, platformTarget } = require("../lib/hostStore");

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
    if (RESERVED_SLUGS.has(finalSlug)) {
      return res.status(400).json({ message: "এই ঠিকানাটি সংরক্ষিত, অন্য কিছু নিন" });
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

// amar dokan gulo (plan + subscription soho)
router.get("/mine", auth, async (req, res) => {
  const stores = await Store.find({ owner: req.user.id }).populate("plan").sort({ createdAt: 1 });
  const subs = await Subscription.find({ store: { $in: stores.map((s) => s._id) } });
  const byStore = new Map(subs.map((s) => [String(s.store), s]));
  res.json(stores.map((s) => ({ ...s.toObject(), subscription: byStore.get(String(s._id)) || null })));
});

// je slug gulo app er nijer path — dokaner thikana e use kora jabe na
const RESERVED_SLUGS = new Set([
  "api", "css", "js", "uploads", "assets", "admin", "dashboard", "login", "register",
  "setup", "portal", "account", "checkout", "product", "shop", "store", "home", "static",
  "favicon", "robots", "health", "favicon.ico",
]);

// dokaner thikana (slug) poroborton — shudhu malik ba super admin
router.patch("/:id/slug", auth, async (req, res) => {
  try {
    const store = await Store.findById(req.params.id);
    if (!store) return res.status(404).json({ message: "Store pawa jayni" });

    const isSuper = req.user.role === "superadmin";
    if (!isSuper && String(store.owner) !== String(req.user.id)) {
      return res.status(403).json({ message: "Ei store er thikana change korte parben na" });
    }

    const slug = String(req.body.slug || "").toLowerCase().trim();
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
      return res.status(400).json({ message: "ঠিকানা ৩-৬৩ অক্ষরের হতে হবে — ছোট হাতের অক্ষর, সংখ্যা বা hyphen" });
    }
    if (RESERVED_SLUGS.has(slug)) {
      return res.status(400).json({ message: "এই ঠিকানাটি সংরক্ষিত, অন্য কিছু নিন" });
    }
    if (await Store.exists({ slug, _id: { $ne: store._id } })) {
      return res.status(409).json({ message: "এই ঠিকানা আগেই নেওয়া হয়েছে" });
    }

    store.slug = slug;
    await store.save();
    res.json(store);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

/* ------------------------------------------------------------------ domain */

async function canManage(req, store) {
  if (req.user.role === "superadmin") return true;
  return String(store.owner) === String(req.user.id);
}

async function loadManageable(req, res) {
  const store = await Store.findById(req.params.id);
  if (!store) {
    res.status(404).json({ message: "Store pawa jayni" });
    return null;
  }
  if (!(await canManage(req, store))) {
    res.status(403).json({ message: "Ei store er domain change korte parben na" });
    return null;
  }
  return store;
}

// portal er guideline panel ei config diyei DNS record lekhe
router.get("/domain-config", auth, async (req, res) => {
  try {
    const main = await platformDomain();
    res.json({
      platformDomain: main || null,
      target: (await platformTarget()) || null,
      ready: Boolean(main),
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// subdomain: amar-dokan.platform.com — DNS lagbe na, wildcard record age theke thake
router.put("/:id/subdomain", auth, async (req, res) => {
  try {
    const store = await loadManageable(req, res);
    if (!store) return;

    const label = String(req.body.subdomain || "").toLowerCase().trim();
    if (!label) {
      store.subdomain = undefined;
      await store.save();
      return res.json({ subdomain: null, hostname: null });
    }
    if (!SUB_RE.test(label)) {
      return res.status(400).json({ message: "সাব-ডোমেইন ৩-৬৩ অক্ষরের — ছোট হাতের অক্ষর, সংখ্যা বা hyphen" });
    }
    if (RESERVED_SUBS.has(label)) return res.status(400).json({ message: "এই নামটি সংরক্ষিত, অন্য কিছু নিন" });
    if (await Store.exists({ subdomain: label, _id: { $ne: store._id } })) {
      return res.status(409).json({ message: "এই সাব-ডোমেইন আগেই নেওয়া হয়েছে" });
    }

    store.subdomain = label;
    await store.save();
    const main = await platformDomain();
    res.json({ subdomain: label, hostname: main ? label + "." + main : null });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// customer er nijer domain — prothome pending, TXT record mille verified
router.put("/:id/custom-domain", auth, async (req, res) => {
  try {
    const store = await loadManageable(req, res);
    if (!store) return;

    const plan = await Plan.findById(store.plan);
    if (!plan || !plan.features?.customDomain) {
      return res.status(403).json({ message: "কাস্টম ডোমেইন এই প্যাকেজে নেই — আগে প্যাকেজ আপগ্রেড করুন" });
    }

    const domain = normalizeDomain(req.body.domain);
    if (!domain) return res.status(400).json({ message: "ডোমেইন ঠিকভাবে লিখুন (যেমন: myshop.com)" });

    const main = await platformDomain();
    if (main && (domain === main || domain.endsWith("." + main))) {
      return res.status(400).json({ message: "প্ল্যাটফর্মের নিজের ডোমেইন কাস্টম ডোমেইন হিসেবে দেওয়া যাবে না" });
    }
    if (await Store.exists({ customDomain: domain, _id: { $ne: store._id } })) {
      return res.status(409).json({ message: "এই ডোমেইন অন্য একটি দোকানে যুক্ত আছে" });
    }

    store.customDomain = domain;
    store.customDomainStatus = "pending";
    store.domainToken = "lxv_" + randomBytes(12).toString("hex");
    store.domainCheckedAt = null;
    await store.save();
    res.json({
      domain,
      status: store.customDomainStatus,
      token: store.domainToken,
      txtHost: "_luxe-verify." + domain,
      platformDomain: main || null,
      target: (await platformTarget()) || null,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id/custom-domain/verify", auth, async (req, res) => {
  try {
    const store = await loadManageable(req, res);
    if (!store) return;
    if (!store.customDomain) return res.status(400).json({ message: "আগে একটি ডোমেইন যোগ করুন" });

    let ok = false;
    let detail = "";
    try {
      const records = await dns.resolveTxt("_luxe-verify." + store.customDomain);
      const values = records.map((chunks) => chunks.join(""));
      ok = values.includes(store.domainToken);
      if (!ok) detail = values.length ? "TXT record টা মেলেনি" : "TXT record পাওয়া যায়নি";
    } catch (err) {
      detail = err.code === "ENOTFOUND" ? "TXT record পাওয়া যায়নি" : "DNS check করা যায়নি";
    }

    store.customDomainStatus = ok ? "verified" : "failed";
    store.domainCheckedAt = new Date();
    await store.save();
    res.json({ domain: store.customDomain, status: store.customDomainStatus, detail: ok ? "" : detail });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete("/:id/custom-domain", auth, async (req, res) => {
  try {
    const store = await loadManageable(req, res);
    if (!store) return;
    store.customDomain = undefined;
    store.customDomainStatus = "none";
    store.domainToken = null;
    store.domainCheckedAt = null;
    await store.save();
    res.json({ domain: null, status: "none" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
