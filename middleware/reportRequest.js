const { randomUUID } = require("crypto");

const WINDOW_MS = 60 * 1000;
const LIMITS = {
  read: 60,
  export: 10,
  rebuild: 2,
};
const buckets = new Map();

function prune(now) {
  if (buckets.size < 3000) return;
  for (const [key, row] of buckets) {
    if (row.resetAt <= now) buckets.delete(key);
  }
}

function rateLimit(kind) {
  const max = LIMITS[kind] || LIMITS.read;
  return function reportRateLimit(req, res, next) {
    const now = Date.now();
    prune(now);
    const user = req.user && req.user.id ? req.user.id : "anon";
    const store = req.store && req.store._id ? req.store._id : "no-store";
    const key = `${kind}:${user}:${store}`;
    let row = buckets.get(key);
    if (!row || row.resetAt <= now) {
      row = { count: 0, resetAt: now + WINDOW_MS };
      buckets.set(key, row);
    }
    row.count += 1;
    if (row.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((row.resetAt - now) / 1000)));
      return res.status(429).json({ message: "Onek beshi request — ek minute por abar chesta korun" });
    }
    return next();
  };
}

function correlation(req, res, next) {
  const incoming = String(req.headers["x-request-id"] || req.headers["x-correlation-id"] || "").trim();
  const id = /^[A-Za-z0-9._:-]{8,80}$/.test(incoming) ? incoming : randomUUID();
  req.correlationId = id;
  res.setHeader("X-Request-Id", id);
  next();
}

module.exports = { rateLimit, correlation };
