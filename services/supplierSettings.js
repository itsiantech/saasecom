const SupplierSettings = require("../models/SupplierSettings");

const DEFAULTS = {
  autoAdjustStock: false,
  maxOrderQty: 10000,
  timezone: "Asia/Dhaka",
};

function settingsView(doc) {
  return {
    autoAdjustStock: doc ? doc.autoAdjustStock === true : DEFAULTS.autoAdjustStock,
    maxOrderQty: doc && Number.isFinite(Number(doc.maxOrderQty)) ? Number(doc.maxOrderQty) : DEFAULTS.maxOrderQty,
    timezone: (doc && doc.timezone) || DEFAULTS.timezone,
  };
}

async function getSupplierSettings(storeId) {
  if (!storeId) return { ...DEFAULTS };
  const doc = await SupplierSettings.findOne({ store: storeId }).lean();
  return settingsView(doc);
}

async function saveSupplierSettings(storeId, patch, userId) {
  const update = { ...patch, updatedBy: userId || null, store: storeId };
  const doc = await SupplierSettings.findOneAndUpdate(
    { _id: storeId, store: storeId },
    { $set: update },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  ).lean();
  return settingsView(doc);
}

module.exports = { DEFAULTS, getSupplierSettings, saveSupplierSettings, settingsView };
