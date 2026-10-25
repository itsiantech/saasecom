const mongoose = require("mongoose");

const tagSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, lowercase: true },
  },
  { timestamps: true }
);

tagSchema.plugin(require("../lib/tenantPlugin"));
tagSchema.index({ store: 1, name: 1 }, { unique: true });
module.exports = mongoose.model("Tag", tagSchema);
