/* Order meta tests — source/device capture used by the order details page.
   Run: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert");
const {
  normalizeSource,
  normalizeDevice,
  parseDeviceType,
  parseOrderSource,
  buildOrderMeta,
} = require("../lib/orderMeta");

test("source aliases normalize to the stored enum values", () => {
  assert.equal(normalizeSource("GOOGLE"), "google");
  assert.equal(normalizeSource("gclid"), "google");
  assert.equal(normalizeSource("fb"), "facebook");
  assert.equal(normalizeSource("meta"), "facebook");
  assert.equal(normalizeSource("ig"), "instagram");
  assert.equal(normalizeSource("yt"), "youtube");
  assert.equal(normalizeSource("none"), "direct");
  assert.equal(normalizeSource("random"), "");
});

test("device aliases accept tab and tablet", () => {
  assert.equal(normalizeDevice("Tab"), "tablet");
  assert.equal(normalizeDevice("TABLET"), "tablet");
  assert.equal(normalizeDevice("mobile"), "mobile");
  assert.equal(normalizeDevice("watch"), "");
});

test("user agent parsing: phone, tablet, desktop", () => {
  assert.equal(
    parseDeviceType("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148"),
    "mobile"
  );
  assert.equal(parseDeviceType("Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit"), "tablet");
  assert.equal(parseDeviceType("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), "tablet");
  assert.equal(parseDeviceType("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120"), "desktop");
  assert.equal(parseDeviceType(""), "");
});

test("order source: explicit utm wins, then referrer host, then direct/other", () => {
  assert.equal(parseOrderSource({ source: "ig" }), "instagram");
  assert.equal(parseOrderSource({ referrer: "https://www.youtube.com/feed" }), "youtube");
  assert.equal(parseOrderSource({ referrer: "https://l.facebook.com/" }), "facebook");
  assert.equal(parseOrderSource({ referrer: "https://www.google.com/search?q=x" }), "google");
  assert.equal(parseOrderSource({}), "direct");
  assert.equal(parseOrderSource({ referrer: "https://someblog.example/post" }), "other");
});

test("buildOrderMeta prefers client hints and falls back to request headers", () => {
  const req = {
    get: (h) =>
      ({
        referer: "https://www.instagram.com/",
        "user-agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) Mobile",
      }[h] || ""),
  };
  const meta = buildOrderMeta(req, { source: "yt", device: "tab", note: "  ring twice  " });
  assert.equal(meta.orderSource, "youtube");
  assert.equal(meta.deviceType, "tablet");
  assert.equal(meta.orderNote, "ring twice");

  const fallback = buildOrderMeta(req, {});
  assert.equal(fallback.orderSource, "instagram");
  assert.equal(fallback.deviceType, "mobile");
  assert.equal(fallback.orderNote, "");
});

test("note is capped at 2000 characters", () => {
  const meta = buildOrderMeta({ get: () => "" }, { note: "x".repeat(2500) });
  assert.equal(meta.orderNote.length, 2000);
});
