const mongoose = require("mongoose");

// Product review — one document per rating. `store` + auto filtering comes from tenantPlugin.
const reviewSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Name is snapshotted so a later account change never rewrites an old review.
    customerName: { type: String, default: "", trim: true, maxlength: 120 },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, default: "", trim: true, maxlength: 120 },
    body: { type: String, default: "", trim: true, maxlength: 2000 },
    images: [{ type: String, default: [] }],
    status: { type: String, enum: ["pending", "published", "hidden"], default: "published" },
  },
  { timestamps: true }
);

reviewSchema.plugin(require("../lib/tenantPlugin"));

// product page reads published reviews newest-first; admin list filters by status
reviewSchema.index({ store: 1, product: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Review", reviewSchema);
