const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    invoiceNumber: { type: String, default: "" },
    // Client-supplied replay key; unique per store when present.
    idempotencyKey: { type: String, default: "", trim: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    customerName: { type: String, required: true },
    customerEmail: { type: String, default: "" },
    customerPhone: { type: String, default: "" },
    address: { type: String, default: "" },
    thana: { type: String, default: "" },
    district: { type: String, default: "" },
    division: { type: String, default: "" },
    postCode: { type: String, default: "" },
    country: { type: String, default: "" },
    // ---- Order details page (new fields only; legacy orders fall back to flat fields) ----
    orderNote: { type: String, default: "" },
    orderSource: {
      type: String,
      enum: ["", "google", "facebook", "instagram", "youtube", "direct", "other"],
      default: "",
    },
    deviceType: {
      type: String,
      enum: ["", "mobile", "tablet", "desktop"],
      default: "",
    },
    // Ad click ids captured on the storefront; used by server-side tracking.
    clickIds: {
      gclid: { type: String, default: "" },
      fbclid: { type: String, default: "" },
      ttclid: { type: String, default: "" },
    },
    billing: {
      name: { type: String, default: "" },
      address: { type: String, default: "" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
    },
    shipping: {
      name: { type: String, default: "" },
      address: { type: String, default: "" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
    },
    items: [{
      product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
      variation: { type: mongoose.Schema.Types.ObjectId, ref: "ProductVariation", default: null },
      swatch: { type: mongoose.Schema.Types.ObjectId, ref: "ProductSwatch", default: null },
      // "addon" lines are Matching add-ons: `product` = parent product id, `addonId`
      // matches Product.addons[_id], no stock, title/price snapshotted from the parent.
      kind: { type: String, enum: ["product", "addon"], default: "product" },
      addonId: { type: mongoose.Schema.Types.ObjectId, default: null },
      title: { type: String, default: "" },
      image: { type: String, default: "" },
      unitPrice: { type: Number, default: 0 },
      // Wholesale snapshot: exact tier price at the time the order was placed.
      unitPricePaisa: { type: Number, default: 0 },
      retailUnitPricePaisa: { type: Number, default: 0 },
      pricingMode: { type: String, enum: ["retail", "wholesale", "flash"], default: "retail" },
      tierMinQty: { type: Number, default: null },
      tierMaxQty: { type: Number, default: null },
      flashSale: { type: mongoose.Schema.Types.ObjectId, ref: "FlashSale", default: null },
      flashSaleTitle: { type: String, default: "" },
      flashPercent: { type: Number, default: 0, min: 0, max: 100 },
      // set when the line was added from a saved product-builder build
      build: { type: mongoose.Schema.Types.ObjectId, ref: "SavedBuild", default: null },
      buildToken: { type: String, default: "" },
      quantity: { type: Number, required: true, min: 1 },
      price: { type: Number, required: true },
    }],
    totalAmount: { type: Number, required: true },
    // Coupon snapshot — stored so a later coupon edit never changes old orders.
    couponCode: { type: String, default: "" },
    couponType: { type: String, enum: ["", "percent", "fixed"], default: "" },
    couponValue: { type: Number, default: 0 },
    couponLabel: { type: String, default: "" },
    couponDiscount: { type: Number, default: 0 }, // BDT
    couponDiscountPaisa: { type: Number, default: 0 },
    couponFreeDelivery: { type: Boolean, default: false },
    shippingLabel: { type: String, default: "" },
    shippingAmount: { type: Number, default: 0 },
    paymentMethod: { type: String, default: "" },
    paymentLabel: { type: String, default: "" },
    paymentDetails: {
      senderNumber: { type: String, default: "" },
      transactionId: { type: String, default: "" },
      gateway: { type: String, default: "" },
      mode: { type: String, default: "" },
    },
    // ---- Wholesale / installment (new fields only; retail orders keep defaults) ----
    paymentMode: { type: String, enum: ["full", "installment"], default: "full" },
    paidAmount: { type: Number, default: 0 }, // paisa, installment orders only
    dueAmount: { type: Number, default: 0 }, // paisa, installment orders only
    deliverySpeed: { type: String, default: "" },
    shippingBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },
    installmentPlan: { type: mongoose.Schema.Types.Mixed, default: null },
    // set by checkout after stock is decremented; cancel/delete restores it exactly once
    stockDeducted: { type: Boolean, default: false },
    stockRestored: { type: Boolean, default: false },
    // courier tracking (order list page + international shipments)
    courierName: { type: String, default: "" },
    // automatic courier booking (Pathao / Steadfast API)
    courierProvider: { type: String, enum: ["", "pathao", "steadfast"], default: "" },
    courierConsignmentId: { type: String, default: "" },
    courierTrackingCode: { type: String, default: "" },
    courierStatus: { type: String, default: "" },
    courierSentAt: { type: Date, default: null },
    // ---- Courier fraud check + website order protection (additive; old orders keep defaults) ----
    customerIp: { type: String, default: "" },
    fraud: {
      status: { type: String, enum: ["", "checking", "done"], default: "" },
      riskLevel: { type: String, enum: ["", "low", "medium", "high", "new", "unavailable"], default: "" },
      combinedPercent: { type: Number, default: null },
      // per-courier { success, cancel, total } counts, { rating }, or { error }
      steadfast: { type: mongoose.Schema.Types.Mixed, default: null },
      pathao: { type: mongoose.Schema.Types.Mixed, default: null },
      checkedAt: { type: Date, default: null },
      callDoneAt: { type: Date, default: null },
    },
    protectionFlags: {
      type: [{ rule: String, reason: String, at: { type: Date, default: Date.now } }],
      default: [],
    },
    status: {
      type: String,
      // legacy: confirmed | shipped | delivered ; new set: processing | on_the_way |
      // in_courier | call_not_received | completed | incomplete
      enum: [
        "pending", "processing", "on_the_way", "in_courier", "call_not_received",
        "completed", "incomplete", "cancelled", "confirmed", "shipped", "delivered",
      ],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded", "partially_paid", "overdue", "cancelled"],
      default: "pending",
    },
  },
  { timestamps: true }
);

orderSchema.plugin(require("../lib/tenantPlugin"));
orderSchema.plugin(require("../lib/planLimitPlugin"));
orderSchema.index(
  { store: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $gt: "" } } }
);
// protection rate limits count recent orders per phone / per IP
orderSchema.index({ store: 1, customerPhone: 1, createdAt: -1 });
orderSchema.index({ store: 1, customerIp: 1, createdAt: -1 });

module.exports = mongoose.model("Order", orderSchema);
