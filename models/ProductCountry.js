const mongoose = require("mongoose");

// Countries a product ships to when international mode is on (one row per product+country).
const productCountrySchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    countryCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 2 },
  },
  { timestamps: true }
);

productCountrySchema.index({ product: 1, countryCode: 1 }, { unique: true });
productCountrySchema.plugin(require("../lib/tenantPlugin"));

module.exports = mongoose.model("ProductCountry", productCountrySchema);
