const mongoose = require("mongoose");

// Platform subscription payment (SaaS billing) — not a storefront order payment.
// Approval (superadmin click, or a verified PayGate webhook) is the only place a
// store gets created or upgraded.
const platformPaymentSchema = new mongoose.Schema(
  {
    invoiceNo: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", default: null },
    kind: { type: String, enum: ["new", "existing"], default: "new" },
    storeName: { type: String, required: true, trim: true, maxlength: 80 },
    storeSlug: { type: String, default: "", trim: true, lowercase: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },
    planName: { type: String, default: "" },
    planSlug: { type: String, default: "" },
    amount: { type: Number, required: true, min: 0 },
    // billing term chosen at checkout — price = plan monthly × months
    cycle: { type: String, default: "1m" },
    months: { type: Number, default: 1 },
    durationDays: { type: Number, default: 30 },
    method: { type: String, enum: ["bkash", "nagad", "bank", "qr", "paygate"], required: true },
    methodLabel: { type: String, default: "" },
    // "paygate" = hosted bKash/Nagad checkout, approved automatically once
    // PayGate has matched the payment SMS. Manual rows leave it empty.
    gateway: { type: String, enum: ["", "paygate"], default: "" },
    paygateId: { type: String, default: "", index: true },
    paygateCheckoutUrl: { type: String, default: "" },
    paygateStatus: { type: String, default: "" },
    paygateDeviceType: { type: String, enum: ["", "bkash", "nagad"], default: "" },
    paygatePaidAt: { type: Date, default: null },
    // evt_ id of the success event that settled this row — proof of which
    // delivery approved it when PayGate retries the same payment.
    paygateEventId: { type: String, default: "", index: true },
    senderNumber: { type: String, default: "", trim: true },
    trxid: { type: String, default: "", trim: true, maxlength: 40 },
    // method:trxid lowercase — unique index stops the same transaction being claimed twice.
    // Rejecting a payment unsets it, so a corrected claim can reuse the TRXID.
    trxKey: { type: String, unique: true, sparse: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    rejectReason: { type: String, default: "", maxlength: 300 },
    nextDueDate: { type: Date, default: null },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    slugAdjusted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

platformPaymentSchema.index({ status: 1, createdAt: -1 });
platformPaymentSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model("PlatformPayment", platformPaymentSchema);
