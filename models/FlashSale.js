const mongoose = require("mongoose");

// A timed campaign. Products are targeted directly or through a category
// (selected category + every descendant at save time).
const flashSaleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    targetType: { type: String, enum: ["product", "category"], default: "product" },
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product", default: [] }],
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category", default: [] }],
    // `categories` keeps the admin's selection; categoryIds is the expanded
    // subtree so pricing can match a product category with one array check.
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category", default: [] }],
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
  },
  { timestamps: true }
);

flashSaleSchema.plugin(require("../lib/tenantPlugin"));

flashSaleSchema.index({ store: 1, startAt: 1, endAt: 1 });
flashSaleSchema.index({ store: 1, targetType: 1 });

module.exports = mongoose.model("FlashSale", flashSaleSchema);
