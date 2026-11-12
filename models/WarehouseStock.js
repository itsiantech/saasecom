const mongoose = require("mongoose");

// Stock held in a non-default warehouse. The default warehouse balance is
// derived as target stock minus every allocation row, so the total can never
// drift away from Product / ProductVariation / ProductSwatch.stock.
const warehouseStockSchema = new mongoose.Schema(
  {
    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: "Warehouse", required: true, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    variation: { type: mongoose.Schema.Types.ObjectId, ref: "ProductVariation", default: null },
    swatch: { type: mongoose.Schema.Types.ObjectId, ref: "ProductSwatch", default: null },
    quantity: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

warehouseStockSchema.plugin(require("../lib/tenantPlugin"));

warehouseStockSchema.index(
  { store: 1, warehouse: 1, product: 1, variation: 1, swatch: 1 },
  { unique: true }
);
warehouseStockSchema.index({ store: 1, product: 1 });

module.exports = mongoose.model("WarehouseStock", warehouseStockSchema);
