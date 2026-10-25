const mongoose = require("mongoose");
const { DEFAULTS } = require("../lib/internationalDefaults");

const deliveryRangeSchema = new mongoose.Schema(
  {
    label: { type: String, default: "", trim: true, maxlength: 80 },
    minDays: { type: Number, default: 0, min: 0 },
    maxDays: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

// One document per store: master switch + global import rules.
const internationalSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: DEFAULTS.enabled },
    advancePercent: { type: Number, default: DEFAULTS.advancePercent, min: 0, max: 100 },
    codPercent: { type: Number, default: DEFAULTS.codPercent, min: 0, max: 100 },
    air: { type: deliveryRangeSchema, default: () => ({ ...DEFAULTS.air }) },
    sea: { type: deliveryRangeSchema, default: () => ({ ...DEFAULTS.sea }) },
    labels: {
      shippingCharge: {
        type: String,
        default: DEFAULTS.labels.shippingCharge,
        trim: true,
        maxlength: 80,
      },
      chinaCourier: {
        type: String,
        default: DEFAULTS.labels.chinaCourier,
        trim: true,
        maxlength: 80,
      },
    },
  },
  { timestamps: true }
);

internationalSettingsSchema.pre("validate", function () {
  const percentTotal = Math.round((this.advancePercent + this.codPercent) * 100) / 100;
  if (percentTotal !== 100) {
    this.invalidate("codPercent", "Advance + COD percentage must equal 100");
  }
  for (const mode of ["air", "sea"]) {
    const rule = this[mode];
    if (rule && rule.maxDays < rule.minDays) {
      this.invalidate(`${mode}.maxDays`, "Delivery max days must be >= min days");
    }
  }
});

internationalSettingsSchema.plugin(require("../lib/tenantPlugin"));

module.exports = mongoose.model("InternationalSettings", internationalSettingsSchema);
