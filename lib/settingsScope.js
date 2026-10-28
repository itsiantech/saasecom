// Legacy Settings rows are key/value pairs in one collection. Platform rows
// keep the plain key; a store's own value is stored as "store:<id>:<key>" so
// the existing unique key index keeps working without a migration.
const PREFIX = "store:";

function scopedKey(storeId, key) {
  return storeId ? `${PREFIX}${String(storeId)}:${key}` : key;
}

function scopePrefix(storeId) {
  return `${PREFIX}${String(storeId)}:`;
}

function isScopedKey(storeId, key) {
  return !!storeId && String(key).startsWith(scopePrefix(storeId));
}

function unscopeKey(storeId, key) {
  return isScopedKey(storeId, key) ? String(key).slice(scopePrefix(storeId).length) : key;
}

// platform rows + this store's rows
function keysForStore(storeId, keys) {
  return storeId ? [...keys, ...keys.map((key) => scopedKey(storeId, key))] : keys;
}

module.exports = { scopedKey, isScopedKey, unscopeKey, keysForStore };
