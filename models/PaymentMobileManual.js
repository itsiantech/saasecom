const mongoose = require("mongoose");

// Manual mobile banking rows (bKash / Nagad / Upay / custom).
const paymentMobileManualSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    accountType: { type: String, enum: ["Personal", "Agent", "Merchant"], default: "Personal" },
    number: { type: String, default: "", trim: true },
    instruction: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

paymentMobileManualSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("PaymentMobileManual", paymentMobileManualSchema);
