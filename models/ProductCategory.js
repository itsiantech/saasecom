const mongoose = require("mongoose");

// Many-to-many between products and categories.
const productCategorySchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
  },
  { timestamps: true }
);

productCategorySchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("ProductCategory", productCategorySchema);
