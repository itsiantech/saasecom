const mongoose = require("mongoose");

// Login OTP codes. Code hash kore rakha hoy, TTL diye auto delete.
const otpCodeSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true },
    purpose: { type: String, default: "login" },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    used: { type: Boolean, default: false },
  },
  { timestamps: true }
);

otpCodeSchema.index({ store: 1, phone: 1, purpose: 1 });
otpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpCodeSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("OtpCode", otpCodeSchema);
