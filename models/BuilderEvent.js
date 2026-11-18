const mongoose = require("mongoose");

// Minimal shopper-side configurator analytics: one row per choice or
// abandoned session. Kept deliberately narrow so the public endpoint stays
// cheap and no free-text ever reaches the collection.
const builderEventSchema = new mongoose.Schema(
  {
    template: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderTemplate", required: true },
    event: { type: String, enum: ["part_chosen", "build_abandoned"], required: true },
    slot: { type: String, default: "", trim: true, lowercase: true, maxlength: 40 },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    sessionId: { type: String, default: null },
    parts: { type: Number, default: 0, min: 0, max: 200 },
  },
  { timestamps: true }
);

builderEventSchema.plugin(require("../lib/tenantPlugin"));

builderEventSchema.index({ store: 1, template: 1, event: 1, createdAt: -1 });

module.exports = mongoose.model("BuilderEvent", builderEventSchema);
