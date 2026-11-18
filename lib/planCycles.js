/* ==========================================================================
   Billing cycles for paid plans. A plan's price is the monthly base; longer
   terms are priced as monthly × months and run for the cycle's day count.
   ========================================================================== */
const CYCLES = [
  { key: "1m", months: 1, days: 30, label: "১ মাস" },
  { key: "3m", months: 3, days: 90, label: "৩ মাস" },
  { key: "6m", months: 6, days: 180, label: "৬ মাস" },
  { key: "1y", months: 12, days: 365, label: "১ বছর" },
  { key: "2y", months: 24, days: 730, label: "২ বছর" },
];

const DEFAULT_CYCLE = "1m";

function cycleFor(key) {
  const k = String(key || "").toLowerCase();
  return CYCLES.find((c) => c.key === k) || null;
}

function priceFor(plan, cycle) {
  const c = typeof cycle === "string" ? cycleFor(cycle) : cycle;
  if (!c) return 0;
  return (Number(plan && plan.price) || 0) * c.months;
}

function optionsFor(plan) {
  return CYCLES.map((c) => ({ ...c, price: priceFor(plan, c) }));
}

module.exports = { CYCLES, DEFAULT_CYCLE, cycleFor, priceFor, optionsFor };
