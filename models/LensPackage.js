const mongoose = require("mongoose");

// Lens Selector step 3 — priced package. `typeIds` / `categoryIds` empty means
// "applies to all"; a non-empty list is the filter the storefront enforces and
// the add-to-cart guard re-checks. Price is paisa, like every other money field.
const lensPackageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    brand: { type: String, default: "", trim: true, maxlength: 80 },
    lensIndex: { type: String, default: "", trim: true, maxlength: 20 },
    badge: { type: String, default: "", trim: true, maxlength: 40 },
    description: { type: String, default: "", trim: true, maxlength: 400 },
    pricePaisa: { type: Number, required: true, min: 0 },
    typeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "LensType", default: [] }],
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "LensCategory", default: [] }],
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "lens_packages" }
);

lensPackageSchema.plugin(require("../lib/tenantPlugin"));
lensPackageSchema.index({ store: 1, name: 1, brand: 1 }, { unique: true });
lensPackageSchema.index({ store: 1, active: 1, sortOrder: 1 });

module.exports = mongoose.model("LensPackage", lensPackageSchema);
