/* ==========================================================================
   Order meta helpers — order source / device type capture for the details page.
   Pure functions so routes + tests can share them.
   ========================================================================== */

const SOURCE_ALIASES = {
  google: "google",
  googleads: "google",
  adwords: "google",
  gclid: "google",
  facebook: "facebook",
  fb: "facebook",
  meta: "facebook",
  instagram: "instagram",
  ig: "instagram",
  youtube: "youtube",
  yt: "youtube",
  direct: "direct",
  none: "direct",
  other: "other",
};

const VALID_DEVICES = ["mobile", "tablet", "desktop"];

function normalizeSource(value) {
  const v = String(value || "").trim().toLowerCase();
  return SOURCE_ALIASES[v] || "";
}

function normalizeDevice(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "tab" || v === "tablet") return "tablet";
  return VALID_DEVICES.includes(v) ? v : "";
}

function parseDeviceType(ua) {
  const s = String(ua || "");
  if (/iPad|Tablet|PlayBook|Silk/i.test(s)) return "tablet";
  if (/Android/i.test(s) && !/Mobile/i.test(s)) return "tablet";
  if (/Mobi|Android|iPhone|iPod|IEMobile|BlackBerry|Opera Mini/i.test(s)) return "mobile";
  if (!s) return "";
  return "desktop";
}

// explicit source (utm_source / client hint) wins, then referrer host, then direct
function parseOrderSource({ source, referrer } = {}) {
  const explicit = normalizeSource(source);
  if (explicit) return explicit;

  const ref = String(referrer || "").toLowerCase();
  if (!ref) return "direct";
  if (ref.includes("youtube.") || ref.includes("youtu.be")) return "youtube";
  if (ref.includes("instagram.") || ref.includes("instagram")) return "instagram";
  if (ref.includes("facebook.") || ref.includes("fb.") || ref.includes("fbcdn")) return "facebook";
  if (ref.includes("google.") || ref.includes("googleadservices") || ref.includes("gclid")) return "google";
  return "other";
}

// client hint first (checkout page knows its own document.referrer), server UA as fallback
function buildOrderMeta(req, clientMeta = {}) {
  const get = req && typeof req.get === "function" ? (h) => req.get(h) || "" : () => "";
  const meta = clientMeta || {};
  return {
    orderSource: parseOrderSource({
      source: meta.source,
      referrer: get("referer") || get("referrer"),
    }),
    deviceType: normalizeDevice(meta.device) || parseDeviceType(get("user-agent")),
    orderNote: String(meta.note || "").trim().slice(0, 2000),
  };
}

module.exports = {
  normalizeSource,
  normalizeDevice,
  parseDeviceType,
  parseOrderSource,
  buildOrderMeta,
};
