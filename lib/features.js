/* ==========================================================================
   Package features — ONE registry for the plan editor, owner dashboard,
   storefront flags and API guards. Adding a feature means adding one row.
   ========================================================================== */
const Plan = require("../models/Plan");

const GROUPS = [
  { key: "core", bn: "কোর স্টোর", en: "Core" },
  { key: "sales", bn: "সেলস", en: "Sales" },
  { key: "marketing", bn: "মার্কেটিং", en: "Marketing" },
  { key: "operations", bn: "অপারেশনস", en: "Operations" },
  { key: "advanced", bn: "অ্যাডভান্সড", en: "Advanced" },
];

const FEATURES = [
  {
    key: "products",
    group: "core",
    bn: "প্রোডাক্ট",
    en: "Products",
    desc: "প্রোডাক্ট তালিকা, যোগ ও এডিট",
    legacy: true,
  },
  {
    key: "orders",
    group: "core",
    bn: "অর্ডার",
    en: "Orders",
    desc: "অর্ডার ম্যানেজমেন্ট",
    legacy: true,
  },
  {
    key: "categories",
    group: "core",
    bn: "ক্যাটাগরি",
    en: "Categories",
    desc: "ক্যাটাগরি ও সাব-ক্যাটাগরি",
    legacy: true,
  },
  {
    key: "brands",
    group: "core",
    bn: "ব্র্যান্ড",
    en: "Brands",
    desc: "ব্র্যান্ড তালিকা",
    legacy: true,
  },
  {
    key: "customers",
    group: "core",
    bn: "কাস্টমার",
    en: "Customers",
    desc: "কাস্টমার লিস্ট ও নোট",
    legacy: true,
  },
  {
    key: "settings",
    group: "core",
    bn: "সেটিংস",
    en: "Settings",
    desc: "দোকান, পেমেন্ট ও SEO সেটিংস",
    legacy: true,
  },
  {
    key: "wholesale",
    group: "sales",
    bn: "হোলসেল মোড",
    en: "Wholesale mode",
    desc: "পাইকারি দাম, MOQ, buyer list",
    legacy: true,
  },
  {
    key: "partialPayment",
    group: "sales",
    bn: "আংশিক পেমেন্ট / কিস্তি",
    en: "Partial payment",
    desc: "হোলসেল অর্ডারে অগ্রিম + বাকি",
    requires: "wholesale",
    legacy: true,
  },
  {
    key: "serverSideTracking",
    group: "marketing",
    bn: "সার্ভার সাইড ট্র্যাকিং",
    en: "Server Side Tracking",
    desc: "Meta CAPI, TikTok, GA4, Google Ads",
    legacy: true,
  },
  {
    key: "flashSales",
    group: "marketing",
    bn: "ফ্ল্যাশ সেল",
    en: "Flash sales",
    desc: "সময়সীমা ভিত্তিক ডিসকাউন্ট",
    legacy: true,
  },
  {
    key: "coupons",
    group: "marketing",
    bn: "কুপন",
    en: "Coupons",
    desc: "ডিসকাউন্ট কুপন",
    legacy: true,
  },
  {
    key: "supplierPortal",
    group: "operations",
    bn: "সাপ্লায়ার লগইন ও রেজিস্ট্রেশন",
    en: "Supplier login & registration",
    desc: "সাপ্লায়ার নিজে লগইন/অর্ডার দেখবে",
    legacy: true,
  },
  {
    key: "inventory",
    group: "operations",
    bn: "ইনভেন্টরি ও স্টক",
    en: "Inventory & stock",
    desc: "স্টক রিপোর্ট, মুভমেন্ট, ট্রান্সফার",
    legacy: true,
  },
  {
    key: "accounts",
    group: "operations",
    bn: "অ্যাকাউন্টস ও ফাইন্যান্স",
    en: "Accounts & finance",
    desc: "খরচ, সাপ্লায়ার ব্যালেন্স, লাভ-ক্ষতি",
    legacy: true,
  },
  {
    key: "reports",
    group: "operations",
    bn: "রিপোর্ট",
    en: "Reports",
    desc: "সেলস, প্রোডাক্ট, কাস্টমার রিপোর্ট",
    legacy: true,
  },
  {
    key: "customDomain",
    group: "advanced",
    bn: "কাস্টম ডোমেইন",
    en: "Custom domain",
    desc: "নিজের ডোমেইন কানেক্ট",
    legacy: false,
  },
  {
    key: "analytics",
    group: "advanced",
    bn: "অ্যানালিটিক্স",
    en: "Analytics",
    desc: "বিস্তারিত রিপোর্ট অ্যাক্সেস",
    legacy: false,
  },
  {
    key: "apiAccess",
    group: "advanced",
    bn: "API অ্যাক্সেস",
    en: "API access",
    desc: "বাইরের সিস্টেমে ডেটা পাঠানো",
    legacy: false,
  },
  {
    key: "prioritySupport",
    group: "advanced",
    bn: "প্রায়োরিটি সাপোর্ট",
    en: "Priority support",
    desc: "দ্রুত সাপোর্ট",
    legacy: false,
  },
];

const BY_KEY = new Map(FEATURES.map((f) => [f.key, f]));
const GROUP_BY_KEY = new Map(GROUPS.map((g) => [g.key, g]));

function isFeature(key) {
  return BY_KEY.has(String(key || ""));
}

function featureList() {
  return FEATURES.map((f) => ({
    ...f,
    groupBn: (GROUP_BY_KEY.get(f.group) || {}).bn || f.group,
    groupEn: (GROUP_BY_KEY.get(f.group) || {}).en || f.group,
  }));
}

function groupList() {
  return GROUPS.map((g) => ({ ...g }));
}

function cleanKeys(list) {
  return Array.from(new Set((Array.isArray(list) ? list : []).map((k) => String(k || "")).filter(isFeature)));
}

// Checkbox pickers send the effective ON set. Anything the plan already covers
// stays inherited; extras become grants and unchecked plan modules become revokes.
function pruneSelection(list) {
  const sel = new Set(cleanKeys(list));
  let changed = true;
  while (changed) {
    changed = false;
    FEATURES.forEach((def) => {
      if (def.requires && sel.has(def.key) && !sel.has(def.requires)) {
        sel.delete(def.key);
        changed = true;
      }
    });
  }
  return sel;
}

function overridesForSelection(plan, list) {
  const sel = pruneSelection(list);
  const granted = [];
  const revoked = [];
  FEATURES.forEach((def) => {
    const wanted = sel.has(def.key);
    const inPlan = planHas(plan, def.key);
    if (wanted && !inPlan) granted.push(def.key);
    if (!wanted && inPlan) revoked.push(def.key);
  });
  return { granted, revoked };
}

// Modules that existed before packages gated them default to on, so a legacy
// plan does not silently lose wholesale/tracking the day this ships.
function planHas(plan, key) {
  const def = BY_KEY.get(key);
  if (!def || !plan || !plan.features) return false;
  const raw = plan.features[key];
  if (raw === undefined || raw === null) return def.legacy === true;
  return raw === true;
}

function overridesOf(store) {
  const list = (store && store.featureOverrides) || {};
  return { granted: cleanKeys(list.granted), revoked: cleanKeys(list.revoked) };
}

function resolveFeature(store, plan, key, seen) {
  const def = BY_KEY.get(key);
  if (!def) return { on: false, source: "none" };
  const stack = seen || new Set();
  if (stack.has(key)) return { on: false, source: "none" };
  stack.add(key);

  const { granted, revoked } = overridesOf(store);
  if (revoked.includes(key)) return { on: false, source: "blocked" };

  const requirementMet = !def.requires || resolveFeature(store, plan, def.requires, stack).on;
  if (!requirementMet) return { on: false, source: "none" };

  if (granted.includes(key)) return { on: true, source: "granted" };
  if (planHas(plan, key)) return { on: true, source: "plan" };
  return { on: false, source: "none" };
}

function resolveFeatures(store, plan) {
  const features = {};
  const sources = {};
  FEATURES.forEach((def) => {
    const row = resolveFeature(store, plan, def.key);
    features[def.key] = row.on;
    sources[def.key] = row.source;
  });
  return { features, sources, overrides: overridesOf(store) };
}

async function featuresForStore(store, planDoc) {
  if (!store) return { features: {}, sources: {}, overrides: { granted: [], revoked: [] }, plan: null };
  let plan = planDoc || store.plan;
  if (!plan || typeof plan !== "object" || plan.features === undefined) {
    plan = plan ? await Plan.findById(plan).lean() : null;
  }
  const resolved = resolveFeatures(store, plan);
  return {
    ...resolved,
    plan: plan ? { id: String(plan._id), name: plan.name, slug: plan.slug } : null,
  };
}

// API-side enforcement — hiding a setting is not enough.
function requireFeature(key) {
  return async function featureGuard(req, res, next) {
    try {
      if (!isFeature(key)) return next();
      // platform owner shob dokan manage kore — tader kache gate khulbe na
      if (req.user && req.user.role === "superadmin") return next();
      const access = await featuresForStore(req.store);
      if (access.features[key]) return next();
      return res.status(403).json({
        code: "feature_locked",
        feature: key,
        message: "এই সুবিধাটি আপনার প্যাকেজে নেই — প্যাকেজ আপগ্রেড করুন",
      });
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  FEATURES,
  GROUPS,
  isFeature,
  featureList,
  groupList,
  cleanKeys,
  planHas,
  overridesOf,
  pruneSelection,
  overridesForSelection,
  resolveFeature,
  resolveFeatures,
  featuresForStore,
  requireFeature,
};
