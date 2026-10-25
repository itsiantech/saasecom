const mongoose = require("mongoose");

// Checkout form er per-field config (show / required / label).
const checkoutFieldSchema = new mongoose.Schema(
  {
    fieldKey: {
      type: String,
      required: true,
      enum: ["name", "phone", "email", "address", "thana", "district", "division", "postCode", "country"],
    },
    isShown: { type: Boolean, default: true },
    isRequired: { type: Boolean, default: false },
    label: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

checkoutFieldSchema.index({ store: 1, fieldKey: 1 }, { unique: true });
checkoutFieldSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("CheckoutField", checkoutFieldSchema);
