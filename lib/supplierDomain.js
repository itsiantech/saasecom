const PERIODS = {
  daily: { unit: "day", defaultBuckets: 14, maxBuckets: 60 },
  monthly: { unit: "month", defaultBuckets: 12, maxBuckets: 36 },
  yearly: { unit: "year", defaultBuckets: 5, maxBuckets: 10 },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function invoiceDuePaisa(invoice) {
  const total = Math.max(0, toInt(invoice && invoice.totalAmountPaisa));
  const paid = Math.max(0, toInt(invoice && invoice.paidAmountPaisa));
  return Math.max(0, total - paid);
}

// Single source of truth for invoice payment state. Never store/trust this.
function invoicePaymentStatus(invoice) {
  if (!invoice || invoice.state === "void") return "void";
  const total = Math.max(0, toInt(invoice.totalAmountPaisa));
  const paid = Math.max(0, toInt(invoice.paidAmountPaisa));
  if (paid >= total) return "paid";
  if (invoice.holdFlag === true) return "hold";
  return "due";
}

// Hold is the riskiest state, then due, then paid. No active invoice => none.
function supplierPaymentStatus(statuses) {
  const active = (statuses || []).filter((s) => s && s !== "void");
  if (!active.length) return "none";
  if (active.includes("hold")) return "hold";
  if (active.includes("due")) return "due";
  return "paid";
}

function formatSequence(kind, year, seq) {
  const prefix = kind === "invoice" ? "INV" : kind === "order" ? "PO" : "GEN";
  return `${prefix}-${toInt(year)}-${String(toInt(seq)).padStart(4, "0")}`;
}

function escapeRegex(value) {
  return String(value == null ? "" : value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validPeriod(period) {
  return Object.prototype.hasOwnProperty.call(PERIODS, period) ? period : null;
}

function zonedDateKey(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date || new Date());
  const out = {};
  for (const part of parts) if (part.type !== "literal") out[part.type] = part.value;
  return `${out.year}-${out.month}-${out.day}`;
}

function zonedMidnightUtc(dayKey, timezone) {
  const [year, month, day] = String(dayKey).split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0);
  const parts = {};
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "Asia/Dhaka",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(guess));
  for (const part of fmt) if (part.type !== "literal") parts[part.type] = Number(part.value);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return new Date(guess - (asUtc - guess));
}

function shiftBucketKey(key, period, delta) {
  if (period === "yearly") {
    const year = Number(String(key).slice(0, 4)) + delta;
    return String(year);
  }
  if (period === "monthly") {
    const year = Number(String(key).slice(0, 4));
    const month = Number(String(key).slice(5, 7)) - 1 + delta;
    const d = new Date(Date.UTC(year, month, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  const [y, m, d] = String(key).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate()
  ).padStart(2, "0")}`;
}

function currentBucketKey(period, now, timezone) {
  const day = zonedDateKey(now, timezone);
  if (period === "yearly") return day.slice(0, 4);
  if (period === "monthly") return day.slice(0, 7);
  return day;
}

function bucketKeys(period, count, now, timezone) {
  const cfg = PERIODS[period] || PERIODS.daily;
  const safeCount = Math.min(cfg.maxBuckets, Math.max(1, toInt(count, cfg.defaultBuckets)));
  const current = currentBucketKey(period, now || new Date(), timezone);
  const keys = [];
  for (let i = safeCount - 1; i >= 0; i--) keys.push(shiftBucketKey(current, period, -i));
  return keys;
}

function bucketKeyToDate(key, period) {
  if (period === "yearly") return new Date(`${key}-01-01T00:00:00.000Z`);
  if (period === "monthly") return new Date(`${key}-01T00:00:00.000Z`);
  return new Date(`${key}T00:00:00.000Z`);
}

function bucketLabel(key, period) {
  if (period === "yearly") return key;
  if (period === "monthly") {
    const month = Number(key.slice(5, 7));
    return `${MONTHS[month - 1] || ""} ${key.slice(0, 4)}`.trim();
  }
  const d = bucketKeyToDate(key, period);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function periodFirstDayKey(period, key) {
  if (period === "yearly") return `${key}-01-01`;
  if (period === "monthly") return `${key}-01`;
  return key;
}

function reportWindow(period, count, now, timezone) {
  const cfg = PERIODS[period] || PERIODS.daily;
  const keys = bucketKeys(period, count, now, timezone);
  const start = zonedMidnightUtc(periodFirstDayKey(period, keys[0]), timezone);
  return { period, keys, start, end: now || new Date(), timezone: timezone || "Asia/Dhaka", cfg };
}

function mongoDateFormat(period) {
  if (period === "yearly") return "%Y";
  if (period === "monthly") return "%Y-%m";
  return "%Y-%m-%d";
}

module.exports = {
  PERIODS,
  invoiceDuePaisa,
  invoicePaymentStatus,
  supplierPaymentStatus,
  formatSequence,
  escapeRegex,
  validPeriod,
  zonedDateKey,
  zonedMidnightUtc,
  shiftBucketKey,
  bucketKeys,
  bucketLabel,
  bucketKeyToDate,
  reportWindow,
  mongoDateFormat,
};
