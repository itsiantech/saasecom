const AuditLog = require("../models/AuditLog");

// Best-effort audit trail: a logging failure must never block the admin action.
async function writeAudit({ store, user, action, entity, entityId, oldValue, newValue }) {
  try {
    await AuditLog.create({
      store: store || undefined,
      user: user || null,
      action,
      entity,
      entityId: entityId ? String(entityId) : "",
      oldValue: oldValue === undefined ? null : oldValue,
      newValue: newValue === undefined ? null : newValue,
    });
  } catch {
    /* ignore */
  }
}

module.exports = { writeAudit };
