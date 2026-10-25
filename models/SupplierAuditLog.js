const mongoose = require("mongoose");

// Supplier-specific audit trail with request IP; existing AuditLog stays untouched.
const supplierAuditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    action: { type: String, required: true, trim: true, maxlength: 80 },
    entity: { type: String, required: true, trim: true, maxlength: 80 },
    entityId: { type: String, default: "", maxlength: 80 },
    ip: { type: String, default: "", maxlength: 80 },
    userAgent: { type: String, default: "", maxlength: 300 },
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, collection: "supplier_audit_logs" }
);

supplierAuditLogSchema.plugin(require("../lib/tenantPlugin"));

supplierAuditLogSchema.index({ store: 1, createdAt: -1 });
supplierAuditLogSchema.index({ store: 1, entity: 1, entityId: 1, createdAt: -1 });

module.exports = mongoose.model("SupplierAuditLog", supplierAuditLogSchema);
