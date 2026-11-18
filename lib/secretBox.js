const crypto = require("crypto");

// Payment gateway secrets AES-256-GCM diye encrypt kora hoy.
// SETTINGS_SECRET env na thakle JWT_SECRET fallback.
const KEY = crypto
  .createHash("sha256")
  .update(process.env.SETTINGS_SECRET || process.env.JWT_SECRET || "luxe-dev-secret")
  .digest();

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj || {}), "utf8"), cipher.final()]);
  return ["v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), data.toString("hex")].join(":");
}

function decrypt(value) {
  try {
    const [version, ivHex, tagHex, dataHex] = String(value || "").split(":");
    if (version !== "v1" || !ivHex || !tagHex || !dataHex) return {};
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const data = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
    return JSON.parse(data.toString("utf8"));
  } catch {
    return {};
  }
}

// Binary variant for private documents (NID scans). Layout:
// "EMI1" | iv(12) | authTag(16) | ciphertext. The magic keeps a corrupted or
// foreign file from being decrypted as if it were ours.
const BUFFER_MAGIC = Buffer.from("EMI1");

function encryptBuffer(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([cipher.update(Buffer.from(buffer)), cipher.final()]);
  return Buffer.concat([BUFFER_MAGIC, iv, cipher.getAuthTag(), data]);
}

function decryptBuffer(buffer) {
  const raw = Buffer.from(buffer || []);
  if (raw.length < BUFFER_MAGIC.length + 28 || !raw.subarray(0, 4).equals(BUFFER_MAGIC)) {
    throw new Error("Encrypted document format bojha jayni");
  }
  const iv = raw.subarray(4, 16);
  const tag = raw.subarray(16, 32);
  const data = raw.subarray(32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

// Admin UI te secret er last 4 char chara kichhu dekhay na.
function maskSecret(value) {
  const s = String(value || "");
  if (!s) return "";
  return "••••" + s.slice(-4);
}

function isMasked(value) {
  return typeof value === "string" && value.startsWith("••••");
}

module.exports = { encrypt, decrypt, encryptBuffer, decryptBuffer, maskSecret, isMasked };
