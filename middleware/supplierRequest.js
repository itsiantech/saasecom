const { randomUUID } = require("crypto");

const WINDOW_MS = 60 * 1000;
const MAX_WRITES = 90;
const buckets = new Map();

function prune(now) {
  if (buckets.size < 2000) return;
  for (const [key, value] of buckets) {
    if (value.resetAt <= now) buckets.delete(key);
  }
}

function writeLimit(req, res, next) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();
  const now = Date.now();
  prune(now);
  const key = `${req.user && req.user.id ? req.user.id : "anon"}:${req.store ? req.store._id : "no-store"}`;
  let row = buckets.get(key);
  if (!row || row.resetAt <= now) {
    row = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, row);
  }
  row.count += 1;
  if (row.count > MAX_WRITES) {
    res.setHeader("Retry-After", String(Math.ceil((row.resetAt - now) / 1000)));
    return res.status(429).json({ message: "Onek beshi request — ek minute por abar chesta korun" });
  }
  next();
}

function correlation(req, res, next) {
  const incoming = String(req.headers["x-correlation-id"] || "").trim();
  const id = /^[A-Za-z0-9._:-]{8,80}$/.test(incoming) ? incoming : randomUUID();
  req.correlationId = id;
  res.setHeader("X-Correlation-Id", id);
  next();
}

module.exports = { writeLimit, correlation };
