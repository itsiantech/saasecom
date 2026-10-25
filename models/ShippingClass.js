const mongoose = require("mongoose");

// Reusable shipping classes, e.g. "Free shipping" = 0.
const shippingClassSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    cost: { type: Number, default: 0, min: 0 },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

shippingClassSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("ShippingClass", shippingClassSchema);
