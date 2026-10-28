const mongoose = require("mongoose");

// ---- International Import Mode sub-schemas (optional; absent on normal products) ----
const internationalOptionSchema = new mongoose.Schema(
  {
    label: { type: String, default: "", trim: true },
    image: { type: String, default: "" },
  },
  { _id: false }
);

const internationalAttributeSchema = new mongoose.Schema(
  {
    name: { type: String, default: "", trim: true },
    options: { type: [internationalOptionSchema], default: [] },
  },
  { _id: false }
);

const internationalSizeSchema = new mongoose.Schema(
  {
    size: { type: String, default: "", trim: true },
    label: { type: String, default: "", trim: true },
    price: { type: Number, default: 0, min: 0 },
    stock: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const internationalShippingRuleSchema = new mongoose.Schema(
  {
    ratePerKg: { type: Number, default: 0, min: 0 },
    minDays: { type: Number, default: 0, min: 0 },
    maxDays: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const internationalShippingSchema = new mongoose.Schema(
  {
    air: { type: internationalShippingRuleSchema, default: () => ({}) },
    sea: { type: internationalShippingRuleSchema, default: () => ({}) },
  },
  { _id: false }
);

const internationalDimensionsSchema = new mongoose.Schema(
  {
    weight: { type: Number, default: 0, min: 0 }, // kg
    height: { type: Number, default: 0, min: 0 }, // cm
    width: { type: Number, default: 0, min: 0 },
    length: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const internationalAnnouncementSchema = new mongoose.Schema(
  {
    type: { type: String, default: "info", trim: true },
    title: { type: String, default: "", trim: true },
    content: { type: String, default: "" },
    color: { type: String, default: "" },
    icon: { type: String, default: "" },
  },
  { _id: false }
);

const internationalConfigSchema = new mongoose.Schema(
  {
    attributes: { type: [internationalAttributeSchema], default: [] },
    sizes: { type: [internationalSizeSchema], default: [] },
    shipping: { type: internationalShippingSchema, default: () => ({}) },
    dimensions: { type: internationalDimensionsSchema, default: () => ({}) },
    chinaCourierCharge: { type: Number, default: 0, min: 0 },
    announcements: { type: [internationalAnnouncementSchema], default: [] },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    // ---- core (kept for backward compatibility with the old product routes) ----
    name: { type: String, default: "" }, // mirror of `title`
    title: { type: String, default: "", trim: true },
    slug: { type: String, default: "", trim: true, lowercase: true },
    price: { type: Number, default: 0 }, // mirror of `regularPrice`
    regularPrice: { type: Number, default: 0 },
    salePrice: { type: Number, default: 0 },
    description: { type: String, default: "" }, // rich text (HTML)
    shortDescription: { type: String, default: "" },
    stock: { type: Number, default: 0 },
    // used by wholesale per-kg / vehicle shipping
    weightKg: { type: Number, default: 0, min: 0 },
    sku: { type: String, default: "" },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
    images: [{ type: String, default: [] }],
    // product walkthrough — a YouTube/Vimeo/direct mp4 link, never an upload
    videoUrl: { type: String, default: "" },

    // ---- relations ----
    brand: { type: mongoose.Schema.Types.ObjectId, ref: "Brand", default: null },
    categories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category", default: [] }],
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: "Tag", default: [] }],
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null },

    // ---- feature flags (driven by the Super Settings toggles) ----
    hasVariations: { type: Boolean, default: false },
    hasSwatches: { type: Boolean, default: false },

    // ---- International Import Mode (default undefined so normal products stay untouched) ----
    internationalConfig: { type: internationalConfigSchema, default: undefined },

    // ---- Product catalog (list/detail pages) ----
    productType: { type: String, enum: ["physical", "digital"], default: "physical" },
    isHotDeal: { type: Boolean, default: false },
    isTopFeature: { type: Boolean, default: false },
    moq: { type: Number, default: 1, min: 1 },
    shipsAbroad: { type: Boolean, default: false },
    soldCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

productSchema.plugin(require("../lib/tenantPlugin"));
productSchema.plugin(require("../lib/planLimitPlugin"));

module.exports = mongoose.model("Product", productSchema);
