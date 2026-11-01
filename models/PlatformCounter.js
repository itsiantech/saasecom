const mongoose = require("mongoose");

// Platform-level sequence (invoice numbers). No tenant plugin: it is one row for the whole platform.
const platformCounterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PlatformCounter", platformCounterSchema);
