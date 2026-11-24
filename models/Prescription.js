const mongoose = require("mongoose");

// A shopper's saved Rx (manual entry or uploaded scan). Guest rows carry the
// browser session id; a logged-in shopper's rows carry `customer`. The file
// block points at private encrypted storage — never a public URL.
const eyeRxSchema = new mongoose.Schema(
  {
    sph: { type: Number, default: null },
    cyl: { type: Number, default: null },
    axis: { type: Number, default: null },
    add: { type: Number, default: null }, // progressive only
  },
  { _id: false }
);

const prescriptionFileSchema = new mongoose.Schema(
  {
    key: { type: String, default: "" }, // private storage key, never exposed
    filename: { type: String, default: "", trim: true, maxlength: 200 },
    mime: { type: String, default: "" },
    sizeBytes: { type: Number, default: 0, min: 0 },
    sha256: { type: String, default: "" },
  },
  { _id: false }
);

const prescriptionSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    sessionId: { type: String, default: "", trim: true, maxlength: 120 },
    mode: { type: String, enum: ["manual", "upload"], default: "manual" },
    od: { type: eyeRxSchema, default: () => ({}) }, // right eye
    os: { type: eyeRxSchema, default: () => ({}) }, // left eye
    pd: { type: Number, default: null },
    notes: { type: String, default: "", trim: true, maxlength: 500 },
    file: { type: prescriptionFileSchema, default: undefined },
    status: { type: String, enum: ["pending", "verified", "rejected"], default: "pending" },
    rejectionReason: { type: String, default: "", trim: true, maxlength: 300 },
    verifiedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "prescriptions" }
);

prescriptionSchema.plugin(require("../lib/tenantPlugin"));
prescriptionSchema.index({ store: 1, customer: 1, createdAt: -1 });
prescriptionSchema.index({ store: 1, sessionId: 1, createdAt: -1 });
prescriptionSchema.index({ store: 1, status: 1 });

module.exports = mongoose.model("Prescription", prescriptionSchema);
