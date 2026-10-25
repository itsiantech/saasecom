// Single source of truth for report definitions. The same wording lives in
// docs/reports.md; change both together.
const DEFAULT_TIMEZONE = "Asia/Dhaka";
const VALID_ORDER_STATUSES = Object.freeze(["processing", "completed"]);
const PRESETS = Object.freeze(["yearly", "last_month", "this_month", "last_7_days"]);
const CUSTOMER_RANGES = Object.freeze(["monthly", "half_yearly", "yearly"]);
const MAX_CUSTOM_RANGE_DAYS = 366;
const MAX_REBUILD_DAYS = 31;
const REPORT_CACHE_TTL_MS = 45 * 1000;
const REPORT_MAX_TIME_MS = 15 * 1000;
const REPORT_REBUILD_MAX_TIME_MS = 60 * 1000;
const REPORT_EXPORT_MAX_ROWS = 5000;

function validTimezone(value) {
  const zone = String(value || "").trim();
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function resolveTimezone(value = process.env.REPORT_TIMEZONE) {
  if (validTimezone(value)) return String(value).trim();
  if (value) console.warn("REPORT_TIMEZONE invalid — falling back to", DEFAULT_TIMEZONE);
  return DEFAULT_TIMEZONE;
}

const REPORT_TIMEZONE = resolveTimezone();

module.exports = {
  DEFAULT_TIMEZONE,
  REPORT_TIMEZONE,
  VALID_ORDER_STATUSES,
  PRESETS,
  CUSTOMER_RANGES,
  MAX_CUSTOM_RANGE_DAYS,
  MAX_REBUILD_DAYS,
  REPORT_CACHE_TTL_MS,
  REPORT_MAX_TIME_MS,
  REPORT_REBUILD_MAX_TIME_MS,
  REPORT_EXPORT_MAX_ROWS,
  resolveTimezone,
  validTimezone,
};
