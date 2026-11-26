const mongoose = require("mongoose");

// Uploaded add-on packages (superadmin only). Files live in storage/addons/<key>/
// and render inside a sandboxed iframe in the store dashboard — no server code.
const addonSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9][a-z0-9-]{0,40}$/,
    },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    nameEn: { type: String, default: "", trim: true, maxlength: 80 },
    description: { type: String, default: "", trim: true, maxlength: 300 },
    version: { type: String, default: "1.0.0", trim: true, maxlength: 20 },
    // relative image path inside the package; empty = generic icon
    icon: { type: String, default: "", trim: true, maxlength: 200 },
    entry: { type: String, required: true, trim: true, maxlength: 200 },
    status: { type: String, enum: ["active", "disabled"], default: "active" },
    fileCount: { type: Number, default: 0 },
    totalBytes: { type: Number, default: 0 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Addon", addonSchema);