const mongoose = require("mongoose");

// Manual bank transfer rows.
const paymentBankManualSchema = new mongoose.Schema(
  {
    bankName: { type: String, required: true, trim: true },
    accountName: { type: String, default: "", trim: true },
    accountNumber: { type: String, default: "", trim: true },
    branch: { type: String, default: "", trim: true },
    instruction: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

paymentBankManualSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("PaymentBankManual", paymentBankManualSchema);
