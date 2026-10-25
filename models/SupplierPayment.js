const mongoose = require("mongoose");

const supplierPaymentSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierInvoice", required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierOrder", required: true },
    amountPaisa: { type: Number, required: true, min: 1 },
    method: {
      type: String,
      enum: ["cash", "bank", "bkash", "nagad", "other"],
      default: "cash",
    },
    reference: { type: String, default: "", trim: true, maxlength: 120 },
    paidAt: { type: Date, required: true, default: Date.now },
    note: { type: String, default: "", trim: true, maxlength: 300 },
    state: { type: String, enum: ["active", "void"], default: "active" },
    voidReason: { type: String, default: "", trim: true, maxlength: 300 },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

supplierPaymentSchema.plugin(require("../lib/tenantPlugin"));

supplierPaymentSchema.index({ store: 1, supplier: 1, paidAt: -1 });
supplierPaymentSchema.index({ store: 1, invoice: 1, createdAt: -1 });

module.exports = mongoose.model("SupplierPayment", supplierPaymentSchema);
