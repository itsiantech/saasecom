/* ==========================================================================
   SMS sender — BulkSMSBD (default) ba generic JSON API.
   API key encrypted thake; request er somoy decrypt hoy.
   ========================================================================== */
const SmsSetting = require("../models/SmsSetting");
const { decrypt } = require("./secretBox");

function apiKeyOf(setting) {
  return decrypt((setting && setting.apiKey) || "").apiKey || "";
}

function normalizePhone(value) {
  let s = String(value || "").replace(/[^\d+]/g, "");
  if (s.startsWith("+880")) s = "0" + s.slice(4);
  return s;
}

async function sendSms(storeId, to, text) {
  const setting = await SmsSetting.findOne({ store: storeId }).lean();
  if (!setting || !setting.enabled) return { skipped: true, reason: "SMS disabled" };

  const number = normalizePhone(to);
  if (!number || !text) return { skipped: true, reason: "Number / message nei" };
  if (!setting.apiKey) return { skipped: true, reason: "API key nei" };

  const apiKey = apiKeyOf(setting);

  try {
    if (setting.provider === "generic" && setting.apiUrl) {
      const res = await fetch(setting.apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          senderid: setting.senderId || "",
          number,
          message: text,
        }),
      });
      const body = await res.text().catch(() => "");
      return { ok: res.ok, status: res.status, body };
    }

    // BulkSMSBD default endpoint
    const url = new URL("https://bulksmsbd.net/api/smsapi");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("type", "text");
    url.searchParams.set("number", number);
    url.searchParams.set("senderid", setting.senderId || "");
    url.searchParams.set("message", text);

    const res = await fetch(url.toString());
    const body = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { sendSms, normalizePhone };
