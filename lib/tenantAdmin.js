/* ------------------------------------------------------------------ *
 * Tenant admin (white-label) login — the store owner signs in on their
 * own domain, so the session lives in a host-only httpOnly cookie and
 * never touches the platform login / localStorage flows.
 * ------------------------------------------------------------------ */
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const Store = require("../models/Store");
const SiteSetting = require("../models/SiteSetting");
const ShopFavicon = require("../models/ShopFavicon");
const Appearance = require("../models/Appearance");
const { resolveHostStore, requestHost } = require("./hostStore");
const { featuresForStore } = require("./features");
const { findTheme, listThemes, mergeTokens, sanitizeTokens } = require("./themeCatalog");

const SESSION_COOKIE = "tnt_session";
const CSRF_COOKIE = "tnt_csrf";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function parseCookies(req) {
  const header = String((req.headers && req.headers.cookie) || "");
  const out = {};
  if (!header) return out;
  header.split(";").forEach((part) => {
    const at = part.indexOf("=");
    if (at < 0) return;
    const key = part.slice(0, at).trim();
    if (!key) return;
    try {
      out[key] = decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      out[key] = part.slice(at + 1).trim();
    }
  });
  return out;
}

// cookie session: only tokens minted by /api/auth/tenant-login carry `tnt`
function tenantTokenOf(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    if (!payload || !payload.id || !payload.tnt) return null;
    return payload;
  } catch {
    return null;
  }
}

function csrfOk(req) {
  if (SAFE_METHODS.has(req.method)) return true;
  const header = String(req.headers["x-csrf-token"] || "");
  const cookie = parseCookies(req)[CSRF_COOKIE] || "";
  if (!header || !cookie) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(cookie);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function secureRequest(req) {
  if (req.secure) return true;
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return proto === "https";
}

function cookieBase(req, maxAge) {
  return {
    secure: secureRequest(req),
    sameSite: "lax",
    path: "/",
    maxAge,
  };
}

function issueTenantSession(req, res, user, store) {
  const token = jwt.sign(
    { id: user._id, role: user.role, tnt: String(store._id), host: requestHost(req) },
    process.env.JWT_SECRET,
    { expiresIn: "8h" }
  );
  const csrf = crypto.randomBytes(24).toString("hex");
  const base = cookieBase(req, SESSION_TTL_MS);
  res.cookie(SESSION_COOKIE, token, { ...base, httpOnly: true });
  res.cookie(CSRF_COOKIE, csrf, { ...base, httpOnly: false });
  return token;
}

function clearTenantSession(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(CSRF_COOKIE, { path: "/" });
}

// strict host match — never from headers or query
async function tenantStoreFor(req) {
  const store = await resolveHostStore(req);
  if (!store || store.deletedAt) return null;
  return store;
}

function accentTokens(published) {
  // no appearance row yet → brand the login with the storefront's default theme
  const theme = findTheme((published && published.theme) || "") || listThemes()[0] || { tokens: {} };
  const tokens = mergeTokens(theme, sanitizeTokens(theme, (published && published.tokens) || {}));
  return {
    accent: tokens.colorPrimary || tokens.colorAccent || "",
    accentDark: tokens.colorPrimaryDark || "",
    bg: tokens.colorBg || "",
    surface: tokens.colorSurface || "",
    ink: tokens.colorInk || "",
    font: tokens.fontBody || "",
  };
}

async function tenantMeta(store) {
  const [site, faviconDoc, appearance, access] = await Promise.all([
    SiteSetting.findOne({ store: store._id }).lean(),
    ShopFavicon.findOne({ store: store._id }).lean(),
    Appearance.findOne({ store: store._id }).lean(),
    featuresForStore(store),
  ]);
  const doc = site || {};
  return {
    store: { name: store.name, slug: store.slug },
    branding: {
      logo: doc.logo || "",
      logoWidth: Number(doc.logoWidth) || 120,
      logoHeight: Number(doc.logoHeight) || 40,
      title: String(doc.siteTitle || "").trim() || store.name,
      favicon: (faviconDoc && faviconDoc.icon) || doc.favicon || "",
    },
    theme: accentTokens(appearance && appearance.published),
    language: store.language === "en" ? "en" : "bn",
    status: store.status,
    suspended: store.status === "suspended",
    whiteLabelAdmin: !!access.features.whiteLabelAdmin,
  };
}

module.exports = {
  SESSION_COOKIE,
  CSRF_COOKIE,
  parseCookies,
  tenantTokenOf,
  csrfOk,
  issueTenantSession,
  clearTenantSession,
  tenantStoreFor,
  tenantMeta,
};
