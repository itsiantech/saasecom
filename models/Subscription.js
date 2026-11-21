const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, unique: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },
    // "trial" is kept for existing rows; "trialing" is the new billing-reminder
    // alias. past_due/suspended drive the automated reminder ladder.
    status: {
      type: String,
      enum: ["active", "trial", "trialing", "past_due", "suspended", "expired", "cancelled"],
      default: "trial",
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    trialEndsAt: { type: Date, default: null },
    // Next invoice date: trial end while trialing, else the paid period end.
    nextBillingDate: { type: Date, default: null },
    // Same-day dedupe marker for the daily reminder pass.
    lastNotifiedAt: { type: Date, default: null },
    // set when the billing cron auto-suspends the store, so an approved
    // payment can lift exactly that suspension again
    billingSuspendedAt: { type: Date, default: null },
    // per-store grace after the due date; null = platform default
    graceDaysOverride: { type: Number, default: null, min: 0, max: 90 },
    // "" = not suspended, "payment" = deadline passed, "manual" = super admin
    suspendReason: { type: String, enum: ["", "payment", "manual"], default: "" },
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    autoRenew: { type: Boolean, default: true },
    lastPaymentAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

subscriptionSchema.index({ status: 1, endDate: 1 });
// daily billing-reminder scan
subscriptionSchema.index({ status: 1, nextBillingDate: 1 });

module.exports = mongoose.model("Subscription", subscriptionSchema);
