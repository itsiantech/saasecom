const mongoose = require("mongoose");

// Append-only inventory ledger for everything that is not a supplier purchase.
// Supplier purchases stay in StockMovement, so that module is never touched.
const inventoryMovementSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    variation: { type: mongoose.Schema.Types.ObjectId, ref: "ProductVariation", default: null },
    swatch: { type: mongoose.Schema.Types.ObjectId, ref: "ProductSwatch", default: null },
    sku: { type: String, default: "", trim: true },
    productName: { type: String, default: "", trim: true },
    variantLabel: { type: String, default: "", trim: true },
    type: {
      type: String,
      enum: ["damage", "return", "adjustment", "transfer_out", "transfer_in"],
      required: true,
    },
    // quantity is the magnitude the admin entered; change is the signed effect
    // on product-level stock (transfers keep stock flat, so change stays 0).
    quantity: { type: Number, required: true, min: 0 },
    change: { type: Number, required: true },
    before: { type: Number, default: null },
    after: { type: Number, default: null },
    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", default: null },
    toWarehouse: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", default: null },
    reference: { type: String, default: "", trim: true, maxlength: 120 },
    note: { type: String, default: "", trim: true, maxlength: 300 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

inventoryMovementSchema.plugin(require("../lib/tenantPlugin"));

inventoryMovementSchema.index({ store: 1, createdAt: -1 });
inventoryMovementSchema.index({ store: 1, product: 1, createdAt: -1 });
inventoryMovementSchema.index({ store: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model("InventoryMovement", inventoryMovementSchema);
