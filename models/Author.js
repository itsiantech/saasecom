const mongoose = require("mongoose");

// One social/profile link on an author page. `platform` is a short label
// (website/facebook/goodreads/...) — the URL itself is validated in the controller.
const authorLinkSchema = new mongoose.Schema(
  {
    platform: { type: String, default: "", trim: true, maxlength: 30 },
    url: { type: String, default: "", trim: true, maxlength: 300 },
  },
  { _id: false }
);

const authorSchema = new mongoose.Schema(
  {
    name: { type: String, default: "", trim: true, maxlength: 160 }, // display / english name
    nameBn: { type: String, default: "", trim: true, maxlength: 160 },
    slug: { type: String, default: "", trim: true, lowercase: true },
    photo: { type: String, default: "" }, // "/uploads/xxxx.png"
    bio: { type: String, default: "", maxlength: 4000 },
    bioBn: { type: String, default: "", maxlength: 4000 },
    country: { type: String, default: "", trim: true, maxlength: 60 },
    birthYear: { type: Number, default: null, min: -3000, max: 2100 },
    deathYear: { type: Number, default: null, min: -3000, max: 2100 },
    links: { type: [authorLinkSchema], default: [] },
    status: { type: String, enum: ["draft", "published", "trashed"], default: "draft" },
    deletedAt: { type: Date, default: null },
    previousStatus: { type: String, enum: ["draft", "published", null], default: null },
    // Demo data flag - true if created from starter pack
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

authorSchema.plugin(require("../lib/tenantPlugin"));

authorSchema.index({ store: 1, status: 1 });
authorSchema.index({ store: 1, slug: 1 });
authorSchema.index({ store: 1, name: 1 });

module.exports = mongoose.model("Author", authorSchema);
