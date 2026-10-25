const mongoose = require("mongoose");

// TTL keeps replay keys for 7 days; the unique compound index is the real guard.
const supplierIdempotencySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 128 },
    scope: { type: String, required: true, trim: true, maxlength: 40 },
    status: { type: String, enum: ["completed"], default: "completed" },
    response: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: "supplier_idempotency" }
);

supplierIdempotencySchema.plugin(require("../lib/tenantPlugin"));

supplierIdempotencySchema.index({ store: 1, scope: 1, key: 1 }, { unique: true });
supplierIdempotencySchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model("SupplierIdempotency", supplierIdempotencySchema);
