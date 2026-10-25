const SupplierAuditLog = require("../models/SupplierAuditLog");

function clientIp(req) {
  const forwarded = String((req && req.headers && req.headers["x-forwarded-for"]) || "");
  if (forwarded) return forwarded.split(",")[0].trim().slice(0, 80);
  return String((req && req.ip) || "").slice(0, 80);
}

// Best-effort: audit failure must never roll back or block a supplier action.
async function auditSupplier(req, { store, user, action, entity, entityId, oldValue, newValue }) {
  try {
    await SupplierAuditLog.create({
      store: store || undefined,
      user: user || null,
      action,
      entity,
      entityId: entityId ? String(entityId) : "",
      ip: clientIp(req),
      userAgent: String((req && req.headers && req.headers["user-agent"]) || "").slice(0, 300),
      oldValue: oldValue === undefined ? null : oldValue,
      newValue: newValue === undefined ? null : newValue,
    });
  } catch {
    /* never block the business action */
  }
}

module.exports = { auditSupplier, clientIp };
