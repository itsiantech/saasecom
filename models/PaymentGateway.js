const mongoose = require("mongoose");

// API payment gateways. `credentials` is an AES-256-GCM encrypted JSON string
// (lib/secretBox.js) — plain secrets DB te kokhono thake na.
const paymentGatewaySchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["mobile", "bank"], required: true },
    name: { type: String, required: true, trim: true },
    mode: { type: String, enum: ["sandbox", "live"], default: "sandbox" },
    credentials: { type: String, default: "" },
    active: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

paymentGatewaySchema.index({ store: 1, type: 1, name: 1 }, { unique: true });
paymentGatewaySchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("PaymentGateway", paymentGatewaySchema);
