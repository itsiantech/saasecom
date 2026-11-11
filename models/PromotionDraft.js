const mongoose = require("mongoose");

// Coupon/flash-sale drafts live apart from the live collections so storefront
// pricing and the coupon-code unique index never see them.
const promotionDraftSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["coupon", "flash-sale"], required: true },
    draftKey: { type: String, required: true, trim: true, maxlength: 128 },
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

promotionDraftSchema.plugin(require("../lib/tenantPlugin"));

promotionDraftSchema.index({ store: 1, kind: 1, draftKey: 1 }, { unique: true });
promotionDraftSchema.index({ store: 1, kind: 1, updatedAt: -1 });

module.exports = mongoose.model("PromotionDraft", promotionDraftSchema);