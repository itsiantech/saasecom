const mongoose = require("mongoose");

// ---- a build the shopper saved / shared ----
// Selections are snapshotted (title/image/price) so a shared link still renders
// after a product is renamed; the cart endpoint re-reads live products anyway.
const savedSelectionSchema = new mongoose.Schema(
  {
    slot: { type: String, required: true, trim: true, lowercase: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, default: 1, min: 1, max: 20 },
    title: { type: String, default: "", trim: true },
    image: { type: String, default: "" },
    price: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const savedBuildSchema = new mongoose.Schema(
  {
    template: { type: mongoose.Schema.Types.ObjectId, ref: "BuilderTemplate", required: true },
    // public share key; unique inside the store, not globally
    token: { type: String, required: true, trim: true, maxlength: 40 },
    name: { type: String, default: "", trim: true, maxlength: 120 },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    sessionId: { type: String, default: null }, // guest builds
    selections: { type: [savedSelectionSchema], default: [] },
    subtotal: { type: Number, default: 0, min: 0 },
    // block-level rule messages captured at save time (quotes/analytics)
    violations: {
      type: [{ rule: String, level: String, message: String, messageBn: String }],
      default: [],
    },
  },
  { timestamps: true }
);

savedBuildSchema.plugin(require("../lib/tenantPlugin"));

savedBuildSchema.index({ store: 1, token: 1 }, { unique: true });
savedBuildSchema.index({ store: 1, template: 1, createdAt: -1 });

module.exports = mongoose.model("SavedBuild", savedBuildSchema);
