const mongoose = require("mongoose");

const productPriceTierSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    variation: { type: mongoose.Schema.Types.ObjectId, ref: "ProductVariation", default: null },
    minQty: { type: Number, required: true, min: 1 },
    maxQty: { type: Number, default: null, min: 1 }, // null = no upper limit
    pricePaisa: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

productPriceTierSchema.plugin(require("../lib/tenantPlugin"));
productPriceTierSchema.index({ product: 1, variation: 1, minQty: 1 });

module.exports = mongoose.model("ProductPriceTier", productPriceTierSchema);
