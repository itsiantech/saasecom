const mongoose = require("mongoose");

// Weight & dimension rules. First matching rule wins at checkout.
const shippingWeightDimensionSchema = new mongoose.Schema(
  {
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null }, // null = all
    area: { type: String, default: "", trim: true },
    minWeight: { type: Number, default: 0 },
    maxWeight: { type: Number, default: null },
    length: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    price: { type: Number, default: 0, min: 0 },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

shippingWeightDimensionSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("ShippingWeightDimension", shippingWeightDimensionSchema);
