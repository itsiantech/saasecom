const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    invoiceNumber: { type: String, default: "" },
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
    // courier tracking (order list page + international shipments)
    courierName: { type: String, default: "" },
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

module.exports = mongoose.model("Order", orderSchema);
