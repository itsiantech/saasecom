const mongoose = require("mongoose");

// One private document (NID scan etc.). Bytes live outside public/ and are
// AES-256-GCM encrypted; `path` is a private storage key, never a URL.
// A pending row is a short-lived upload token handed to the application form.
const installmentDocumentSchema = new mongoose.Schema(
  {
    application: { type: mongoose.Schema.Types.ObjectId, ref: "InstallmentApplication", default: null },
    token: { type: String, default: "", trim: true },
    type: { type: String, required: true, trim: true, maxlength: 40 },
    filename: { type: String, default: "", trim: true, maxlength: 200 },
    path: { type: String, default: "" },
    mime: { type: String, default: "" },
    sizeBytes: { type: Number, default: 0, min: 0 },
    sha256: { type: String, default: "" },
    status: { type: String, enum: ["pending", "attached", "purged"], default: "pending" },
    expiresAt: { type: Date, default: null },
    attachedAt: { type: Date, default: null },
    purgedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

installmentDocumentSchema.plugin(require("../lib/tenantPlugin"));
installmentDocumentSchema.index(
  { store: 1, token: 1 },
  { unique: true, partialFilterExpression: { token: { $gt: "" } } }
);
installmentDocumentSchema.index({ store: 1, application: 1, status: 1 });
installmentDocumentSchema.index({ store: 1, status: 1, expiresAt: 1 });

module.exports = mongoose.model("InstallmentDocument", installmentDocumentSchema);
