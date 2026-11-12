/* ==========================================================================
   Shop address (subdomain label) availability — the server half of the
   shared validator in public/js/shop-address.js. The client only advises;
   creation always re-checks here and the unique index is the last word.
   ========================================================================== */
const Settings = require("../models/Settings");
const Store = require("../models/Store");
const SlugHistory = require("../models/SlugHistory");
const shared = require("../public/js/shop-address");

const RESERVED_KEY = "reservedSlugs";
const QUARANTINE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseReserved(value) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

// super admin edits the list in platform settings; defaults apply until then
async function getReservedSlugs() {
  const doc = await Settings.findOne({ key: RESERVED_KEY }).lean();
  const stored = parseReserved(doc && doc.value);
  return stored.length ? stored : shared.DEFAULT_RESERVED.slice();
}

async function saveReservedSlugs(list) {
  const cleaned = [];
  for (const raw of Array.isArray(list) ? list : parseReserved(list)) {
    const check = shared.validate(raw, { reserved: [] });
    if (!check.ok) {
      const reasons = shared.MESSAGES[check.reason];
      const err = new Error(`"${check.value || String(raw).trim()}" — ${reasons ? reasons.bn : "ঠিকানাটি ঠিক নয়"}`);
      err.status = 400;
      throw err;
    }
    if (cleaned.indexOf(check.value) === -1) cleaned.push(check.value);
  }
  await Settings.findOneAndUpdate(
    { key: RESERVED_KEY },
    { $set: { value: cleaned.join("\n") } },
    { upsert: true }
  );
  return cleaned;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Taken = any Store.slug, Store.subdomain, first label of a *verified* custom
 * domain, or a slug still inside its 90-day quarantine. Suspended, trashed and
 * soft-deleted stores are deliberately included — their address stays theirs.
 */
async function isNameTaken(name) {
  const escaped = escapeRegex(name);
  const now = new Date();
  const [slugHit, subdomainHit, customDomainHit, historyHit] = await Promise.all([
    Store.exists({ slug: name }),
    Store.exists({ subdomain: name }),
    Store.exists({
      customDomainStatus: "verified",
      customDomain: new RegExp("^" + escaped + "\\."),
    }),
    SlugHistory.exists({ slug: name, quarantineUntil: { $gt: now } }),
  ]);
  return Boolean(slugHit || subdomainHit || customDomainHit || historyHit);
}

/**
 * Full check for the public endpoint and for creation.
 * reason: null | "invalid" | "reserved" | "taken"
 */
async function checkShopName(raw) {
  const reserved = await getReservedSlugs();
  const check = shared.validate(raw, { reserved });
  if (!check.ok) {
    return {
      available: false,
      reason: check.apiReason,
      value: check.value,
      detail: check.reason,
      message: check.message,
    };
  }
  if (await isNameTaken(check.value)) {
    return {
      available: false,
      reason: "taken",
      value: check.value,
      detail: "taken",
      message: shared.MESSAGES.taken.bn,
    };
  }
  return { available: true, reason: null, value: check.value, detail: "", message: "" };
}

// throws an http-shaped error for routes; returns the normalized label
async function assertShopName(raw) {
  const result = await checkShopName(raw);
  if (result.available) return result.value;
  const err = new Error(result.message);
  err.reason = result.reason;
  err.code = result.reason === "taken" ? "slug_taken" : result.reason === "reserved" ? "slug_reserved" : "slug_invalid";
  err.status = result.reason === "taken" ? 409 : 400;
  throw err;
}

// wrap a duplicate-key error from the unique index in the 409 the UI expects
function slugTakenError() {
  const err = new Error("এই ঠিকানাটি এইমাত্র নেওয়া হয়েছে — অন্য নাম বেছে নিন");
  err.status = 409;
  err.reason = "taken";
  err.code = "slug_taken";
  return err;
}

// keep a released/renamed name out of circulation for the quarantine period
async function recordSlugHistory({ slug, store, kind, replacedBySlug }) {
  const now = new Date();
  return SlugHistory.create({
    slug: shared.normalize(slug),
    store,
    kind: kind === "renamed" ? "renamed" : "released",
    replacedBySlug: shared.normalize(replacedBySlug || ""),
    releasedAt: now,
    quarantineUntil: new Date(now.getTime() + QUARANTINE_DAYS * DAY_MS),
  });
}

module.exports = {
  RESERVED_KEY,
  QUARANTINE_DAYS,
  getReservedSlugs,
  saveReservedSlugs,
  isNameTaken,
  checkShopName,
  assertShopName,
  slugTakenError,
  recordSlugHistory,
};
