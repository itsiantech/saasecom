const mongoose = require("mongoose");

const installmentPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    installmentsCount: { type: Number, required: true, min: 2, max: 60 },
    // percent = advanceValue is basis points (4000 = 40%); fixed = paisa
    advanceType: { type: String, enum: ["percent", "fixed"], required: true },
    advanceValue: { type: Number, required: true, min: 0 },
    gapDays: { type: Number, default: 0, min: 0, max: 365 },
    minOrderAmountPaisa: { type: Number, default: 0, min: 0 },
    feeType: { type: String, enum: ["none", "percent", "fixed"], default: "none" },
    feeValue: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

installmentPlanSchema.plugin(require("../lib/tenantPlugin"));

module.exports = mongoose.model("InstallmentPlan", installmentPlanSchema);
