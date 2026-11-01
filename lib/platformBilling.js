/* ==========================================================================
   Platform billing — settings for manual payment methods (bKash / Nagad /
   bank / Bangla QR), payment submission rules, invoice numbers and links.
   ========================================================================== */
const crypto = require("crypto");
const Settings = require("../models/Settings");
const PlatformCounter = require("../models/PlatformCounter");
const { maskSecret, isMasked } = require("./secretBox");

const BILLING_KEY = "platformBilling";
const MANUAL_METHODS = ["bkash", "nagad", "bank", "qr"];
const METHOD_LABELS = { bkash: "বিকাশ", nagad: "নগদ", bank: "ব্যাংক ট্রান্সফার", qr: "বাংলা QR" };

const TRX_RE = /^[A-Za-z0-9-]{6,40}$/;
const PHONE_RE = /^01[3-9]\d{8}$/;

const DEFAULT_SETTINGS = {
  manualEnabled: true,
  bkash: { enabled: false, number: "", accountName: "", instructions: "" },
  nagad: { enabled: false, number: "", accountName: "", instructions: "" },
  bank: {
    enabled: false,
    bankName: "",
    accountName: "",
    accountNumber: "",
    branch: "",
    routingNumber: "",
    instructions: "",
  },
  qr: { enabled: false, accountName: "", imageUrl: "", instructions: "" },
  api: { enabled: false, provider: "", publicKey: "", secretKey: "", sandbox: true, note: "" },
};

function str(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeImageUrl(value) {
  const s = str(value, 300);
  return /^(\/uploads\/[a-z0-9/._-]+|https:\/\/[^\s"'<>]+)$/i.test(s) ? s : "";
}

function normalizeSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const method = (name) => (r[name] && typeof r[name] === "object" ? r[name] : {});
  const k = method("bkash");
  const n = method("nagad");
  const b = method("bank");
  const q = method("qr");
  const a = method("api");

  return {
    manualEnabled: r.manualEnabled !== false,
    bkash: {
      enabled: Boolean(k.enabled),
      number: str(k.number, 30),
      accountName: str(k.accountName, 80),
      instructions: str(k.instructions, 600),
    },
    nagad: {
      enabled: Boolean(n.enabled),
      number: str(n.number, 30),
      accountName: str(n.accountName, 80),
      instructions: str(n.instructions, 600),
    },
    bank: {
      enabled: Boolean(b.enabled),
      bankName: str(b.bankName, 80),
      accountName: str(b.accountName, 80),
      accountNumber: str(b.accountNumber, 40),
      branch: str(b.branch, 80),
      routingNumber: str(b.routingNumber, 30),
      instructions: str(b.instructions, 600),
    },
    qr: {
      enabled: Boolean(q.enabled),
      accountName: str(q.accountName, 80),
      imageUrl: safeImageUrl(q.imageUrl),
      instructions: str(q.instructions, 600),
    },
    api: {
      enabled: Boolean(a.enabled),
      provider: str(a.provider, 40),
      publicKey: str(a.publicKey, 300),
      secretKey: str(a.secretKey, 300),
      sandbox: a.sandbox !== false,
      note: str(a.note, 300),
    },
  };
}

function parseSettings(value) {
  try {
    return normalizeSettings(JSON.parse(value || "{}"));
  } catch {
    return normalizeSettings({});
  }
}

async function loadSettings() {
  const doc = await Settings.findOne({ key: BILLING_KEY });
  return parseSettings(doc ? doc.value : "");
}

// Admin UI never sees a full key — masked values coming back in a PUT keep the stored one.
async function saveSettings(raw) {
  const doc = await Settings.findOne({ key: BILLING_KEY });
  const prev = parseSettings(doc ? doc.value : "");
  const next = normalizeSettings(raw);
  if (!next.api.publicKey || isMasked(next.api.publicKey)) next.api.publicKey = prev.api.publicKey;
  if (!next.api.secretKey || isMasked(next.api.secretKey)) next.api.secretKey = prev.api.secretKey;

  await Settings.findOneAndUpdate(
    { key: BILLING_KEY },
    { $set: { value: JSON.stringify(next) } },
    { upsert: true }
  );
  return next;
}

function maskedSettings(settings) {
  const out = JSON.parse(JSON.stringify(settings || DEFAULT_SETTINGS));
  out.api.publicKey = maskSecret(out.api.publicKey);
  out.api.secretKey = maskSecret(out.api.secretKey);
  return out;
}

// Checkout page e shudhu cholti manual method gulo — API key kokhono jay na
function publicMethods(settings) {
  const s = settings || DEFAULT_SETTINGS;
  if (!s.manualEnabled) return [];
  const rows = [];

  for (const id of ["bkash", "nagad"]) {
    const m = s[id];
    if (!m.enabled || !m.number) continue;
    rows.push({
      id,
      label: METHOD_LABELS[id],
      number: m.number,
      accountName: m.accountName,
      instructions: m.instructions,
      needsSender: true,
    });
  }

  if (s.bank.enabled && s.bank.accountNumber) {
    rows.push({
      id: "bank",
      label: METHOD_LABELS.bank,
      bankName: s.bank.bankName,
      accountName: s.bank.accountName,
      accountNumber: s.bank.accountNumber,
      branch: s.bank.branch,
      routingNumber: s.bank.routingNumber,
      instructions: s.bank.instructions,
      needsSender: false,
    });
  }

  if (s.qr.enabled && s.qr.imageUrl) {
    rows.push({
      id: "qr",
      label: METHOD_LABELS.qr,
      accountName: s.qr.accountName,
      imageUrl: s.qr.imageUrl,
      instructions: s.qr.instructions,
      needsSender: true,
    });
  }

  return rows;
}

function cleanPhone(value) {
  return String(value || "").replace(/[\s-]/g, "").slice(0, 20);
}

// returns { error, method, senderNumber, trxid }
function validateSubmission({ settings, method, senderNumber, trxid }) {
  const id = str(method, 20).toLowerCase();
  if (!MANUAL_METHODS.includes(id)) {
    return { error: "পেমেন্ট মেথড বাছুন" };
  }
  const s = settings || DEFAULT_SETTINGS;
  if (!s.manualEnabled) return { error: "ম্যানুয়াল পেমেন্ট এখন বন্ধ আছে" };
  if (!publicMethods(s).some((m) => m.id === id)) {
    return { error: "এই পেমেন্ট মেথড এখন চালু নেই — অন্য একটি বেছে নিন" };
  }

  const trx = str(trxid, 40);
  if (!TRX_RE.test(trx)) {
    return { error: "TRXID ঠিকভাবে লিখুন — ৬–৪০ অক্ষর, শুধু ইংরেজি অক্ষর/সংখ্যা" };
  }

  const phone = cleanPhone(senderNumber);
  if (id !== "bank" && !PHONE_RE.test(phone)) {
    return { error: "যে নম্বর থেকে টাকা পাঠিয়েছেন সেটি ১১ ডিজিটে লিখুন (যেমন 01712345678)" };
  }

  return { error: "", method: id, senderNumber: phone, trxid: trx };
}

function trxKey(method, trxid) {
  return String(method).toLowerCase() + ":" + String(trxid).trim().toLowerCase();
}

function addDays(date, days) {
  const n = Number(days) > 0 ? Number(days) : 30;
  return new Date(date.getTime() + n * 24 * 60 * 60 * 1000);
}

function dueDateAfter(startAt, durationDays) {
  return addDays(startAt || new Date(), durationDays);
}

let counterReady = false;
async function ensureCounterIndexes() {
  if (counterReady) return;
  counterReady = true;
  try {
    await PlatformCounter.init();
  } catch {
    /* index already exists / offline — the $inc below still needs no index */
  }
}

async function nextInvoiceNo(date) {
  const d = date || new Date();
  await ensureCounterIndexes();
  const row = await PlatformCounter.findOneAndUpdate(
    { key: "invoice:" + d.getFullYear() },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  return "INV-" + d.getFullYear() + "-" + String(row.seq).padStart(4, "0");
}

function invoiceToken(payment) {
  const id = String((payment && (payment._id || payment.id)) || "");
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET || "luxe-dev-secret")
    .update("platform-invoice:" + id)
    .digest("hex")
    .slice(0, 32);
}

function checkInvoiceToken(payment, token) {
  const want = invoiceToken(payment);
  const got = String(token || "");
  return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// API response shape — raw sender number tai jay (owner/admin dekhe), invoice e mask hoy
function paymentView(payment) {
  const p = payment && payment.toObject ? payment.toObject() : { ...(payment || {}) };
  return {
    id: String(p._id),
    invoiceNo: p.invoiceNo,
    invoiceDate: p.createdAt || null,
    createdAt: p.createdAt || null,
    kind: p.kind || "new",
    storeId: p.store ? String(p.store._id || p.store) : null,
    storeName: p.storeName || "",
    storeSlug: p.storeSlug || "",
    planName: p.planName || (p.plan && p.plan.name) || "",
    planSlug: p.planSlug || (p.plan && p.plan.slug) || "",
    amount: Number(p.amount) || 0,
    method: p.method,
    methodLabel: p.methodLabel || METHOD_LABELS[p.method] || p.method,
    senderNumber: p.senderNumber || "",
    trxid: p.trxid || "",
    status: p.status,
    rejectReason: p.rejectReason || "",
    nextDueDate: p.nextDueDate || null,
    decidedAt: p.decidedAt || null,
    slugAdjusted: Boolean(p.slugAdjusted),
    invoiceUrl: "/api/billing/payments/" + String(p._id) + "/invoice?token=" + invoiceToken(p),
  };
}

module.exports = {
  BILLING_KEY,
  MANUAL_METHODS,
  METHOD_LABELS,
  DEFAULT_SETTINGS,
  normalizeSettings,
  parseSettings,
  loadSettings,
  saveSettings,
  maskedSettings,
  publicMethods,
  validateSubmission,
  cleanPhone,
  trxKey,
  addDays,
  dueDateAfter,
  nextInvoiceNo,
  invoiceToken,
  checkInvoiceToken,
  paymentView,
};
