const mongoose = require("mongoose");

const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    price: { type: Number, required: true, default: 0 },
    durationDays: { type: Number, default: 30 },
    trialDays: { type: Number, default: 0 },
    limits: {
      products: { type: Number, default: 0 }, // 0 = unlimited
      orders: { type: Number, default: 0 }, // 0 = unlimited
      storageMB: { type: Number, default: 0 }, // 0 = unlimited
      staffMembers: { type: Number, default: 1 }, // 0 = unlimited
    },
    features: {
      customDomain: { type: Boolean, default: false },
      analytics: { type: Boolean, default: false },
      apiAccess: { type: Boolean, default: false },
      prioritySupport: { type: Boolean, default: false },
    },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Plan", planSchema);
