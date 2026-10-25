const mongoose = require("mongoose");

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    discountType: { type: String, enum: ["percent", "fixed"], default: "percent" },
    discountValue: { type: Number, default: 0, min: 0 },
    minOrderAmount: { type: Number, default: 0, min: 0 }, // taka
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    // No product/category selected = applies to every product in the store.
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product", default: [] }],
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category", default: [] }],
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category", default: [] }],
    freeDelivery: { type: Boolean, default: false },
  },
  { timestamps: true }
);

couponSchema.plugin(require("../lib/tenantPlugin"));

couponSchema.index({ store: 1, code: 1 }, { unique: true });
couponSchema.index({ store: 1, startAt: 1, endAt: 1 });

module.exports = mongoose.model("Coupon", couponSchema);
