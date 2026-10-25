const Store = require("../models/Store");
const Settings = require("../models/Settings");

// platform er nijer host — egulote kokhono store resolve hobe na (landing/panel/portal)
const PLATFORM_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]", "host.docker.internal"]);
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

const SUB_RE = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;
const RESERVED_SUBS = new Set([
  "www", "api", "app", "admin", "dashboard", "portal", "setup", "login", "register", "account",
  "mail", "smtp", "ftp", "static", "assets", "cdn", "img", "dev", "staging", "test", "demo",
  "shop", "store", "new", "get", "buy", "support", "help", "docs", "blog", "status", "root", "master",
]);

// Settings (super admin pore panel theke set korte parbe) → na thakle .env
async function platformDomain() {
  const doc = await Settings.findOne({ key: "platformDomain" });
  const value = (doc && doc.value) || process.env.PLATFORM_DOMAIN || "";
  return String(value).trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
}

async function platformTarget() {
  const doc = await Settings.findOne({ key: "platformIp" });
  return String((doc && doc.value) || process.env.PLATFORM_IP || "").trim();
}

// req.hostname nijei port o IPv6 bracket badhde — X-Forwarded-Host kokhono trust kori na
function requestHost(req) {
  return String(req.hostname || "").toLowerCase().replace(/\.$/, "");
}

function subLabel(host, main) {
  if (!main || !host.endsWith("." + main)) return null;
  const label = host.slice(0, -(main.length + 1));
  return SUB_RE.test(label) ? label : null;
}

// Host theke store — shudhu DB match holei, na hole null (thika host diye onno store dhora jabe na)
async function resolveHostStore(req) {
  const host = requestHost(req);
  if (!host || PLATFORM_HOSTS.has(host) || IPV4.test(host)) return null;

  const main = await platformDomain();
  if (main && (host === main || host === "www." + main)) return null;

  const label = subLabel(host, main);
  if (label) return Store.findOne({ subdomain: label });
  return Store.findOne({ customDomain: host, customDomainStatus: "verified" });
}

// user ja likhbe seta theke clean hostname — IDN (বাংলাদোকান.com) punycode hoye jay
function normalizeDomain(input) {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return null;
  let host;
  try {
    host = new URL(raw.includes("://") ? raw : "http://" + raw).hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, "");
  if (!host.includes(".") || /\s/.test(host)) return null;
  if (IPV4.test(host)) return null;
  if (host.length > 253) return null;
  return host;
}

module.exports = {
  PLATFORM_HOSTS,
  RESERVED_SUBS,
  SUB_RE,
  normalizeDomain,
  platformDomain,
  platformTarget,
  requestHost,
  resolveHostStore,
  subLabel,
};
