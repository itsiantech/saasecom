const { REPORT_CACHE_TTL_MS } = require("../lib/reportConstants");

const entries = new Map();
const MAX_ENTRIES = 400;

function prune(now) {
  if (entries.size < MAX_ENTRIES) return;
  for (const [key, row] of entries) {
    if (row.expiresAt <= now) entries.delete(key);
  }
  if (entries.size >= MAX_ENTRIES) {
    const oldest = [...entries.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (let i = 0; i < Math.ceil(MAX_ENTRIES / 4); i += 1) {
      if (oldest[i]) entries.delete(oldest[i][0]);
    }
  }
}

function keyFor(storeId, kind, from, to, extra = "") {
  return `${String(storeId)}|${kind}|${from}|${to}|${extra}`;
}

function get(key) {
  const row = entries.get(key);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    entries.delete(key);
    return null;
  }
  return row.value;
}

function set(key, value, ttlMs = REPORT_CACHE_TTL_MS) {
  prune(Date.now());
  entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

function clearStore(storeId) {
  const prefix = `${String(storeId)}|`;
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
}

function reset() {
  entries.clear();
}

module.exports = { keyFor, get, set, clearStore, reset };
