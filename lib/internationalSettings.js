const cache = require("./cache");
const InternationalSettings = require("../models/InternationalSettings");
const { defaultSettings, normalizeSettings } = require("./internationalDefaults");

const SETTINGS_TTL = 30 * 1000;

function cacheKey(storeId) {
  return `international:settings:${storeId}`;
}

async function getInternationalSettings(storeId) {
  if (!storeId) return defaultSettings();
  const hit = cache.get(cacheKey(storeId));
  if (hit) return hit;

  const doc = await InternationalSettings.findOne({ store: storeId }).lean();
  const value = doc ? normalizeSettings(doc) : defaultSettings();
  cache.set(cacheKey(storeId), value, SETTINGS_TTL);
  return value;
}

async function isInternational(storeId) {
  const settings = await getInternationalSettings(storeId);
  return settings.enabled === true;
}

function clearInternationalCache(storeId) {
  cache.del(cacheKey(storeId));
}

module.exports = {
  getInternationalSettings,
  isInternational,
  clearInternationalCache,
};
