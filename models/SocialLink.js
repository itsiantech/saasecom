const mongoose = require("mongoose");

// Social media rows shown in the footer / settings page.
const socialLinkSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    icon: { type: String, default: "" },
    url: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

socialLinkSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("SocialLink", socialLinkSchema);
