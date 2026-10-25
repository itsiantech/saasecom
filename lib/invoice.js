/* ==========================================================================
   Invoice renderer — ek page e duita copy:
   1) Customer copy  2) Office / admin copy
   InvoiceSetting theke branding, color, VAT, terms, signature ashe.
   ========================================================================== */
const { esc } = require("./emailTemplates");

function money(n) {
  return "৳" + (Number(n) || 0).toLocaleString("en-US");
}

function dt(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusClass(status) {
  const s = String(status || "pending").toLowerCase();
  if (s === "cancelled") return "is-cancel";
  if (s === "delivered" || s === "paid") return "is-ok";
  if (s === "shipped" || s === "confirmed") return "is-mid";
  return "is-pending";
}

/* ---- wholesale / international invoice helpers ---- */

function isWholesaleOrder(order) {
  return (order.items || []).some((it) => it.pricingMode === "wholesale");
}

function isInternationalOrder(order) {
  const country = String(order.country || "").trim().toLowerCase();
  return !!country && country !== "bangladesh" && country !== "bd";
}

function tierRange(it) {
  const min = Number(it.tierMinQty) || 0;
  const max = Number(it.tierMaxQty) || 0;
  if (min && max) return `${min}–${max} pcs`;
  if (min) return `${min}+ pcs`;
  return "";
}

function retailUnitPrice(it) {
  const paisa = Number(it.retailUnitPricePaisa) || 0;
  return paisa > 0 ? paisa / 100 : 0;
}

function wholesaleStats(order) {
  let retail = 0;
  let sale = 0;
  for (const it of order.items || []) {
    if (it.pricingMode !== "wholesale") continue;
    const qty = Number(it.quantity) || 0;
    sale += Number(it.price) || (Number(it.unitPrice) || 0) * qty;
    retail += retailUnitPrice(it) * qty;
  }
  return { retail, sale, savings: Math.max(0, retail - sale) };
}

function itemRows(order, flags) {
  return (order.items || [])
    .map((it) => {
      const name = (it.product && it.product.name) || it.name || "Product";
      const qty = Number(it.quantity) || 0;
      const unit = Number(it.unitPrice) || 0;
      const line = Number(it.price) || unit * qty;
      const wholesale = flags.wholesale && it.pricingMode === "wholesale";
      const range = wholesale ? tierRange(it) : "";
      const retail = wholesale ? retailUnitPrice(it) : 0;
      let sub = wholesale
        ? `<div class="item-sub">${range ? `Tier ${range}` : "Wholesale price"}${
            retail > unit ? ` · retail <s>${money(retail)}</s>` : ""
          }</div>`
        : "";
      if (it.pricingMode === "flash" && Number(it.flashPercent) > 0) {
        sub += `<div class="item-sub">Flash sale −${Number(it.flashPercent)}%${
          it.flashSaleTitle ? ` · ${esc(it.flashSaleTitle)}` : ""
        }</div>`;
      }
      return `<tr>
        <td>${esc(name)}${sub}</td>
        <td class="c">${qty}</td>
        <td class="r">${money(unit)}</td>
        <td class="r">${money(line)}</td>
      </tr>`;
    })
    .join("");
}

function copyHtml(order, setting, storeName, logo, copyLabel, flags) {
  flags = flags || {};
  const items = order.items || [];
  const subtotal = items.reduce(
    (s, it) => s + (Number(it.price) || (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0)),
    0
  );
  const shipping = Number(order.shippingAmount) || 0;
  const couponDiscount = Number(order.couponDiscount) || 0;
  const grand = Number(order.totalAmount) || subtotal - couponDiscount + shipping;
  const pct = setting.showVat ? Math.max(0, Number(setting.vatPercent) || 0) : 0;
  const vat = pct > 0 ? Math.round((grand * pct) / (100 + pct)) : 0;
  const wstats = flags.wholesale ? wholesaleStats(order) : { savings: 0 };
  const installment = order.paymentMode === "installment";
  const paid = Number(order.paidAmount) / 100 || 0;
  const due = Number(order.dueAmount) / 100 || 0;

  const company = setting.companyName || storeName;
  const invoiceNo = order.invoiceNumber || order.orderNumber || "—";
  const address = [
    order.address,
    order.thana,
    order.district,
    order.division,
    order.postCode,
    order.country,
  ]
    .filter(Boolean)
    .join(", ");

  const contact = [
    setting.companyAddress,
    setting.companyPhone,
    setting.companyEmail,
  ]
    .filter(Boolean)
    .map((x) => `<span>${esc(x)}</span>`)
    .join("<i>·</i>");

  return `
  <section class="copy">
    <div class="copy-ribbon">${esc(copyLabel)}</div>

    <header class="head">
      <div class="brand">
        ${setting.showLogo && logo ? `<img src="${esc(logo)}" alt="${esc(company)}" />` : ""}
        <div>
          <h1>${esc(company)}</h1>
          <div class="contact">${contact || `<span>${esc(storeName)}</span>`}</div>
          ${setting.binNumber ? `<div class="bin">BIN: ${esc(setting.binNumber)}</div>` : ""}
        </div>
      </div>
      <div class="head-meta">
        <span class="doc-type">INVOICE</span>
        <strong class="inv-no">#${esc(invoiceNo)}</strong>
        <span class="date">${dt(order.createdAt || new Date())}</span>
        <span class="badge ${statusClass(order.status)}">${esc(order.status || "pending")}</span>
        ${
          flags.wholesale || flags.international
            ? `<span class="doc-tags">
                ${flags.wholesale ? `<span class="doc-tag">Wholesale order</span>` : ""}
                ${flags.international ? `<span class="doc-tag is-intl">International</span>` : ""}
              </span>`
            : ""
        }
      </div>
    </header>

    <div class="parties">
      <div>
        <h4>Bill to</h4>
        <strong>${esc(order.customerName || "Guest")}</strong>
        ${order.customerPhone ? `<span>${esc(order.customerPhone)}</span>` : ""}
        ${order.customerEmail ? `<span>${esc(order.customerEmail)}</span>` : ""}
      </div>
      <div>
        <h4>Ship to</h4>
        <strong>${esc(order.customerName || "Guest")}</strong>
        <span>${esc(address || "—")}</span>
      </div>
      <div>
        <h4>Payment</h4>
        <strong>${esc(order.paymentLabel || order.paymentMethod || "—")}</strong>
        <span>Status: ${esc(order.paymentStatus || "pending")}</span>
        ${order.shippingLabel ? `<span>Shipping: ${esc(order.shippingLabel)}</span>` : ""}
        ${flags.international && order.country ? `<span>Destination: ${esc(order.country)}</span>` : ""}
        ${flags.international && order.deliverySpeed ? `<span>Delivery: ${esc(order.deliverySpeed)}</span>` : ""}
      </div>
    </div>

    <table class="items">
      <thead>
        <tr><th>Item</th><th class="c">Qty</th><th class="r">Price</th><th class="r">Total</th></tr>
      </thead>
      <tbody>${itemRows(order, flags)}</tbody>
    </table>

    <div class="bottom">
      <div class="notes">
        ${setting.terms ? `<h4>Terms</h4><p>${esc(setting.terms)}</p>` : ""}
        ${setting.footerNote ? `<p class="thanks">${esc(setting.footerNote)}</p>` : ""}
        <p class="small">Order: ${esc(order.orderNumber || "—")}</p>
      </div>
      <div class="totals">
        ${
          wstats.savings > 0
            ? `<div class="save retail"><span>Retail value</span><b><s>${money(wstats.retail)}</s></b></div>
               <div class="save"><span>Wholesale savings</span><b>−${money(wstats.savings)}</b></div>`
            : ""
        }
        <div><span>Subtotal</span><b>${money(subtotal)}</b></div>
        ${
          couponDiscount > 0
            ? `<div class="save"><span>Coupon ${esc(order.couponCode || "")}</span><b>−${money(
                couponDiscount
              )}</b></div>`
            : ""
        }
        <div><span>Shipping${order.couponFreeDelivery ? " (free delivery)" : ""}</span><b>${money(
          shipping
        )}</b></div>
        ${pct > 0 ? `<div><span>VAT (${pct}% included)</span><b>${money(vat)}</b></div>` : ""}
        <div class="grand"><span>Total</span><b>${money(grand)}</b></div>
        ${
          installment
            ? `<div class="pay-row"><span>Paid</span><b>${money(paid)}</b></div>
               <div class="pay-row due"><span>Due</span><b>${money(due)}</b></div>`
            : ""
        }
      </div>
    </div>

    <footer class="foot">
      <div class="sig">
        ${setting.showSignature ? `<span class="sig-line"></span><small>${esc(setting.signatureLabel || "Authorized signature")}</small>` : ""}
      </div>
      <div class="copy-mark">${esc(copyLabel)}</div>
    </footer>
  </section>`;
}

function buildInvoiceHtml({ order, setting, storeName, logo, modes }) {
  const s = setting || {};
  const flags = modes
    ? { wholesale: modes.wholesale === true, international: modes.international === true }
    : { wholesale: isWholesaleOrder(order), international: isInternationalOrder(order) };
  const accent = /^#[0-9a-f]{3,8}$/i.test(s.accentColor || "") ? s.accentColor : "#c9a961";
  const copies = s.copies || "both";
  const wanted =
    copies === "customer"
      ? [["Customer copy"]]
      : copies === "admin"
      ? [["Office copy"]]
      : [["Customer copy"], ["Office copy"]];

  const copyBlocks = wanted
    .map(([label]) => copyHtml(order, s, storeName, logo, label, flags))
    .join('<div class="cut"><span>✂</span> Cut here</div>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invoice ${esc(order.invoiceNumber || order.orderNumber || "")} — ${esc(storeName || "Store")}</title>
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px 40px;
    background: #e9e5dc; color: #241f18;
    font-family: "Segoe UI", Arial, Helvetica, sans-serif;
    font-size: 12px;
  }
  .toolbar { max-width: 820px; margin: 0 auto 14px; display: flex; justify-content: flex-end; gap: 8px; }
  .toolbar button {
    border: 0; border-radius: 8px; padding: 9px 16px; cursor: pointer;
    background: #17140f; color: var(--accent); font-weight: 600;
  }
  .sheet {
    max-width: 820px; margin: 0 auto; background: #fff;
    border-radius: 6px; box-shadow: 0 12px 40px rgba(0,0,0,0.14);
    padding: 18px; 
  }
  .copy {
    border: 1px solid #e7e1d3; border-radius: 10px;
    padding: 16px 18px 12px; position: relative; overflow: hidden;
    background: #fff;
  }
  .copy-ribbon {
    position: absolute; top: 0; right: 0;
    background: var(--accent); color: #17110a;
    font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; padding: 4px 12px;
    border-bottom-left-radius: 8px;
  }
  .head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  .head { padding-top: 8px; }
  .brand { display: flex; gap: 10px; align-items: flex-start; }
  .brand img { max-width: 78px; max-height: 46px; object-fit: contain; }
  .brand h1 { font-size: 18px; margin: 0 0 3px; letter-spacing: 0.01em; }
  .contact { color: #7c7568; font-size: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
  .contact i { font-style: normal; color: #c9a961; }
  .bin { color: #7c7568; font-size: 9px; margin-top: 3px; }
  .head-meta { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; min-width: 130px; }
  .doc-type { font-size: 9px; letter-spacing: 0.22em; color: var(--accent); font-weight: 700; }
  .inv-no { font-size: 15px; }
  .date { color: #7c7568; font-size: 10px; }
  .badge {
    margin-top: 3px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em;
    padding: 2px 8px; border-radius: 999px; background: #f1ede3; color: #6b6455;
  }
  .badge.is-ok { background: #e3f3e7; color: #2f7a44; }
  .badge.is-mid { background: #e8effa; color: #315f9e; }
  .badge.is-cancel { background: #fbe7e3; color: #a83f2d; }
  .doc-tags { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; margin-top: 2px; }
  .doc-tag {
    font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em;
    padding: 2px 7px; border-radius: 999px; background: #f4ecdc; color: #8a6d2f;
  }
  .doc-tag.is-intl { background: #e8effa; color: #315f9e; }
  .parties {
    display: grid; grid-template-columns: 1.1fr 1.5fr 1fr; gap: 12px;
    margin-top: 14px; padding: 10px 12px; background: #faf8f2;
    border: 1px solid #eee8da; border-radius: 8px;
  }
  .parties h4 { font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: #9a9282; margin: 0 0 4px; }
  .parties strong { display: block; font-size: 12px; }
  .parties span { display: block; color: #6b6455; font-size: 10px; margin-top: 1px; }
  .items { width: 100%; border-collapse: collapse; margin-top: 12px; }
  .items th {
    text-align: left; font-size: 9px; letter-spacing: 0.09em; text-transform: uppercase;
    color: #9a9282; padding: 6px 8px; border-bottom: 1.5px solid #e7e1d3;
  }
  .items td { padding: 7px 8px; border-bottom: 1px solid #f0ece3; font-size: 11px; }
  .items .c { text-align: center; }
  .items .r { text-align: right; }
  .item-sub { color: #9a9282; font-size: 9px; margin-top: 2px; }
  .item-sub s { color: #b8b0a0; }
  .bottom { display: flex; gap: 18px; justify-content: space-between; margin-top: 12px; }
  .notes { flex: 1; color: #6b6455; font-size: 10px; }
  .notes h4 { margin: 0 0 3px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: #9a9282; }
  .notes p { margin: 0 0 4px; }
  .notes .thanks { color: var(--accent); font-weight: 600; }
  .notes .small { color: #9a9282; }
  .totals { width: 210px; }
  .totals > div { display: flex; justify-content: space-between; padding: 3px 0; color: #6b6455; font-size: 11px; }
  .totals .grand {
    border-top: 1.5px solid #e7e1d3; margin-top: 4px; padding-top: 6px;
    color: #241f18; font-size: 14px; font-weight: 700;
  }
  .totals .grand b { color: var(--accent); }
  .totals .save b { color: #2f7a44; }
  .totals .save.retail b { color: #9a9282; }
  .totals .pay-row {
    border-top: 1px dashed #e7e1d3; margin-top: 3px; padding-top: 4px;
  }
  .totals .pay-row.due b { color: #a83f2d; }
  .foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 16px; }
  .sig { text-align: center; color: #6b6455; }
  .sig-line { display: block; width: 120px; border-top: 1px solid #b8b0a0; margin-bottom: 4px; }
  .sig small { font-size: 9px; }
  .copy-mark { font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: #b8b0a0; }
  .cut {
    display: flex; align-items: center; gap: 10px; color: #b8b0a0;
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.16em;
    margin: 14px 0; 
  }
  .cut::before, .cut::after { content: ""; flex: 1; border-top: 1px dashed #cfc7b6; }
  .cut span { font-size: 13px; }
  @media (max-width: 680px) {
    .parties { grid-template-columns: 1fr 1fr; }
    .parties > div:last-child { grid-column: 1 / -1; }
    .bottom { flex-direction: column; }
    .totals { width: 100%; }
  }
  @media print {
    body { background: #fff; padding: 0; }
    .toolbar { display: none; }
    .sheet { box-shadow: none; border-radius: 0; max-width: none; padding: 0; }
    .copy { break-inside: avoid; }
    @page { size: ${s.paperSize === "a5" ? "A5" : "A4"}; margin: 10mm; }
  }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">Print / Save PDF</button></div>
  <div class="sheet">${copyBlocks}</div>
</body>
</html>`;
}

function sampleOrder() {
  return {
    orderNumber: "ORD-DEMO-1001",
    invoiceNumber: "INV-01001",
    createdAt: new Date(),
    customerName: "Demo Customer",
    customerPhone: "01712345678",
    customerEmail: "customer@example.com",
    address: "House 12, Road 5",
    thana: "Dhanmondi",
    district: "Dhaka",
    division: "Dhaka",
    postCode: "1209",
    country: "Bangladesh",
    shippingLabel: "Inside Dhaka",
    shippingAmount: 60,
    paymentLabel: "Cash on delivery",
    paymentMethod: "cod",
    paymentStatus: "pending",
    status: "pending",
    totalAmount: 2560,
    items: [
      { product: { name: "Premium Leather Wallet" }, unitPrice: 2500, quantity: 1, price: 2500 },
    ],
  };
}

function sampleWholesaleOrder() {
  return {
    orderNumber: "ORD-DEMO-2001",
    invoiceNumber: "INV-01002",
    createdAt: new Date(),
    customerName: "Rahim Traders",
    customerPhone: "01898877665",
    customerEmail: "rahim.traders@example.com",
    address: "Shop 14, New Market",
    thana: "Mirpur",
    district: "Dhaka",
    division: "Dhaka",
    postCode: "1216",
    country: "Bangladesh",
    shippingLabel: "Wholesale truck — Inside Dhaka",
    shippingAmount: 350,
    paymentLabel: "Bank transfer + COD",
    paymentMethod: "bank",
    paymentStatus: "partial",
    paymentMode: "installment",
    paidAmount: 1063500,
    dueAmount: 2481500,
    status: "confirmed",
    totalAmount: 35450,
    items: [
      {
        product: { name: "Premium Cotton Panjabi" },
        pricingMode: "wholesale",
        unitPrice: 1125,
        retailUnitPricePaisa: 150000,
        tierMinQty: 20,
        tierMaxQty: 49,
        quantity: 24,
        price: 27000,
      },
      {
        product: { name: "Formal Oxford Shirt" },
        pricingMode: "wholesale",
        unitPrice: 675,
        retailUnitPricePaisa: 90000,
        tierMinQty: 10,
        tierMaxQty: 19,
        quantity: 12,
        price: 8100,
      },
    ],
  };
}

function sampleInternationalOrder() {
  return {
    orderNumber: "ORD-DEMO-3001",
    invoiceNumber: "INV-01003",
    createdAt: new Date(),
    customerName: "Ayesha Rahman",
    customerPhone: "+44 7700 900123",
    customerEmail: "ayesha@example.co.uk",
    address: "42 Brick Lane",
    thana: "",
    district: "London",
    division: "",
    postCode: "E1 6RL",
    country: "United Kingdom",
    shippingLabel: "International Air Shipping",
    deliverySpeed: "Air — 7–15 days",
    shippingAmount: 2400,
    paymentLabel: "Advance 30% + COD 70%",
    paymentMethod: "international",
    paymentStatus: "partial",
    status: "confirmed",
    totalAmount: 8340,
    items: [
      { product: { name: "Handwoven Jamdani Saree" }, unitPrice: 4200, quantity: 1, price: 4200 },
      { product: { name: "Leather Tote Bag" }, unitPrice: 1740, quantity: 1, price: 1740 },
    ],
  };
}

module.exports = {
  buildInvoiceHtml,
  sampleOrder,
  sampleWholesaleOrder,
  sampleInternationalOrder,
  isWholesaleOrder,
  isInternationalOrder,
  money,
};
