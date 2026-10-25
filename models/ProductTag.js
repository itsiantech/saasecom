const mongoose = require("mongoose");

// Many-to-many between products and tags.
const productTagSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    tag: { type: mongoose.Schema.Types.ObjectId, ref: "Tag", required: true },
  },
  { timestamps: true }
);

productTagSchema.plugin(require("../lib/tenantPlugin"));
module.exports = mongoose.model("ProductTag", productTagSchema);
