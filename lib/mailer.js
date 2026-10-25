/* ==========================================================================
   SMTP mailer — store-wise EmailSetting theke transport banay.
   Secret password decrypt kore use kore, kothao plaintext store kore na.
   ========================================================================== */
const nodemailer = require("nodemailer");
const EmailSetting = require("../models/EmailSetting");
const EmailTemplate = require("../models/EmailTemplate");
const { decrypt } = require("./secretBox");
const { DEFAULT_TEMPLATES, renderTemplate, layout } = require("./emailTemplates");

function smtpPasswordOf(setting) {
  return decrypt((setting && setting.smtpPassword) || "").password || "";
}

function buildTransport(setting) {
  const auth = setting.smtpUser
    ? { user: setting.smtpUser, pass: smtpPasswordOf(setting) }
    : undefined;
  return nodemailer.createTransport({
    host: setting.smtpHost,
    port: Number(setting.smtpPort) || 587,
    secure: !!setting.smtpSecure,
    auth,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
}

async function getSetting(storeId) {
  return EmailSetting.findOne({ store: storeId }).lean();
}

// Ekta mail pathay. setting.enabled na thakle skip kore.
async function sendMail(storeId, { to, subject, html, replyTo }) {
  const setting = await getSetting(storeId);
  if (!setting || !setting.enabled) return { skipped: true, reason: "Email disabled" };
  if (!setting.smtpHost || !setting.fromEmail) {
    return { skipped: true, reason: "SMTP host / from email set kora nei" };
  }
  if (!to) return { skipped: true, reason: "Recipient nei" };

  const transport = buildTransport(setting);
  const info = await transport.sendMail({
    from: setting.fromName
      ? `"${setting.fromName}" <${setting.fromEmail}>`
      : setting.fromEmail,
    to,
    subject,
    html,
    replyTo: replyTo || setting.replyTo || undefined,
  });
  return { ok: true, messageId: info.messageId, accepted: info.accepted };
}

// Template key theke subject/body niye mail pathay.
async function sendTemplate(storeId, key, ctx, to) {
  const setting = await getSetting(storeId);
  if (!setting || !setting.enabled) return { skipped: true, reason: "Email disabled" };

  const tpl = await EmailTemplate.findOne({ store: storeId, key }).lean();
  if (tpl && tpl.enabled === false) return { skipped: true, reason: "Template disabled" };

  const def = DEFAULT_TEMPLATES[key] || { subject: "", body: "" };
  const subject = renderTemplate((tpl && tpl.subject) || def.subject, ctx);
  const body = renderTemplate((tpl && tpl.body) || def.body, ctx);
  const storeName = ctx.store_name || "Store";
  return sendMail(storeId, { to, subject, html: layout(setting, storeName, body) });
}

module.exports = { sendMail, sendTemplate, buildTransport, smtpPasswordOf };
