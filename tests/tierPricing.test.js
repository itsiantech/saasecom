const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeTiers,
  resolveTier,
  priceForQty,
  TierError,
} = require("../services/tierPricing");

const tiers = normalizeTiers([
  { minQty: 1, maxQty: 10, pricePaisa: 100000 },
  { minQty: 11, maxQty: 50, pricePaisa: 90000 },
  { minQty: 51, maxQty: null, pricePaisa: 80000 },
]);

test("tier boundaries: 10, 11, 50, 51 and open-ended last tier", () => {
  assert.equal(priceForQty(tiers, 10).pricePaisa, 100000);
  assert.equal(priceForQty(tiers, 11).pricePaisa, 90000);
  assert.equal(priceForQty(tiers, 50).pricePaisa, 90000);
  assert.equal(priceForQty(tiers, 51).pricePaisa, 80000);
  assert.equal(priceForQty(tiers, 9999).pricePaisa, 80000);
  assert.equal(resolveTier(tiers, 51).minQty, 51);
});

test("falls back to retail price when no tier matches", () => {
  const startingAtFive = normalizeTiers([{ minQty: 5, maxQty: null, pricePaisa: 70000 }]);
  const result = priceForQty(startingAtFive, 3, 12345);
  assert.equal(result.pricePaisa, 12345);
  assert.equal(result.tier, null);
});

test("rejects non-contiguous rows", () => {
  assert.throws(
    () =>
      normalizeTiers([
        { minQty: 1, maxQty: 10, pricePaisa: 100 },
        { minQty: 12, maxQty: 20, pricePaisa: 90 },
      ]),
    (err) => err instanceof TierError && /contiguous/.test(err.message)
  );
});

test("rejects To qty smaller than From qty", () => {
  assert.throws(
    () => normalizeTiers([{ minQty: 11, maxQty: 10, pricePaisa: 100 }]),
    /To qty/
  );
});

test("rejects rows after an open-ended tier", () => {
  assert.throws(
    () =>
      normalizeTiers([
        { minQty: 1, maxQty: null, pricePaisa: 100 },
        { minQty: 2, maxQty: 5, pricePaisa: 90 },
      ]),
    /Last tier/
  );
});

test("sorts rows by From qty and accepts numeric strings from forms", () => {
  const sorted = normalizeTiers([
    { minQty: "51", maxQty: "", pricePaisa: "80000" },
    { minQty: "1", maxQty: "10", pricePaisa: "100000" },
    { minQty: "11", maxQty: "50", pricePaisa: "90000" },
  ]);
  assert.deepEqual(
    sorted.map((tier) => tier.minQty),
    [1, 11, 51]
  );
  assert.equal(sorted[2].maxQty, null);
});
