const { test } = require("node:test");
const assert = require("node:assert/strict");
const planCycles = require("../lib/planCycles");

test("cycles cover 1, 3, 6, 12 and 24 months", () => {
  assert.deepEqual(
    planCycles.CYCLES.map((c) => [c.key, c.months, c.days]),
    [
      ["1m", 1, 30],
      ["3m", 3, 90],
      ["6m", 6, 180],
      ["1y", 12, 365],
      ["2y", 24, 730],
    ]
  );
  assert.equal(planCycles.DEFAULT_CYCLE, "1m");
});

test("priceFor multiplies the monthly base by the cycle months", () => {
  const plan = { price: 990 };
  assert.equal(planCycles.priceFor(plan, "1m"), 990);
  assert.equal(planCycles.priceFor(plan, "3m"), 2970);
  assert.equal(planCycles.priceFor(plan, "6m"), 5940);
  assert.equal(planCycles.priceFor(plan, "1y"), 11880);
  assert.equal(planCycles.priceFor(plan, "2y"), 23760);
  assert.equal(planCycles.priceFor(plan, planCycles.cycleFor("6m")), 5940);
});

test("unknown cycle keys resolve to null and never price a checkout", () => {
  assert.equal(planCycles.cycleFor("7m"), null);
  assert.equal(planCycles.cycleFor(""), null);
  assert.equal(planCycles.cycleFor(undefined), null);
  assert.equal(planCycles.priceFor({ price: 990 }, "7m"), 0);
});

test("optionsFor gives every cycle its computed total", () => {
  const opts = planCycles.optionsFor({ price: 500 });
  assert.deepEqual(opts.map((c) => c.price), [500, 1500, 3000, 6000, 12000]);
  assert.ok(opts.every((c) => c.label && c.days > 0));
});
