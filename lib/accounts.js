const { REPORT_TIMEZONE } = require("./reportConstants");
const { zonedDateKey, zonedMidnightUtc } = require("./supplierDomain");

const KINDS = ["office", "tech", "marketing", "salary", "investment"];

const VOID_TYPES = [
  "order_cancel",
  "supplier_order_cancel",
  "supplier_invoice_void",
  "supplier_payment_void",
  "expense_void",
];

const KIND_META = {
  office: { label: "Office operating cost", direction: "out", group: "cost" },
  tech: { label: "Tech & server cost", direction: "out", group: "cost" },
  marketing: { label: "Marketing & ads cost", direction: "out", group: "cost" },
  salary: { label: "Salary", direction: "out", group: "cost" },
  investment: { label: "Investment", direction: "in", group: "capital" },
};

const METHODS = ["cash", "bank", "bkash", "nagad", "other"];
const MAX_ROW_SCAN = 5000;
const MAX_AMOUNT_PAISA = 100000000000; // ৳ 1 billion

function accountsError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function isKind(value) {
  return KINDS.includes(String(value || ""));
}

function kindLabel(kind) {
  return (KIND_META[kind] && KIND_META[kind].label) || kind;
}

function cleanText(value, label, max) {
  const text = String(value == null ? "" : value).trim();
  if (max && text.length > max) throw accountsError(`${label} ${max} character er beshi hote parbe na`);
  return text;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPaisa(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function fromPaisa(paisa) {
  return toPaisa(paisa) / 100;
}

// Accepts "1,250.50", "৳ 1250", 1250.5 — always returns integer paisa.
function parseAmountPaisa(value) {
  const raw = String(value == null ? "" : value)
    .replace(/[৳,\s]/g, "")
    .trim();
  if (!raw) throw accountsError("Amount lagbe");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) throw accountsError("Amount valid na (max 2 decimal)");
  const paisa = Math.round(Number(raw) * 100);
  if (!Number.isFinite(paisa) || paisa < 1) throw accountsError("Amount 0 er beshi hote hobe");
  if (paisa > MAX_AMOUNT_PAISA) throw accountsError("Amount onek beshi");
  return paisa;
}

function isDayKey(value) {
  const key = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// Expense dates are plain calendar days; store them at Dhaka midnight so the
// same value always falls inside a report period boundary.
function parseEntryDate(value) {
  const key = String(value || "").trim() || zonedDateKey(new Date(), REPORT_TIMEZONE);
  if (!isDayKey(key)) throw accountsError("Date YYYY-MM-DD format e din");
  return zonedMidnightUtc(key, REPORT_TIMEZONE);
}

function parseMethod(value) {
  const method = String(value || "cash").trim().toLowerCase();
  if (!METHODS.includes(method)) throw accountsError("Payment method valid na");
  return method;
}

module.exports = {
  KINDS,
  VOID_TYPES,
  KIND_META,
  METHODS,
  MAX_ROW_SCAN,
  accountsError,
  isKind,
  kindLabel,
  cleanText,
  escapeRegex,
  toPaisa,
  fromPaisa,
  parseAmountPaisa,
  parseEntryDate,
  parseMethod,
};
