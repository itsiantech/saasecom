const mongoose = require("mongoose");

// Icon can come from a library (value = icon name) or be fully custom (value = svg/class/upload).
const iconSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["library", "custom", "none"], default: "none" },
    value: { type: String, default: "", maxlength: 4000 },
  },
  { _id: false }
);

const brandSchema = new mongoose.Schema(
  {
    name: { type: String, default: "", trim: true }, // NOT mandatory — UI shows "Untitled"
    slug: { type: String, default: "", trim: true, lowercase: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "Brand", default: null }, // null = root
    ancestors: [{ type: mongoose.Schema.Types.ObjectId, ref: "Brand", default: [] }],
    level: { type: Number, default: 0 }, // 0 = brand, 1 = sub, 2 = sub-sub, deeper allowed
    order: { type: Number, default: 0 }, // sibling serial
    image: { type: String, default: "" }, // "/uploads/xxxx.png"
    icon: { type: iconSchema, default: () => ({ type: "none", value: "" }) },
    status: { type: String, enum: ["draft", "published", "trashed"], default: "draft" },
    deletedAt: { type: Date, default: null },
    previousStatus: { type: String, enum: ["draft", "published", null], default: null },
  },
  { timestamps: true }
);

// Multi-tenant scoping (same pattern as Category/Product).
brandSchema.plugin(require("../lib/tenantPlugin"));

brandSchema.index({ store: 1, parent: 1, order: 1 });
brandSchema.index({ store: 1, status: 1 });
brandSchema.index({ store: 1, slug: 1 });
brandSchema.index({ ancestors: 1 });

module.exports = mongoose.model("Brand", brandSchema);
