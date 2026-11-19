/* ==========================================================================
   Handlebars templates for platform billing mail. One body layout, one
   subject map; the cron passes plain data and gets back {subject, html}.
   ========================================================================== */
const Handlebars = require("handlebars");

const MONTHS_BN = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];

function money(value) {
  const n = Number(value) || 0;
  return "৳" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// Billing dates are Dhaka local dates, so format them in that zone.
function formatDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(d);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || "";
  const month = Number(get("month")) - 1;
  return get("day") + " " + (MONTHS_BN[month] || get("month")) + " " + get("year");
}

const bodyTemplate = Handlebars.compile(`
<h2 style="margin:0 0 14px;font-size:20px;line-height:1.4;color:#111827;">{{heading}}</h2>
{{#each paragraphs}}<p style="margin:0 0 12px;font-size:14px;line-height:1.7;color:#374151;">{{this}}</p>{{/each}}
{{#if rows}}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;overflow:hidden;">
  {{#each rows}}
  <tr>
    <td style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">{{label}}</td>
    <td align="right" style="padding:10px 14px;font-size:13px;font-weight:600;color:#111827;border-bottom:1px solid #f3f4f6;">{{value}}</td>
  </tr>
  {{/each}}
</table>
{{/if}}
{{#if note}}
<div style="margin:16px 0 0;padding:12px 14px;border-left:4px solid #c9a961;background:#fbf7ec;font-size:13px;line-height:1.7;color:#7c5a12;">{{note}}</div>
{{/if}}
{{#if ctaUrl}}
<p style="margin:22px 0 0;"><a href="{{ctaUrl}}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:8px;">{{ctaLabel}}</a></p>
{{/if}}
`);

const layoutTemplate = Handlebars.compile(`
<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{subject}}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:#1f2937;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{{preheader}}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:#111827;padding:20px 28px;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.5px;">{{brand}}</td>
        </tr>
        <tr>
          <td style="padding:28px;">{{{body}}}</td>
        </tr>
        <tr>
          <td style="padding:18px 28px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.6;">
            এই ইমেইলটি {{brand}} প্ল্যাটফর্ম থেকে স্বয়ংক্রিয়ভাবে পাঠানো হয়েছে।<br>
            © {{year}} {{brand}} — সর্বস্বত্ব সংরক্ষিত।
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`);

const SUBJECTS = {
  trial_warning_3d: "{{planName}} ট্রায়াল {{daysLeft}} দিন পরে শেষ হচ্ছে — {{brand}}",
  trial_warning_1d: "আর {{daysLeft}} দিন — {{planName}} ট্রায়াল শেষ হচ্ছে",
  invoice: "{{brand}} ইনভয়েস {{invoiceNo}} — {{storeName}}",
  overdue: "পেমেন্ট বকেয়া: {{storeName}} — {{amount}}",
  suspend: "{{storeName}} সাসপেন্ড করা হয়েছে",
  broadcast: "{{subject}}",
};

const KINDS = Object.keys(SUBJECTS);

function renderEmail(kind, data) {
  const subjectSource = SUBJECTS[kind];
  if (!subjectSource) throw new Error("অজানা ইমেইল টেমপ্লেট: " + kind);

  const brand = data.brand || "LUXE";
  const ctx = { brand, year: new Date().getFullYear(), ...data };
  const subject = Handlebars.compile(subjectSource)(ctx);
  const body = bodyTemplate(ctx);
  const html = layoutTemplate({
    subject,
    body,
    brand,
    year: ctx.year,
    preheader: data.preheader || subject,
  });
  return { subject, html };
}

module.exports = { renderEmail, money, formatDate, KINDS, SUBJECTS };
