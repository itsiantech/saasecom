// Store admin dashboard look, stored as one JSON string in per-store Settings.
// Every key is optional: "" means "use the active dark/light theme value".
const STYLE_KEY = "dashboardStyle";

const COLOR_KEYS = [
  "bodyBg",
  "bodyText",
  "buttonColor",
  "sidebarBg",
  "menuBg",
  "iconColor",
  "activeBg",
  "activeText",
  "activeIcon",
];

const FORM_KEYS = ["fontFamily", "activeFont", "activeWeight"];

const STYLE_KEYS = [...COLOR_KEYS, ...FORM_KEYS];

const FONT_OPTIONS = [
  { key: "inter", label: "Inter — modern sans", stack: '"Inter", "Segoe UI", system-ui, sans-serif' },
  { key: "playfair", label: "Playfair Display — serif", stack: '"Playfair Display", Georgia, serif' },
  { key: "georgia", label: "Georgia — classic serif", stack: 'Georgia, "Times New Roman", serif' },
  { key: "system", label: "System UI", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { key: "mono", label: "Consolas — monospace", stack: '"Consolas", "SFMono-Regular", Menlo, monospace' },
];

const FONT_KEYS = FONT_OPTIONS.map((font) => font.key);
const WEIGHTS = ["", "400", "500", "600", "700", "800"];

const EMPTY_STYLE = Object.freeze({
  bodyBg: "",
  bodyText: "",
  fontFamily: "",
  buttonColor: "",
  sidebarBg: "",
  menuBg: "",
  iconColor: "",
  activeBg: "",
  activeText: "",
  activeIcon: "",
  activeFont: "",
  activeWeight: "",
});

const PRESETS = [
  { key: "default", label: "Theme default", swatch: "#6b7280", style: { ...EMPTY_STYLE } },
  {
    key: "gold",
    label: "Luxe gold",
    swatch: "#d4af7a",
    style: {
      bodyBg: "#0a0a10",
      bodyText: "#ece9e2",
      fontFamily: "inter",
      buttonColor: "#d4af7a",
      sidebarBg: "#0e0e16",
      menuBg: "#14141f",
      iconColor: "#a49a86",
      activeBg: "#0a0a10",
      activeText: "#d4af7a",
      activeIcon: "#d4af7a",
      activeFont: "playfair",
      activeWeight: "600",
    },
  },
  {
    key: "midnight",
    label: "Midnight blue",
    swatch: "#4d8dff",
    style: {
      bodyBg: "#070d17",
      bodyText: "#e6eef7",
      fontFamily: "inter",
      buttonColor: "#4d8dff",
      sidebarBg: "#091320",
      menuBg: "#0f1c2e",
      iconColor: "#8aa0b6",
      activeBg: "#4d8dff",
      activeText: "#031225",
      activeIcon: "#031225",
      activeFont: "inter",
      activeWeight: "600",
    },
  },
  {
    key: "emerald",
    label: "Emerald",
    swatch: "#2fbf8f",
    style: {
      bodyBg: "#06120e",
      bodyText: "#e4f5ec",
      fontFamily: "inter",
      buttonColor: "#2fbf8f",
      sidebarBg: "#081a14",
      menuBg: "#0d241c",
      iconColor: "#8fb9a9",
      activeBg: "#2fbf8f",
      activeText: "#04170f",
      activeIcon: "#04170f",
      activeFont: "inter",
      activeWeight: "600",
    },
  },
  {
    key: "rose",
    label: "Rose",
    swatch: "#e06a94",
    style: {
      bodyBg: "#140a10",
      bodyText: "#f7e8ef",
      fontFamily: "inter",
      buttonColor: "#e06a94",
      sidebarBg: "#1b0d16",
      menuBg: "#241220",
      iconColor: "#c39aac",
      activeBg: "#e06a94",
      activeText: "#2a0714",
      activeIcon: "#2a0714",
      activeFont: "playfair",
      activeWeight: "600",
    },
  },
  {
    key: "paper",
    label: "Paper (light)",
    swatch: "#4453d6",
    style: {
      bodyBg: "#f6f5f2",
      bodyText: "#1d1a15",
      fontFamily: "inter",
      buttonColor: "#7f8cff",
      sidebarBg: "#ecebe6",
      menuBg: "#f6f5f2",
      iconColor: "#6c6558",
      activeBg: "#4453d6",
      activeText: "#ffffff",
      activeIcon: "#ffffff",
      activeFont: "inter",
      activeWeight: "600",
    },
  },
];

const HEX_RE = /^#[0-9a-f]{6}$/i;
const SHORT_HEX_RE = /^#[0-9a-f]{3}$/i;

function normalizeHex(value) {
  if (typeof value !== "string") return "";
  const hex = value.trim();
  if (HEX_RE.test(hex)) return hex.toLowerCase();
  if (SHORT_HEX_RE.test(hex)) {
    const [, r, g, b] = hex.toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "";
}

// Invalid colors fall back to the theme instead of rejecting the whole save, so
// one half-typed field never blocks the rest of the style.
function normalizeStyle(raw) {
  const out = { ...EMPTY_STYLE };
  if (!raw || typeof raw !== "object") return out;
  for (const key of COLOR_KEYS) out[key] = normalizeHex(raw[key]);
  out.fontFamily = FONT_KEYS.includes(raw.fontFamily) ? raw.fontFamily : "";
  out.activeFont = FONT_KEYS.includes(raw.activeFont) ? raw.activeFont : "";
  out.activeWeight = WEIGHTS.includes(String(raw.activeWeight || "")) ? String(raw.activeWeight || "") : "";
  return out;
}

function parseStyle(value) {
  try {
    return normalizeStyle(JSON.parse(value || "{}"));
  } catch {
    return { ...EMPTY_STYLE };
  }
}

function isEmptyStyle(style) {
  return STYLE_KEYS.every((key) => !style || !style[key]);
}

function styleOptions() {
  return {
    fonts: FONT_OPTIONS,
    weights: WEIGHTS.filter(Boolean),
    presets: PRESETS,
    emptyStyle: { ...EMPTY_STYLE },
  };
}

module.exports = {
  STYLE_KEY,
  STYLE_KEYS,
  COLOR_KEYS,
  FORM_KEYS,
  FONT_OPTIONS,
  FONT_KEYS,
  WEIGHTS,
  EMPTY_STYLE,
  PRESETS,
  normalizeHex,
  normalizeStyle,
  parseStyle,
  isEmptyStyle,
  styleOptions,
};
