const mongoose = require("mongoose");

/* One row per email per billing cycle. The unique key is what makes the daily
 * cron idempotent: a row is claimed before the job is queued, so a second run
 * (or two overlapping runs) can never mail the same tenant twice for the same
 * cycle. Rows are also the audit trail of what was sent. */
const billingNotificationSchema = new mongoose.Schema(
  {
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    subscription: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", required: true },
    kind: {
      type: String,
      enum: ["trial_warning_3d", "trial_warning_1d", "invoice", "overdue", "suspend", "broadcast"],
      required: true,
    },
    // trial:<ends-at date>:3d / invoice:<billing date> / overdue:<billing date>:3d ...
    cycleKey: { type: String, required: true },
    to: { type: String, default: "" },
    subject: { type: String, default: "" },
    status: { type: String, enum: ["queued", "sent", "skipped", "failed", "deferred"], default: "queued" },
    jobId: { type: String, default: "" },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    sentAt: { type: Date, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

billingNotificationSchema.index({ subscription: 1, kind: 1, cycleKey: 1 }, { unique: true });
billingNotificationSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("BillingNotification", billingNotificationSchema);
