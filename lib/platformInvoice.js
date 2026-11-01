/* ==========================================================================
   Platform subscription invoice (SaaS bill) — HTML + browser print-to-PDF.
   ========================================================================== */
const { esc } = require("./emailTemplates");

const STATUS_LABEL = { pending: "যাচাইয়ের অপেক্ষায়", approved: "পরিশোধিত", rejected: "বাতিল" };
const STATUS_CLASS = { pending: "is-pending", approved: "is-ok", rejected: "is-cancel" };

function money(value) {
  return "৳ " + (Number(value) || 0).toLocaleString("en-US");
}

function dt(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function maskPhone(value) {
  const s = String(value || "").replace(/[\s-]/g, "");
  if (s.length < 5) return s || "—";
  return s.slice(0, 3) + "••••" + s.slice(-3);
}

function buildPlatformInvoiceHtml(payment, options) {
  const p = payment || {};
  const opts = options || {};
  const user = p.user && typeof p.user === "object" ? p.user : {};
  const status = p.status || "pending";
  const brand = opts.brand || "LUXE";
  const site = opts.site || "";

  return `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invoice ${esc(p.invoiceNo || "")} — ${esc(brand)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px 48px; background: #eef1f6; color: #14202e;
    font-family: "Segoe UI", "Noto Sans Bengali", Arial, sans-serif; font-size: 13px;
  }
  .toolbar { max-width: 780px; margin: 0 auto 14px; display: flex; justify-content: flex-end; gap: 8px; }
  .toolbar button {
    border: 0; border-radius: 8px; padding: 10px 18px; cursor: pointer; font-weight: 600;
    background: #0e1a29; color: #ffffff;
  }
  .sheet {
    max-width: 780px; margin: 0 auto; background: #fff; border-radius: 12px;
    box-shadow: 0 18px 48px rgba(16, 32, 52, 0.16); overflow: hidden;
  }
  .head {
    display: flex; justify-content: space-between; gap: 18px; align-items: flex-start;
    padding: 26px 30px; background: #0e1a29; color: #e6eef7;
  }
  .brand { font-size: 22px; font-weight: 700; letter-spacing: 0.06em; }
  .brand small { display: block; font-size: 11px; font-weight: 400; letter-spacing: 0.14em; text-transform: uppercase; color: #8aa0b6; margin-top: 4px; }
  .head-meta { text-align: right; }
  .head-meta .doc { font-size: 10px; letter-spacing: 0.24em; color: #6ea8ff; font-weight: 700; }
  .head-meta strong { display: block; font-size: 17px; margin-top: 4px; }
  .head-meta span.date { display: block; color: #8aa0b6; font-size: 11px; margin-top: 3px; }
  .badge {
    display: inline-block; margin-top: 8px; padding: 3px 10px; border-radius: 999px;
    font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
  }
  .badge.is-pending { background: rgba(255, 190, 90, 0.16); color: #f0b34d; }
  .badge.is-ok { background: rgba(127, 199, 154, 0.16); color: #7fc79a; }
  .badge.is-cancel { background: rgba(224, 112, 92, 0.18); color: #f09585; }
  .parties {
    display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px;
    padding: 20px 30px; background: #f7f9fc; border-bottom: 1px solid #e3e8f0;
  }
  .parties h4 { margin: 0 0 5px; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: #8496ab; }
  .parties b { display: block; font-size: 14px; }
  .parties span { display: block; color: #5a6b7e; font-size: 12px; margin-top: 2px; }
  .rows { padding: 8px 30px 4px; }
  .row {
    display: flex; justify-content: space-between; gap: 16px;
    padding: 11px 0; border-bottom: 1px solid #eef1f6; font-size: 13px;
  }
  .row span { color: #5a6b7e; }
  .row b { font-weight: 600; color: #14202e; }
  .total {
    display: flex; justify-content: space-between; align-items: center;
    padding: 18px 30px; background: #f7f9fc; border-top: 1px solid #e3e8f0;
  }
  .total span { font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: #8496ab; }
  .total b { font-size: 24px; color: #0e1a29; }
  .notes { padding: 16px 30px 26px; color: #7d8ea1; font-size: 11.5px; line-height: 1.6; }
  .notes b { color: #14202e; }
  .foot { padding: 0 30px 26px; color: #9aa8b8; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; }
  @media (max-width: 620px) {
    .parties { grid-template-columns: 1fr; }
    .head { flex-direction: column; }
    .head-meta { text-align: left; }
  }
  @media print {
    body { background: #fff; padding: 0; }
    .toolbar { display: none; }
    .sheet { box-shadow: none; border-radius: 0; max-width: none; }
    .head { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    @page { size: A4; margin: 12mm; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Print / Save PDF</button></div>
  <div class="sheet">
    <div class="head">
      <div>
        <div class="brand">${esc(brand)}<small>Subscription invoice</small></div>
      </div>
      <div class="head-meta">
        <div class="doc">INVOICE</div>
        <strong>${esc(p.invoiceNo || "—")}</strong>
        <span class="date">${dt(p.createdAt)}</span>
        <span class="badge ${STATUS_CLASS[status] || "is-pending"}">${esc(STATUS_LABEL[status] || status)}</span>
      </div>
    </div>

    <div class="parties">
      <div>
        <h4>বিল প্রাপক</h4>
        <b>${esc(user.name || "—")}</b>
        ${user.email ? `<span>${esc(user.email)}</span>` : ""}
        ${user.phone ? `<span>${esc(maskPhone(user.phone))}</span>` : ""}
      </div>
      <div>
        <h4>দোকান</h4>
        <b>${esc(p.storeName || "—")}</b>
        <span>${p.storeSlug ? "/" + esc(p.storeSlug) : "—"}</span>
      </div>
    </div>

    <div class="rows">
      <div class="row"><span>প্যাকেজ</span><b>${esc(p.planName || "—")}</b></div>
      <div class="row"><span>পেমেন্ট মেথড</span><b>${esc(p.methodLabel || p.method || "—")}</b></div>
      <div class="row"><span>প্রেরকের নম্বর</span><b>${esc(maskPhone(p.senderNumber))}</b></div>
      <div class="row"><span>TRXID</span><b>${esc(p.trxid || "—")}</b></div>
      <div class="row"><span>পরিশোধের তারিখ</span><b>${dt(p.decidedAt || (status === "approved" ? p.updatedAt : null))}</b></div>
      <div class="row"><span>পরবর্তী বিল</span><b>${dt(p.nextDueDate)}</b></div>
    </div>

    <div class="total"><span>মোট</span><b>${money(p.amount)}</b></div>

    <div class="notes">
      ${
        status === "pending"
          ? `<b>এই পেমেন্ট এখনো যাচাই হয়নি।</b> প্ল্যাটফর্ম টিম TRXID মিলিয়ে দেখার পর দোকান চালু / প্যাকেজ আপডেট হবে।`
          : status === "rejected"
          ? `<b>পেমেন্ট বাতিল হয়েছে।</b>${p.rejectReason ? " কারণ: " + esc(p.rejectReason) : ""}`
          : `<b>পেমেন্ট গৃহীত হয়েছে।</b>${p.nextDueDate ? " পরবর্তী বিল " + dt(p.nextDueDate) + " তারিখে।" : ""}`
      }
    </div>
    <div class="foot">${esc(brand)}${site ? " · " + esc(site) : ""} · ${esc(p.invoiceNo || "")}</div>
  </div>
</body>
</html>`;
}

module.exports = { buildPlatformInvoiceHtml };
