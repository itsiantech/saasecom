const mongoose = require("mongoose");

// Snapshot of one installment at purchase time; later plan edits never touch it.
const orderInstallmentSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: "InstallmentPlan", default: null },
    planName: { type: String, default: "" },
    number: { type: Number, required: true, min: 1 },
    amountPaisa: { type: Number, required: true, min: 0 },
    paidPaisa: { type: Number, default: 0, min: 0 },
    dueDate: { type: Date, required: true },
    status: { type: String, enum: ["pending", "paid", "overdue", "cancelled"], default: "pending" },
    paidAt: { type: Date, default: null },
    lateFeePaisa: { type: Number, default: 0, min: 0 },
    remindersSent: {
      before: { type: Boolean, default: false },
      due: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

orderInstallmentSchema.plugin(require("../lib/tenantPlugin"));
orderInstallmentSchema.index({ order: 1, number: 1 }, { unique: true });
orderInstallmentSchema.index({ status: 1, dueDate: 1 });

module.exports = mongoose.model("OrderInstallment", orderInstallmentSchema);
