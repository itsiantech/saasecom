const mongoose = require("mongoose");

// One row per status change: order_id, from, to, who, when.
// Written by services/orderStatusChange.js — never edited directly.
const orderStatusHistorySchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    fromStatus: { type: String, default: "" },
    toStatus: { type: String, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, default: "" },
    note: { type: String, default: "", maxlength: 300 },
  },
  { timestamps: true }
);

orderStatusHistorySchema.plugin(require("../lib/tenantPlugin"));
orderStatusHistorySchema.index({ order: 1, createdAt: -1 });

module.exports = mongoose.model("OrderStatusHistory", orderStatusHistorySchema);
