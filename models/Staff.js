const mongoose = require("mongoose");

const staffSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    role: { type: String, enum: ["manager", "editor", "viewer"], default: "viewer" },
    permissions: [{ type: String }],
  },
  { timestamps: true }
);

staffSchema.plugin(require("../lib/tenantPlugin"));
staffSchema.plugin(require("../lib/planLimitPlugin"));

module.exports = mongoose.model("Staff", staffSchema);
