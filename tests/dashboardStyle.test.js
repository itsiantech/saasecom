const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  STYLE_KEYS,
  FONT_KEYS,
  EMPTY_STYLE,
  PRESETS,
  normalizeHex,
  normalizeStyle,
  parseStyle,
  isEmptyStyle,
  styleOptions,
} = require("../lib/dashboardStyle");

function luminance(hex) {
  const channels = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function ratio(a, b) {
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
}

test("style keys and defaults stay in sync", () => {
  assert.equal(STYLE_KEYS.length, 12);
  assert.deepEqual(Object.keys(EMPTY_STYLE).sort(), [...STYLE_KEYS].sort());
  assert.deepEqual(styleOptions().emptyStyle, EMPTY_STYLE);
  assert.ok(styleOptions().fonts.length >= 5);
  assert.ok(styleOptions().presets.some((preset) => preset.key === "default"));
});

test("every preset fills every key with valid values", () => {
  for (const preset of PRESETS) {
    assert.deepEqual(Object.keys(preset.style).sort(), [...STYLE_KEYS].sort(), preset.key);
    for (const [key, value] of Object.entries(preset.style)) {
      if (key === "fontFamily" || key === "activeFont") {
        assert.ok(value === "" || FONT_KEYS.includes(value), `${preset.key}.${key}`);
      } else if (key === "activeWeight") {
        assert.ok(value === "" || /^[4-8]00$/.test(value), `${preset.key}.${key}`);
      } else {
        assert.ok(value === "" || /^#[0-9a-f]{6}$/.test(value), `${preset.key}.${key}`);
      }
    }
  }
  assert.deepEqual(PRESETS.find((preset) => preset.key === "default").style, EMPTY_STYLE);
});

test("preset colours keep body, active and button text readable", () => {
  for (const preset of PRESETS) {
    if (preset.key === "default") continue;
    const { bodyBg, bodyText, activeBg, activeText, buttonColor } = preset.style;
    assert.ok(ratio(bodyText, bodyBg) >= 4.5, `${preset.key} body text`);
    assert.ok(ratio(activeText, activeBg) >= 4.5, `${preset.key} active text`);
    const label = ratio("#ffffff", buttonColor) >= ratio("#15110a", buttonColor) ? "#ffffff" : "#15110a";
    assert.ok(ratio(label, buttonColor) >= 4.5, `${preset.key} button label`);
  }
});

test("hex input accepts short/long forms and normalizes case", () => {
  assert.equal(normalizeHex("#ABCDEF"), "#abcdef");
  assert.equal(normalizeHex(" #abc "), "#aabbcc");
  assert.equal(normalizeHex("#12345"), "");
  assert.equal(normalizeHex("gold"), "");
  assert.equal(normalizeHex(null), "");
});

test("invalid values fall back to the theme instead of blocking the save", () => {
  const style = normalizeStyle({
    bodyBg: "#112233",
    bodyText: "not-a-colour",
    fontFamily: "comic-sans",
    activeFont: "playfair",
    activeWeight: "900",
    menuBg: "#FFF",
    evil: "<script>",
  });
  assert.equal(style.bodyBg, "#112233");
  assert.equal(style.bodyText, "");
  assert.equal(style.fontFamily, "");
  assert.equal(style.activeFont, "playfair");
  assert.equal(style.activeWeight, "");
  assert.equal(style.menuBg, "#ffffff");
  assert.deepEqual(Object.keys(style).sort(), [...STYLE_KEYS].sort());
});

test("parseStyle survives broken or empty rows", () => {
  assert.deepEqual(parseStyle(""), EMPTY_STYLE);
  assert.deepEqual(parseStyle("{not json"), EMPTY_STYLE);
  assert.deepEqual(parseStyle(JSON.stringify({ activeBg: "#010203" })).activeBg, "#010203");
});

test("isEmptyStyle only treats a fully cleared style as default", () => {
  assert.equal(isEmptyStyle(EMPTY_STYLE), true);
  assert.equal(isEmptyStyle(normalizeStyle({ iconColor: "#aabbcc" })), false);
});
