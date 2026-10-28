const jwt = require("jsonwebtoken");
const User = require("../models/User");

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Login kora lagbe" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Session expire hoyeche, abar login korun" });
  }
}

// cart-routes e: token thakle user dhoro, na thakle guest hisebe choluk
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
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
