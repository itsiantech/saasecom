const test = require("node:test");
const assert = require("node:assert/strict");
const { pickTiers, effectiveMinQty } = require("../services/cartPricing");

const productTiers = [
  { minQty: 10, maxQty: null, pricePaisa: 90000 },
];
const variationTiers = [
  { minQty: 5, maxQty: 20, pricePaisa: 85000 },
  { minQty: 21, maxQty: null, pricePaisa: 80000 },
];

test("variation tiers win over product tiers", () => {
  assert.deepEqual(pickTiers(variationTiers, productTiers), variationTiers);
});

test("empty variation tiers fall back to product tiers", () => {
  assert.deepEqual(pickTiers([], productTiers), productTiers);
  assert.deepEqual(pickTiers(null, productTiers), productTiers);
});

test("missing tier lists return an empty array", () => {
  assert.deepEqual(pickTiers(undefined, undefined), []);
  assert.deepEqual(pickTiers(null, null), []);
});

test("effective MOQ is the larger of the store MOQ and the first tier", () => {
  assert.equal(effectiveMinQty({ moq: 3 }, productTiers), 10);
  assert.equal(effectiveMinQty({ moq: 25 }, productTiers), 25);
  assert.equal(effectiveMinQty({ moq: 25 }, []), 25);
  assert.equal(effectiveMinQty(null, []), 1);
});

test("MOQ and tier bounds survive numeric strings from the settings form", () => {
  assert.equal(effectiveMinQty({ moq: "2" }, [{ minQty: "12" }]), 12);
});
