const mongoose = require("mongoose");

// Logged-in customer's saved products, scoped per store by tenantPlugin.
const wishlistSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  },
  { timestamps: true }
);

wishlistSchema.plugin(require("../lib/tenantPlugin"));

// same product twice for the same shopper in the same store is meaningless
wishlistSchema.index({ store: 1, customer: 1, product: 1 }, { unique: true });
wishlistSchema.index({ store: 1, customer: 1, createdAt: -1 });

module.exports = mongoose.model("Wishlist", wishlistSchema);
