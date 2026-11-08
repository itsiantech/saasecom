const crypto = require("crypto");

// Invoice / packing slip links travel by email and chat, so the token carries
// the order, store and document type — a link for one store or one document
// can never be replayed for another.
const TTL_SECONDS = 30 * 24 * 60 * 60;

function secret() {
  return process.env.ORDER_DOC_SECRET || process.env.JWT_SECRET || "";
}

function hmac(body) {
  return crypto.createHmac("sha256", secret()).update(body).digest("base64url");
}

function makeOrderDocToken({ orderId, storeId, type, ttlSeconds = TTL_SECONDS }) {
  if (!secret()) return "";
  const payload = {
    o: String(orderId),
    s: String(storeId),
    t: String(type),
    e: Math.floor(Date.now() / 1000) + Math.max(60, Number(ttlSeconds) || TTL_SECONDS),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + hmac(body);
}

function verifyOrderDocToken(token, type) {
  if (!secret()) return null;
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const want = hmac(body);
  const got = Buffer.from(sig);
  const expected = Buffer.from(want);
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || payload.t !== String(type)) return null;
  if (!payload.o || !payload.s) return null;
  if (Number(payload.e) * 1000 < Date.now()) return null;
  return payload;
}

module.exports = { makeOrderDocToken, verifyOrderDocToken, TTL_SECONDS };
