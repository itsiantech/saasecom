const mongoose = require("mongoose");

// International shipping rules: country + category + order price range.
const shippingInternationalSchema = new mongoose.Schema(
  {
    country: { type: String, default: "", trim: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null }, // null = all
    minOrder: { type: Number, default: null },
    maxOrder: { type: Number, default: null },
    price: { type: Number, default: 0, min: 0 },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

shippingInternationalSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("ShippingInternational", shippingInternationalSchema);
