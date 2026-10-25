const mongoose = require("mongoose");

// One purchasable combination of attribute terms, with its OWN price/stock/image.
const productVariationSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    attribute: { type: mongoose.Schema.Types.ObjectId, ref: "Attribute", default: null },
    term: { type: mongoose.Schema.Types.ObjectId, ref: "AttributeTerm", default: null },
    attributeName: { type: String, default: "" }, // denormalized for display
    termName: { type: String, default: "" },
    image: { type: String, default: "" },
    regularPrice: { type: Number, default: 0 },
    salePrice: { type: Number, default: 0 },
    stock: { type: Number, default: 0 },
  },
  { timestamps: true }
);

productVariationSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("ProductVariation", productVariationSchema);
