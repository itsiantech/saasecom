const { randomBytes } = require("crypto");
const Store = require("../models/Store");

// je slug gulo app er nijer path — dokaner thikana e use kora jabe na
const RESERVED_SLUGS = new Set([
  "api", "css", "js", "uploads", "assets", "admin", "dashboard", "login", "register",
  "setup", "portal", "account", "checkout", "plan-checkout", "billing", "payment",
  "product", "shop", "store", "home", "static", "favicon", "robots", "health", "favicon.ico",
]);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,62}$/;

function normalizeSlug(value) {
  return String(value || "").toLowerCase().trim();
}

// empty string = thik ache, na hole bangla error message
function slugProblem(slug) {
  const s = normalizeSlug(slug);
  if (!s) return "দোকানের ঠিকানা (slug) লিখুন";
  if (!/^[a-z0-9-]+$/.test(s)) return "Slug e shudhu choto hater, number, hyphen hobe";
  if (!SLUG_RE.test(s)) return "ঠিকানা ৩–৬৩ অক্ষরের হতে হবে — ছোট হাতের অক্ষর, সংখ্যা বা hyphen";
  if (RESERVED_SLUGS.has(s)) return "এই ঠিকানাটি সংরক্ষিত, অন্য কিছু নিন";
  return "";
}

// payment approve er somoy slug hariye gele porer ta niye ney
async function uniqueSlug(base) {
  let slug = normalizeSlug(base).slice(0, 63) || "store-" + randomBytes(3).toString("hex");
  if (!(await Store.exists({ slug }))) return slug;
  for (let i = 2; i <= 20; i++) {
    const candidate = (slug.slice(0, 58) + "-" + i).slice(0, 63);
    if (!(await Store.exists({ slug: candidate }))) return candidate;
  }
  return (slug.slice(0, 55) + "-" + randomBytes(2).toString("hex")).slice(0, 63);
}

module.exports = { RESERVED_SLUGS, SLUG_RE, normalizeSlug, slugProblem, uniqueSlug };
