/* ==========================================================================
   Platform mailer — SaaS billing/reminder mail goes out from the platform's
   own Brevo SMTP, NOT from a tenant's EmailSetting. Tenant order mail keeps
   using lib/mailer.js; this file never reads a store's SMTP secrets.
   ========================================================================== */
const nodemailer = require("nodemailer");

const DEFAULTS = {
  host: "smtp-relay.brevo.com",
  port: 587,
};

let transport = null;

function smtpConfig() {
  const port = Number(process.env.SMTP_PORT) || DEFAULTS.port;
  return {
    host: process.env.SMTP_HOST || DEFAULTS.host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  };
}

function mailFrom() {
  return process.env.MAIL_FROM || process.env.SMTP_USER || "";
}

function isConfigured() {
  const cfg = smtpConfig();
  return Boolean(cfg.host && cfg.user && cfg.pass && mailFrom());
}

function getTransport() {
  if (transport) return transport;
  const cfg = smtpConfig();
  transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
  return transport;
}

// env change hole (tests) notun transport banate hoy
function resetTransport() {
  transport = null;
}

async function sendPlatformMail({ to, subject, html, text, replyTo }) {
  if (!to) return { skipped: true, reason: "Recipient nei" };
  if (!isConfigured()) return { skipped: true, reason: "SMTP_HOST/SMTP_USER/SMTP_PASS/MAIL_FROM set kora nei" };

  const info = await getTransport().sendMail({
    from: mailFrom(),
    to,
    subject,
    html,
    text: text || undefined,
    replyTo: replyTo || undefined,
  });
  return { ok: true, messageId: info.messageId, accepted: info.accepted };
}

module.exports = { sendPlatformMail, isConfigured, mailFrom, smtpConfig, resetTransport };
