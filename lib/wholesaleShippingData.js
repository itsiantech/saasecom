const cache = require("./cache");
const WholesaleShippingRule = require("../models/WholesaleShippingRule");
const WholesaleVehicle = require("../models/WholesaleVehicle");
const WholesaleDeliverySpeed = require("../models/WholesaleDeliverySpeed");
const Category = require("../models/Category");

const TTL = 5 * 60 * 1000;

function cacheKey(storeId) {
  return `wholesale:shipping:${storeId}:data`;
}

async function loadShippingData(storeId) {
  if (!storeId) return { rules: [], vehicles: [], speeds: [] };
  const hit = cache.get(cacheKey(storeId));
  if (hit) return hit;

  const [rules, vehicles, speeds] = await Promise.all([
    WholesaleShippingRule.find({ store: storeId }).lean(),
    WholesaleVehicle.find({ store: storeId }).sort({ sortOrder: 1, maxWeightKg: 1 }).lean(),
    WholesaleDeliverySpeed.find({ store: storeId }).sort({ sortOrder: 1, createdAt: 1 }).lean(),
  ]);

  const categories = rules.length
    ? await Category.find({ _id: { $in: rules.map((rule) => rule.category) } })
        .select("name")
        .lean()
    : [];
  const categoryNames = new Map(categories.map((cat) => [String(cat._id), cat.name || ""]));

  const data = {
    rules: rules.map((rule) => ({
      category: rule.category,
      categoryName: categoryNames.get(String(rule.category)) || "",
      chargeType: rule.chargeType,
      ratePaisa: Number(rule.ratePaisa) || 0,
    })),
    vehicles: vehicles.map((vehicle) => ({
      name: vehicle.name,
      maxWeightKg: Number(vehicle.maxWeightKg) || 0,
      chargePaisa: Number(vehicle.chargePaisa) || 0,
    })),
    speeds: speeds.map((speed) => ({
      _id: speed._id,
      name: speed.name,
      etaDays: Number(speed.etaDays) || 0,
      extraType: speed.extraType,
      extraValue: Number(speed.extraValue) || 0,
    })),
  };
  cache.set(cacheKey(storeId), data, TTL);
  return data;
}

module.exports = { loadShippingData };
