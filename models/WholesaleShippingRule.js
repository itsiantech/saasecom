const mongoose = require("mongoose");

// Wholesale shipping charge for one product category.
const wholesaleShippingRuleSchema = new mongoose.Schema(
  {
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    chargeType: { type: String, enum: ["per_piece", "per_kg", "flat"], required: true },
    ratePaisa: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

wholesaleShippingRuleSchema.plugin(require("../lib/tenantPlugin"));
wholesaleShippingRuleSchema.index({ store: 1, category: 1 }, { unique: true });

module.exports = mongoose.model("WholesaleShippingRule", wholesaleShippingRuleSchema);
