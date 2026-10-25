const mongoose = require("mongoose");

// Icon can come from a library (value = icon name) or be fully custom (value = svg/class/upload).
const iconSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["library", "custom", "none"], default: "none" },
    value: { type: String, default: "", maxlength: 4000 },
  },
  { _id: false }
);

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, default: "", trim: true }, // NOT mandatory — UI shows "Untitled"
    slug: { type: String, default: "", trim: true, lowercase: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null }, // null = root
    // ancestors = ordered list of parent ids (root first). Lets us query a whole subtree with one index hit.
    ancestors: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category", default: [] }],
    level: { type: Number, default: 0 }, // 0 = category, 1 = sub, 2 = sub-sub, deeper allowed
    order: { type: Number, default: 0 }, // sibling serial
    image: { type: String, default: "" }, // "/uploads/xxxx.png"
    icon: { type: iconSchema, default: () => ({ type: "none", value: "" }) },
    status: { type: String, enum: ["draft", "published", "trashed"], default: "draft" },
    deletedAt: { type: Date, default: null },
    // Remember the status before trashing so Restore brings it back exactly as it was.
    previousStatus: { type: String, enum: ["draft", "published", null], default: null },
  },
  { timestamps: true }
);

// Multi-tenant scoping: adds the `store` field and auto-filters every read/update/delete
// by the current tenant (same pattern as Product/Order/Staff).
categorySchema.plugin(require("../lib/tenantPlugin"));

// Indexes for the hot queries.
categorySchema.index({ store: 1, parent: 1, order: 1 });
categorySchema.index({ store: 1, status: 1 });
categorySchema.index({ store: 1, slug: 1 });
categorySchema.index({ ancestors: 1 });

module.exports = mongoose.model("Category", categorySchema);
