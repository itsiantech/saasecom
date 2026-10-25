/* ==========================================================================
   Login OTP — generate, hash, expire, verify.
   OTP SMS provider config SmsSetting theke ashe.
   ========================================================================== */
const crypto = require("crypto");
const OtpCode = require("../models/OtpCode");
const SmsSetting = require("../models/SmsSetting");
const { sendSms, normalizePhone } = require("./sms");
const { renderTemplate } = require("./emailTemplates");

function hashCode(storeId, code) {
  return crypto
    .createHash("sha256")
    .update(String(code) + ":" + String(storeId))
    .digest("hex");
}

async function requestOtp(storeId, phone, purpose = "login") {
  const setting = await SmsSetting.findOne({ store: storeId }).lean();
  if (!setting || !setting.enabled || !setting.otpEnabled) {
    return { ok: false, message: "SMS / OTP enable kora nei" };
  }

  const number = normalizePhone(phone);
  if (!/^01[3-9]\d{8}$/.test(number)) {
    return { ok: false, message: "Phone number valid na (01XXXXXXXXX)" };
  }

  const len = Math.min(8, Math.max(4, Number(setting.otpLength) || 6));
  const minutes = Math.min(30, Math.max(1, Number(setting.otpExpiryMinutes) || 5));
  const code = String(crypto.randomInt(0, Math.pow(10, len))).padStart(len, "0");

  // Purono code muche notun ta bosiye dei
  await OtpCode.deleteMany({ store: storeId, phone: number, purpose });
  await OtpCode.create({
    store: storeId,
    phone: number,
    purpose,
    codeHash: hashCode(storeId, code),
    expiresAt: new Date(Date.now() + minutes * 60 * 1000),
  });

  const text = renderTemplate(
    setting.otpTemplate || "{{store_name}} login OTP: {{code}}. Valid for {{minutes}} minutes.",
    { code, minutes, store_name: "Store" }
  );
  const result = await sendSms(storeId, number, text);
  if (!result.ok) {
    // SMS fail korle code ta DB theke muche dei
    await OtpCode.deleteMany({ store: storeId, phone: number, purpose });
    return { ok: false, message: "OTP SMS pathate parlam na", detail: result };
  }
  return { ok: true, minutes, phone: number };
}

async function verifyOtp(storeId, phone, code, purpose = "login") {
  const number = normalizePhone(phone);
  const doc = await OtpCode.findOne({ store: storeId, phone: number, purpose });
  if (!doc) return { ok: false, message: "OTP pawa jayni, abar pathan" };
  if (doc.used) return { ok: false, message: "OTP agei use hoyeche" };
  if (doc.expiresAt < new Date()) return { ok: false, message: "OTP expire hoye geche" };
  if (doc.attempts >= 5) return { ok: false, message: "Onek bar bhul hoyeche, notun OTP nin" };

  if (doc.codeHash !== hashCode(storeId, String(code || "").trim())) {
    doc.attempts += 1;
    await doc.save();
    return { ok: false, message: "OTP vul" };
  }

  doc.used = true;
  await doc.save();
  return { ok: true };
}

module.exports = { requestOtp, verifyOtp };
