const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { tenantTokenOf, csrfOk } = require("../lib/tenantAdmin");
const { resolveHostStore } = require("../lib/hostStore");

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  // panel scripts always send the header, even with an empty localStorage —
  // "Bearer null" must fall through to the cookie session, not 401 on its own
  if (token && token !== "null" && token !== "undefined") {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
      req.user = payload;
      req.sessionSource = "bearer";
      return next();
    } catch (err) {
      return res.status(401).json({ message: "Session expire hoyeche, abar login korun" });
    }
  }

  // white-label tenant session: host-only cookie minted by /api/auth/tenant-login.
  // Only tokens carrying `tnt` are accepted here — platform/customer logins
  // keep using the bearer header exactly as before.
  const tenant = tenantTokenOf(req);
  if (!tenant) return res.status(401).json({ message: "Login kora lagbe" });

  // routes that skip tenant resolution still need the host to prove the
  // cookie's store is live (a removed domain must not keep API access)
  const scope = req.store || req.publicStore || (await resolveHostStore(req).catch(() => null));
  if (!scope || String(scope._id) !== String(tenant.tnt)) {
    return res.status(401).json({ message: "Login kora lagbe" });
  }
  if (!csrfOk(req)) {
    return res.status(403).json({ code: "csrf_failed", message: "নিরাপত্তা টোকেন মেলেনি — পেজ রিফ্রেশ করে আবার চেষ্টা করুন" });
  }
  req.user = tenant;
  req.sessionSource = "cookie";
  next();
}

// cart-routes e: token thakle user dhoro, na thakle guest hisebe choluk
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    } catch {
      /* invalid token → guest cart hisebe cholbe */
    }
  }
  next();
}

async function requireAdmin(req, res, next) {
  const user = await User.findById(req.user.id).select("role");
  if (!user) return res.status(403).json({ message: "Admin access lagbe" });
  // platform owner shob dokan dekhte pare; baki ke shudhu nijer dokan
  if (user.role === "superadmin") return next();
  if (req.store && req.store.owner && String(req.store.owner.toString()) === String(req.user.id)) {
    return next();
  }
  return res.status(403).json({ message: "Admin access lagbe" });
}

// sudhu platform er malik (super admin)
async function requireSuperAdmin(req, res, next) {
  const user = await User.findById(req.user.id).select("role");
  if (!user || user.role !== "superadmin") {
    return res.status(403).json({ message: "Super admin access lagbe" });
  }
  next();
}

module.exports = { auth, optionalAuth, requireAdmin, requireSuperAdmin };
