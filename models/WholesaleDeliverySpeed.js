const mongoose = require("mongoose");

const wholesaleDeliverySpeedSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    etaDays: { type: Number, required: true, min: 0 },
    // flat = extraValue is paisa; percent = extraValue is basis points (500 = 5%)
    extraType: { type: String, enum: ["flat", "percent"], required: true },
    extraValue: { type: Number, required: true, min: 0 },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

wholesaleDeliverySpeedSchema.plugin(require("../lib/tenantPlugin"));

module.exports = mongoose.model("WholesaleDeliverySpeed", wholesaleDeliverySpeedSchema);
