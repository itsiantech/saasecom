const Store = require("../models/Store");
const { tenantStorage } = require("../lib/tenantContext");
const { resolveHostStore, normalizeDomain, platformDomain, subLabel } = require("../lib/hostStore");

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

// x-store-domain: ekta hostname (dokan.com ba amar-dokan.platform.com) header e pathano jay,
// main Next.js SSR host theke API call korar jonno (browser Host seta na).
async function fromDomainHeader(req) {
  const host = normalizeDomain(req.headers["x-store-domain"]);
  if (!host) return null;
  const main = await platformDomain();
  const label = main ? subLabel(host, main) : null;
  if (label) return Store.findOne({ subdomain: label });
  return Store.findOne({ customDomain: host, customDomainStatus: "verified" });
}

// /public/* store identity SHUDHU request theke ase — JWT user er first store theke na.
// Na-hole ekjon login kora customer onno store er token/header diye catalog dhorte parto.
async function resolvePublicStore(req) {
  const hostStore = await resolveHostStore(req);
  if (hostStore) return hostStore;

  const headerDomain = await fromDomainHeader(req);
  if (headerDomain) return headerDomain;

  const raw = String(req.headers["x-store-slug"] || req.query.store || "").trim().toLowerCase();
  if (raw && SLUG_RE.test(raw)) return Store.findOne({ slug: raw });

  return null;
}

module.exports = async function publicStore(req, res, next) {
  try {
    const store = await resolvePublicStore(req);
    if (!store) return res.status(404).json({ message: "Ei thikanay kono dokan nei" });
    if (store.status === "suspended") {
      return res.status(403).json({ message: "Ei dokan ta ekhon bondho ache" });
    }
    req.publicStore = store;
    // tenantPlugin jate filter korte pare — same AsyncLocalStorage the admin panel e use kore
    tenantStorage.run({ storeId: store._id }, () => next());
  } catch (err) {
    next(err);
  }
};

module.exports.resolvePublicStore = resolvePublicStore;
module.exports.fromDomainHeader = fromDomainHeader;
