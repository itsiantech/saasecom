// Wholesale shipping = category charge + (vehicle charge x count) + delivery speed extra.
// All amounts are integer paisa.

class WholesaleShippingError extends Error {
  constructor(message) {
    super(message);
    this.name = "WholesaleShippingError";
    this.status = 400;
  }
}

function toPaisa(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function normalizeVehicles(vehicles) {
  return (vehicles || [])
    .map((vehicle) => ({
      name: String(vehicle.name || ""),
      maxWeightKg: Number(vehicle.maxWeightKg) || 0,
      chargePaisa: toPaisa(vehicle.chargePaisa),
    }))
    .filter((vehicle) => vehicle.maxWeightKg > 0);
}

function categoryCharges(lines, rules) {
  const ruleByCategory = new Map();
  for (const rule of rules || []) {
    if (!rule || !rule.category) continue;
    const key = String(rule.category);
    if (!ruleByCategory.has(key)) ruleByCategory.set(key, rule);
  }

  // Flat charges apply once per category, so group lines before calculating.
  const groups = new Map();
  for (const line of lines || []) {
    const category = line.categoryId ? String(line.categoryId) : "";
    if (!category || !ruleByCategory.has(category)) continue;
    const quantity = Math.max(0, Number(line.quantity) || 0);
    const weightKg = Math.max(0, Number(line.weightKg) || 0) * quantity;
    const group = groups.get(category) || { quantity: 0, weightKg: 0 };
    group.quantity += quantity;
    group.weightKg += weightKg;
    groups.set(category, group);
  }

  let totalPaisa = 0;
  const rows = [];
  for (const [category, group] of groups) {
    const rule = ruleByCategory.get(category);
    let amountPaisa = 0;
    if (rule.chargeType === "per_piece") {
      amountPaisa = Math.round(toPaisa(rule.ratePaisa) * group.quantity);
    } else if (rule.chargeType === "per_kg") {
      amountPaisa = Math.round(toPaisa(rule.ratePaisa) * group.weightKg);
    } else {
      amountPaisa = toPaisa(rule.ratePaisa);
    }
    totalPaisa += amountPaisa;
    rows.push({ category, chargeType: rule.chargeType, amountPaisa });
  }

  return { totalPaisa, rows };
}

function groupPickedVehicles(picked) {
  const groups = new Map();
  for (const vehicle of picked) {
    const key = `${vehicle.name}|${vehicle.maxWeightKg}|${vehicle.chargePaisa}`;
    const group = groups.get(key) || { ...vehicle, count: 0, totalPaisa: 0 };
    group.count += 1;
    group.totalPaisa = group.count * vehicle.chargePaisa;
    groups.set(key, group);
  }
  return [...groups.values()];
}

function pickLargestFirst(weightKg, vehicles) {
  const sorted = [...vehicles].sort(
    (a, b) => b.maxWeightKg - a.maxWeightKg || a.chargePaisa - b.chargePaisa
  );
  let remaining = weightKg;
  const picked = [];
  while (remaining > 0) {
    picked.push(sorted[0]);
    remaining -= sorted[0].maxWeightKg;
  }
  return picked;
}

// Unbounded knapsack: minimum total charge that covers the whole weight.
function pickCheapest(weightKg, vehicles) {
  const target = Math.ceil(weightKg);
  if (target > 200000) return pickLargestFirst(weightKg, vehicles);

  const sorted = [...vehicles].sort(
    (a, b) => b.maxWeightKg - a.maxWeightKg || a.chargePaisa - b.chargePaisa
  );
  const best = new Array(target + 1).fill(Infinity);
  const choice = new Array(target + 1).fill(null);
  best[0] = 0;

  for (let weight = 1; weight <= target; weight += 1) {
    for (const vehicle of sorted) {
      const prev = Math.max(0, weight - vehicle.maxWeightKg);
      const cost = best[prev] + vehicle.chargePaisa;
      if (cost < best[weight]) {
        best[weight] = cost;
        choice[weight] = vehicle;
      }
    }
  }

  const picked = [];
  let weight = target;
  while (weight > 0 && choice[weight]) {
    const vehicle = choice[weight];
    picked.push(vehicle);
    weight = Math.max(0, weight - vehicle.maxWeightKg);
  }
  return picked;
}

function pickVehicles(weightKg, vehicles, overflowRule) {
  if (weightKg <= 0 || !vehicles.length) {
    return { rows: [], count: 0, chargePaisa: 0 };
  }
  const picked =
    overflowRule === "largest_first"
      ? pickLargestFirst(weightKg, vehicles)
      : pickCheapest(weightKg, vehicles);
  const rows = groupPickedVehicles(picked);
  return {
    rows,
    count: rows.reduce((sum, row) => sum + row.count, 0),
    chargePaisa: rows.reduce((sum, row) => sum + row.totalPaisa, 0),
  };
}

function speedExtra(speed, basePaisa) {
  if (!speed) return { name: "", extraType: null, amountPaisa: 0 };
  const extraType = speed.extraType === "percent" ? "percent" : "flat";
  const value = Math.max(0, Math.round(Number(speed.extraValue) || 0));
  const amountPaisa =
    extraType === "percent" ? Math.round((basePaisa * value) / 10000) : value;
  return { name: String(speed.name || ""), extraType, amountPaisa };
}

function calculateWholesaleShipping({
  lines = [],
  rules = [],
  vehicles = [],
  speed = null,
  overflowRule = "cheapest",
}) {
  const weightKg = (lines || []).reduce(
    (sum, line) =>
      sum +
      Math.max(0, Number(line.weightKg) || 0) * Math.max(0, Number(line.quantity) || 0),
    0
  );

  const rulesResult = categoryCharges(lines, rules);
  const vehicleResult = pickVehicles(
    weightKg,
    normalizeVehicles(vehicles),
    overflowRule
  );
  const basePaisa = rulesResult.totalPaisa + vehicleResult.chargePaisa;
  const speedResult = speedExtra(speed, basePaisa);

  return {
    weightKg: Math.round(weightKg * 1000) / 1000,
    categoryPaisa: rulesResult.totalPaisa,
    vehiclePaisa: vehicleResult.chargePaisa,
    speedPaisa: speedResult.amountPaisa,
    totalPaisa: basePaisa + speedResult.amountPaisa,
    categories: rulesResult.rows,
    vehicles: vehicleResult.rows,
    vehicleCount: vehicleResult.count,
    speed: speed
      ? {
          name: speedResult.name,
          extraType: speedResult.extraType,
          extraPaisa: speedResult.amountPaisa,
        }
      : null,
    overflowRule: overflowRule === "largest_first" ? "largest_first" : "cheapest",
  };
}

module.exports = { WholesaleShippingError, calculateWholesaleShipping };
