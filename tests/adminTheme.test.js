const { test } = require("node:test");
const assert = require("node:assert/strict");

const { THEME_KEYS, DEFAULT_THEME, normalizeTheme, parseTheme } = require("../lib/adminTheme");

test("defaults cover every theme key with a hex value", () => {
  assert.equal(THEME_KEYS.length, 12);
  for (const key of THEME_KEYS) {
    assert.match(DEFAULT_THEME[key], /^#[0-9a-f]{6}$/, key);
  }
});

test("valid values are kept and lowercased", () => {
  const theme = normalizeTheme({ bg: "#FFFFFF", accent: "#4D8DFF" });
  assert.equal(theme.bg, "#ffffff");
  assert.equal(theme.accent, "#4d8dff");
  assert.equal(theme.panel, DEFAULT_THEME.panel);
});

test("invalid values fall back to defaults", () => {
  const theme = normalizeTheme({ bg: "red", panel: "#12345", text: 42 });
  assert.equal(theme.bg, DEFAULT_THEME.bg);
  assert.equal(theme.panel, DEFAULT_THEME.panel);
  assert.equal(theme.text, DEFAULT_THEME.text);
});

test("unknown keys are dropped", () => {
  const theme = normalizeTheme({ bg: "#112233", evil: "<script>" });
  assert.deepEqual(Object.keys(theme).sort(), [...THEME_KEYS].sort());
});

test("parseTheme survives broken or empty rows", () => {
  assert.deepEqual(parseTheme(""), DEFAULT_THEME);
  assert.deepEqual(parseTheme("{not json"), DEFAULT_THEME);
  assert.deepEqual(parseTheme(JSON.stringify({ sideBg: "#010203" })).sideBg, "#010203");
});
