const mongoose = require("mongoose");

// One row per payment attempt; manual methods stay pending until an admin verifies.
const paymentSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    installment: { type: mongoose.Schema.Types.ObjectId, ref: "OrderInstallment", default: null },
    method: { type: String, required: true, trim: true }, // cod | mobile | bank | gateway | manual
    methodLabel: { type: String, default: "" },
    senderNumber: { type: String, default: "" },
    trxId: { type: String, default: "", trim: true, maxlength: 120 },
    amountPaisa: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["pending", "verified", "rejected", "refunded"], default: "pending" },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    verifiedAt: { type: Date, default: null },
    note: { type: String, default: "", trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

paymentSchema.plugin(require("../lib/tenantPlugin"));
paymentSchema.index({ installment: 1 });

module.exports = mongoose.model("Payment", paymentSchema);
