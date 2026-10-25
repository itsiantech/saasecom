const mongoose = require("mongoose");
const WholesaleSettings = require("../models/WholesaleSettings");
const InternationalSettings = require("../models/InternationalSettings");
const ProductPriceTier = require("../models/ProductPriceTier");
const WholesaleShippingRule = require("../models/WholesaleShippingRule");
const WholesaleVehicle = require("../models/WholesaleVehicle");
const WholesaleDeliverySpeed = require("../models/WholesaleDeliverySpeed");
const InstallmentPlan = require("../models/InstallmentPlan");
const Product = require("../models/Product");
const ProductVariation = require("../models/ProductVariation");
const Category = require("../models/Category");
const User = require("../models/User");
const Order = require("../models/Order");
const { defaultSettings, normalizeSettings } = require("../lib/wholesaleDefaults");
const { getWholesaleSettings, clearWholesaleCache } = require("../lib/wholesaleSettings");
const { normalizeTiers, clearTierCache } = require("../services/tierPricing");
const { writeAudit } = require("../lib/audit");
const cache = require("../lib/cache");

function readBool(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
}

function readInt(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  const result = Math.round(n);
  if (result < min || (max !== undefined && result > max)) return NaN;
  return result;
}

function readEnum(value, allowed, fallback) {
  if (value === undefined) return fallback;
  return allowed.includes(value) ? value : NaN;
}

function invalidateShippingCache(storeId) {
  cache.invalidatePrefix(`wholesale:shipping:${storeId}:`);
  clearWholesaleCache(storeId);
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */
function parseSettings(body, current) {
  const input = body && typeof body === "object" ? body : {};

  const badgeText =
    input.badgeText === undefined ? current.badgeText : String(input.badgeText).trim();
  if (!badgeText || badgeText.length > 40) {
    return { error: "Badge text 1-40 character hote hobe" };
  }

  const moq = readInt(input.moq, current.moq, 1, 1000000);
  if (!Number.isInteger(moq)) return { error: "MOQ 1 ba tar beshi hote hobe" };

  const buyers = readEnum(input.buyers, ["all", "approved"], current.buyers);
  if (Number.isNaN(buyers)) return { error: "Buyer option valid na" };

  const vehicleOverflowRule = readEnum(
    input.vehicleOverflowRule,
    ["cheapest", "largest_first"],
    current.vehicleOverflowRule
  );
  if (Number.isNaN(vehicleOverflowRule)) return { error: "Vehicle overflow rule valid na" };

  const lateFeePaisa = readInt(input.lateFeePaisa, current.lateFeePaisa, 0);
  if (!Number.isInteger(lateFeePaisa)) return { error: "Late fee valid amount hote hobe" };

  const lateFeeType = readEnum(input.lateFeeType, ["flat", "percent"], current.lateFeeType);
  if (Number.isNaN(lateFeeType)) return { error: "Late fee type valid na" };

  const graceDays = readInt(input.graceDays, current.graceDays, 0, 365);
  if (!Number.isInteger(graceDays)) return { error: "Grace days 0-365 er moddhe hote hobe" };

  const maxOpenInstallmentOrders = readInt(
    input.maxOpenInstallmentOrders,
    current.maxOpenInstallmentOrders,
    0
  );
  if (!Number.isInteger(maxOpenInstallmentOrders)) {
    return { error: "Max open installment orders valid hote hobe" };
  }

  const goodsReleaseRule = readEnum(
    input.goodsReleaseRule,
    ["after_advance", "after_half", "after_full"],
    current.goodsReleaseRule
  );
  if (Number.isNaN(goodsReleaseRule)) return { error: "Goods release rule valid na" };

  const installmentBuyers = readEnum(
    input.installmentBuyers,
    ["approved", "all"],
    current.installmentBuyers
  );
  if (Number.isNaN(installmentBuyers)) return { error: "Installment buyer option valid na" };

  const overdueAction = readEnum(input.overdueAction, ["hold", "cancel"], current.overdueAction);
  if (Number.isNaN(overdueAction)) return { error: "Overdue action valid na" };

  const overdueDays = readInt(input.overdueDays, current.overdueDays, 0, 365);
  if (!Number.isInteger(overdueDays)) return { error: "Overdue days 0-365 er moddhe hote hobe" };

  const refundType = readEnum(
    input.refundType,
    ["full", "percent", "none"],
    current.refundType
  );
  if (Number.isNaN(refundType)) return { error: "Refund type valid na" };

  const refundPercent = readInt(input.refundPercent, current.refundPercent, 0, 100);
  if (!Number.isInteger(refundPercent)) return { error: "Refund percent 0-100 er moddhe hote hobe" };

  return {
    value: {
      enabled: readBool(input.enabled, current.enabled),
      badgeText,
      moq,
      buyers,
      showRetailPrice: readBool(input.showRetailPrice, current.showRetailPrice),
      vehicleOverflowRule,
      partialPaymentEnabled: readBool(
        input.partialPaymentEnabled,
        current.partialPaymentEnabled
      ),
      lateFeePaisa,
      lateFeeType,
      graceDays,
      maxOpenInstallmentOrders,
      goodsReleaseRule,
      installmentBuyers,
      shippingInFirstInstallment: readBool(
        input.shippingInFirstInstallment,
        current.shippingInFirstInstallment
      ),
      overdueAction,
      overdueDays,
      refundType,
      refundPercent,
    },
  };
}

async function getSettings(req, res, next) {
  try {
    const settings = await getWholesaleSettings(req.store._id);
    res.json({ settings });
  } catch (err) {
    next(err);
  }
}

async function updateSettings(req, res, next) {
  try {
    const storeId = req.store._id;
    const doc = await WholesaleSettings.findOne({ store: storeId });
    const current = doc ? normalizeSettings(doc.toObject()) : defaultSettings();
    const parsed = parseSettings(req.body, current);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    if (parsed.value.enabled) {
      const intl = await InternationalSettings.findOne({ store: storeId })
        .select("enabled")
        .lean();
      if (intl && intl.enabled) {
        return res.status(400).json({
          message: "International import mode ON ache — age seta OFF korun",
        });
      }
    }

    const target = doc || new WholesaleSettings({ _id: storeId });
    target.store = storeId;
    target.set(parsed.value);
    await target.save();

    clearWholesaleCache(storeId);
    await writeAudit({
      store: storeId,
      user: req.user && req.user.id,
      action: "wholesale.settings_update",
      entity: "WholesaleSettings",
      entityId: target._id,
      oldValue: current,
      newValue: parsed.value,
    });

    res.json({ settings: normalizeSettings(target.toObject()) });
  } catch (err) {
    if (err.name === "ValidationError") {
      const first = Object.values(err.errors)[0];
      return res.status(400).json({ message: first ? first.message : err.message });
    }
    if (err.code === 11000) {
      return res.status(409).json({ message: "Settings save conflict, abar try korun" });
    }
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Product price tiers
 * ------------------------------------------------------------------ */
async function resolveVariation(productId, variationId, storeId) {
  if (!variationId) return null;
  if (!mongoose.isValidObjectId(variationId)) return false;
  const variation = await ProductVariation.findOne({
    _id: variationId,
    product: productId,
    store: storeId,
  }).select("_id");
  return variation || false;
}

async function getProductTiers(req, res, next) {
  try {
    const storeId = req.store._id;
    const product = await Product.findOne({ _id: req.params.productId, store: storeId }).select("_id");
    if (!product) return res.status(404).json({ message: "Product pawa jayni" });

    const variationId = req.query.variationId || null;
    if (variationId && !(await resolveVariation(product._id, variationId, storeId))) {
      return res.status(400).json({ message: "Variation valid na" });
    }

    const rows = await ProductPriceTier.find({
      store: storeId,
      product: product._id,
      variation: variationId || null,
    })
      .sort({ minQty: 1 })
      .lean();

    res.json({
      tiers: rows.map((row) => ({
        minQty: row.minQty,
        maxQty: row.maxQty,
        pricePaisa: row.pricePaisa,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function saveProductTiers(req, res, next) {
  try {
    const storeId = req.store._id;
    const product = await Product.findOne({ _id: req.params.productId, store: storeId }).select("_id");
    if (!product) return res.status(404).json({ message: "Product pawa jayni" });

    const variationId = (req.body && req.body.variationId) || null;
    if (variationId && !(await resolveVariation(product._id, variationId, storeId))) {
      return res.status(400).json({ message: "Variation valid na" });
    }

    let tiers;
    try {
      tiers = normalizeTiers(req.body && req.body.tiers);
    } catch (err) {
      if (err.name === "TierError") return res.status(400).json({ message: err.message });
      throw err;
    }

    const filter = { store: storeId, product: product._id, variation: variationId || null };
    const before = await ProductPriceTier.find(filter).sort({ minQty: 1 }).lean();
    await ProductPriceTier.deleteMany(filter);
    if (tiers.length) {
      await ProductPriceTier.insertMany(
        tiers.map((tier) => ({ ...tier, product: product._id, variation: variationId || null, store: storeId }))
      );
    }

    clearTierCache(storeId, product._id);
    await writeAudit({
      store: storeId,
      user: req.user && req.user.id,
      action: "wholesale.tiers_update",
      entity: "ProductPriceTier",
      entityId: product._id,
      oldValue: before.map(({ minQty, maxQty, pricePaisa }) => ({ minQty, maxQty, pricePaisa })),
      newValue: tiers,
    });

    res.json({ tiers });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Shipping rules
 * ------------------------------------------------------------------ */
function parseRule(body) {
  const input = body || {};
  if (!mongoose.isValidObjectId(input.categoryId)) {
    return { error: "Category select korun" };
  }
  const chargeType = ["per_piece", "per_kg", "flat"].includes(input.chargeType)
    ? input.chargeType
    : null;
  if (!chargeType) return { error: "Charge type valid na" };
  const ratePaisa = readInt(input.ratePaisa, NaN, 0);
  if (!Number.isInteger(ratePaisa)) return { error: "Rate valid amount hote hobe" };
  return { value: { category: input.categoryId, chargeType, ratePaisa } };
}

async function listShippingRules(req, res, next) {
  try {
    const rules = await WholesaleShippingRule.find({ store: req.store._id })
      .sort({ createdAt: 1 })
      .lean();
    res.json({ rules });
  } catch (err) {
    next(err);
  }
}

async function createShippingRule(req, res, next) {
  try {
    const parsed = parseRule(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    const category = await Category.findOne({
      _id: parsed.value.category,
      store: req.store._id,
    }).select("_id");
    if (!category) return res.status(400).json({ message: "Category pawa jayni" });

    const exists = await WholesaleShippingRule.findOne({
      store: req.store._id,
      category: parsed.value.category,
    }).select("_id");
    if (exists) return res.status(409).json({ message: "Ei category er rule age theke ache" });

    const rule = await WholesaleShippingRule.create({ ...parsed.value, store: req.store._id });
    invalidateShippingCache(req.store._id);
    await writeAudit({
      store: req.store._id,
      user: req.user && req.user.id,
      action: "wholesale.shipping_rule_create",
      entity: "WholesaleShippingRule",
      entityId: rule._id,
      oldValue: null,
      newValue: parsed.value,
    });
    res.status(201).json({ rule });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "Ei category er rule age theke ache" });
    }
    next(err);
  }
}

async function updateShippingRule(req, res, next) {
  try {
    const parsed = parseRule(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    const category = await Category.findOne({
      _id: parsed.value.category,
      store: req.store._id,
    }).select("_id");
    if (!category) return res.status(400).json({ message: "Category pawa jayni" });

    const before = await WholesaleShippingRule.findOne({
      _id: req.params.id,
      store: req.store._id,
    }).lean();
    if (!before) return res.status(404).json({ message: "Rule pawa jayni" });

    const duplicate = await WholesaleShippingRule.findOne({
      store: req.store._id,
      category: parsed.value.category,
      _id: { $ne: before._id },
    }).select("_id");
    if (duplicate) return res.status(409).json({ message: "Ei category er rule age theke ache" });

    const rule = await WholesaleShippingRule.findByIdAndUpdate(
      before._id,
      { $set: parsed.value },
      { new: true, runValidators: true }
    );
    invalidateShippingCache(req.store._id);
    await writeAudit({
      store: req.store._id,
      user: req.user && req.user.id,
      action: "wholesale.shipping_rule_update",
      entity: "WholesaleShippingRule",
      entityId: before._id,
      oldValue: { category: before.category, chargeType: before.chargeType, ratePaisa: before.ratePaisa },
      newValue: parsed.value,
    });
    res.json({ rule });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "Ei category er rule age theke ache" });
    }
    next(err);
  }
}

async function deleteShippingRule(req, res, next) {
  try {
    const rule = await WholesaleShippingRule.findOneAndDelete({
      _id: req.params.id,
      store: req.store._id,
    }).lean();
    if (!rule) return res.status(404).json({ message: "Rule pawa jayni" });
    invalidateShippingCache(req.store._id);
    await writeAudit({
      store: req.store._id,
      user: req.user && req.user.id,
      action: "wholesale.shipping_rule_delete",
      entity: "WholesaleShippingRule",
      entityId: rule._id,
      oldValue: { category: rule.category, chargeType: rule.chargeType, ratePaisa: rule.ratePaisa },
      newValue: null,
    });
    res.json({ message: "Rule delete hoyeche" });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Vehicles
 * ------------------------------------------------------------------ */
function parseVehicle(body, current = {}) {
  const input = body || {};
  const name =
    input.name === undefined ? current.name : String(input.name || "").trim().slice(0, 60);
  if (!name) return { error: "Vehicle name lagbe" };
  const maxWeightKg = readInt(input.maxWeightKg, current.maxWeightKg, 1, 1000000);
  if (!Number.isInteger(maxWeightKg)) return { error: "Max load valid kg hote hobe" };
  const chargePaisa = readInt(input.chargePaisa, current.chargePaisa, 0);
  if (!Number.isInteger(chargePaisa)) return { error: "Vehicle charge valid amount hote hobe" };
  const sortOrder = readInt(input.sortOrder, current.sortOrder || 0, 0);
  if (!Number.isInteger(sortOrder)) return { error: "Sort order valid hote hobe" };
  return { value: { name, maxWeightKg, chargePaisa, sortOrder } };
}

async function listVehicles(req, res, next) {
  try {
    const vehicles = await WholesaleVehicle.find({ store: req.store._id })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
    res.json({ vehicles });
  } catch (err) {
    next(err);
  }
}

async function createVehicle(req, res, next) {
  try {
    const parsed = parseVehicle(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });
    const vehicle = await WholesaleVehicle.create({ ...parsed.value, store: req.store._id });
    invalidateShippingCache(req.store._id);
    await writeAudit({
      store: req.store._id,
      user: req.user && req.user.id,
      action: "wholesale.vehicle_create",
      entity: "WholesaleVehicle",
      entityId: vehicle._id,
      oldValue: null,
      newValue: parsed.value,
    });
    res.status(201).json({ vehicle });
  } catch (err) {
    next(err);
  }
}

async function updateVehicle(req, res, next) {
  try {
    const before = await WholesaleVehicle.findOne({
      _id: req.params.id,
      store: req.store._id,
    }).lean();
    if (!before) return res.status(404).json({ message: "Vehicle pawa jayni" });
    const parsed = parseVehicle(req.body, before);
    if (parsed.error) return res.status(400).json({ message: parsed.error });
    const vehicle = await WholesaleVehicle.findByIdAndUpdate(
      before._id,
      { $set: parsed.value },
      { new: true, runValidators: true }
    );
    invalidateShippingCache(req.store._id);
    await writeAudit({
      store: req.store._id,
      user: req.user && req.user.id,
      action: "wholesale.vehicle_update",
      entity: "WholesaleVehicle",
      entityId: before._id,
      oldValue: {
        name: before.name,
        maxWeightKg: before.maxWeightKg,
        chargePaisa: before.chargePaisa,
        sortOrder: before.sortOrder,
      },
      newValue: parsed.value,
    });
    res.json({ vehicle });
  } catch (err) {
    next(err);
  }
}

async function deleteVehicle(req, res, next) {
  try {
    const vehicle = await WholesaleVehicle.findOneAndDelete({
      _id: req.params.id,
      store: req.store._id,
    });
    if (!vehicle) return res.status(404).json({ message: "Vehicle pawa jayni" });
    invalidateShippingCache(req.store._id);
    await writeAudit({
      store: req.store._id,
      user: req.user && req.user.id,
      action: "wholesale.vehicle_delete",
      entity: "WholesaleVehicle",
      entityId: vehicle._id,
      oldValue: {
        name: vehicle.name,
        maxWeightKg: vehicle.maxWeightKg,
        chargePaisa: vehicle.chargePaisa,
        sortOrder: vehicle.sortOrder,
      },
      newValue: null,
    });
    res.json({ message: "Vehicle delete hoyeche" });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Delivery speeds
 * ------------------------------------------------------------------ */
function parseSpeed(body, current = {}) {
  const input = body || {};
  const name =
    input.name === undefined ? current.name : String(input.name || "").trim().slice(0, 60);
  if (!name) return { error: "Speed name lagbe" };
  const etaDays = readInt(input.etaDays, current.etaDays, 0, 365);
  if (!Number.isInteger(etaDays)) return { error: "Delivery days 0-365 er moddhe hote hobe" };
  const extraType =
    input.extraType === undefined ? current.extraType : input.extraType;
  if (!["flat", "percent"].includes(extraType)) return { error: "Extra charge type valid na" };
  const extraValue = readInt(input.extraValue, current.extraValue, 0);
  if (!Number.isInteger(extraValue)) return { error: "Extra charge valid hote hobe" };
  if (extraType === "percent" && extraValue > 10000) {
    return { error: "Percent extra 0-100% er moddhe hote hobe" };
  }
  const sortOrder = readInt(input.sortOrder, current.sortOrder || 0, 0);
  if (!Number.isInteger(sortOrder)) return { error: "Sort order valid hote hobe" };
  return { value: { name, etaDays, extraType, extraValue, sortOrder } };
}

async function listSpeeds(req, res, next) {
  try {
    const speeds = await WholesaleDeliverySpeed.find({ store: req.store._id })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
    res.json({ speeds });
  } catch (err) {
    next(err);
  }
}

async function createSpeed(req, res, next) {
  try {
    const parsed = parseSpeed(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });
    const speed = await WholesaleDeliverySpeed.create({ ...parsed.value, store: req.store._id });
    invalidateShippingCache(req.store._id);
    await writeAudit({
      store: req.store._id,
      user: req.user && req.user.id,
      action: "wholesale.speed_create",
      entity: "WholesaleDeliverySpeed",
      entityId: speed._id,
      oldValue: null,
      newValue: parsed.value,
    });
    res.status(201).json({ speed });
  } catch (err) {
    next(err);
  }
}

async function updateSpeed(req, res, next) {
  try {
    const before = await WholesaleDeliverySpeed.findOne({
      _id: req.params.id,
      store: req.store._id,
    }).lean();
    if (!before) return res.status(404).json({ message: "Speed pawa jayni" });
    const parsed = parseSpeed(req.body, before);
    if (parsed.error) return res.status(400).json({ message: parsed.error });
    const speed = await WholesaleDeliverySpeed.findByIdAndUpdate(
      before._id,
      { $set: parsed.value },
      { new: true, runValidators: true }
    );
    invalidateShippingCache(req.store._id);
    await writeAudit({
      store: req.store._id,
      user: req.user && req.user.id,
      action: "wholesale.speed_update",
      entity: "WholesaleDeliverySpeed",
      entityId: before._id,
      oldValue: {
        name: before.name,
        etaDays: before.etaDays,
        extraType: before.extraType,
        extraValue: before.extraValue,
        sortOrder: before.sortOrder,
      },
      newValue: parsed.value,
    });
    res.json({ speed });
  } catch (err) {
    next(err);
  }
}

async function deleteSpeed(req, res, next) {
  try {
    const speed = await WholesaleDeliverySpeed.findOneAndDelete({
      _id: req.params.id,
      store: req.store._id,
    });
    if (!speed) return res.status(404).json({ message: "Speed pawa jayni" });
    invalidateShippingCache(req.store._id);
    await writeAudit({
      store: req.store._id,
      user: req.user && req.user.id,
      action: "wholesale.speed_delete",
      entity: "WholesaleDeliverySpeed",
      entityId: speed._id,
      oldValue: {
        name: speed.name,
        etaDays: speed.etaDays,
        extraType: speed.extraType,
        extraValue: speed.extraValue,
        sortOrder: speed.sortOrder,
      },
      newValue: null,
    });
    res.json({ message: "Speed delete hoyeche" });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Installment plans
 * ------------------------------------------------------------------ */
function parsePlan(body, current = {}) {
  const input = body || {};
  const name =
    input.name === undefined ? current.name : String(input.name || "").trim().slice(0, 80);
  if (!name) return { error: "Plan name lagbe" };

  const installmentsCount = readInt(input.installmentsCount, current.installmentsCount, 2, 60);
  if (!Number.isInteger(installmentsCount)) {
    return { error: "Installment count 2-60 er moddhe hote hobe" };
  }

  const advanceType = input.advanceType === undefined ? current.advanceType : input.advanceType;
  if (!["percent", "fixed"].includes(advanceType)) {
    return { error: "Advance type valid na" };
  }
  const advanceValue = readInt(input.advanceValue, current.advanceValue, 0);
  if (!Number.isInteger(advanceValue)) return { error: "Advance value valid hote hobe" };
  if (advanceType === "percent" && advanceValue > 10000) {
    return { error: "Advance percent 0-100% er moddhe hote hobe" };
  }

  const gapDays = readInt(input.gapDays, current.gapDays || 0, 0, 365);
  if (!Number.isInteger(gapDays)) return { error: "Gap days 0-365 er moddhe hote hobe" };

  const minOrderAmountPaisa = readInt(
    input.minOrderAmountPaisa,
    current.minOrderAmountPaisa || 0,
    0
  );
  if (!Number.isInteger(minOrderAmountPaisa)) {
    return { error: "Minimum order amount valid hote hobe" };
  }

  const feeType = input.feeType === undefined ? current.feeType || "none" : input.feeType;
  if (!["none", "percent", "fixed"].includes(feeType)) {
    return { error: "Fee type valid na" };
  }
  const feeValue = readInt(input.feeValue, current.feeValue || 0, 0);
  if (!Number.isInteger(feeValue)) return { error: "Fee value valid hote hobe" };
  if (feeType === "percent" && feeValue > 10000) {
    return { error: "Fee percent 0-100% er moddhe hote hobe" };
  }

  const isActive = readBool(input.isActive, current.isActive === undefined ? true : current.isActive);
  const sortOrder = readInt(input.sortOrder, current.sortOrder || 0, 0);
  if (!Number.isInteger(sortOrder)) return { error: "Sort order valid hote hobe" };

  return {
    value: {
      name,
      installmentsCount,
      advanceType,
      advanceValue,
      gapDays,
      minOrderAmountPaisa,
      feeType,
      feeValue,
      isActive,
      sortOrder,
    },
  };
}

async function listPlans(req, res, next) {
  try {
    const plans = await InstallmentPlan.find({ store: req.store._id })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
    res.json({ plans });
  } catch (err) {
    next(err);
  }
}

async function createPlan(req, res, next) {
  try {
    const parsed = parsePlan(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });
    const plan = await InstallmentPlan.create({ ...parsed.value, store: req.store._id });
    clearWholesaleCache(req.store._id);
    await writeAudit({
      store: req.store._id,
      user: req.user && req.user.id,
      action: "installment.plan_create",
      entity: "InstallmentPlan",
      entityId: plan._id,
      oldValue: null,
      newValue: parsed.value,
    });
    res.status(201).json({ plan });
  } catch (err) {
    next(err);
  }
}

async function updatePlan(req, res, next) {
  try {
    const before = await InstallmentPlan.findOne({
      _id: req.params.id,
      store: req.store._id,
    }).lean();
    if (!before) return res.status(404).json({ message: "Plan pawa jayni" });
    const parsed = parsePlan(req.body, before);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    const plan = await InstallmentPlan.findByIdAndUpdate(
      before._id,
      { $set: parsed.value },
      { new: true, runValidators: true }
    );
    clearWholesaleCache(req.store._id);
    await writeAudit({
      store: req.store._id,
      user: req.user && req.user.id,
      action: "installment.plan_update",
      entity: "InstallmentPlan",
      entityId: before._id,
      oldValue: {
        name: before.name,
        installmentsCount: before.installmentsCount,
        advanceType: before.advanceType,
        advanceValue: before.advanceValue,
        gapDays: before.gapDays,
        minOrderAmountPaisa: before.minOrderAmountPaisa,
        feeType: before.feeType,
        feeValue: before.feeValue,
        isActive: before.isActive,
      },
      newValue: parsed.value,
    });
    res.json({ plan });
  } catch (err) {
    next(err);
  }
}

async function deletePlan(req, res, next) {
  try {
    const plan = await InstallmentPlan.findOneAndDelete({
      _id: req.params.id,
      store: req.store._id,
    }).lean();
    if (!plan) return res.status(404).json({ message: "Plan pawa jayni" });
    clearWholesaleCache(req.store._id);
    await writeAudit({
      store: req.store._id,
      user: req.user && req.user.id,
      action: "installment.plan_delete",
      entity: "InstallmentPlan",
      entityId: plan._id,
      oldValue: plan,
      newValue: null,
    });
    res.json({ message: "Plan delete hoyeche" });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Buyer approvals (wholesale / installment eligibility)
 * ------------------------------------------------------------------ */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function listBuyers(req, res, next) {
  try {
    const filter = { role: "customer" };

    // SaaS e ek store er admin onno store er customer dekhte parbe na —
    // jei customer ei store theke order koreche shudhu tader dekhai.
    if (req.saas) {
      const customerIds = await Order.distinct("customer", {
        store: req.store._id,
        customer: { $ne: null },
      });
      filter._id = { $in: customerIds };
    }

    const search = String(req.query.search || "").trim();
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }

    const buyers = await User.find(filter)
      .select("name email phone wholesaleApproved createdAt")
      .sort({ name: 1, createdAt: 1 })
      .limit(200)
      .lean();

    res.json({ buyers });
  } catch (err) {
    next(err);
  }
}

async function setBuyerApproval(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Buyer pawa jayni" });
    }
    const buyer = await User.findOne({ _id: req.params.id, role: "customer" });
    if (!buyer) return res.status(404).json({ message: "Buyer pawa jayni" });

    if (req.saas) {
      const ordered = await Order.exists({ customer: buyer._id, store: req.store._id });
      if (!ordered) return res.status(404).json({ message: "Ei store er buyer pawa jayni" });
    }

    const approved = req.body && req.body.approved === true;
    const before = buyer.wholesaleApproved === true;
    if (before !== approved) {
      buyer.wholesaleApproved = approved;
      await buyer.save();
      await writeAudit({
        store: req.store._id,
        user: req.user && req.user.id,
        action: approved ? "wholesale.buyer_approve" : "wholesale.buyer_revoke",
        entity: "User",
        entityId: buyer._id,
        oldValue: { wholesaleApproved: before },
        newValue: { wholesaleApproved: approved },
      });
    }

    res.json({
      buyer: {
        _id: buyer._id,
        name: buyer.name,
        email: buyer.email,
        phone: buyer.phone,
        wholesaleApproved: buyer.wholesaleApproved === true,
      },
    });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Public config for checkout / storefront
 * ------------------------------------------------------------------ */
async function publicConfig(req, res, next) {
  try {
    const storeId = req.store._id;
    const settings = await getWholesaleSettings(storeId);
    if (!settings.enabled) return res.json({ enabled: false });

    const [plans, speeds] = await Promise.all([
      settings.partialPaymentEnabled
        ? InstallmentPlan.find({ store: storeId, isActive: true })
            .sort({ sortOrder: 1, createdAt: 1 })
            .lean()
        : Promise.resolve([]),
      WholesaleDeliverySpeed.find({ store: storeId })
        .sort({ sortOrder: 1, createdAt: 1 })
        .lean(),
    ]);

    res.json({
      enabled: true,
      badgeText: settings.badgeText,
      moq: settings.moq,
      buyers: settings.buyers,
      showRetailPrice: settings.showRetailPrice,
      vehicleOverflowRule: settings.vehicleOverflowRule,
      partialPayment: {
        enabled: settings.partialPaymentEnabled,
        installmentBuyers: settings.installmentBuyers,
        goodsReleaseRule: settings.goodsReleaseRule,
        shippingInFirstInstallment: settings.shippingInFirstInstallment,
        graceDays: settings.graceDays,
      },
      plans: plans.map((plan) => ({
        id: plan._id,
        name: plan.name,
        installmentsCount: plan.installmentsCount,
        advanceType: plan.advanceType,
        advanceValue: plan.advanceValue,
        gapDays: plan.gapDays,
        minOrderAmountPaisa: plan.minOrderAmountPaisa,
        feeType: plan.feeType,
        feeValue: plan.feeValue,
      })),
      speeds: speeds.map((speed) => ({
        id: speed._id,
        name: speed.name,
        etaDays: speed.etaDays,
        extraType: speed.extraType,
        extraValue: speed.extraValue,
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSettings,
  updateSettings,
  getProductTiers,
  saveProductTiers,
  listShippingRules,
  createShippingRule,
  updateShippingRule,
  deleteShippingRule,
  listVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  listSpeeds,
  createSpeed,
  updateSpeed,
  deleteSpeed,
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  listBuyers,
  setBuyerApproval,
  publicConfig,
};
