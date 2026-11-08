/* ==========================================================================
   Restores stock for an order whose lines were deducted at checkout.
   The claim flag on the order makes cancel/delete idempotent: only the first
   caller flips stockRestored and increments the lines.
   ========================================================================== */
const Order = require("../models/Order");
const Product = require("../models/Product");
const ProductVariation = require("../models/ProductVariation");
const ProductSwatch = require("../models/ProductSwatch");

async function restoreOrderStock(order) {
  if (!order || !order._id || !order.stockDeducted) return false;

  const claimed = await Order.findOneAndUpdate(
    { _id: order._id, stockDeducted: true, stockRestored: { $ne: true } },
    { $set: { stockRestored: true } },
    { returnDocument: "after" }
  );
  if (!claimed) return false;

  const storeId = claimed.store;
  for (const item of claimed.items || []) {
    const quantity = Number(item.quantity) || 0;
    if (quantity <= 0 || !item.product) continue;

    const model = item.variation ? ProductVariation : item.swatch ? ProductSwatch : Product;
    const target = item.variation || item.swatch || item.product;
    await model
      .updateOne({ _id: target, store: storeId }, { $inc: { stock: quantity } })
      .catch((err) => console.error("order restock:", err.message));
  }

  return true;
}

module.exports = { restoreOrderStock };
