const mongoose = require("mongoose");

// Append-only supplier stock ledger. Never update or delete these rows.
const stockMovementSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierOrder", default: null },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierInvoice", default: null },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    change: { type: Number, required: true },
    stockAfter: { type: Number, default: null },
    mode: { type: String, enum: ["auto", "manual", "reversal"], required: true },
    reason: { type: String, default: "", trim: true, maxlength: 300 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

stockMovementSchema.plugin(require("../lib/tenantPlugin"));

stockMovementSchema.index({ store: 1, supplier: 1, createdAt: -1 });
stockMovementSchema.index({ store: 1, product: 1, createdAt: -1 });
stockMovementSchema.index({ store: 1, order: 1 });

module.exports = mongoose.model("StockMovement", stockMovementSchema);
