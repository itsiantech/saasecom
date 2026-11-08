const { hostKind } = require("../lib/hostKind");

// Superadmin UI — the only HTML the panel host (api.*) may serve.
const ADMIN_PAGES = new Set(["/admin-login.html", "/admin.html"]);
const ASSET_PREFIXES = ["/css/", "/js/", "/uploads/", "/img/", "/fonts/"];
const ASSET_FILES = new Set(["/favicon.ico", "/favicon.svg", "/robots.txt", "/manifest.json"]);

function isAsset(path) {
  return ASSET_FILES.has(path) || ASSET_PREFIXES.some((prefix) => path.startsWith(prefix));
}

// Page-level host separation only. Authorization stays in the API (roles +
// tenant scope) — a wrong page on the wrong host must still be harmless.
module.exports = async function hostGate(req, res, next) {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/api/")) return next();
  if (isAsset(req.path)) return next();
  try {
    const kind = await hostKind(req);
    // shop hosts are gated in server.js (platform pages are refused there)
    if (kind !== "panel") return next();

    if (req.path === "/" || req.path === "/index.html") return res.redirect(302, "/admin-login.html");
    if (ADMIN_PAGES.has(req.path)) return next();
    return res.status(404).type("text/plain").send("এই ঠিকানায় শুধু প্ল্যাটফর্ম অ্যাডমিন থাকে।");
  } catch (err) {
    next(err);
  }
};
