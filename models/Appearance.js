const mongoose = require("mongoose");

// Per-store storefront appearance: the active theme plus token overrides.
// Draft is what the admin is editing, published is what shoppers see, and
// every publish leaves a revision so a bad re-skin can be rolled back.
const tokenBlock = {
  tokens: { type: mongoose.Schema.Types.Mixed, default: {} },
};

const appearanceSchema = new mongoose.Schema(
  {
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, unique: true },
    draft: {
      theme: { type: String, default: "" },
      ...tokenBlock,
      savedAt: { type: Date, default: null },
      savedBy: { type: String, default: "" },
    },
    published: {
      theme: { type: String, default: "" },
      ...tokenBlock,
      publishedAt: { type: Date, default: null },
      publishedBy: { type: String, default: "" },
    },
    revisions: [
      {
        theme: { type: String, required: true },
        tokens: { type: mongoose.Schema.Types.Mixed, default: {} },
        publishedAt: { type: Date, default: Date.now },
        publishedBy: { type: String, default: "" },
      },
    ],
    // one short-lived token at a time: the admin opens the storefront with it
    // to see the draft before publishing
    previewToken: { type: String, default: "" },
    previewExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Appearance", appearanceSchema);
