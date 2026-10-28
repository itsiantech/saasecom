// Shared defaults for International Import Mode (used by model, API and pricing).
const DEFAULTS = {
  enabled: false,
  advancePercent: 30,
  codPercent: 70,
  air: { label: "Air Shipping", minDays: 7, maxDays: 15, ratePerKg: 0 },
  sea: { label: "Sea Shipping", minDays: 25, maxDays: 45, ratePerKg: 0 },
  labels: { shippingCharge: "Shipping Charge", chinaCourier: "China Courier Fee" },
};

function defaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function labelOr(value, fallback) {
  const label = String(value == null ? "" : value).trim();
  return label || fallback;
}

// Keeps API responses to known fields only (never exposes store/_id/timestamps).
function normalizeSettings(input = {}) {
  const air = input.air || {};
  const sea = input.sea || {};
  const labels = input.labels || {};
  return {
    enabled: input.enabled === true,
    advancePercent: numberOr(input.advancePercent, DEFAULTS.advancePercent),
    codPercent: numberOr(input.codPercent, DEFAULTS.codPercent),
    air: {
      label: labelOr(air.label, DEFAULTS.air.label),
      minDays: numberOr(air.minDays, DEFAULTS.air.minDays),
      maxDays: numberOr(air.maxDays, DEFAULTS.air.maxDays),
      ratePerKg: numberOr(air.ratePerKg, DEFAULTS.air.ratePerKg),
    },
    sea: {
      label: labelOr(sea.label, DEFAULTS.sea.label),
      minDays: numberOr(sea.minDays, DEFAULTS.sea.minDays),
      maxDays: numberOr(sea.maxDays, DEFAULTS.sea.maxDays),
      ratePerKg: numberOr(sea.ratePerKg, DEFAULTS.sea.ratePerKg),
    },
    labels: {
      shippingCharge: labelOr(labels.shippingCharge, DEFAULTS.labels.shippingCharge),
      chinaCourier: labelOr(labels.chinaCourier, DEFAULTS.labels.chinaCourier),
    },
  };
}

module.exports = { DEFAULTS, defaultSettings, normalizeSettings };
