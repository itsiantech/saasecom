const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, unique: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },
    status: { type: String, enum: ["active", "trial", "expired", "cancelled"], default: "trial" },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    trialEndsAt: { type: Date, default: null },
    autoRenew: { type: Boolean, default: true },
    lastPaymentAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

subscriptionSchema.index({ status: 1, endDate: 1 });

module.exports = mongoose.model("Subscription", subscriptionSchema);
