/* Flash sale + coupon pricing tests.
   Run: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert");
const {
  inWindow,
  windowStatus,
  flashDiscountPaisa,
  flashPricePaisa,
  saleMatchesProduct,
  bestFlashSale,
  couponAppliesToLine,
  evaluateCoupon,
} = require("../services/promotions");

const now = new Date("2026-10-24T12:00:00Z");
const live = { startAt: "2026-10-24T00:00:00Z", endAt: "2026-10-25T00:00:00Z" };
const past = { startAt: "2026-10-01T00:00:00Z", endAt: "2026-10-10T00:00:00Z" };

function coupon(extra = {}) {
  return {
    code: "SAVE10",
    discountType: "percent",
    discountValue: 10,
    minOrderAmount: 1000,
    startAt: live.startAt,
    endAt: live.endAt,
    freeDelivery: false,
    products: [],
    categories: [],
    categoryIds: [],
    ...extra,
  };
}

test("flash discount rounds to paisa and never goes below zero", () => {
  assert.strictEqual(flashDiscountPaisa(150000, 20), 30000);
  assert.strictEqual(flashPricePaisa(150000, 20), 120000);
  assert.strictEqual(flashPricePaisa(150000, 0), 150000);
  assert.strictEqual(flashPricePaisa(150000, 100), 0);
  assert.strictEqual(flashDiscountPaisa(999, 33), 330);
});

test("window status is inclusive on both ends", () => {
  assert.strictEqual(inWindow(live, now), true);
  assert.strictEqual(inWindow(live, new Date(live.startAt)), true);
  assert.strictEqual(inWindow(live, new Date(live.endAt)), true);
  assert.strictEqual(inWindow(past, now), false);
  assert.strictEqual(windowStatus({ ...live, startAt: "2026-10-26T00:00:00Z" }, now), "upcoming");
  assert.strictEqual(windowStatus(past, now), "ended");
  assert.strictEqual(windowStatus(live, now), "live");
});

test("flash sale matches direct products and category subtrees", () => {
  const byProduct = { targetType: "product", products: ["p1"], categoryIds: [] };
  assert.strictEqual(saleMatchesProduct(byProduct, "p1", []), true);
  assert.strictEqual(saleMatchesProduct(byProduct, "p2", ["c1"]), false);

  const byCategory = { targetType: "category", products: [], categoryIds: ["c2"] };
  assert.strictEqual(saleMatchesProduct(byCategory, "p2", ["c1", "c2"]), true);
  assert.strictEqual(saleMatchesProduct(byCategory, "p2", ["c1"]), false);
});

test("best flash sale picks the lowest live price and ignores 0%", () => {
  const sales = [
    { _id: "s1", ...live, targetType: "product", products: ["p1"], discountPercent: 10 },
    { _id: "s2", ...live, targetType: "product", products: ["p1"], discountPercent: 25 },
    { _id: "s3", ...live, targetType: "product", products: ["p1"], discountPercent: 50 },
    { _id: "s4", ...past, targetType: "product", products: ["p1"], discountPercent: 90 },
    { _id: "s5", ...live, targetType: "product", products: ["p1"], discountPercent: 0 },
  ];
  const picked = bestFlashSale({
    sales,
    productId: "p1",
    categoryIds: [],
    basePaisa: 100000,
    now,
  });
  assert.strictEqual(String(picked.sale._id), "s3");
  assert.strictEqual(picked.pricePaisa, 50000);
  assert.strictEqual(picked.discountPaisa, 50000);

  const none = bestFlashSale({
    sales,
    productId: "p2",
    categoryIds: [],
    basePaisa: 100000,
    now,
  });
  assert.strictEqual(none, null);
});

test("coupon with no targets applies to every line", () => {
  assert.strictEqual(couponAppliesToLine(coupon(), "anything", []), true);
});

test("coupon product/category targets only cover matching lines", () => {
  const c = coupon({ products: ["p1"], categories: ["c9"], categoryIds: ["c9"] });
  assert.strictEqual(couponAppliesToLine(c, "p1", []), true);
  assert.strictEqual(couponAppliesToLine(c, "p2", ["c9"]), true);
  assert.strictEqual(couponAppliesToLine(c, "p2", ["c1"]), false);
});

test("percent coupon discounts only eligible lines and enforces min order", () => {
  const lines = [
    { productId: "p1", categoryIds: ["c1"], amountPaisa: 100000 },
    { productId: "p2", categoryIds: ["c2"], amountPaisa: 50000 },
  ];
  const c = coupon({ products: ["p1"], minOrderAmount: 1000 });
  const result = evaluateCoupon({ coupon: c, lines, subtotalPaisa: 150000, shippingPaisa: 6000, now });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.eligiblePaisa, 100000);
  assert.strictEqual(result.discountPaisa, 10000);
  assert.strictEqual(result.shippingPaisa, 6000);

  const belowMin = evaluateCoupon({
    coupon: { ...c, minOrderAmount: 5000 },
    lines,
    subtotalPaisa: 150000,
    now,
  });
  assert.strictEqual(belowMin.ok, false);
  assert.match(belowMin.message, /Minimum order/);
});

test("fixed coupon is capped at the eligible subtotal", () => {
  const c = coupon({ discountType: "fixed", discountValue: 500, minOrderAmount: 0 });
  const result = evaluateCoupon({
    coupon: c,
    lines: [{ productId: "p1", categoryIds: [], amountPaisa: 20000 }],
    subtotalPaisa: 20000,
    now,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.discountPaisa, 20000);
});

test("free delivery zeroes shipping while keeping the item total", () => {
  const c = coupon({ discountValue: 0, freeDelivery: true, minOrderAmount: 0 });
  const result = evaluateCoupon({
    coupon: c,
    lines: [{ productId: "p1", categoryIds: [], amountPaisa: 80000 }],
    subtotalPaisa: 80000,
    shippingPaisa: 12000,
    now,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.discountPaisa, 0);
  assert.strictEqual(result.shippingDiscountPaisa, 12000);
  assert.strictEqual(result.shippingPaisa, 0);
});

test("expired coupon and non-matching cart are rejected", () => {
  const expired = evaluateCoupon({
    coupon: coupon({ ...past, minOrderAmount: 0 }),
    lines: [{ productId: "p1", categoryIds: [], amountPaisa: 100000 }],
    subtotalPaisa: 100000,
    now,
  });
  assert.strictEqual(expired.ok, false);

  const wrongTarget = evaluateCoupon({
    coupon: coupon({ products: ["p9"], minOrderAmount: 0 }),
    lines: [{ productId: "p1", categoryIds: [], amountPaisa: 100000 }],
    subtotalPaisa: 100000,
    now,
  });
  assert.strictEqual(wrongTarget.ok, false);
  assert.match(wrongTarget.message, /apply hoy na/);
});

test("coupon without discount or free delivery is rejected", () => {
  const result = evaluateCoupon({
    coupon: coupon({ discountValue: 0, freeDelivery: false, minOrderAmount: 0 }),
    lines: [{ productId: "p1", categoryIds: [], amountPaisa: 100000 }],
    subtotalPaisa: 100000,
    now,
  });
  assert.strictEqual(result.ok, false);
});
