const { esc } = require("./emailTemplates");
const { invoiceDuePaisa, invoicePaymentStatus } = require("./supplierDomain");

function money(paisa) {
  return "৳ " + (Math.max(0, Number(paisa) || 0) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dt(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusLabel(status) {
  return { paid: "Paid", due: "Due", hold: "Hold", void: "Void", none: "—" }[status] || status;
}

function buildSupplierInvoiceHtml({ invoice, supplier, order, storeName, payments }) {
  const due = invoiceDuePaisa(invoice);
  const status = invoicePaymentStatus(invoice);
  const paidRows = (payments || []).filter((p) => p.state === "active");
  const items = (invoice.lines || [])
    .map(
      (line) => `<tr>
        <td>${esc(line.name)}<small>${esc(line.productCode || "")}</small></td>
        <td class="c">${Number(line.quantity) || 0}</td>
        <td class="r">${money(line.unitCostPaisa)}</td>
        <td class="r">${money(line.lineTotalPaisa)}</td>
      </tr>`
    )
    .join("");

  const paymentRows = paidRows.length
    ? `<table class="payments">
        <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="r">Amount</th></tr></thead>
        <tbody>${paidRows
          .map(
            (p) => `<tr>
              <td>${dt(p.paidAt)}</td>
              <td>${esc(p.method || "")}</td>
              <td>${esc(p.reference || "—")}</td>
              <td class="r">${money(p.amountPaisa)}</td>
            </tr>`
          )
          .join("")}</tbody>
      </table>`
    : `<p class="muted">No payment recorded yet.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(invoice.invoiceNo)} — ${esc(storeName || "Store")}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f1ea; color: #241f18; font-family: Inter, Arial, Helvetica, sans-serif; }
  .page { max-width: 880px; margin: 24px auto; background: #fff; border: 1px solid #e8e2d5; border-radius: 14px; padding: 34px; position: relative; overflow: hidden; }
  .top { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #17140f; padding-bottom: 20px; }
  .brand h1 { margin: 0; font-size: 24px; letter-spacing: .04em; }
  .brand p { margin: 6px 0 0; color: #6f685c; font-size: 12px; }
  .doc { text-align: right; }
  .doc .type { font-size: 11px; letter-spacing: .18em; color: #8a6d2f; font-weight: 700; }
  .doc h2 { margin: 5px 0; font-size: 22px; }
  .doc .date { color: #6f685c; font-size: 12px; }
  .badge { display: inline-block; margin-top: 7px; border: 1px solid #d8ccb0; background: #f7efdc; color: #755b25; border-radius: 999px; padding: 4px 9px; font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
  .badge.void { border-color: #c98d86; background: #fae9e7; color: #a83f35; }
  .parties { display: grid; grid-template-columns: 1.2fr 1fr; gap: 24px; margin: 24px 0; }
  .parties h4 { margin: 0 0 7px; font-size: 10px; letter-spacing: .14em; color: #8a8375; text-transform: uppercase; }
  .parties strong { display: block; font-size: 15px; }
  .parties span { display: block; margin-top: 4px; color: #5f584d; font-size: 12.5px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; }
  .items th { background: #17140f; color: #f4eee2; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; text-align: left; padding: 10px; }
  .items td { border-bottom: 1px solid #eee7da; padding: 11px 10px; font-size: 13px; vertical-align: top; }
  .items small { display: block; margin-top: 3px; color: #8a8375; font-size: 10.5px; letter-spacing: .04em; }
  .c { text-align: center; }
  .r { text-align: right; white-space: nowrap; }
  .bottom { display: grid; grid-template-columns: 1fr 300px; gap: 30px; margin-top: 22px; }
  .totals > div { display: flex; justify-content: space-between; gap: 16px; padding: 7px 0; border-bottom: 1px solid #eee7da; font-size: 13px; }
  .totals span { color: #6f685c; }
  .totals .grand { border-bottom: 0; padding-top: 12px; font-size: 17px; font-weight: 700; }
  .totals .due b { color: #a83f35; }
  .payments { margin-top: 8px; }
  .payments th { border-bottom: 1px solid #ddd4c3; color: #6f685c; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; text-align: left; padding: 8px; }
  .payments td { border-bottom: 1px solid #eee7da; padding: 8px; font-size: 12px; }
  .muted { color: #8a8375; font-size: 12px; }
  .notes { margin-top: 20px; padding: 12px 14px; border-left: 3px solid #c9a961; background: #fbf7ee; font-size: 12px; line-height: 1.55; color: #5f584d; }
  .foot { display: flex; justify-content: space-between; margin-top: 34px; color: #8a8375; font-size: 11px; }
  .sig { min-width: 180px; border-top: 1px solid #b8ae9c; padding-top: 6px; text-align: center; }
  .void-mark { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
  .void-mark span { transform: rotate(-18deg); font-size: 84px; font-weight: 800; color: rgba(168,63,53,.10); letter-spacing: .12em; border: 8px solid rgba(168,63,53,.10); padding: 6px 24px; border-radius: 12px; }
  .toolbar { position: fixed; right: 20px; top: 20px; display: flex; gap: 8px; }
  .toolbar button { border: 0; border-radius: 8px; padding: 10px 15px; background: #17140f; color: #fff; font-weight: 600; cursor: pointer; }
  @media print {
    body { background: #fff; }
    .page { margin: 0; max-width: none; border: 0; border-radius: 0; padding: 18mm; }
    .toolbar { display: none; }
  }
  @media (max-width: 640px) {
    .page { margin: 0; padding: 20px; border: 0; border-radius: 0; }
    .top { flex-direction: column; }
    .doc { text-align: left; }
    .parties, .bottom { grid-template-columns: 1fr; }
    .toolbar { position: static; padding: 12px; justify-content: flex-end; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">Print / Save PDF</button></div>
  <main class="page">
    ${status === "void" ? '<div class="void-mark"><span>VOID</span></div>' : ""}
    <div class="top">
      <div class="brand">
        <h1>${esc(storeName || "Store")}</h1>
        <p>Supplier purchase invoice</p>
      </div>
      <div class="doc">
        <div class="type">PURCHASE INVOICE</div>
        <h2>${esc(invoice.invoiceNo)}</h2>
        <div class="date">Issued ${dt(invoice.issueDate)}</div>
        <span class="badge ${status === "void" ? "void" : ""}">${esc(statusLabel(status))}</span>
      </div>
    </div>

    <div class="parties">
      <div>
        <h4>Supplier</h4>
        <strong>${esc(supplier && supplier.name ? supplier.name : "—")}</strong>
        ${supplier && supplier.companyName ? `<span>${esc(supplier.companyName)}</span>` : ""}
        ${supplier && supplier.address ? `<span>${esc(supplier.address)}</span>` : ""}
        ${supplier && supplier.phone ? `<span>${esc(supplier.phone)}</span>` : ""}
        ${supplier && supplier.email ? `<span>${esc(supplier.email)}</span>` : ""}
      </div>
      <div>
        <h4>Order details</h4>
        <span><b>Order:</b> ${esc(order && order.orderNo ? order.orderNo : "—")}</span>
        <span><b>Order date:</b> ${dt(order && order.orderDate)}</span>
        <span><b>Lines:</b> ${(invoice.lines || []).length}</span>
        <span><b>Total qty:</b> ${(invoice.lines || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0)}</span>
      </div>
    </div>

    <table class="items">
      <thead><tr><th>Item</th><th class="c">Qty</th><th class="r">Unit cost</th><th class="r">Total</th></tr></thead>
      <tbody>${items}</tbody>
    </table>

    <div class="bottom">
      <div>
        <h4 class="muted" style="margin:0 0 4px;">PAYMENT HISTORY</h4>
        ${paymentRows}
      </div>
      <div class="totals">
        <div><span>Total</span><b>${money(invoice.totalAmountPaisa)}</b></div>
        <div><span>Paid</span><b>${money(invoice.paidAmountPaisa)}</b></div>
        <div class="due"><span>Due</span><b>${money(due)}</b></div>
        ${invoice.holdFlag ? `<div><span>Hold</span><b>${esc(invoice.holdReason || "Yes")}</b></div>` : ""}
      </div>
    </div>

    ${
      order && order.note
        ? `<div class="notes"><b>Order note:</b> ${esc(order.note)}</div>`
        : ""
    }

    <div class="foot">
      <span>Generated ${dt(new Date())} · ${esc(invoice.invoiceNo)}</span>
      <div class="sig">Authorized signature</div>
    </div>
  </main>
</body>
</html>`;
}

module.exports = { buildSupplierInvoiceHtml, money };
