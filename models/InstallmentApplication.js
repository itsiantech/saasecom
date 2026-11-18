const mongoose = require("mongoose");

const applicantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 160 },
    // NID never stored in plaintext; secretBox ciphertext only.
    nidEnc: { type: String, default: "" },
    address: { type: String, default: "", trim: true, maxlength: 400 },
    guarantorName: { type: String, default: "", trim: true, maxlength: 120 },
    guarantorPhone: { type: String, default: "", trim: true, maxlength: 20 },
    guarantorRelation: { type: String, default: "", trim: true, maxlength: 60 },
    note: { type: String, default: "", trim: true, maxlength: 500 },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    type: { type: String, default: "other", trim: true, maxlength: 40 },
    path: { type: String, default: "" }, // private storage key, never a public URL
    mime: { type: String, default: "" },
    sizeBytes: { type: Number, default: 0 },
    encrypted: { type: Boolean, default: false },
    uploadedAt: { type: Date, default: Date.now },
    purgedAt: { type: Date, default: null },
  },
  { _id: false }
);

const itemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    variation: { type: mongoose.Schema.Types.ObjectId, ref: "ProductVariation", default: null },
    title: { type: String, default: "", trim: true, maxlength: 200 },
    slug: { type: String, default: "", trim: true, maxlength: 200 },
    image: { type: String, default: "" },
    quantity: { type: Number, default: 1, min: 1 },
    unitBasePaisa: { type: Number, default: 0, min: 0 },
    lineBasePaisa: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const reviewSchema = new mongoose.Schema(
  {
    note: { type: String, default: "", trim: true, maxlength: 1000 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    infoRequest: { type: String, default: "", trim: true, maxlength: 1000 },
  },
  { _id: false }
);

// One EMI application. Approval converts it into a normal Order (paymentMode
// "installment") plus the existing OrderInstallment rows, so payments,
// reminders and late fees reuse the shipped wholesale machinery.
const installmentApplicationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    number: { type: String, default: "", trim: true },
    applicant: { type: applicantSchema, required: true },
    documents: { type: [documentSchema], default: [] },
    items: { type: [itemSchema], default: [] },
    buildId: { type: mongoose.Schema.Types.ObjectId, default: null },
    cashPaisa: { type: Number, default: 0, min: 0 },
    basePaisa: { type: Number, default: 0, min: 0 },
    offer: { type: mongoose.Schema.Types.ObjectId, ref: "InstallmentOffer", default: null },
    offerSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    // authoritative engine output at submission time (see services/installmentPricing)
    quote: { type: mongoose.Schema.Types.Mixed, default: null },
    status: {
      type: String,
      enum: ["pending_review", "info_requested", "approved", "rejected", "cancelled", "expired", "completed"],
      default: "pending_review",
    },
    review: { type: reviewSchema, default: () => ({}) },
    stockReserved: { type: Boolean, default: false },
    stockReleased: { type: Boolean, default: false },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },
    termsAcceptedAt: { type: Date, default: null },
    idempotencyKey: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

installmentApplicationSchema.plugin(require("../lib/tenantPlugin"));
installmentApplicationSchema.index({ store: 1, status: 1, createdAt: -1 });
installmentApplicationSchema.index(
  { store: 1, number: 1 },
  { unique: true, partialFilterExpression: { number: { $gt: "" } } }
);
installmentApplicationSchema.index(
  { store: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $gt: "" } } }
);

module.exports = mongoose.model("InstallmentApplication", installmentApplicationSchema);
