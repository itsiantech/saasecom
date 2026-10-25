const mongoose = require("mongoose");

// Area shipping: district + thana/area + optional shipping class + price.
const shippingAreaSchema = new mongoose.Schema(
  {
    district: { type: String, default: "", trim: true },
    area: { type: String, default: "", trim: true },
    shippingClass: { type: mongoose.Schema.Types.ObjectId, ref: "ShippingClass", default: null },
    price: { type: Number, default: 0, min: 0 },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

shippingAreaSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("ShippingArea", shippingAreaSchema);
