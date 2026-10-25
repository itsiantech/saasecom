const mongoose = require("mongoose");

const heroSlideSchema = new mongoose.Schema(
  {
    image: { type: String, required: true, trim: true, maxlength: 500 },
    alt: { type: String, default: "", trim: true, maxlength: 160 },
    title: { type: String, default: "", trim: true, maxlength: 120 },
    subtitle: { type: String, default: "", trim: true, maxlength: 240 },
    buttonLabel: { type: String, default: "", trim: true, maxlength: 40 },
    linkUrl: { type: String, default: "", trim: true, maxlength: 500 },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

heroSlideSchema.plugin(require("../lib/tenantPlugin"));

heroSlideSchema.index({ store: 1, active: 1, sortOrder: 1 });

module.exports = mongoose.model("HeroSlide", heroSlideSchema);
