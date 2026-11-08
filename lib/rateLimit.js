// Simple in-process fixed-window limiter. The API runs as one pm2 process, so
// this is enough to stop brute-force bursts without external infrastructure.
const buckets = new Map();
const MAX_KEYS = 10000;

function prune(now) {
  if (buckets.size < MAX_KEYS) return;
  for (const [key, row] of buckets) {
    if (row.reset <= now) buckets.delete(key);
  }
}

function consume(key, windowMs, max, now = Date.now()) {
  let row = buckets.get(key);
  if (!row || row.reset <= now) {
    row = { count: 0, reset: now + windowMs };
    buckets.set(key, row);
  }
  row.count += 1;
  return { ok: row.count <= max, retryAfter: Math.max(1, Math.ceil((row.reset - now) / 1000)) };
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * windowMs: window length, max: allowed hits in the window,
 * keyOf(req): extra identity (phone/email) so one noisy account does not lock
 * out every other login behind the same IP.
 */
function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, keyPrefix = "rl", keyOf = null, message } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    prune(now);
    let key = keyPrefix + ":" + clientIp(req);
    if (keyOf) {
      const extra = String(keyOf(req) || "").trim().toLowerCase().slice(0, 120);
      if (extra) key += ":" + extra;
    }
    const result = consume(key, windowMs, max, now);
    if (!result.ok) {
      res.setHeader("Retry-After", String(result.retryAfter));
      return res.status(429).json({
        message: message || `Onek bar cheshta hoyeche — ${Math.ceil(result.retryAfter / 60)} minute por abar cheshta korun`,
      });
    }
    next();
  };
}

function resetRateLimits() {
  buckets.clear();
}

module.exports = { rateLimit, resetRateLimits, consume };
