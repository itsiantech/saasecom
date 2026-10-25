const mongoose = require("mongoose");

// Editable email template (subject + HTML body) per store.
const emailTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    subject: { type: String, default: "" },
    body: { type: String, default: "" },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

emailTemplateSchema.index({ store: 1, key: 1 }, { unique: true });
emailTemplateSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("EmailTemplate", emailTemplateSchema);
