const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

// platform-level history survives a store purge: payment rows are accounting
// evidence and the audit trail must remember who deleted what
const KEEP = new Set(["PlatformPayment", "AuditLog", "Store"]);

// models are loaded lazily from disk so collections that no route requires in
// this process (and would hence be missing from mongoose.modelNames) still get
// wiped. StoreSettings is the one model that spells its tenant key "storeId".
function tenantCollections() {
  const dir = path.join(__dirname, "..", "models");
  const found = new Map();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".js")) continue;
    let model;
    try {
      model = require(path.join(dir, file));
    } catch {
      continue;
    }
    if (!model || !model.modelName || KEEP.has(model.modelName)) continue;
    const field = model.schema.path("store") ? "store" : model.schema.path("storeId") ? "storeId" : null;
    if (!field) continue;
    found.set(model.modelName, { collection: model.collection.collectionName, field });
  }
  return [...found.values()];
}

/**
 * Delete everything tenant-owned by a store. Runs through the native driver so
 * the tenant plugin's AsyncLocalStorage filter can never narrow the delete to
 * the admin's own store. Returns collection → deleted count.
 */
async function purgeStoreData(storeId) {
  const removed = {};
  const failed = [];
  for (const { collection, field } of tenantCollections()) {
    try {
      const res = await mongoose.connection.collection(collection).deleteMany({ [field]: storeId });
      if (res.deletedCount) removed[collection] = res.deletedCount;
    } catch (err) {
      failed.push(collection);
    }
  }
  if (failed.length) {
    const err = new Error("কিছু ডেটা মুছতে ব্যর্থ হয়েছে — আবার চেষ্টা করুন: " + failed.join(", "));
    err.failed = failed;
    throw err;
  }
  return removed;
}

module.exports = { purgeStoreData, tenantCollections };
