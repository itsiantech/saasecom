const jwt = require("jsonwebtoken");
const { randomBytes } = require("crypto");
const Store = require("../models/Store");
const Plan = require("../models/Plan");
const Settings = require("../models/Settings");
const { tenantStorage } = require("../lib/tenantContext");
const { resolveHostStore } = require("../lib/hostStore");

// store chara kaj cholbe e api gulote (signup/setup er somoy)
const STORELESS_OK = ["/api/auth", "/api/plans", "/api/settings", "/api/admin", "/api/stores"];

async function saasEnabled() {
  if (process.env.APP_MODE === "single") return false;
  if (process.env.APP_MODE === "saas") return true;
  const doc = await Settings.findOne({ key: "saasEnabled" });
  return doc ? doc.value === "true" : true; // default: saas cholche
}

function getTokenUserId(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(header.slice(7), process.env.JWT_SECRET).id;
  } catch {
    return null;
  }
}

async function randomSlug() {
  for (let i = 0; i < 5; i++) {
    const slug = "store-" + randomBytes(3).toString("hex");
    if (!(await Store.exists({ slug }))) return slug;
  }
  return "store-" + Date.now().toString(36);
}

async function resolveStore(req, saas) {
  // single mode: sob request ek e dokane jay (standalone bikrir jonno)
  if (!saas) {
    let store = await Store.findOne().sort({ createdAt: 1 });
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

  // saas mode 1: explicitly slug deya thakle (frontend header/query diye pathay)
  const slug = req.headers["x-store-slug"] || req.query.store;
  if (slug) return Store.findOne({ slug: String(slug).toLowerCase() });

  // saas mode 2: login kora user er dokan (setup page e khola hoy, auto na)
  const userId = getTokenUserId(req);
  if (userId) return Store.findOne({ owner: userId }).sort({ createdAt: 1 });

  return null;
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
    req.store = store;
    tenantStorage.run({ storeId: store._id }, () => next());
  } catch (err) {
    next(err);
  }
};
