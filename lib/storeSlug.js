const { randomBytes } = require("crypto");
const Store = require("../models/Store");
const shared = require("../public/js/shop-address");
const { isNameTaken } = require("./shopAddress");

// je slug gulo app er nijer path — dokaner thikana e use kora jabe na
const RESERVED_SLUGS = new Set(shared.DEFAULT_RESERVED);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,62}$/;

function normalizeSlug(value) {
  return shared.normalize(value);
}

// kept for older callers; the authoritative check is lib/shopAddress
function slugProblem(slug) {
  const check = shared.validate(slug);
  if (check.ok) return "";
  return check.reason === "reserved" ? "এই ঠিকানাটি সংরক্ষিত, অন্য কিছু নিন" : check.message;
}

// payment approve er somoy slug hariye gele porer ta niye ney (user-chosen
// slugs never get suffixed — those routes ask the user to pick again)
async function uniqueSlug(base) {
  let slug = normalizeSlug(base).slice(0, 63) || "store-" + randomBytes(3).toString("hex");
  if (!(await isNameTaken(slug))) return slug;
  for (let i = 2; i <= 20; i++) {
    const candidate = (slug.slice(0, 58) + "-" + i).slice(0, 63);
    if (!(await isNameTaken(candidate))) return candidate;
  }
  return (slug.slice(0, 55) + "-" + randomBytes(2).toString("hex")).slice(0, 63);
}

module.exports = { RESERVED_SLUGS, SLUG_RE, normalizeSlug, slugProblem, uniqueSlug };
