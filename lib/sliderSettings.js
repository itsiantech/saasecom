const Settings = require("../models/Settings");
const { scopedKey } = require("./settingsScope");
const { normalizeLayout } = require("./heroSlides");

// Slider preferences are one store-level choice (not per slide) kept in the
// legacy key/value Settings collection, scoped to the store like other prefs.
const LAYOUT_KEY = "slider_layout";
const HEIGHT_KEY = "slider_height";
const TRANSITION_KEY = "slider_transition";
const AUTOPLAY_KEY = "slider_autoplay";

const HEIGHT_MIN = 150;
const HEIGHT_MAX = 900;
const HEIGHT_DEFAULT = 420;
const AUTOPLAY_MIN = 1;
const AUTOPLAY_MAX = 15;
const AUTOPLAY_DEFAULT = 3;
const TRANSITIONS = [
  "slide-left-to-right",
  "slide-right-to-left",
  "slide-top-to-bottom",
  "slide-bottom-to-top",
  "fade",
  "zoom",
];

// "" means unusable / never saved; callers decide the theme fallback.
function normalizeHeight(value) {
  if (value === "" || value == null) return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const rounded = Math.round(number);
  if (rounded < HEIGHT_MIN || rounded > HEIGHT_MAX) return "";
  return String(rounded);
}

function normalizeAutoplay(value) {
  if (value === "" || value == null) return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const rounded = Math.round(number);
  if (rounded < AUTOPLAY_MIN || rounded > AUTOPLAY_MAX) return "";
  return String(rounded);
}

function normalizeTransition(value) {
  const transition = String(value == null ? "" : value).trim().toLowerCase();
  return TRANSITIONS.includes(transition) ? transition : "";
}

async function readSliderSettings(storeId) {
  const fallback = {
    layout: "",
    height: HEIGHT_DEFAULT,
    transition: "",
    autoplay: AUTOPLAY_DEFAULT,
  };
  if (!storeId) return fallback;

  const keys = [LAYOUT_KEY, HEIGHT_KEY, TRANSITION_KEY, AUTOPLAY_KEY].map((key) => scopedKey(storeId, key));
  const rows = await Settings.find({ key: { $in: keys } }).select("key value").lean();
  const saved = new Map(rows.map((row) => [row.key, row.value]));
  const pick = (key) => saved.get(scopedKey(storeId, key));

  return {
    layout: normalizeLayout(pick(LAYOUT_KEY)),
    height: Number(normalizeHeight(pick(HEIGHT_KEY))) || HEIGHT_DEFAULT,
    transition: normalizeTransition(pick(TRANSITION_KEY)),
    autoplay: Number(normalizeAutoplay(pick(AUTOPLAY_KEY))) || AUTOPLAY_DEFAULT,
  };
}

async function saveSliderSettings(storeId, body) {
  if (!storeId) throw new Error("Store pawa jayni");
  const input = body || {};
  const writes = [];

  if (input.layout !== undefined) {
    const layout = normalizeLayout(input.layout);
    if (!layout) throw new Error("Slider layout boxed ba full hote hobe");
    writes.push([LAYOUT_KEY, layout]);
  }
  if (input.height !== undefined) {
    const height = normalizeHeight(input.height);
    if (!height) throw new Error(`Slider height ${HEIGHT_MIN}–${HEIGHT_MAX} px er moddhe hote hobe`);
    writes.push([HEIGHT_KEY, height]);
  }
  if (input.transition !== undefined) {
    const transition = normalizeTransition(input.transition);
    if (!transition) throw new Error("Transition effect valid na");
    writes.push([TRANSITION_KEY, transition]);
  }
  if (input.autoplay !== undefined) {
    const autoplay = normalizeAutoplay(input.autoplay);
    if (!autoplay) throw new Error(`Autoplay speed ${AUTOPLAY_MIN}–${AUTOPLAY_MAX} second er moddhe hote hobe`);
    writes.push([AUTOPLAY_KEY, autoplay]);
  }

  for (const [key, value] of writes) {
    const scoped = scopedKey(storeId, key);
    await Settings.updateOne({ key: scoped }, { $set: { key: scoped, value } }, { upsert: true });
  }
  return readSliderSettings(storeId);
}

module.exports = {
  LAYOUT_KEY,
  HEIGHT_KEY,
  TRANSITION_KEY,
  AUTOPLAY_KEY,
  HEIGHT_MIN,
  HEIGHT_MAX,
  HEIGHT_DEFAULT,
  AUTOPLAY_MIN,
  AUTOPLAY_MAX,
  AUTOPLAY_DEFAULT,
  TRANSITIONS,
  normalizeHeight,
  normalizeAutoplay,
  normalizeTransition,
  readSliderSettings,
  saveSliderSettings,
};
