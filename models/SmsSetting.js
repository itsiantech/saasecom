const mongoose = require("mongoose");

// Store-wise SMS / OTP config. API key encrypted thake.
const smsSettingSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    provider: { type: String, enum: ["bulksmsbd", "generic"], default: "bulksmsbd" },
    apiKey: { type: String, default: "" }, // encrypted: { apiKey }
    senderId: { type: String, default: "" },
    apiUrl: { type: String, default: "" }, // generic provider er jonno

    // Order SMS
    notifyOrder: { type: Boolean, default: true },
    notifyAdminOrder: { type: Boolean, default: false },
    adminPhone: { type: String, default: "" },
    orderTemplate: {
      type: String,
      default: "Order {{order_number}} confirmed. Total {{total}}. Dhonnobad — {{store_name}}",
    },

    // Login OTP
    otpEnabled: { type: Boolean, default: false },
    otpLength: { type: Number, default: 6 },
    otpExpiryMinutes: { type: Number, default: 5 },
    otpTemplate: {
      type: String,
      default: "{{store_name}} login OTP: {{code}}. Valid for {{minutes}} minutes.",
    },
  },
  { timestamps: true }
);

smsSettingSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("SmsSetting", smsSettingSchema);
