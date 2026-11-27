const mongoose = require("mongoose");

const publisherSchema = new mongoose.Schema(
  {
    name: { type: String, default: "", trim: true, maxlength: 160 },
    nameBn: { type: String, default: "", trim: true, maxlength: 160 },
    slug: { type: String, default: "", trim: true, lowercase: true },
    logo: { type: String, default: "" }, // "/uploads/xxxx.png"
    description: { type: String, default: "", maxlength: 4000 },
    descriptionBn: { type: String, default: "", maxlength: 4000 },
    address: { type: String, default: "", trim: true, maxlength: 300 },
    phone: { type: String, default: "", trim: true, maxlength: 40 },
    email: { type: String, default: "", trim: true, lowercase: true, maxlength: 160 },
    website: { type: String, default: "", trim: true, maxlength: 300 },
    status: { type: String, enum: ["draft", "published", "trashed"], default: "draft" },
    deletedAt: { type: Date, default: null },
    previousStatus: { type: String, enum: ["draft", "published", null], default: null },
    // Demo data flag - true if created from starter pack
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

publisherSchema.plugin(require("../lib/tenantPlugin"));

publisherSchema.index({ store: 1, status: 1 });
publisherSchema.index({ store: 1, slug: 1 });
publisherSchema.index({ store: 1, name: 1 });

module.exports = mongoose.model("Publisher", publisherSchema);
