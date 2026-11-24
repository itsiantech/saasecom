const mongoose = require("mongoose");

// Lens Selector step 2 — Blue Light, Photochromic, Driving…
// `typeIds` empty = shown for every type.
const lensCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    typeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "LensType", default: [] }],
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "lens_categories" }
);

lensCategorySchema.plugin(require("../lib/tenantPlugin"));
lensCategorySchema.index({ store: 1, name: 1 }, { unique: true });
lensCategorySchema.index({ store: 1, active: 1, sortOrder: 1 });

module.exports = mongoose.model("LensCategory", lensCategorySchema);
