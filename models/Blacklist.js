const mongoose = require("mongoose");

// Checkout blocklist — phone / address / IP. Entries reject matching orders
// with a generic polite message; every change is audited.
const blacklistSchema = new mongoose.Schema(
  {
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    type: { type: String, enum: ["phone", "address", "ip"], required: true },
    value: { type: String, required: true, trim: true },
    reason: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

blacklistSchema.index({ store: 1, type: 1, value: 1 }, { unique: true });

module.exports = mongoose.model("Blacklist", blacklistSchema);