const { getStoreId } = require("../lib/tenantContext");

// lib/tenantPlugin auto-filter kore shudhu tenant context thakle.
// Context na thakle query gulo sob dokan er data fenle — tai aage check.
module.exports = function requireTenant(req, res, next) {
  const storeId = (req.store && req.store._id) || getStoreId();
  if (!storeId) return res.status(400).json({ message: "Store resolve kora jayni" });
  req.storeId = storeId;
  next();
};
