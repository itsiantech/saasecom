const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateWholesaleShipping } = require("../services/wholesaleShipping");

const RULES = [
  { category: "cat-a", chargeType: "per_piece", ratePaisa: 5000 },
  { category: "cat-b", chargeType: "per_kg", ratePaisa: 10000 },
  { category: "cat-c", chargeType: "flat", ratePaisa: 20000 },
];

const VEHICLES = [
  { name: "Mini truck", maxWeightKg: 1000, chargePaisa: 50000 },
  { name: "Truck", maxWeightKg: 5000, chargePaisa: 150000 },
];

function linesForWeight(weightKg) {
  return [{ categoryId: "none", quantity: 1, weightKg }];
}

test("multi-category category charges (per piece, per kg, flat once)", () => {
  const result = calculateWholesaleShipping({
    lines: [
      { categoryId: "cat-a", quantity: 2, weightKg: 1 },
      { categoryId: "cat-a", quantity: 3, weightKg: 1 },
      { categoryId: "cat-b", quantity: 1, weightKg: 3 },
      { categoryId: "cat-c", quantity: 4, weightKg: 0.5 },
    ],
    rules: RULES,
    vehicles: [],
  });

  assert.equal(result.weightKg, 10);
  assert.equal(result.categoryPaisa, 25000 + 30000 + 20000);
  assert.equal(result.vehiclePaisa, 0);
  assert.equal(result.speedPaisa, 0);
  assert.equal(result.totalPaisa, 75000);
});

test("single vehicle type uses ceil(total weight / capacity)", () => {
  const result = calculateWholesaleShipping({
    lines: linesForWeight(12000),
    vehicles: [VEHICLES[1]],
  });

  assert.equal(result.vehicleCount, 3);
  assert.equal(result.vehiclePaisa, 450000);
  assert.equal(result.vehicles[0].name, "Truck");
  assert.equal(result.vehicles[0].count, 3);
});

test("largest-first overflow rule uses as many largest vehicles as needed", () => {
  const result = calculateWholesaleShipping({
    lines: linesForWeight(12000),
    vehicles: VEHICLES,
    overflowRule: "largest_first",
  });

  assert.equal(result.vehicleCount, 3);
  assert.equal(result.vehiclePaisa, 450000);
  assert.equal(result.vehicles.length, 1);
  assert.equal(result.vehicles[0].name, "Truck");
});

test("cheapest overflow rule mixes vehicles when it is cheaper", () => {
  const result = calculateWholesaleShipping({
    lines: linesForWeight(12000),
    vehicles: VEHICLES,
    overflowRule: "cheapest",
  });

  // 2 trucks + 2 mini trucks cover 12,000 kg for 400,000 paisa (3 trucks cost 450,000).
  assert.equal(result.vehicleCount, 4);
  assert.equal(result.vehiclePaisa, 400000);
  const truck = result.vehicles.find((row) => row.name === "Truck");
  const mini = result.vehicles.find((row) => row.name === "Mini truck");
  assert.equal(truck.count, 2);
  assert.equal(mini.count, 2);
});

test("delivery speed percent applies to category + vehicle charge", () => {
  const result = calculateWholesaleShipping({
    lines: [{ categoryId: "cat-c", quantity: 1, weightKg: 0 }],
    rules: RULES,
    vehicles: VEHICLES,
    speed: { name: "Fast delivery", extraType: "percent", extraValue: 500 },
  });

  assert.equal(result.categoryPaisa, 20000);
  assert.equal(result.vehiclePaisa, 0);
  assert.equal(result.speedPaisa, 1000); // 5% of 20,000
  assert.equal(result.totalPaisa, 21000);
});

test("delivery speed flat extra is added as-is", () => {
  const result = calculateWholesaleShipping({
    lines: [{ categoryId: "cat-c", quantity: 1, weightKg: 0 }],
    rules: RULES,
    speed: { name: "Slow delivery", extraType: "flat", extraValue: 2500 },
  });

  assert.equal(result.speedPaisa, 2500);
  assert.equal(result.totalPaisa, 22500);
});

test("full formula: category + vehicles + speed", () => {
  const result = calculateWholesaleShipping({
    lines: [
      { categoryId: "cat-a", quantity: 2, weightKg: 1000 },
      { categoryId: "cat-a", quantity: 0, weightKg: 1000 },
      ...linesForWeight(10000),
    ],
    rules: RULES,
    vehicles: VEHICLES,
    overflowRule: "largest_first",
    speed: { name: "Fast delivery", extraType: "percent", extraValue: 500 },
  });

  // weight 12,000 kg -> 3 trucks = 450,000; category 2 pieces = 10,000
  const base = 10000 + 450000;
  assert.equal(result.categoryPaisa, 10000);
  assert.equal(result.vehiclePaisa, 450000);
  assert.equal(result.speedPaisa, Math.round(base * 0.05));
  assert.equal(result.totalPaisa, base + result.speedPaisa);
});

test("no vehicles configured means no vehicle charge", () => {
  const result = calculateWholesaleShipping({
    lines: linesForWeight(500),
    vehicles: [],
  });
  assert.equal(result.vehiclePaisa, 0);
  assert.equal(result.vehicleCount, 0);
});
