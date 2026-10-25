const test = require("node:test");
const assert = require("node:assert/strict");
const {
  WholesaleShippingError,
  resolveLineCategory,
  buildShippingLines,
  buildQuote,
  toShippingBreakdown,
} = require("../services/wholesaleShippingQuote");

const DATA = {
  rules: [
    { category: "cat-a", categoryName: "Tiles", chargeType: "per_piece", ratePaisa: 5000 },
  ],
  vehicles: [{ name: "Truck", maxWeightKg: 1000, chargePaisa: 50000 }],
  speeds: [
    { _id: "speed-1", name: "Express", etaDays: 2, extraType: "percent", extraValue: 500 },
    { _id: "speed-2", name: "Same day", etaDays: 0, extraType: "flat", extraValue: 2500 },
  ],
};

test("line category prefers a category that has a shipping rule", () => {
  const ruleIds = new Set(["cat-a"]);
  assert.equal(resolveLineCategory(["cat-x", "cat-a"], ruleIds), "cat-a");
  assert.equal(resolveLineCategory(["cat-x", "cat-y"], ruleIds), "cat-x");
  assert.equal(resolveLineCategory([], ruleIds), null);
});

test("shipping lines map product weight and quantity, skipping missing products", () => {
  const products = new Map([
    ["p1", { categories: ["cat-x", "cat-a"], weightKg: 2 }],
    ["p2", { categories: ["cat-b"], weightKg: 1.5 }],
  ]);
  const lines = buildShippingLines(
    [
      { product: "p1", quantity: 3 },
      { product: "p2", quantity: 2 },
      { product: "deleted", quantity: 9 },
      { product: "p1", quantity: 0 },
    ],
    products,
    new Set(["cat-a"])
  );

  assert.deepEqual(lines, [
    { categoryId: "cat-a", weightKg: 2, quantity: 3 },
    { categoryId: "cat-b", weightKg: 1.5, quantity: 2 },
  ]);
});

test("standard delivery is the default option and configured speeds add extras", () => {
  const lines = [{ categoryId: "cat-a", quantity: 2, weightKg: 0 }];
  const base = buildQuote({
    settings: { vehicleOverflowRule: "cheapest" },
    data: DATA,
    lines,
  });

  assert.equal(base.categoryPaisa, 10000);
  assert.equal(base.totalPaisa, 10000);
  assert.equal(base.selectedSpeedId, "");
  assert.equal(base.options.length, 3);
  assert.equal(base.options[0].name, "Standard delivery");
  assert.equal(base.options[0].totalPaisa, 10000);
  assert.equal(base.options[1].extraPaisa, 500); // 5% of 10,000
  assert.equal(base.options[1].totalPaisa, 10500);
  assert.equal(base.options[2].extraPaisa, 2500);
  assert.equal(base.options[2].totalPaisa, 12500);
});

test("selecting a speed recalculates the shipping total", () => {
  const quote = buildQuote({
    settings: { vehicleOverflowRule: "cheapest" },
    data: DATA,
    lines: [{ categoryId: "cat-a", quantity: 2, weightKg: 0 }],
    speedId: "speed-2",
  });

  assert.equal(quote.selectedSpeedId, "speed-2");
  assert.equal(quote.speedPaisa, 2500);
  assert.equal(quote.totalPaisa, 12500);
  assert.equal(quote.speed.name, "Same day");
});

test("unknown delivery speed is rejected", () => {
  assert.throws(
    () =>
      buildQuote({
        settings: { vehicleOverflowRule: "cheapest" },
        data: DATA,
        lines: [{ categoryId: "cat-a", quantity: 1, weightKg: 0 }],
        speedId: "missing",
      }),
    (err) => err instanceof WholesaleShippingError && /speed/.test(err.message)
  );
});

test("order breakdown keeps category names and paisa amounts", () => {
  const quote = buildQuote({
    settings: { vehicleOverflowRule: "cheapest" },
    data: DATA,
    lines: [{ categoryId: "cat-a", quantity: 2, weightKg: 600 }],
    speedId: "speed-1",
  });
  const snapshot = toShippingBreakdown(quote);

  assert.equal(snapshot.mode, "wholesale");
  assert.equal(snapshot.weightKg, 1200);
  assert.equal(snapshot.categoryPaisa, 10000);
  assert.equal(snapshot.vehiclePaisa, 100000); // 2 trucks
  assert.equal(snapshot.speedPaisa, 5500); // 5% of 110,000
  assert.equal(snapshot.totalPaisa, 115500);
  assert.equal(snapshot.categories[0].categoryName, "Tiles");
  assert.equal(snapshot.vehicles[0].count, 2);
  assert.equal(snapshot.speed.name, "Express");
  assert.equal("options" in snapshot, false);
});
