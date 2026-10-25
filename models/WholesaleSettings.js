const mongoose = require("mongoose");
const { DEFAULTS } = require("../lib/wholesaleDefaults");

// One document per store (singleton enforced with _id = store id in the controller).
const wholesaleSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: DEFAULTS.enabled },
    badgeText: { type: String, default: DEFAULTS.badgeText, trim: true, maxlength: 40 },
    moq: { type: Number, default: DEFAULTS.moq, min: 1 },
    buyers: { type: String, enum: ["all", "approved"], default: DEFAULTS.buyers },
    showRetailPrice: { type: Boolean, default: DEFAULTS.showRetailPrice },
    vehicleOverflowRule: { type: String, enum: ["cheapest", "largest_first"], default: DEFAULTS.vehicleOverflowRule },

    partialPaymentEnabled: { type: Boolean, default: DEFAULTS.partialPaymentEnabled },
    lateFeePaisa: { type: Number, default: DEFAULTS.lateFeePaisa, min: 0 },
    lateFeeType: { type: String, enum: ["flat", "percent"], default: DEFAULTS.lateFeeType },
    graceDays: { type: Number, default: DEFAULTS.graceDays, min: 0 },
    maxOpenInstallmentOrders: { type: Number, default: DEFAULTS.maxOpenInstallmentOrders, min: 0 },
    goodsReleaseRule: {
      type: String,
      enum: ["after_advance", "after_half", "after_full"],
      default: DEFAULTS.goodsReleaseRule,
    },
    installmentBuyers: { type: String, enum: ["approved", "all"], default: DEFAULTS.installmentBuyers },
    shippingInFirstInstallment: { type: Boolean, default: DEFAULTS.shippingInFirstInstallment },
    overdueAction: { type: String, enum: ["hold", "cancel"], default: DEFAULTS.overdueAction },
    overdueDays: { type: Number, default: DEFAULTS.overdueDays, min: 0 },
    refundType: { type: String, enum: ["full", "percent", "none"], default: DEFAULTS.refundType },
    refundPercent: { type: Number, default: DEFAULTS.refundPercent, min: 0, max: 100 },
  },
  { timestamps: true }
);

wholesaleSettingsSchema.plugin(require("../lib/tenantPlugin"));

module.exports = mongoose.model("WholesaleSettings", wholesaleSettingsSchema);
