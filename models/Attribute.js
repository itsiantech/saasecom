const mongoose = require("mongoose");

// A product attribute, e.g. "Size", "Color", "Material".
const attributeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

attributeSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("Attribute", attributeSchema);
