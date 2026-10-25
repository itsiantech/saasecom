const mongoose = require("mongoose");

// Atomic per-store, per-kind, per-year sequence source. No find-max/count.
const supplierCounterSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["order", "invoice"], required: true },
    year: { type: Number, required: true },
    seq: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: "counters" }
);

supplierCounterSchema.plugin(require("../lib/tenantPlugin"));

supplierCounterSchema.index({ store: 1, kind: 1, year: 1 }, { unique: true });

module.exports = mongoose.model("SupplierCounter", supplierCounterSchema);
