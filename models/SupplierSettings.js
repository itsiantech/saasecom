const mongoose = require("mongoose");

// One document per store; the service stores it with _id = store id.
const supplierSettingsSchema = new mongoose.Schema(
  {
    autoAdjustStock: { type: Boolean, default: false },
    maxOrderQty: { type: Number, default: 10000, min: 1, max: 1000000 },
    timezone: { type: String, default: "Asia/Dhaka", trim: true, maxlength: 60 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, collection: "supplier_settings" }
);

supplierSettingsSchema.plugin(require("../lib/tenantPlugin"));

module.exports = mongoose.model("SupplierSettings", supplierSettingsSchema);
