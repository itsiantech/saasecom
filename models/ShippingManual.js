const mongoose = require("mongoose");

// Manual shipping: simple area -> charge rows.
const shippingManualSchema = new mongoose.Schema(
  {
    areaName: { type: String, required: true, trim: true },
    amount: { type: Number, default: 0, min: 0 },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

shippingManualSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("ShippingManual", shippingManualSchema);
