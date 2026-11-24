const mongoose = require("mongoose");

// Lens Selector step 1 — Single Vision / Progressive-Bifocal / Non-Prescription.
const lensTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Non-prescription skips the Rx step entirely.
    needsPrescription: { type: Boolean, default: true },
    note: { type: String, default: "", trim: true, maxlength: 200 },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "lens_types" }
);

lensTypeSchema.plugin(require("../lib/tenantPlugin"));
lensTypeSchema.index({ store: 1, name: 1 }, { unique: true });
lensTypeSchema.index({ store: 1, active: 1, sortOrder: 1 });

module.exports = mongoose.model("LensType", lensTypeSchema);
