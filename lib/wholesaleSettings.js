const cache = require("./cache");
const WholesaleSettings = require("../models/WholesaleSettings");
const { defaultSettings, normalizeSettings } = require("./wholesaleDefaults");

const SETTINGS_TTL = 30 * 1000;

function cacheKey(storeId) {
  return `wholesale:settings:${storeId}`;
}

async function getWholesaleSettings(storeId) {
  if (!storeId) return defaultSettings();
  const hit = cache.get(cacheKey(storeId));
  if (hit) return hit;

  const doc = await WholesaleSettings.findOne({ store: storeId }).lean();
  const value = doc ? normalizeSettings(doc) : defaultSettings();
  cache.set(cacheKey(storeId), value, SETTINGS_TTL);
  return value;
}

async function isWholesale(storeId) {
  const settings = await getWholesaleSettings(storeId);
  return settings.enabled === true;
}

// Partial payment is only effective while wholesale mode is on.
async function isPartialPaymentActive(storeId) {
  const settings = await getWholesaleSettings(storeId);
  return settings.enabled === true && settings.partialPaymentEnabled === true;
}

function clearWholesaleCache(storeId) {
  cache.del(cacheKey(storeId));
  cache.invalidatePrefix(`wholesale:tiers:${storeId}:`);
  cache.invalidatePrefix(`wholesale:shipping:${storeId}:`);
  cache.invalidatePrefix(`wholesale:public:${storeId}:`);
}

module.exports = {
  getWholesaleSettings,
  isWholesale,
  isPartialPaymentActive,
  clearWholesaleCache,
};
