const jwt = require("jsonwebtoken");
const { randomBytes } = require("crypto");
const Store = require("../models/Store");
const Plan = require("../models/Plan");
const Settings = require("../models/Settings");
const User = require("../models/User");
const { tenantStorage } = require("../lib/tenantContext");
const { resolveHostStore } = require("../lib/hostStore");
const { fromDomainHeader } = require("./publicStore");
const { tenantTokenOf } = require("../lib/tenantAdmin");

// store chara kaj cholbe e api gulote (signup/setup/billing er somoy)
const STORELESS_OK = ["/api/auth", "/api/plans", "/api/settings", "/api/admin", "/api/stores", "/api/billing"];

// banned shop e owner er jonno ei path gulo khula — login, payment submit,
// plan info. Read-only store lookups stay open so the portal can render its
// "pay now" card; anything that edits the shop is locked.
const SUSPENDED_OK = ["/api/auth", "/api/billing", "/api/plans", "/api/admin"];
const SUSPENDED_READS = ["/api/subscriptions/current", "/api/stores/current", "/api/stores/mine", "/api/stores/domain-config"];

function allowedWhileSuspended(req) {
  if (SUSPENDED_OK.some((prefix) => req.path.startsWith(prefix))) return true;
  if (req.method === "GET" && SUSPENDED_READS.some((prefix) => req.path.startsWith(prefix))) return true;
  return false;
}

async function saasEnabled() {
  if (process.env.APP_MODE === "single") return false;
  if (process.env.APP_MODE === "saas") return true;
  const doc = await Settings.findOne({ key: "saasEnabled" });
  return doc ? doc.value === "true" : true; // default: saas cholche
}

function getTokenUserId(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    try {
      return jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ["HS256"] }).id;
    } catch {
      return null;
    }
  }
  const tenant = tenantTokenOf(req);
  return tenant ? tenant.id : null;
}

async function randomSlug() {
  for (let i = 0; i < 5; i++) {
    const slug = "store-" + randomBytes(3).toString("hex");
    if (!(await Store.exists({ slug }))) return slug;
  }
  return "store-" + Date.now().toString(36);
}

async function resolveStore(req, saas) {
  // single mode: sob request ek e dokane jay (standalone bikrir jonno).
  // A known shop host still wins: the white-label panel opens on that host and
  // its host-only cookie is bound to the store the host resolves to, so the
  // later scope/ownership checks must see the same store.
  if (!saas) {
    const hostStore = await resolveHostStore(req);
    if (hostStore) return hostStore;
    let store = await Store.findOne({ deletedAt: null }).sort({ createdAt: 1 });
    if (!store) {
      const ownerId = getTokenUserId(req);
      if (!ownerId) return null;
      const freePlan = await Plan.findOne({ slug: "free", active: true });
      if (!freePlan) return null;
      store = await Store.create({ name: "My Store", slug: await randomSlug(), owner: ownerId, plan: freePlan._id });
    }
    return store;
  }

  // saas mode 0: host nijei store bole dey (amar-dokan.platform.com ba dokan.com)
  const hostStore = await resolveHostStore(req);
  if (hostStore) return hostStore;

  // saas mode 1a: Next.js proxy theke asha visitor hostname (backend er nijer
  // req.hostname proxi er localhost, tai cart/auth route gulote o domain lagbe)
  const domainStore = await fromDomainHeader(req);
  if (domainStore) return domainStore;

  // saas mode 1b: explicitly slug deya thakle (frontend header/query diye pathay)
  const slug = req.headers["x-store-slug"] || req.query.store;
  if (slug) return Store.findOne({ slug: String(slug).toLowerCase(), deletedAt: null });

  // saas mode 2: login kora user er dokan (setup page e khola hoy, auto na)
  const userId = getTokenUserId(req);
  if (userId) return Store.findOne({ owner: userId, deletedAt: null }).sort({ createdAt: 1 });

  return null;
}

// Payment ban → storefront already 403s (publicStore/shop host); this locks
// the owner's admin side too. Superadmins keep full access.
async function blockedBySuspension(req, store) {
  if (store.status !== "suspended") return false;
  if (allowedWhileSuspended(req)) return false;
  const userId = getTokenUserId(req);
  if (!userId) return true;
  const user = await User.findById(userId).select("role");
  return !user || user.role !== "superadmin";
}

module.exports = async function tenant(req, res, next) {
  // static file er jonno tenant lagbe na
  if (req.method === "GET" && !req.path.startsWith("/api")) return next();
  try {
    const saas = await saasEnabled();
    const store = await resolveStore(req, saas);
    req.saas = saas;
    if (!store) {
      const ok = STORELESS_OK.some((p) => req.path.startsWith(p));
      if (ok) return next();
      return res.status(400).json({ message: "Prothome ekta store khulun (/setup.html)" });
    }
    if (await blockedBySuspension(req, store)) {
      return res.status(403).json({
        message: "পেমেন্ট বাকির কারণে দোকানটি বন্ধ আছে — পেমেন্ট করলে আবার চালু হবে",
        code: "STORE_SUSPENDED",
      });
    }
    req.store = store;
    tenantStorage.run({ storeId: store._id }, () => next());
  } catch (err) {
    next(err);
  }
};
