const mongoose = require("mongoose");

// Prottek dokaner nijer branding — logo/title/favicon/footer. Eikhane je key set thakbe
// seta global Settings ke overwrite kore, tai ekjon onnojoner logo frontend e dekhabe na.
const siteSettingSchema = new mongoose.Schema(
  {
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, unique: true },
    logo: { type: String, default: "" },
    logoWidth: { type: Number, default: 120 },
    logoHeight: { type: Number, default: 40 },
    siteTitle: { type: String, default: "" },
    favicon: { type: String, default: "" },
    footerLogo: { type: String, default: "" },
    footerCopyright: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SiteSetting", siteSettingSchema);
