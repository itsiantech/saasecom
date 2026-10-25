const mongoose = require("mongoose");

const supplierInvoiceLineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productCode: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitCostPaisa: { type: Number, required: true, min: 0 },
    lineTotalPaisa: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const supplierInvoiceSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "SupplierOrder", required: true },
    invoiceNo: { type: String, required: true, trim: true },
    issueDate: { type: Date, required: true, default: Date.now },
    lines: { type: [supplierInvoiceLineSchema], default: [] },
    totalAmountPaisa: { type: Number, required: true, min: 0 },
    paidAmountPaisa: { type: Number, required: true, min: 0, default: 0 },
    holdFlag: { type: Boolean, default: false },
    holdReason: { type: String, default: "", trim: true, maxlength: 300 },
    state: { type: String, enum: ["active", "void"], default: "active" },
    voidReason: { type: String, default: "", trim: true, maxlength: 300 },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

supplierInvoiceSchema.plugin(require("../lib/tenantPlugin"));

supplierInvoiceSchema.index({ store: 1, invoiceNo: 1 }, { unique: true });
supplierInvoiceSchema.index({ store: 1, order: 1 }, { unique: true });
supplierInvoiceSchema.index({ store: 1, supplier: 1, issueDate: -1 });
supplierInvoiceSchema.index({ store: 1, issueDate: -1 });
supplierInvoiceSchema.index({ store: 1, state: 1, issueDate: -1 });

module.exports = mongoose.model("SupplierInvoice", supplierInvoiceSchema);
