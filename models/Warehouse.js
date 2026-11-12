const mongoose = require("mongoose");

const warehouseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    address: { type: String, default: "", trim: true, maxlength: 300 },
    isDefault: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

warehouseSchema.plugin(require("../lib/tenantPlugin"));

warehouseSchema.index({ store: 1, name: 1 }, { unique: true });
// only one default warehouse per store
warehouseSchema.index(
  { store: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);

module.exports = mongoose.model("Warehouse", warehouseSchema);
