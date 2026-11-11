const mongoose = require("mongoose");

const supplierSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: function () {
        return this.state !== "draft";
      },
      trim: true,
      maxlength: 120,
    },
    companyName: { type: String, default: "", trim: true, maxlength: 160 },
    address: { type: String, default: "", trim: true, maxlength: 300 },
    phone: {
      type: String,
      required: function () {
        return this.state !== "draft";
      },
      trim: true,
      maxlength: 20,
    },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 160 },
    note: { type: String, default: "", trim: true, maxlength: 500 },
    state: { type: String, enum: ["active", "void", "trashed", "draft"], default: "active" },
    draftKey: { type: String, default: "", trim: true, maxlength: 128 },
    draftOf: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null },
    voidReason: { type: String, default: "", trim: true, maxlength: 300 },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null },
    trashedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

supplierSchema.plugin(require("../lib/tenantPlugin"));

// One active supplier per phone inside a store. Void/trashed rows keep history.
supplierSchema.index(
  { store: 1, phone: 1 },
  { unique: true, partialFilterExpression: { state: "active" }, name: "supplier_active_phone" }
);
// Autosave upserts one draft row per client form session (draftKey).
supplierSchema.index(
  { store: 1, draftKey: 1 },
  { unique: true, partialFilterExpression: { state: "draft" }, name: "supplier_draft_key" }
);
supplierSchema.index({ store: 1, state: 1, updatedAt: -1 });
supplierSchema.index({ store: 1, name: 1 });

module.exports = mongoose.model("Supplier", supplierSchema);
