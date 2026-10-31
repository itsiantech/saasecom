const Settings = require("../models/Settings");
const { scopedKey } = require("./settingsScope");
const { normalizeLayout } = require("./heroSlides");

// Slider layout is one store-level choice (not per slide) kept in the legacy
// key/value Settings collection, scoped to the store like other preferences.
const LAYOUT_KEY = "slider_layout";

async function readSliderLayout(storeId) {
  if (!storeId) return "";
  const row = await Settings.findOne({ key: scopedKey(storeId, LAYOUT_KEY) }).select("value").lean();
  return normalizeLayout(row && row.value);
}

async function saveSliderLayout(storeId, value) {
  if (!storeId) throw new Error("Store pawa jayni");
  const layout = normalizeLayout(value);
  if (!layout) throw new Error("Slider layout boxed ba full hote hobe");
  const key = scopedKey(storeId, LAYOUT_KEY);
  await Settings.updateOne({ key }, { $set: { key, value: layout } }, { upsert: true });
  return layout;
}

module.exports = { LAYOUT_KEY, readSliderLayout, saveSliderLayout };
