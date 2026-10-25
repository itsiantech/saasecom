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

// Admin UI te secret er last 4 char chara kichhu dekhay na.
function maskSecret(value) {
  const s = String(value || "");
  if (!s) return "";
  return "••••" + s.slice(-4);
}

function isMasked(value) {
  return typeof value === "string" && value.startsWith("••••");
}

module.exports = { encrypt, decrypt, maskSecret, isMasked };
