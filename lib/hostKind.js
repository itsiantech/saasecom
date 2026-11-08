const { platformDomain, requestHost, PLATFORM_HOSTS, SUB_RE } = require("./hostStore");

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
// api = backend/panel address, admin = optional alias for the same job
const PANEL_LABELS = new Set(["api", "admin"]);

// host → who lives there: local (dev/IP), platform (root+www), panel (api),
// store (shop subdomains and verified custom domains)
function classifyHost(host, main) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  if (!h || PLATFORM_HOSTS.has(h) || IPV4.test(h)) return "local";
  if (!main) return "local";
  if (h === main || h === "www." + main) return "platform";
  if (h.endsWith("." + main)) {
    const label = h.slice(0, -(main.length + 1));
    if (!SUB_RE.test(label)) return "unknown";
    return PANEL_LABELS.has(label) ? "panel" : "store";
  }
  return "store"; // custom domain
}

// platformDomain() hits Settings; page requests include every asset, so cache it
let cached = { value: null, at: 0 };
async function currentPlatformDomain() {
  if (cached.value !== null && Date.now() - cached.at < 60_000) return cached.value;
  const value = await platformDomain();
  cached = { value, at: Date.now() };
  return value;
}

async function hostKind(req) {
  return classifyHost(requestHost(req), await currentPlatformDomain());
}

module.exports = { classifyHost, hostKind, PANEL_LABELS };
