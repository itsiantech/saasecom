const mongoose = require("mongoose");
const Product = require("../models/Product");
const InternationalSettings = require("../models/InternationalSettings");
const WholesaleSettings = require("../models/WholesaleSettings");
const { defaultSettings, normalizeSettings } = require("../lib/internationalDefaults");
const { clearInternationalCache } = require("../lib/internationalSettings");
const { calculateLine, PricingError, round2 } = require("../services/internationalPricing");

function readNumber(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function readInt(value, fallback) {
  const n = readNumber(value, fallback);
  return Number.isFinite(n) ? Math.round(n) : NaN;
}

function readLabel(value, fallback) {
  if (value === undefined) return fallback;
  const label = String(value).trim().slice(0, 80);
  return label || fallback;
}

function readEnabled(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
}

function parseSettings(body, current) {
  const input = body && typeof body === "object" ? body : {};
  const airInput = input.air && typeof input.air === "object" ? input.air : {};
  const seaInput = input.sea && typeof input.sea === "object" ? input.sea : {};
  const labelsInput = input.labels && typeof input.labels === "object" ? input.labels : {};

  const advancePercent = readNumber(input.advancePercent, current.advancePercent);
  const codPercent = readNumber(input.codPercent, current.codPercent);
  if (!Number.isFinite(advancePercent) || !Number.isFinite(codPercent)) {
    return { error: "Advance/COD percentage number hote hobe" };
  }
  if (advancePercent < 0 || advancePercent > 100 || codPercent < 0 || codPercent > 100) {
    return { error: "Advance/COD percentage 0 theke 100 er moddhe hote hobe" };
  }
  if (round2(advancePercent + codPercent) !== 100) {
    return { error: "Advance + COD percentage 100 hote hobe" };
  }

  const air = {
    label: readLabel(airInput.label, current.air.label),
    minDays: readInt(airInput.minDays, current.air.minDays),
    maxDays: readInt(airInput.maxDays, current.air.maxDays),
  };
  const sea = {
    label: readLabel(seaInput.label, current.sea.label),
    minDays: readInt(seaInput.minDays, current.sea.minDays),
    maxDays: readInt(seaInput.maxDays, current.sea.maxDays),
  };
  for (const rule of [air, sea]) {
    if (!Number.isFinite(rule.minDays) || !Number.isFinite(rule.maxDays)) {
      return { error: "Delivery days number hote hobe" };
    }
    if (rule.minDays < 0 || rule.maxDays < 0 || rule.minDays > rule.maxDays || rule.maxDays > 365) {
      return { error: "Delivery days 0-365 er moddhe ebong min <= max hote hobe" };
    }
  }

  return {
    value: {
      enabled: readEnabled(input.enabled, current.enabled),
      advancePercent: round2(advancePercent),
      codPercent: round2(codPercent),
      air,
      sea,
      labels: {
        shippingCharge: readLabel(labelsInput.shippingCharge, current.labels.shippingCharge),
        chinaCourier: readLabel(labelsInput.chinaCourier, current.labels.chinaCourier),
      },
    },
  };
}

async function getSettings(req, res, next) {
  try {
    const doc = await InternationalSettings.findOne();
    res.json({ settings: doc ? normalizeSettings(doc.toObject()) : defaultSettings() });
  } catch (err) {
    next(err);
  }
}

async function updateSettings(req, res, next) {
  try {
    const doc = await InternationalSettings.findOne();
    const current = doc ? normalizeSettings(doc.toObject()) : defaultSettings();
    const parsed = parseSettings(req.body, current);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    // Wholesale and international import modes cannot run together.
    if (parsed.value.enabled) {
      const wholesale = await WholesaleSettings.findOne({ store: req.store._id })
        .select("enabled")
        .lean();
      if (wholesale && wholesale.enabled) {
        return res.status(400).json({
          message: "Wholesale mode ON ache — age seta OFF korun",
        });
      }
    }

    let target = doc;
    if (!target) {
      // _id = store id makes the per-store settings document a singleton without an extra unique index.
      target = new InternationalSettings({ _id: req.store._id });
      target.store = req.store._id;
    }
    target.set(parsed.value);
    await target.save();
    clearInternationalCache(req.store._id);

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

async function quote(req, res, next) {
  try {
    const { productId, size, quantity, shippingMode } = req.body || {};
    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({ message: "Product id invalid" });
    }

    const product = await Product.findOne({ _id: productId, status: "published" });
    if (!product) return res.status(404).json({ message: "Product pawa jayni" });

    const doc = await InternationalSettings.findOne();
    const settings = doc ? normalizeSettings(doc.toObject()) : defaultSettings();
    if (!settings.enabled) {
      return res.status(400).json({ message: "International product mode bondho ache" });
    }

    const quoteLine = calculateLine({ product, sizeKey: size, quantity, shippingMode, settings });
    res.json({ quote: quoteLine, settings });
  } catch (err) {
    if (err instanceof PricingError) {
      return res.status(err.status).json({ message: err.message });
    }
    next(err);
  }
}

module.exports = { getSettings, updateSettings, quote };
