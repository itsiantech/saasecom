const mongoose = require("mongoose");

const supplierOrderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    productCode: { type: String, required: true, trim: true }, // Product.sku snapshot
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitCostPaisa: { type: Number, required: true, min: 0 },
    lineTotalPaisa: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const supplierOrderSchema = new mongoose.Schema(
  {
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    orderNo: { type: String, required: true, trim: true },
    orderDate: { type: Date, default: Date.now },
    items: { type: [supplierOrderItemSchema], default: [] },
    totalQty: { type: Number, required: true, min: 1 },
    totalAmountPaisa: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["ordered", "received", "cancelled"], default: "ordered" },
    receivedAt: { type: Date, default: null },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelReason: { type: String, default: "", trim: true, maxlength: 300 },
    stockApplied: { type: Boolean, default: false },
    stockMode: { type: String, enum: ["none", "auto", "reversed"], default: "none" },
    note: { type: String, default: "", trim: true, maxlength: 500 },
    source: { type: String, enum: ["manual", "ai-parsing"], default: "manual" },
    idempotencyKey: { type: String, default: "", trim: true, maxlength: 128 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

supplierOrderSchema.plugin(require("../lib/tenantPlugin"));

supplierOrderSchema.index({ store: 1, orderNo: 1 }, { unique: true });
supplierOrderSchema.index({ store: 1, supplier: 1, createdAt: -1 });
supplierOrderSchema.index({ store: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("SupplierOrder", supplierOrderSchema);
