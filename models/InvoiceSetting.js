const mongoose = require("mongoose");

// Invoice branding + paper config. Ek page e customer + admin duto copy.
const invoiceSettingSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    prefix: { type: String, default: "INV-" },
    nextNumber: { type: Number, default: 1000 },
    accentColor: { type: String, default: "#c9a961" },
    paperSize: { type: String, enum: ["a4", "a5", "thermal"], default: "a4" },
    copies: { type: String, enum: ["both", "customer", "admin"], default: "both" },

    companyName: { type: String, default: "" },
    companyAddress: { type: String, default: "" },
    companyPhone: { type: String, default: "" },
    companyEmail: { type: String, default: "" },

    showLogo: { type: Boolean, default: true },
    showSignature: { type: Boolean, default: true },
    signatureLabel: { type: String, default: "Authorized signature" },
    showVat: { type: Boolean, default: false },
    vatPercent: { type: Number, default: 0 },
    binNumber: { type: String, default: "" },
    footerNote: { type: String, default: "Dhonnobad! Abar asben." },
    terms: { type: String, default: "" },
  },
  { timestamps: true }
);

invoiceSettingSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("InvoiceSetting", invoiceSettingSchema);
