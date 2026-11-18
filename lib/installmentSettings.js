/* ==========================================================================
   Retail EMI settings — defaults, normalization, cache and the
   product → category → store override chain. All money is integer paisa,
   rate fields are plain percentages (12.5 = 12.5%).
   ========================================================================== */
const cache = require("./cache");
const InstallmentSettings = require("../models/InstallmentSettings");

const METHODS = ["flat_annual", "total_markup", "reducing"];
const SETTINGS_TTL = 30 * 1000;

const DEFAULTS = {
  enabled: false,
  method: "flat_annual",
  annualRatePct: 0,
  markupPct: 0,
  maxAnnualRatePct: 36,
  serviceChargePercent: 0,
  serviceChargeFlatPaisa: 0,
  minDownPaymentPercent: 0,
  cashPriceIsSalePrice: true,
  maxMonths: 60,
  applicant: {
    requireNid: true,
    requireAddress: true,
    requireGuarantor: false,
    requireDocuments: false,
    documentTypes: ["nid_front", "nid_back"],
    note: "",
  },
  review: { approvalRequired: true, autoRejectDays: 3 },
  lateFee: { type: "flat", amountPaisa: 0, percent: 0, graceDays: 3 },
  reminderDays: [3],
  categoryRules: [],
  cardEmi: { enabled: false, note: "" },
  documents: { retentionDays: 180 },
  terms: "",
};

function defaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
}

function toNum(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  let result = n;
  if (min !== undefined) result = Math.max(min, result);
  if (max !== undefined) result = Math.min(max, result);
  return result;
}

function toInt(value, fallback, min, max) {
  return Math.round(toNum(value, fallback, min, max));
}

function nullableNum(value, min = 0, max) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  let result = n;
  if (min !== undefined) result = Math.max(min, result);
  if (max !== undefined) result = Math.min(max, result);
  return result;
}

function nullableInt(value, min = 0, max) {
  const n = nullableNum(value, min, max);
  return n === null ? null : Math.round(n);
}

function nullableBool(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
}

function cleanStrings(list, maxItems = 20, maxLen = 40) {
  const rows = (Array.isArray(list) ? list : [])
    .map((row) => String(row == null ? "" : row).trim().slice(0, maxLen))
    .filter(Boolean);
  return Array.from(new Set(rows)).slice(0, maxItems);
}

function normalizeRules(list) {
  return (Array.isArray(list) ? list : [])
    .map((rule) => {
      if (!rule || !rule.category) return null;
      return {
        category: String(rule.category),
        allowed: nullableBool(rule.allowed),
        method: METHODS.includes(rule.method) ? rule.method : null,
        annualRatePct: nullableNum(rule.annualRatePct, 0, 1000),
        markupPct: nullableNum(rule.markupPct, 0, 1000),
        serviceChargePercent: nullableNum(rule.serviceChargePercent, 0, 100),
        serviceChargeFlatPaisa: nullableInt(rule.serviceChargeFlatPaisa, 0),
      };
    })
    .filter(Boolean)
    .slice(0, 200);
}

function normalizeSettings(input = {}) {
  const doc = input || {};
  const applicant = doc.applicant || {};
  const review = doc.review || {};
  const lateFee = doc.lateFee || {};
  const cardEmi = doc.cardEmi || {};
  const documents = doc.documents || {};
  return {
    enabled: toBool(doc.enabled, DEFAULTS.enabled),
    method: METHODS.includes(doc.method) ? doc.method : DEFAULTS.method,
    annualRatePct: toNum(doc.annualRatePct, DEFAULTS.annualRatePct, 0, 1000),
    markupPct: toNum(doc.markupPct, DEFAULTS.markupPct, 0, 1000),
    maxAnnualRatePct: toNum(doc.maxAnnualRatePct, DEFAULTS.maxAnnualRatePct, 0, 1000),
    serviceChargePercent: toNum(doc.serviceChargePercent, DEFAULTS.serviceChargePercent, 0, 100),
    serviceChargeFlatPaisa: toInt(doc.serviceChargeFlatPaisa, DEFAULTS.serviceChargeFlatPaisa, 0),
    minDownPaymentPercent: toNum(doc.minDownPaymentPercent, DEFAULTS.minDownPaymentPercent, 0, 99),
    cashPriceIsSalePrice: toBool(doc.cashPriceIsSalePrice, DEFAULTS.cashPriceIsSalePrice),
    maxMonths: toInt(doc.maxMonths, DEFAULTS.maxMonths, 2, 60),
    applicant: {
      requireNid: toBool(applicant.requireNid, DEFAULTS.applicant.requireNid),
      requireAddress: toBool(applicant.requireAddress, DEFAULTS.applicant.requireAddress),
      requireGuarantor: toBool(applicant.requireGuarantor, DEFAULTS.applicant.requireGuarantor),
      requireDocuments: toBool(applicant.requireDocuments, DEFAULTS.applicant.requireDocuments),
      documentTypes: cleanStrings(applicant.documentTypes, 10, 40).length
        ? cleanStrings(applicant.documentTypes, 10, 40)
        : [...DEFAULTS.applicant.documentTypes],
      note: String(applicant.note || "").trim().slice(0, 300),
    },
    review: {
      approvalRequired: toBool(review.approvalRequired, DEFAULTS.review.approvalRequired),
      autoRejectDays: toInt(review.autoRejectDays, DEFAULTS.review.autoRejectDays, 0, 30),
    },
    lateFee: {
      type: lateFee.type === "percent" ? "percent" : "flat",
      amountPaisa: toInt(lateFee.amountPaisa, DEFAULTS.lateFee.amountPaisa, 0),
      percent: toNum(lateFee.percent, DEFAULTS.lateFee.percent, 0, 100),
      graceDays: toInt(lateFee.graceDays, DEFAULTS.lateFee.graceDays, 0, 60),
    },
    reminderDays: (Array.isArray(doc.reminderDays) ? doc.reminderDays : DEFAULTS.reminderDays)
      .map((day) => toInt(day, -1, 0, 90))
      .filter((day) => day >= 0)
      .filter((day, index, rows) => rows.indexOf(day) === index)
      .sort((a, b) => a - b)
      .slice(0, 6),
    categoryRules: normalizeRules(doc.categoryRules),
    cardEmi: {
      enabled: toBool(cardEmi.enabled, DEFAULTS.cardEmi.enabled),
      note: String(cardEmi.note || "").trim().slice(0, 300),
    },
    documents: {
      retentionDays: toInt(documents.retentionDays, DEFAULTS.documents.retentionDays, 0, 3650),
    },
    terms: String(doc.terms || "").trim().slice(0, 4000),
  };
}

function normalizeOffer(raw) {
  if (!raw) return null;
  return {
    id: String(raw._id || raw.id || ""),
    name: String(raw.name || "").trim().slice(0, 80),
    months: toInt(raw.months, 0, 2, 60),
    downPaymentPercent: toNum(raw.downPaymentPercent, 0, 0, 99),
    method: METHODS.includes(raw.method) ? raw.method : null,
    annualRatePct: nullableNum(raw.annualRatePct, 0, 1000),
    markupPct: nullableNum(raw.markupPct, 0, 1000),
    serviceChargePercent: nullableNum(raw.serviceChargePercent, 0, 100),
    serviceChargeFlatPaisa: nullableInt(raw.serviceChargeFlatPaisa, 0),
    minProductPricePaisa: toInt(raw.minProductPricePaisa, 0, 0),
    isActive: raw.isActive !== false,
    sortOrder: toInt(raw.sortOrder, 0),
  };
}

function cacheKey(storeId) {
  return `installments:settings:${storeId}`;
}

async function getInstallmentSettings(storeId) {
  if (!storeId) return defaultSettings();
  const hit = cache.get(cacheKey(storeId));
  if (hit) return hit;
  const doc = await InstallmentSettings.findOne({ store: storeId }).lean();
  const value = doc ? normalizeSettings(doc) : defaultSettings();
  cache.set(cacheKey(storeId), value, SETTINGS_TTL);
  return value;
}

function clearInstallmentSettingsCache(storeId) {
  cache.del(cacheKey(storeId));
}

function categoryIdOf(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  return String(entry._id || entry.id || entry.category || "");
}

function productPolicyOf(product) {
  const raw = product && product.installment;
  if (!raw) return null;
  return {
    allowed: nullableBool(raw.allowed),
    method: METHODS.includes(raw.method) ? raw.method : null,
    annualRatePct: nullableNum(raw.annualRatePct, 0, 1000),
    markupPct: nullableNum(raw.markupPct, 0, 1000),
    months: (Array.isArray(raw.months) ? raw.months : [])
      .map((m) => toInt(m, 0, 2, 60))
      .filter((m) => m > 0)
      .filter((m, index, rows) => rows.indexOf(m) === index)
      .sort((a, b) => a - b),
    downPaymentPercent: nullableNum(raw.downPaymentPercent, 0, 99),
    serviceChargePercent: nullableNum(raw.serviceChargePercent, 0, 100),
    serviceChargeFlatPaisa: nullableInt(raw.serviceChargeFlatPaisa, 0),
    note: String(raw.note || "").trim().slice(0, 200),
  };
}

function categoryRuleFor(product, settings) {
  const ids = new Set((product && product.categories ? product.categories : []).map(categoryIdOf).filter(Boolean));
  if (!ids.size) return null;
  let first = null;
  for (const rule of (settings && settings.categoryRules) || []) {
    if (!rule || !ids.has(String(rule.category))) continue;
    if (rule.allowed === false) return rule; // a block always wins
    if (!first) first = rule;
  }
  return first;
}

// Most specific switch wins: product → category → store.
function resolvePolicy(product, settings) {
  const policy = productPolicyOf(product);
  const rule = categoryRuleFor(product, settings);
  if (policy && policy.allowed !== null) {
    return { allowed: policy.allowed, source: "product", policy, rule };
  }
  if (rule && rule.allowed !== null) {
    return { allowed: rule.allowed, source: "category", policy, rule };
  }
  return { allowed: true, source: "store", policy, rule };
}

// Rate precedence: product → plan → category → store.
function pickValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function mergeTerms(settings, { offer, policy, rule } = {}) {
  const method =
    [policy && policy.method, offer && offer.method, rule && rule.method, settings.method].find((value) =>
      METHODS.includes(value)
    ) || "flat_annual";
  const minDownPaymentPercent = Math.max(
    Number(settings.minDownPaymentPercent) || 0,
    Number(offer && offer.downPaymentPercent) || 0,
    Number(policy && policy.downPaymentPercent) || 0
  );
  return {
    method,
    annualRatePct: pickValue(
      policy && policy.annualRatePct,
      offer && offer.annualRatePct,
      rule && rule.annualRatePct,
      settings.annualRatePct
    ),
    markupPct: pickValue(
      policy && policy.markupPct,
      offer && offer.markupPct,
      rule && rule.markupPct,
      settings.markupPct
    ),
    serviceChargePercent: pickValue(
      policy && policy.serviceChargePercent,
      offer && offer.serviceChargePercent,
      rule && rule.serviceChargePercent,
      settings.serviceChargePercent
    ),
    serviceChargeFlatPaisa: pickValue(
      policy && policy.serviceChargeFlatPaisa,
      offer && offer.serviceChargeFlatPaisa,
      rule && rule.serviceChargeFlatPaisa,
      settings.serviceChargeFlatPaisa
    ),
    minDownPaymentPercent: Math.min(99, minDownPaymentPercent),
  };
}

function defaultTerms(storeName) {
  const store = String(storeName || "").trim() || "এই দোকান";
  return (
    `কিস্তি সুবিধাটি ${store} প্রদান করছে। কিস্তি আদায়ের সম্পূর্ণ দায়িত্ব ${store}-এর, ` +
    "প্ল্যাটফর্ম নয়। নির্ধারিত তারিখে কিস্তি পরিশোধ না করলে দোকানের নিয়ম অনুযায়ী বিলম্ব ফি " +
    "প্রযোজ্য হতে পারে এবং অ্যাকাউন্ট স্থগিত হতে পারে।"
  );
}

// Product form payload → Product.installment. null/undefined/blank means
// "inherit store rules"; only fields the admin actually filled are kept.
function sanitizeProductPolicy(raw) {
  if (raw === null || raw === undefined || raw === "inherit") return null;
  if (typeof raw !== "object") return null;
  const out = {
    allowed: nullableBool(raw.allowed),
    method: METHODS.includes(raw.method) ? raw.method : null,
    annualRatePct: nullableNum(raw.annualRatePct, 0, 1000),
    markupPct: nullableNum(raw.markupPct, 0, 1000),
    months: (Array.isArray(raw.months) ? raw.months : [])
      .map((month) => toInt(month, 0, 2, 60))
      .filter((month) => month > 0)
      .filter((month, index, rows) => rows.indexOf(month) === index)
      .sort((a, b) => a - b),
    downPaymentPercent: nullableNum(raw.downPaymentPercent, 0, 99),
    serviceChargePercent: nullableNum(raw.serviceChargePercent, 0, 100),
    serviceChargeFlatPaisa: nullableInt(raw.serviceChargeFlatPaisa, 0),
    note: String(raw.note || "").trim().slice(0, 200),
  };
  const hasValue = ["allowed", "method", "annualRatePct", "markupPct", "downPaymentPercent", "serviceChargePercent", "serviceChargeFlatPaisa", "note"].some(
    (key) => out[key] !== null && out[key] !== ""
  );
  if (!hasValue && !out.months.length) return null;
  return out;
}

module.exports = {
  METHODS,
  DEFAULTS,
  defaultSettings,
  normalizeSettings,
  normalizeOffer,
  getInstallmentSettings,
  clearInstallmentSettingsCache,
  resolvePolicy,
  mergeTerms,
  defaultTerms,
  sanitizeProductPolicy,
};
