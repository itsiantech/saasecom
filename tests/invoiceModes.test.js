/* Invoice mode tests — retail / wholesale / international rendering.
   Run: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert");
const {
  buildInvoiceHtml,
  sampleOrder,
  sampleWholesaleOrder,
  sampleInternationalOrder,
  isWholesaleOrder,
  isInternationalOrder,
} = require("../lib/invoice");

const setting = {
  companyName: "Luxe Store",
  copies: "customer",
  showVat: false,
  showLogo: false,
  showSignature: false,
};

function render(order, extra = {}) {
  return buildInvoiceHtml({ order, setting, storeName: "Luxe Store", logo: "", ...extra });
}

test("retail invoice has no wholesale or international markers", () => {
  const html = render(sampleOrder());
  assert.ok(!html.includes("Wholesale order"));
  assert.ok(!html.includes("International"));
  assert.ok(!html.includes("Destination:"));
  assert.ok(!html.includes("Wholesale savings"));
  assert.ok(!html.includes("Paid"));
  assert.ok(!html.includes("Due"));
  assert.ok(!html.includes('class="item-sub"'));
});

test("wholesale invoice shows tier, retail strike, savings and paid/due", () => {
  const order = sampleWholesaleOrder();
  const html = render(order);
  assert.ok(html.includes("Wholesale order"));
  assert.ok(html.includes("Tier 20–49 pcs"));
  assert.ok(html.includes("Tier 10–19 pcs"));
  assert.ok(html.includes("retail <s>৳1,500</s>"));
  assert.ok(html.includes("retail <s>৳900</s>"));
  assert.ok(html.includes("Retail value"));
  assert.ok(html.includes("Wholesale savings"));
  assert.ok(html.includes("−৳11,700"));
  assert.ok(html.includes("Paid"));
  assert.ok(html.includes("৳10,635"));
  assert.ok(html.includes("Due"));
  assert.ok(html.includes("৳24,815"));
});

test("international invoice shows destination, delivery and tag", () => {
  const html = render(sampleInternationalOrder());
  assert.ok(html.includes("International"));
  assert.ok(html.includes("Destination: United Kingdom"));
  assert.ok(html.includes("Delivery: Air — 7–15 days"));
  assert.ok(html.includes("International Air Shipping"));
  assert.ok(!html.includes("Wholesale order"));
});

test("explicit retail modes suppress auto-detection", () => {
  const html = render(sampleWholesaleOrder(), { modes: { wholesale: false, international: false } });
  assert.ok(!html.includes("Wholesale order"));
  assert.ok(!html.includes("Wholesale savings"));
  assert.ok(!html.includes('class="item-sub"'));
});

test("explicit international mode works on a domestic sample", () => {
  const html = render(sampleOrder(), { modes: { wholesale: false, international: true } });
  assert.ok(html.includes("International"));
  assert.ok(html.includes("Destination: Bangladesh"));
});

test("mode helpers auto-detect orders", () => {
  assert.equal(isWholesaleOrder(sampleWholesaleOrder()), true);
  assert.equal(isWholesaleOrder(sampleOrder()), false);
  assert.equal(isInternationalOrder(sampleInternationalOrder()), true);
  assert.equal(isInternationalOrder(sampleOrder()), false);
  assert.equal(isInternationalOrder({ country: "BD" }), false);
});
