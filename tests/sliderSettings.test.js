/* Slider preference validation tests.
   Run: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert");
const {
  normalizeHeight,
  normalizeAutoplay,
  normalizeTransition,
  TRANSITIONS,
} = require("../lib/sliderSettings");

test("normalizeHeight accepts 150–900 and rounds", () => {
  assert.strictEqual(normalizeHeight(420), "420");
  assert.strictEqual(normalizeHeight("150"), "150");
  assert.strictEqual(normalizeHeight(899.6), "900");
  assert.strictEqual(normalizeHeight(420.4), "420");
});

test("normalizeHeight rejects out-of-range and junk values", () => {
  assert.strictEqual(normalizeHeight(149), "");
  assert.strictEqual(normalizeHeight(901), "");
  assert.strictEqual(normalizeHeight("abc"), "");
  assert.strictEqual(normalizeHeight(""), "");
  assert.strictEqual(normalizeHeight(null), "");
  assert.strictEqual(normalizeHeight(undefined), "");
});

test("normalizeAutoplay accepts 1–15 whole seconds", () => {
  assert.strictEqual(normalizeAutoplay(3), "3");
  assert.strictEqual(normalizeAutoplay("1"), "1");
  assert.strictEqual(normalizeAutoplay(15), "15");
  assert.strictEqual(normalizeAutoplay(2.6), "3");
});

test("normalizeAutoplay rejects out-of-range and junk values", () => {
  assert.strictEqual(normalizeAutoplay(0), "");
  assert.strictEqual(normalizeAutoplay(16), "");
  assert.strictEqual(normalizeAutoplay("fast"), "");
  assert.strictEqual(normalizeAutoplay(null), "");
});

test("normalizeTransition accepts the six supported effects", () => {
  for (const effect of [
    "slide-left-to-right",
    "slide-right-to-left",
    "slide-top-to-bottom",
    "slide-bottom-to-top",
    "fade",
    "zoom",
  ]) {
    assert.strictEqual(normalizeTransition(effect), effect);
    assert.ok(TRANSITIONS.includes(effect));
  }
  assert.strictEqual(normalizeTransition(" SLIDE-RIGHT-TO-LEFT "), "slide-right-to-left");
});

test("normalizeTransition blanks unknown effects so the theme default wins", () => {
  assert.strictEqual(normalizeTransition("flip"), "");
  assert.strictEqual(normalizeTransition(""), "");
  assert.strictEqual(normalizeTransition(undefined), "");
});
