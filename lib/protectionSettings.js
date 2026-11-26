/* Website-side order protection settings — pure helpers.
 * Values live in the same key/value Settings store (scoped per store).
 * Blacklisted entries always reject; the other rules only flag unless the
 * store owner picks "reject" for that rule. */

const PROTECTION_DEFAULTS = {
  protect_rate_phone_max: "3",
  protect_rate_ip_max: "5",
  protect_rate_window_hours: "24",
  protect_rate_action: "flag", // flag | reject
  protect_duplicate_enabled: "true",
  protect_duplicate_window_minutes: "60",
  protect_duplicate_min_orders: "3",
  protect_duplicate_action: "flag", // flag | reject
  protect_otp_enabled: "false", // COD SMS OTP (needs SMS settings on)
};

const PROTECTION_KEYS = Object.keys(PROTECTION_DEFAULTS);

const BOOL_KEYS = ["protect_duplicate_enabled", "protect_otp_enabled"];

const ACTIONS = ["flag", "reject"];

function normalizeProtectionValue(key, value) {
  const text = String(value == null ? "" : value).trim();
  if (key === "protect_rate_action" || key === "protect_duplicate_action") {
    return ACTIONS.includes(text) ? text : PROTECTION_DEFAULTS[key];
  }
  const limits = {
    protect_rate_phone_max: [0, 100],
    protect_rate_ip_max: [0, 100],
    protect_rate_window_hours: [1, 168],
    protect_duplicate_window_minutes: [5, 1440],
    protect_duplicate_min_orders: [2, 50],
  };
  if (limits[key]) {
    const n = Number(text);
    const [min, max] = limits[key];
    return Number.isFinite(n) && n >= min && n <= max
      ? String(Math.round(n))
      : PROTECTION_DEFAULTS[key];
  }
  return text.slice(0, 300);
}

function intOf(map, key) {
  const n = Number(map && map[key]);
  return Number.isFinite(n) ? n : Number(PROTECTION_DEFAULTS[key]);
}

module.exports = {
  PROTECTION_DEFAULTS,
  PROTECTION_KEYS,
  BOOL_KEYS,
  normalizeProtectionValue,
  intOf,
};