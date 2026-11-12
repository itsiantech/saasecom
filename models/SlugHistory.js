const mongoose = require("mongoose");

/* A slug that left a store — renamed or released — stays unusable for a
 * quarantine period (90 days) so old links get a chance to redirect. */
const slugHistorySchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, lowercase: true, trim: true },
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    kind: { type: String, enum: ["released", "renamed"], default: "released" },
    replacedBySlug: { type: String, default: "", lowercase: true, trim: true },
    releasedAt: { type: Date, default: Date.now },
    quarantineUntil: { type: Date, required: true },
  },
  { timestamps: true }
);

// availability lookup: is this name still in quarantine?
slugHistorySchema.index({ slug: 1, quarantineUntil: 1 });
// redirect lookup: newest rename row for a name
slugHistorySchema.index({ slug: 1, kind: 1, releasedAt: -1 });

module.exports = mongoose.model("SlugHistory", slugHistorySchema);
