const mongoose = require("mongoose");

const storeSettingsSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      default: null, // null for platform-wide settings, storeId for store-specific
    },

    // Basic Settings
    websiteTitle: { type: String, default: "My Store" },
    storeTitle: { type: String, default: "My Store" },
    logo: { type: String, default: "" }, // URL or path
    favicon: { type: String, default: "" }, // URL or path
    googleLocation: {
      address: { type: String, default: "" },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      embedUrl: { type: String, default: "" },
    },

    // Business Settings
    currency: {
      code: { type: String, default: "USD" }, // USD, BDT, EUR, etc.
      symbol: { type: String, default: "$" },
      position: { type: String, enum: ["before", "after"], default: "before" },
      autoCountry: { type: Boolean, default: true },
    },
    language: { type: String, default: "en" }, // en, bn, etc.
    footerCopyright: { type: String, default: "© 2024 My Store. All rights reserved." },

    // Contact Settings
    contact: {
      phone: { type: String, default: "" },
      alternatePhone: { type: String, default: "" },
      email: { type: String, default: "" },
      alternateEmail: { type: String, default: "" },
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "" },
      postalCode: { type: String, default: "" },
      businessHours: [
        {
          day: { type: String, enum: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] },
          open: { type: String, default: "09:00" }, // HH:mm format
          close: { type: String, default: "18:00" },
          closed: { type: Boolean, default: false },
        },
      ],
    },

    // Social Media (bonus)
    social: {
      facebook: { type: String, default: "" },
      instagram: { type: String, default: "" },
      twitter: { type: String, default: "" },
      youtube: { type: String, default: "" },
      linkedin: { type: String, default: "" },
    },

    // SEO Settings (bonus)
    seo: {
      metaTitle: { type: String, default: "" },
      metaDescription: { type: String, default: "" },
      metaKeywords: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

// Index for efficient lookups
storeSettingsSchema.index({ storeId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("StoreSettings", storeSettingsSchema);
