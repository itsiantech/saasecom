const mongoose = require("mongoose");

// Retail EMI plan ("3 মাস", "6 মাস" ...). Separate from InstallmentPlan, which
// belongs to the wholesale partial-payment flow. Null overrides fall back to
// InstallmentSettings so a store can price every plan the same way.
const installmentOfferSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    months: { type: Number, required: true, min: 2, max: 60 },
    // minimum down payment for this plan, percent of the product base
    downPaymentPercent: { type: Number, default: 0, min: 0, max: 99 },
    method: { type: String, default: null },
    annualRatePct: { type: Number, default: null, min: 0 },
    markupPct: { type: Number, default: null, min: 0 },
    serviceChargePercent: { type: Number, default: null, min: 0 },
    serviceChargeFlatPaisa: { type: Number, default: null, min: 0 },
    // 0 = no per-plan floor
    minProductPricePaisa: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

installmentOfferSchema.plugin(require("../lib/tenantPlugin"));
installmentOfferSchema.index({ store: 1, isActive: 1, sortOrder: 1 });

module.exports = mongoose.model("InstallmentOffer", installmentOfferSchema);
