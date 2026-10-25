const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^01[3-9]\d{8}$/;

const ADDRESS_LIMITS = {
  address: 240,
  thana: 80,
  district: 80,
  division: 80,
  postCode: 20,
  country: 80,
};

function cleanText(value, max) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizePhone(value) {
  let phone = String(value == null ? "" : value).replace(/[^\d+]/g, "");
  if (phone.startsWith("+880")) phone = "0" + phone.slice(4);
  return phone;
}

function normalizeEmail(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

// Admin edit payload — current User theke fallback niye merged patch banay.
function normalizeCustomerUpdate(body, current) {
  const input = body || {};
  const existing = current || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const patch = {};

  const name = has("name") ? cleanText(input.name, 120) : cleanText(existing.name, 120);
  if (!name) throw new Error("Customer name lagbe");
  if (has("name")) patch.name = name;

  const email = has("email") ? normalizeEmail(input.email) : normalizeEmail(existing.email);
  if (email && !EMAIL_RE.test(email)) throw new Error("Email valid na");
  if (has("email")) patch.email = email || null;

  const rawPhone = has("phone")
    ? String(input.phone == null ? "" : input.phone).trim()
    : String(existing.phone || "").trim();
  const phone = normalizePhone(rawPhone);
  if (phone && !PHONE_RE.test(phone)) {
    throw new Error("Phone number valid na (01XXXXXXXXX)");
  }
  if (has("phone")) patch.phone = phone || null;

  if (!email && !phone) throw new Error("Email ba phone er ekta lagbe");

  const shipping = {};
  for (const [field, max] of Object.entries(ADDRESS_LIMITS)) {
    if (has(field)) shipping[field] = cleanText(input[field], max);
  }
  if (Object.keys(shipping).length) patch.shipping = shipping;

  if (!Object.keys(patch).length) throw new Error("Update korar kichu nei");
  return patch;
}

function normalizeNote(value) {
  const text = String(value == null ? "" : value).replace(/\r\n/g, "\n").trim();
  if (!text) throw new Error("Note likhun");
  if (text.length > 1000) throw new Error("Note 1000 character er beshi hote parbe na");
  return text;
}

function normalizePassword(value) {
  const password = String(value == null ? "" : value);
  if (password.length < 6) throw new Error("Password kompokkhe 6 character hote hobe");
  if (Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Password 72 byte er beshi hote parbe na");
  }
  return password;
}

function pickNonEmpty(primary, fallback) {
  return primary != null && String(primary).trim() ? primary : fallback;
}

// User profile + latest order snapshot merge — list/detail e same rule.
function resolveContact(user, latestOrder) {
  const account = user || {};
  const saved = account.shipping || {};
  const order = latestOrder || {};
  return {
    name: pickNonEmpty(account.name, order.customerName) || "Customer",
    email: pickNonEmpty(account.email, order.customerEmail) || "",
    phone: pickNonEmpty(account.phone, order.customerPhone) || "",
    address: pickNonEmpty(saved.address, order.address) || "",
    thana: pickNonEmpty(saved.thana, order.thana) || "",
    district: pickNonEmpty(saved.district, order.district) || "",
    division: pickNonEmpty(saved.division, order.division) || "",
    postCode: pickNonEmpty(saved.postCode, order.postCode) || "",
    country: pickNonEmpty(saved.country, order.country) || "",
  };
}

module.exports = {
  EMAIL_RE,
  PHONE_RE,
  cleanText,
  normalizePhone,
  normalizeEmail,
  normalizeCustomerUpdate,
  normalizeNote,
  normalizePassword,
  resolveContact,
};
