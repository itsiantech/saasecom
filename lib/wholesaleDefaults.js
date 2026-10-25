// Shared defaults for Wholesale mode and installment payment.
// All money is stored as integer paisa; percentages are basis points (3000 = 30%).
const DEFAULTS = {
  enabled: false,
  badgeText: "Wholesale",
  moq: 1,
  buyers: "all",
  showRetailPrice: true,
  vehicleOverflowRule: "cheapest",
  partialPaymentEnabled: false,
  lateFeePaisa: 0,
  lateFeeType: "flat",
  graceDays: 3,
  maxOpenInstallmentOrders: 0,
  goodsReleaseRule: "after_advance",
  installmentBuyers: "approved",
  shippingInFirstInstallment: true,
  overdueAction: "hold",
  overdueDays: 7,
  refundType: "full",
  refundPercent: 100,
};

const ENUMS = {
  buyers: ["all", "approved"],
  vehicleOverflowRule: ["cheapest", "largest_first"],
  lateFeeType: ["flat", "percent"],
  goodsReleaseRule: ["after_advance", "after_half", "after_full"],
  installmentBuyers: ["approved", "all"],
  overdueAction: ["hold", "cancel"],
  refundType: ["full", "percent", "none"],
};

function defaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
}

function toInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  let result = Math.round(n);
  if (min !== undefined) result = Math.max(min, result);
  if (max !== undefined) result = Math.min(max, result);
  return result;
}

function toEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeSettings(input = {}) {
  const badge = String(input.badgeText == null ? "" : input.badgeText).trim().slice(0, 40);
  return {
    enabled: toBool(input.enabled, DEFAULTS.enabled),
    badgeText: badge || DEFAULTS.badgeText,
    moq: Math.max(1, toInt(input.moq, DEFAULTS.moq)),
    buyers: toEnum(input.buyers, ENUMS.buyers, DEFAULTS.buyers),
    showRetailPrice: toBool(input.showRetailPrice, DEFAULTS.showRetailPrice),
    vehicleOverflowRule: toEnum(input.vehicleOverflowRule, ENUMS.vehicleOverflowRule, DEFAULTS.vehicleOverflowRule),
    partialPaymentEnabled: toBool(input.partialPaymentEnabled, DEFAULTS.partialPaymentEnabled),
    lateFeePaisa: Math.max(0, toInt(input.lateFeePaisa, DEFAULTS.lateFeePaisa)),
    lateFeeType: toEnum(input.lateFeeType, ENUMS.lateFeeType, DEFAULTS.lateFeeType),
    graceDays: Math.max(0, toInt(input.graceDays, DEFAULTS.graceDays)),
    maxOpenInstallmentOrders: Math.max(0, toInt(input.maxOpenInstallmentOrders, DEFAULTS.maxOpenInstallmentOrders)),
    goodsReleaseRule: toEnum(input.goodsReleaseRule, ENUMS.goodsReleaseRule, DEFAULTS.goodsReleaseRule),
    installmentBuyers: toEnum(input.installmentBuyers, ENUMS.installmentBuyers, DEFAULTS.installmentBuyers),
    shippingInFirstInstallment: toBool(input.shippingInFirstInstallment, DEFAULTS.shippingInFirstInstallment),
    overdueAction: toEnum(input.overdueAction, ENUMS.overdueAction, DEFAULTS.overdueAction),
    overdueDays: Math.max(0, toInt(input.overdueDays, DEFAULTS.overdueDays)),
    refundType: toEnum(input.refundType, ENUMS.refundType, DEFAULTS.refundType),
    refundPercent: Math.min(100, Math.max(0, toInt(input.refundPercent, DEFAULTS.refundPercent))),
  };
}

module.exports = { DEFAULTS, ENUMS, defaultSettings, normalizeSettings };
