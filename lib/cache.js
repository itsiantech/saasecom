// Small in-process TTL cache for price tiers and wholesale shipping rules.
// Single-instance only; a shared cache (Redis) can replace this later.
const store = new Map();

function get(key) {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value;
}

function set(key, value, ttlMs = 60 * 1000) {
  store.set(key, { value, expiresAt: Date.now() + Math.max(1, ttlMs) });
  return value;
}

function del(...keys) {
  keys.forEach((key) => store.delete(key));
}

function invalidatePrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

function clear() {
  store.clear();
}

function size() {
  return store.size;
}

module.exports = { get, set, del, invalidatePrefix, clear, size };
