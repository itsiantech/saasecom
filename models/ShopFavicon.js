const mongoose = require("mongoose");

// Per-shop favicon. `store` points at the shop; no tenantPlugin here because
// a single owner can manage icons for ALL of their shops in one place.
const shopFaviconSchema = new mongoose.Schema(
  {
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true },
    icon: { type: String, default: "" },
  },
  { timestamps: true }
);

shopFaviconSchema.index({ store: 1 }, { unique: true });
module.exports = mongoose.model("ShopFavicon", shopFaviconSchema);
