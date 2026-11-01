const THEME_KEYS = [
  "bg",
  "panel",
  "line",
  "sideBg",
  "sideText",
  "sideMenu",
  "sideHover",
  "text",
  "muted",
  "accent",
  "icon",
  "btnBg",
];

// Midnight blue is the shipped admin look; saved values override it key by key.
const DEFAULT_THEME = {
  bg: "#070d17",
  panel: "#0e1a29",
  line: "#1d3149",
  sideBg: "#091320",
  sideText: "#e6eef7",
  sideMenu: "#93a8bd",
  sideHover: "#ffffff",
  text: "#e6eef7",
  muted: "#8aa0b6",
  accent: "#4d8dff",
  icon: "#8aa0b6",
  btnBg: "#4d8dff",
};

const HEX_RE = /^#[0-9a-f]{6}$/i;

function normalizeTheme(raw) {
  const out = { ...DEFAULT_THEME };
  if (!raw || typeof raw !== "object") return out;
  for (const key of THEME_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && HEX_RE.test(value.trim())) out[key] = value.trim().toLowerCase();
  }
  return out;
}

function parseTheme(value) {
  try {
    return normalizeTheme(JSON.parse(value || "{}"));
  } catch {
    return { ...DEFAULT_THEME };
  }
}

module.exports = { THEME_KEYS, DEFAULT_THEME, normalizeTheme, parseTheme };
