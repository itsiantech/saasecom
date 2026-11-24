const mongoose = require("mongoose");

// Immutable copy made at order time: lens type/category/package/brand/price and
// the Rx values. Editing a package or a saved prescription later must never
// change an old order, so nothing here references the live rows for display.
const orderRxEyeSchema = new mongoose.Schema(
  {
    sph: { type: Number, default: null },
    cyl: { type: Number, default: null },
    axis: { type: Number, default: null },
    add: { type: Number, default: null },
  },
  { _id: false }
);

const orderRxFileSchema = new mongoose.Schema(
  {
    key: { type: String, default: "" },
    filename: { type: String, default: "", trim: true, maxlength: 200 },
    mime: { type: String, default: "" },
    sizeBytes: { type: Number, default: 0, min: 0 },
    sha256: { type: String, default: "" },
  },
  { _id: false }
);

const orderPrescriptionSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    // _id of the embedded Order.items entry this lens belongs to
    orderItem: { type: mongoose.Schema.Types.ObjectId, required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    lens: {
      typeId: { type: mongoose.Schema.Types.ObjectId, default: null },
      typeName: { type: String, default: "", trim: true },
      categoryId: { type: mongoose.Schema.Types.ObjectId, default: null },
      categoryName: { type: String, default: "", trim: true },
      packageId: { type: mongoose.Schema.Types.ObjectId, default: null },
      packageName: { type: String, default: "", trim: true },
      brand: { type: String, default: "", trim: true },
      lensIndex: { type: String, default: "", trim: true },
      badge: { type: String, default: "", trim: true },
      pricePaisa: { type: Number, default: 0, min: 0 },
    },
    rx: {
      mode: { type: String, enum: ["manual", "upload", "none"], default: "none" },
      od: { type: orderRxEyeSchema, default: () => ({}) },
      os: { type: orderRxEyeSchema, default: () => ({}) },
      pd: { type: Number, default: null },
      notes: { type: String, default: "", trim: true, maxlength: 500 },
      file: { type: orderRxFileSchema, default: undefined },
    },
    rxStatus: { type: String, enum: ["pending", "verified", "rejected"], default: "pending" },
    lensStatus: {
      type: String,
      enum: ["waiting_verification", "processing", "ready"],
      default: "waiting_verification",
    },
    rejectionReason: { type: String, default: "", trim: true, maxlength: 300 },
    verifiedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    snapshotAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "order_prescriptions" }
);

orderPrescriptionSchema.plugin(require("../lib/tenantPlugin"));
orderPrescriptionSchema.index({ store: 1, order: 1 });
orderPrescriptionSchema.index({ store: 1, rxStatus: 1, lensStatus: 1, createdAt: -1 });
orderPrescriptionSchema.index({ store: 1, orderItem: 1 }, { unique: true });

module.exports = mongoose.model("OrderPrescription", orderPrescriptionSchema);
