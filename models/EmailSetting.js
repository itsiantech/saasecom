const mongoose = require("mongoose");

// Store-wise email / SMTP config. Password encrypted thake (secretBox).
const emailSettingSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },

    // Sender identity
    fromName: { type: String, default: "" },
    fromEmail: { type: String, default: "" },
    replyTo: { type: String, default: "" },

    // SMTP
    smtpHost: { type: String, default: "" },
    smtpPort: { type: Number, default: 587 },
    smtpSecure: { type: Boolean, default: false },
    smtpUser: { type: String, default: "" },
    smtpPassword: { type: String, default: "" }, // encrypted: { password }

    // Recipients
    orderEmail: { type: String, default: "" }, // new order email ekhane jabe
    cancelEmail: { type: String, default: "" }, // cancel order email
    adminEmail: { type: String, default: "" }, // optional, orderEmail er fallback

    // Event toggles
    notifyAdminNewOrder: { type: Boolean, default: true },
    notifyCustomerNewOrder: { type: Boolean, default: true },
    notifyCustomerCancelled: { type: Boolean, default: true },
    notifyCustomerStatus: { type: Boolean, default: true },
  },
  { timestamps: true }
);

emailSettingSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("EmailSetting", emailSettingSchema);
