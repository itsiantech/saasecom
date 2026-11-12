const express = require("express");
const router = express.Router();
const { randomBytes } = require("crypto");
const Store = require("../models/Store");
const Plan = require("../models/Plan");
const Subscription = require("../models/Subscription");
const dns = require("dns").promises;
const { auth } = require("../middleware/auth");
const { RESERVED_SUBS, SUB_RE, normalizeDomain, platformDomain, platformTarget } = require("../lib/hostStore");
const { storefrontUrl } = require("../lib/storefrontUrl");
const { normalizeSlug } = require("../lib/storeSlug");
const {
  assertShopName,
  recordSlugHistory,
  getSlugCooldownDays,
  nextSlugChangeAt,
} = require("../lib/shopAddress");
const { writeAudit } = require("../lib/audit");
const { featuresForStore } = require("../lib/features");
const { createStoreWithSubscription } = require("../lib/storeProvisioning");
const { applyStarterPack } = require("../services/starterPack");

// notun dokan khola (saas mode e plan soho) — paid plan shudhu payment approve howar por
router.post("/", auth, async (req, res) => {
  try {
    const { name, slug, planSlug, starterPack } = req.body;
    if (!name) return res.status(400).json({ message: "Store er naam lagbe" });

    // empty = generated store-xxxxxx; a typed address must pass the shared rules
    const wanted = String(slug || "").trim();
    const finalSlug = wanted ? await assertShopName(wanted) : "";

    // planSlug dile validate kore store er plan set hoy
    let plan;
    if (planSlug) {
      plan = await Plan.findOne({ slug: String(planSlug).toLowerCase(), active: true });
      if (!plan) return res.status(404).json({ message: "Plan pawa jayni" });
    } else {
      plan = await Plan.findOne({ slug: "free", active: true });
      if (!plan) return res.status(404).json({ message: "Free plan pawa jayni" });
    }

    if (Number(plan.price) > 0 && req.user.role !== "superadmin") {
      return res.status(402).json({
        message: "এই প্যাকেজে পেমেন্ট লাগবে — পেমেন্ট করে দোকান খুলুন",
        requiresPayment: true,
        checkout: "/plan-checkout.html?plan=" + encodeURIComponent(plan.slug),
      });
    }

    const { store, subscription } = await createStoreWithSubscription({
      ownerId: req.user.id,
      name,
      slug: finalSlug,
      plan,
      strictSlug: Boolean(wanted),
    });

    // Apply starter pack if requested (default: true)
    if (starterPack !== false && starterPack !== "false") {
      const packName = starterPack || "general";
      try {
        await applyStarterPack(store._id, packName);
      } catch (packError) {
        console.error("Failed to apply starter pack:", packError);
        // Don't fail store creation if pack fails, just log the error
      }
    }

    res.status(201).json({ store, subscription });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message, code: err.code, reason: err.reason });
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
  const cooldownDays = await getSlugCooldownDays();
  const rows = stores.map((s) => {
    const row = { ...s.toObject(), subscription: byStore.get(String(s._id)) || null };
    row.slugCooldownDays = cooldownDays;
    row.nextSlugChangeAt = nextSlugChangeAt(s, cooldownDays);
    return row;
  });
  // panel er "ওয়েবসাইট দেখুন" link — themed Next site, legacy page na
  const urls = await Promise.all(stores.map((s) => storefrontUrl(s)));
  const access = await Promise.all(stores.map((s) => featuresForStore(s, s.plan)));
  rows.forEach((row, i) => {
    row.storefrontUrl = urls[i];
    row.access = access[i];
  });
  res.json(rows);
});

// panel e je dokan khola ache — super admin onner dokan khullao eta e return kore
router.get("/current", auth, async (req, res) => {
  const store = req.store;
  if (!store) return res.status(404).json({ message: "Store pawa jayni" });
  res.json({
    id: String(store._id),
    slug: store.slug,
    name: store.name,
    storefrontUrl: await storefrontUrl(store),
    access: await featuresForStore(store),
  });
});

// dokaner thikana (slug) poroborton — malik ba super admin.
// owners: N diner cooldown; the old address keeps redirecting for 90 days.
router.patch("/:id/slug", auth, async (req, res) => {
  try {
    const store = await Store.findById(req.params.id);
    if (!store) return res.status(404).json({ message: "Store pawa jayni" });

    const isSuper = req.user.role === "superadmin";
    if (!isSuper && String(store.owner) !== String(req.user.id)) {
      return res.status(403).json({ message: "Ei store er thikana change korte parben na" });
    }

    const cooldownDays = await getSlugCooldownDays();
    const nextChange = nextSlugChangeAt(store, cooldownDays);
    const raw = String(req.body.slug || "").trim();
    if (normalizeSlug(raw) === store.slug) {
      return res.json({ ...store.toObject(), slugCooldownDays: cooldownDays, nextSlugChangeAt: nextChange });
    }
    if (!isSuper && nextChange && nextChange > new Date()) {
      const daysLeft = Math.ceil((nextChange.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      return res.status(429).json({
        message: `ঠিকানা ${cooldownDays} দিনে একবার বদলানো যায় — ${daysLeft} দিন পরে আবার চেষ্টা করুন`,
        code: "slug_cooldown",
        retryAt: nextChange,
      });
    }

    const check = await assertShopName(raw).catch((err) => err);
    if (check instanceof Error) {
      return res.status(check.status || 400).json({ message: check.message, code: check.code, reason: check.reason });
    }
    const slug = check;
    const previous = store.slug;

    store.slug = slug;
    store.slugChangedAt = new Date();
    try {
      await store.save();
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(409).json({ message: "এই ঠিকানা এইমাত্র নেওয়া হয়েছে — অন্য নাম বেছে নিন", code: "slug_taken", reason: "taken" });
      }
      throw err;
    }

    await recordSlugHistory({ slug: previous, store: store._id, kind: "renamed", replacedBySlug: slug });
    await writeAudit({
      store: store._id,
      user: req.user.id,
      action: "store.slug.change",
      entity: "Store",
      entityId: store._id,
      oldValue: { slug: previous },
      newValue: { slug, by: isSuper ? "superadmin" : "owner" },
    });

    res.json({
      ...store.toObject(),
      previousSlug: previous,
      slugCooldownDays: cooldownDays,
      nextSlugChangeAt: nextSlugChangeAt(store, cooldownDays),
    });
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
    if (await Store.exists({ $or: [{ subdomain: label }, { slug: label }], _id: { $ne: store._id } })) {
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
