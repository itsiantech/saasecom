const mongoose = require("mongoose");

// A cart line item. `variation` and `swatch` are mutually exclusive; the chosen
// one holds its own image/price, and its own stock is reduced at checkout.
const cartItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    variation: { type: mongoose.Schema.Types.ObjectId, ref: "ProductVariation", default: null },
    swatch: { type: mongoose.Schema.Types.ObjectId, ref: "ProductSwatch", default: null },
    image: { type: String, default: "" },
    // Legacy BDT mirror + the exact paisa amount used by wholesale pricing.
    unitPrice: { type: Number, required: true },
    unitPricePaisa: { type: Number, default: 0 },
    retailUnitPricePaisa: { type: Number, default: 0 },
    pricingMode: { type: String, enum: ["retail", "wholesale", "flash"], default: "retail" },
    tierMinQty: { type: Number, default: null },
    tierMaxQty: { type: Number, default: null },
    flashSale: { type: mongoose.Schema.Types.ObjectId, ref: "FlashSale", default: null },
    flashSaleTitle: { type: String, default: "" },
    flashPercent: { type: Number, default: 0, min: 0, max: 100 },
    quantity: { type: Number, default: 1, min: 1 },
  },
  { _id: true }
);

const cartSchema = new mongoose.Schema(
  {
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    sessionId: { type: String, default: null }, // guest carts
    couponCode: { type: String, default: "" },
    items: [cartItemSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Cart", cartSchema);
