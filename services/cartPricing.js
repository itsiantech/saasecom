const User = require("../models/User");
const { getWholesaleSettings } = require("../lib/wholesaleSettings");
const { loadTiers, priceForQty } = require("./tierPricing");
const { toPaisa, fromPaisa } = require("../lib/money");

class WholesaleCartError extends Error {
  constructor(message) {
    super(message);
    this.name = "WholesaleCartError";
    this.status = 400;
  }
}

// A variation can have its own tier set; otherwise the product tiers apply.
function pickTiers(variationTiers, productTiers) {
  const own = Array.isArray(variationTiers) ? variationTiers : [];
  return own.length ? own : Array.isArray(productTiers) ? productTiers : [];
}

// Global MOQ and the first tier's From qty both act as a floor.
function effectiveMinQty(settings, tiers) {
  const moq = Math.max(1, Math.round(Number(settings && settings.moq) || 1));
  const first = tiers && tiers.length
    ? Math.max(1, Math.round(Number(tiers[0].minQty) || 1))
    : 1;
  return Math.max(moq, first);
}

async function loadApplicableTiers(storeId, productId, variationId = null) {
  if (!storeId || !productId) return [];
  const [variationTiers, productTiers] = await Promise.all([
    variationId ? loadTiers(storeId, productId, variationId) : Promise.resolve([]),
    loadTiers(storeId, productId, null),
  ]);
  return pickTiers(variationTiers, productTiers);
}

function retailPricing(retailPrice) {
  const paisa = toPaisa(retailPrice);
  return {
    unitPrice: fromPaisa(paisa),
    unitPricePaisa: paisa,
    retailUnitPricePaisa: paisa,
    pricingMode: "retail",
    tierMinQty: null,
    tierMaxQty: null,
    minQty: 1,
    settings: null,
  };
}

async function resolveWholesaleLine({
  storeId,
  productId,
  variationId = null,
  quantity,
  retailPrice,
  userId = null,
}) {
  const settings = await getWholesaleSettings(storeId);
  if (!settings.enabled) return null;

  if (settings.buyers === "approved") {
    if (!userId) {
      throw new WholesaleCartError("Approved wholesale buyer hisebe login korun");
    }
    const buyer = await User.findOne({ _id: userId }).select("wholesaleApproved");
    if (!buyer || buyer.wholesaleApproved !== true) {
      throw new WholesaleCartError("Ei store er approved wholesale buyer lagbe");
    }
  }

  const qty = Math.max(1, Math.round(Number(quantity) || 1));
  const tiers = await loadApplicableTiers(storeId, productId, variationId);
  const minQty = effectiveMinQty(settings, tiers);
  if (qty < minQty) {
    throw new WholesaleCartError(`Minimum order quantity ${minQty} piece`);
  }

  const retailUnitPricePaisa = toPaisa(retailPrice);
  const picked = priceForQty(tiers, qty, retailUnitPricePaisa);
  return {
    unitPrice: fromPaisa(picked.pricePaisa),
    unitPricePaisa: picked.pricePaisa,
    retailUnitPricePaisa,
    pricingMode: "wholesale",
    tierMinQty: picked.tier ? picked.tier.minQty : null,
    tierMaxQty: picked.tier ? picked.tier.maxQty : null,
    minQty,
    settings,
  };
}

module.exports = {
  WholesaleCartError,
  pickTiers,
  effectiveMinQty,
  loadApplicableTiers,
  retailPricing,
  resolveWholesaleLine,
};
