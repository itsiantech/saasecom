const mongoose = require("mongoose");

// ---- configured PC/product builder template ----
// A template is a set of slots (cpu, motherboard, gpu …) plus declarative
// compatibility rules. Rules never run code — lib/builderRules.js interprets
// them server-side.

const groupSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, default: "", trim: true },
    nameBn: { type: String, default: "", trim: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: false }
);

// which catalog products a slot may offer; empty dimension = no restriction
const slotFilterSchema = new mongoose.Schema(
  {
    categories: { type: [mongoose.Schema.Types.ObjectId], ref: "Category", default: [] },
    brands: { type: [mongoose.Schema.Types.ObjectId], ref: "Brand", default: [] },
    tags: { type: [mongoose.Schema.Types.ObjectId], ref: "Tag", default: [] },
    products: { type: [mongoose.Schema.Types.ObjectId], ref: "Product", default: [] },
  },
  { _id: false }
);

const slotSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, default: "", trim: true },
    labelBn: { type: String, default: "", trim: true },
    group: { type: String, default: "", trim: true, lowercase: true },
    required: { type: Boolean, default: false },
    maxQty: { type: Number, default: 1, min: 1, max: 20 },
    sortOrder: { type: Number, default: 0 },
    hint: { type: String, default: "", trim: true },
    hintBn: { type: String, default: "", trim: true },
    filter: { type: slotFilterSchema, default: () => ({}) },
  },
  { _id: false }
);

// operand either points at a slot's product spec or holds a literal (right side only)
const ruleTermSchema = new mongoose.Schema(
  {
    slot: { type: String, required: true, trim: true, lowercase: true },
    spec: { type: String, required: true, trim: true },
    multiplier: { type: Number, default: 1, min: 0.1, max: 20 },
  },
  { _id: false }
);

const ruleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["equals", "in", "includes", "lte", "gte", "sum-lte", "set-membership"],
      required: true,
    },
    level: { type: String, enum: ["block", "warn"], default: "block" },
    message: { type: String, default: "", trim: true, maxlength: 300 },
    messageBn: { type: String, default: "", trim: true, maxlength: 300 },
    left: {
      slot: { type: String, default: "", trim: true, lowercase: true },
      spec: { type: String, default: "", trim: true },
    },
    right: {
      slot: { type: String, default: "", trim: true, lowercase: true },
      spec: { type: String, default: "", trim: true },
    },
    value: { type: mongoose.Schema.Types.Mixed, default: undefined },
    terms: { type: [ruleTermSchema], default: [] },
    limit: { type: Number, default: null },
  },
  { _id: false }
);

const builderTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 62 },
    description: { type: String, default: "", trim: true, maxlength: 500 },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
    groups: { type: [groupSchema], default: [] },
    slots: { type: [slotSchema], default: [] },
    rules: { type: [ruleSchema], default: [] },
    settings: {
      showTotal: { type: Boolean, default: true },
      stickyBar: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

builderTemplateSchema.plugin(require("../lib/tenantPlugin"));

builderTemplateSchema.index({ store: 1, slug: 1 }, { unique: true });
builderTemplateSchema.index({ store: 1, status: 1 });

module.exports = mongoose.model("BuilderTemplate", builderTemplateSchema);
