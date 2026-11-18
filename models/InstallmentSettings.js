const mongoose = require("mongoose");

const METHODS = ["flat_annual", "total_markup", "reducing"];

const applicantSchema = new mongoose.Schema(
  {
    requireNid: { type: Boolean, default: true },
    requireAddress: { type: Boolean, default: true },
    requireGuarantor: { type: Boolean, default: false },
    requireDocuments: { type: Boolean, default: false },
    documentTypes: { type: [String], default: ["nid_front", "nid_back"] },
    note: { type: String, default: "", trim: true, maxlength: 300 },
  },
  { _id: false }
);

const reviewSchema = new mongoose.Schema(
  {
    approvalRequired: { type: Boolean, default: true },
    autoRejectDays: { type: Number, default: 3, min: 0, max: 30 },
  },
  { _id: false }
);

const lateFeeSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["flat", "percent"], default: "flat" },
    amountPaisa: { type: Number, default: 0, min: 0 },
    percent: { type: Number, default: 0, min: 0, max: 100 },
    graceDays: { type: Number, default: 3, min: 0, max: 60 },
  },
  { _id: false }
);

// Category-level overrides; a rule with allowed=false hides the EMI card for
// every product in that category. Rate fields are optional (null = inherit).
const categoryRuleSchema = new mongoose.Schema(
  {
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true },
    allowed: { type: Boolean, default: null },
    method: { type: String, default: null },
    annualRatePct: { type: Number, default: null, min: 0 },
    markupPct: { type: Number, default: null, min: 0 },
    serviceChargePercent: { type: Number, default: null, min: 0 },
    serviceChargeFlatPaisa: { type: Number, default: null, min: 0 },
  },
  { _id: false }
);

const cardEmiSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    note: { type: String, default: "", trim: true, maxlength: 300 },
  },
  { _id: false }
);

// Private document vault retention. 0 keeps documents until the store
// deletes them; anything else is counted from the last application update.
const documentsSchema = new mongoose.Schema(
  {
    retentionDays: { type: Number, default: 180, min: 0, max: 3650 },
  },
  { _id: false }
);

// One row per store. Rates are plain percentages (12.5 = 12.5%), all money is
// integer paisa.
const installmentSettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    method: { type: String, enum: METHODS, default: "flat_annual" },
    annualRatePct: { type: Number, default: 0, min: 0, max: 1000 },
    markupPct: { type: Number, default: 0, min: 0, max: 1000 },
    maxAnnualRatePct: { type: Number, default: 36, min: 0, max: 1000 },
    serviceChargePercent: { type: Number, default: 0, min: 0, max: 100 },
    serviceChargeFlatPaisa: { type: Number, default: 0, min: 0 },
    minDownPaymentPercent: { type: Number, default: 0, min: 0, max: 99 },
    // true = sale price is the cash price, regular price the installment base
    cashPriceIsSalePrice: { type: Boolean, default: true },
    maxMonths: { type: Number, default: 60, min: 2, max: 60 },
    applicant: { type: applicantSchema, default: () => ({}) },
    review: { type: reviewSchema, default: () => ({}) },
    lateFee: { type: lateFeeSchema, default: () => ({}) },
    reminderDays: { type: [Number], default: [3] },
    categoryRules: { type: [categoryRuleSchema], default: [] },
    cardEmi: { type: cardEmiSchema, default: () => ({}) },
    documents: { type: documentsSchema, default: () => ({}) },
    terms: { type: String, default: "", trim: true, maxlength: 4000 },
  },
  { timestamps: true }
);

installmentSettingsSchema.plugin(require("../lib/tenantPlugin"));

module.exports = mongoose.model("InstallmentSettings", installmentSettingsSchema);
