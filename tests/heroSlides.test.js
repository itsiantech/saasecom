/* Hero slider validation / public shaping tests.
   Run: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert");
const {
  normalizeSlide,
  normalizeLink,
  publicSlide,
  sortForPublic,
} = require("../lib/heroSlides");

test("normalizeSlide trims text and defaults active to true", () => {
  const slide = normalizeSlide({
    image: "/uploads/banner.webp",
    alt: "  Autumn   edit ",
    title: "  New   season ",
    subtitle: " Hand-picked  essentials ",
    buttonLabel: "  Shop now ",
    linkUrl: "/product/amber-noir",
  });
  assert.deepStrictEqual(slide, {
    image: "/uploads/banner.webp",
    alt: "Autumn edit",
    title: "New season",
    subtitle: "Hand-picked essentials",
    buttonLabel: "Shop now",
    linkUrl: "/product/amber-noir",
    active: true,
  });
});

test("normalizeSlide requires an image", () => {
  assert.throws(() => normalizeSlide({ title: "No image" }), /image lagbe/i);
  assert.throws(() => normalizeSlide({ image: "javascript:alert(1)" }), /Image path valid na/);
});

test("normalizeSlide keeps active false", () => {
  const slide = normalizeSlide({ image: "/uploads/a.jpg", active: false });
  assert.strictEqual(slide.active, false);
});

test("links allow internal paths and https but block unsafe schemes", () => {
  assert.strictEqual(normalizeLink("/product/amber-noir"), "/product/amber-noir");
  assert.strictEqual(normalizeLink("https://example.com/sale"), "https://example.com/sale");
  assert.throws(() => normalizeLink("javascript:alert(1)"), /Link/);
  assert.throws(() => normalizeLink("data:text/html,x"), /Link/);
  assert.throws(() => normalizeLink("//evil.example"), /Link/);
  assert.throws(() => normalizeLink("ftp://example.com/file"), /Link/);
  assert.strictEqual(normalizeLink(""), "");
});

test("publicSlide exposes only public fields", () => {
  assert.deepStrictEqual(
    publicSlide({
      _id: "abc",
      image: "/uploads/a.jpg",
      alt: "Alt",
      title: "Title",
      subtitle: "Sub",
      buttonLabel: "Shop",
      linkUrl: "/shop",
      active: true,
      sortOrder: 2,
      store: "secret-store-id",
    }),
    {
      id: "abc",
      image: "/uploads/a.jpg",
      alt: "Alt",
      title: "Title",
      subtitle: "Sub",
      buttonLabel: "Shop",
      linkUrl: "/shop",
    }
  );
});

test("sortForPublic drops inactive slides and orders by sortOrder", () => {
  const rows = sortForPublic([
    { _id: "3", active: true, sortOrder: 2, createdAt: "2026-10-01T00:00:00Z" },
    { _id: "1", active: true, sortOrder: 0, createdAt: "2026-10-03T00:00:00Z" },
    { _id: "off", active: false, sortOrder: -1, createdAt: "2026-10-01T00:00:00Z" },
    { _id: "2", active: true, sortOrder: 1, createdAt: "2026-10-02T00:00:00Z" },
  ]);
  assert.deepStrictEqual(rows.map((row) => row._id), ["1", "2", "3"]);
});
