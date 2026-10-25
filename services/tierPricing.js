const cache = require("../lib/cache");
const ProductPriceTier = require("../models/ProductPriceTier");

const TIERS_TTL = 5 * 60 * 1000;

class TierError extends Error {
  constructor(message) {
    super(message);
    this.name = "TierError";
    this.status = 400;
  }
}

// Validates the admin's tier rows and returns contiguous, sorted tiers.
function normalizeTiers(rows) {
  if (rows === undefined || rows === null) return [];
  if (!Array.isArray(rows)) throw new TierError("Tier list array hote hobe");

  const tiers = rows.map((row, index) => {
    const label = `Tier ${index + 1}`;
    const minQty = Number(row && row.minQty);
    if (!Number.isInteger(minQty) || minQty < 1) {
      throw new TierError(`${label}: From qty 1 ba tar beshi integer hote hobe`);
    }

    let maxQty = null;
    const rawMax = row && row.maxQty;
    if (rawMax !== undefined && rawMax !== null && String(rawMax).trim() !== "") {
      maxQty = Number(rawMax);
      if (!Number.isInteger(maxQty) || maxQty < minQty) {
        throw new TierError(`${label}: To qty From qty er cheye boro hote hobe`);
      }
    }

    const pricePaisa = Math.round(Number(row && row.pricePaisa));
    if (!Number.isInteger(pricePaisa) || pricePaisa < 0) {
      throw new TierError(`${label}: Price valid hote hobe`);
    }

    return { minQty, maxQty, pricePaisa };
  });

  tiers.sort((a, b) => a.minQty - b.minQty);

  for (let i = 0; i < tiers.length; i += 1) {
    const prev = tiers[i - 1];
    const current = tiers[i];
    if (i === 0) continue;
    if (prev.maxQty === null) {
      throw new TierError("Last tier er por r tier thakte parbe na");
    }
    if (current.minQty !== prev.maxQty + 1) {
      throw new TierError("Tier range contiguous hote hobe (previous To qty + 1)");
    }
  }

  return tiers;
}

function resolveTier(tiers, quantity) {
  const qty = Math.max(1, Math.round(Number(quantity) || 0));
  for (const tier of tiers || []) {
    if (qty < tier.minQty) continue;
    if (tier.maxQty === null || qty <= tier.maxQty) return tier;
  }
  return null;
}

// Falls back to the retail price when an admin has not configured tiers yet.
function priceForQty(tiers, quantity, fallbackPaisa = 0) {
  const tier = resolveTier(tiers, quantity);
  return {
    tier: tier || null,
    pricePaisa: tier ? tier.pricePaisa : Math.max(0, Math.round(Number(fallbackPaisa) || 0)),
  };
}

function tierCacheKey(storeId, productId, variationId) {
  return `wholesale:tiers:${storeId}:${productId}:${variationId || "none"}`;
}

async function loadTiers(storeId, productId, variationId = null) {
  if (!storeId || !productId) return [];
  const key = tierCacheKey(storeId, productId, variationId);
  const hit = cache.get(key);
  if (hit) return hit;

  const rows = await ProductPriceTier.find({
    store: storeId,
    product: productId,
    variation: variationId || null,
  })
    .sort({ minQty: 1 })
    .lean();

  const tiers = rows.map((row) => ({
    minQty: row.minQty,
    maxQty: row.maxQty,
    pricePaisa: row.pricePaisa,
  }));
  cache.set(key, tiers, TIERS_TTL);
  return tiers;
}

function clearTierCache(storeId, productId) {
  const prefix = productId
    ? `wholesale:tiers:${storeId}:${productId}:`
    : `wholesale:tiers:${storeId}:`;
  cache.invalidatePrefix(prefix);
}

module.exports = {
  TierError,
  normalizeTiers,
  resolveTier,
  priceForQty,
  loadTiers,
  clearTierCache,
};
