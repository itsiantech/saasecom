const mongoose = require("mongoose");

// A term/value of an attribute, e.g. attribute "Size" -> "L", "XL", "XXL".
const attributeTermSchema = new mongoose.Schema(
  {
    attribute: { type: mongoose.Schema.Types.ObjectId, ref: "Attribute", required: true },
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

attributeTermSchema.plugin(require("../lib/tenantPlugin"));
attributeTermSchema.index({ attribute: 1, name: 1 });
module.exports = mongoose.model("AttributeTerm", attributeTermSchema);
