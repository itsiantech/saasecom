/* ==========================================================================
   Packing slip renderer — warehouse copy, no prices.
   Ship-to + item name/SKU + quantity only.
   ========================================================================== */
const { esc } = require("./emailTemplates");

function dt(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function itemRows(order) {
  return (order.items || [])
    .map((it, i) => {
      const name = (it.product && it.product.name) || it.name || "Product";
      const sku = (it.product && it.product.sku) || it.sku || "";
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(name)}${sku ? `<div class="sku">SKU: ${esc(sku)}</div>` : ""}</td>
        <td class="qty">${Number(it.quantity) || 0}</td>
      </tr>`;
    })
    .join("");
}

function fullAddress(order) {
  return [order.address, order.thana, order.district, order.division, order.postCode, order.country]
    .filter(Boolean)
    .join(", ");
}

function buildPackingSlipHtml({ order, setting, storeName, logo }) {
  const s = setting || {};
  const accent = /^#[0-9a-f]{3,8}$/i.test(s.accentColor || "") ? s.accentColor : "#c9a961";
  const company = s.companyName || storeName || "Store";
  const ship = order.shipping || {};
  const shipName = ship.name || order.customerName || "Guest";
  const shipPhone = ship.phone || order.customerPhone || "";
  const shipEmail = ship.email || order.customerEmail || "";
  const shipAddress = ship.address || fullAddress(order);
  const totalQty = (order.items || []).reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
  const note = order.orderNote || "";
  const orderNo = order.orderNumber || "—";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Packing slip ${esc(orderNo)} — ${esc(company)}</title>
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px 40px;
    background: #e9e5dc; color: #241f18;
    font-family: "Segoe UI", Arial, Helvetica, sans-serif;
    font-size: 12px;
  }
  .toolbar { max-width: 760px; margin: 0 auto 14px; display: flex; justify-content: flex-end; gap: 8px; }
  .toolbar button {
    border: 0; border-radius: 8px; padding: 9px 16px; cursor: pointer;
    background: #17140f; color: var(--accent); font-weight: 600;
  }
  .sheet {
    max-width: 760px; margin: 0 auto; background: #fff;
    border-radius: 6px; box-shadow: 0 12px 40px rgba(0,0,0,0.14);
    padding: 22px 24px 18px;
  }
  .head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  .brand { display: flex; gap: 10px; align-items: flex-start; }
  .brand img { max-width: 78px; max-height: 46px; object-fit: contain; }
  .brand h1 { font-size: 18px; margin: 0 0 3px; }
  .brand .contact { color: #7c7568; font-size: 10px; }
  .doc { text-align: right; }
  .doc h2 { margin: 0; font-size: 15px; letter-spacing: 0.24em; color: var(--accent); text-transform: uppercase; }
  .doc strong { display: block; font-size: 16px; margin-top: 4px; }
  .doc span { color: #7c7568; font-size: 10px; }
  .ship {
    margin-top: 16px; padding: 12px 14px; background: #faf8f2;
    border: 1px solid #eee8da; border-radius: 8px;
  }
  .ship h4 {
    margin: 0 0 5px; font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; color: #9a9282;
  }
  .ship strong { display: block; font-size: 13px; }
  .ship span { display: block; color: #6b6455; font-size: 10.5px; margin-top: 2px; }
  .ship .phone { color: #241f18; font-weight: 600; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th {
    text-align: left; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase;
    color: #9a9282; padding: 7px 8px; border-bottom: 1.5px solid #e7e1d3;
  }
  td { padding: 9px 8px; border-bottom: 1px solid #f0ece3; font-size: 11.5px; vertical-align: top; }
  .c { text-align: center; width: 34px; color: #9a9282; }
  .qty { text-align: center; font-size: 15px; font-weight: 700; width: 64px; }
  .sku { color: #9a9282; font-size: 9.5px; margin-top: 2px; }
  tfoot td { border-bottom: none; padding-top: 10px; color: #6b6455; font-size: 11px; }
  tfoot .qty { color: #241f18; font-size: 14px; }
  .note {
    margin-top: 14px; padding: 10px 12px; border: 1px dashed #cfc7b6; border-radius: 8px;
    color: #6b6455; font-size: 11px;
  }
  .note b { display: block; color: #9a9282; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 3px; }
  .foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 20px; color: #b8b0a0; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; }
  @media print {
    body { background: #fff; padding: 0; }
    .toolbar { display: none; }
    .sheet { box-shadow: none; border-radius: 0; max-width: none; padding: 0; }
    @page { size: ${s.paperSize === "a5" ? "A5" : "A4"}; margin: 10mm; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Print packaging slip</button></div>
  <div class="sheet">
    <header class="head">
      <div class="brand">
        ${s.showLogo && logo ? `<img src="${esc(logo)}" alt="${esc(company)}" />` : ""}
        <div>
          <h1>${esc(company)}</h1>
          <div class="contact">${esc([s.companyAddress, s.companyPhone, s.companyEmail].filter(Boolean).join(" · ") || storeName || "")}</div>
        </div>
      </div>
      <div class="doc">
        <h2>Packing slip</h2>
        <strong>#${esc(orderNo)}</strong>
        <span>${esc(dt(order.createdAt || new Date()))}</span>
      </div>
    </header>

    <section class="ship">
      <h4>Ship to</h4>
      <strong>${esc(shipName)}</strong>
      ${shipPhone ? `<span class="phone">${esc(shipPhone)}</span>` : ""}
      ${shipAddress ? `<span>${esc(shipAddress)}</span>` : ""}
      ${shipEmail ? `<span>${esc(shipEmail)}</span>` : ""}
    </section>

    <table>
      <thead>
        <tr><th class="c">#</th><th>Item</th><th class="qty">Qty</th></tr>
      </thead>
      <tbody>${itemRows(order)}</tbody>
      <tfoot>
        <tr><td colspan="2">${(order.items || []).length} line(s) · Total quantity</td><td class="qty">${totalQty}</td></tr>
      </tfoot>
    </table>

    ${note ? `<div class="note"><b>Order note</b>${esc(note)}</div>` : ""}

    <footer class="foot">
      <span>Order ${esc(orderNo)}</span>
      <span>Packing slip · Office copy</span>
    </footer>
  </div>
</body>
</html>`;
}

module.exports = { buildPackingSlipHtml };
