const mongoose = require("mongoose");

// Store-scoped finance ledger for operating costs and capital.
// Rows are never deleted; voiding keeps the audit trail visible in Void & Cancel Logs.
const financeEntrySchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["office", "tech", "marketing", "salary", "investment"],
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    amountPaisa: { type: Number, required: true, min: 1 },
    entryDate: { type: Date, required: true, default: Date.now },
    method: {
      type: String,
      enum: ["cash", "bank", "bkash", "nagad", "other"],
      default: "cash",
    },
    reference: { type: String, default: "", trim: true, maxlength: 120 },
    note: { type: String, default: "", trim: true, maxlength: 300 },
    state: { type: String, enum: ["active", "void"], default: "active" },
    voidReason: { type: String, default: "", trim: true, maxlength: 300 },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

financeEntrySchema.plugin(require("../lib/tenantPlugin"));

financeEntrySchema.index({ store: 1, kind: 1, entryDate: -1 });
financeEntrySchema.index({ store: 1, entryDate: -1 });
financeEntrySchema.index({ store: 1, state: 1, entryDate: -1 });

module.exports = mongoose.model("FinanceEntry", financeEntrySchema);
