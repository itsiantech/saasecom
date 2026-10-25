const mongoose = require("mongoose");

// An image swatch: a selectable "look" under one product, with its own price/stock
// and a gallery of images (the first image is used in the cart).
const productSwatchSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, default: "" },
    price: { type: Number, default: 0 },
    stock: { type: Number, default: 0 },
    images: [{ type: String, default: [] }],
  },
  { timestamps: true }
);

productSwatchSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("ProductSwatch", productSwatchSchema);
