const mongoose = require("mongoose");
const Product = require("../models/Product");
const ProductVariation = require("../models/ProductVariation");
const ProductPriceTier = require("../models/ProductPriceTier");
const Store = require("../models/Store");
const HeroSlide = require("../models/HeroSlide");
const InternationalSettings = require("../models/InternationalSettings");
const SiteSetting = require("../models/SiteSetting");
const ShopFavicon = require("../models/ShopFavicon");
const { publicSlide, sortForPublic } = require("../lib/heroSlides");
const { defaultSettings, normalizeSettings } = require("../lib/internationalDefaults");
const { getWholesaleSettings } = require("../lib/wholesaleSettings");
const { toPaisa, fromPaisa } = require("../lib/money");
const {
  loadLiveFlashSales,
  bestFlashSale,
  publicFlashSale,
} = require("../services/promotions");

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findStore(slug) {
  if (!slug) return null;
  return Store.findOne({ slug: String(slug).toLowerCase() }).select("name slug");
}

async function loadSettings(storeId) {
  const doc = await InternationalSettings.findOne({ store: storeId });
  return doc ? normalizeSettings(doc.toObject()) : defaultSettings();
}

function toCard(product, internationalEnabled) {
  const config = product.internationalConfig;
  const useInternational = internationalEnabled && !!config;
  let price = product.salePrice > 0 ? product.salePrice : product.regularPrice || product.price || 0;
  let stock = Number(product.stock) || 0;

  if (useInternational) {
    const sizes = Array.isArray(config.sizes) ? config.sizes : [];
    const prices = sizes
      .map((row) => Number(row.price))
      .filter((value) => Number.isFinite(value) && value >= 0);
    if (prices.length) price = Math.min(...prices);
    stock = sizes.reduce((sum, row) => sum + (Number(row.stock) || 0), 0);
  }

  return {
    id: product._id,
    name: product.title || product.name || "Unnamed product",
    slug: product.slug,
    image: (product.images && product.images[0]) || "",
    price,
    isInternational: useInternational,
    inStock: stock > 0,
  };
}

async function getStorefront(req, res, next) {
  try {
    const store = await findStore(req.params.slug);
    if (!store) return res.status(404).json({ message: "Store pawa jayni" });
    const [international, site, faviconDoc] = await Promise.all([
      loadSettings(store._id),
      SiteSetting.findOne({ store: store._id }).lean(),
      ShopFavicon.findOne({ store: store._id }).lean(),
    ]);
    res.json({ store, international, branding: brandingFor(store, site, faviconDoc) });
  } catch (err) {
    next(err);
  }
}

// dokaner nijer branding; kichu set na korle shudhu dokan er naam
function brandingFor(store, site, faviconDoc) {
  const doc = site || {};
  return {
    logo: doc.logo || "",
    logoWidth: Number(doc.logoWidth) || 120,
    logoHeight: Number(doc.logoHeight) || 40,
    title: String(doc.siteTitle || "").trim() || store.name,
    favicon: (faviconDoc && faviconDoc.icon) || doc.favicon || "",
    footerLogo: doc.footerLogo || "",
    footerCopyright:
      String(doc.footerCopyright || "").trim() || "© " + new Date().getFullYear() + " " + store.name,
  };
}

async function listHeroSlides(req, res, next) {
  try {
    const store = await findStore(req.params.slug);
    if (!store) return res.status(404).json({ message: "Store pawa jayni" });
    const rows = await HeroSlide.find({ store: store._id }).lean();
    res.json({ slides: sortForPublic(rows).map(publicSlide) });
  } catch (err) {
    next(err);
  }
}

async function listProducts(req, res, next) {
  try {
    const store = await findStore(req.params.slug);
    if (!store) return res.status(404).json({ message: "Store pawa jayni" });

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(60, Math.max(1, parseInt(req.query.limit, 10) || 24));
    const filter = { store: store._id, status: "published" };

    const query = String(req.query.q || "").trim().slice(0, 120);
    if (query) {
      const regex = new RegExp(escapeRegex(query), "i");
      filter.$or = [{ title: regex }, { name: regex }, { shortDescription: regex }];
    }

    const [products, total, international, wholesale, flashSales] = await Promise.all([
      Product.find(filter)
        .select("name title slug images price regularPrice salePrice stock categories internationalConfig.sizes")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Product.countDocuments(filter),
      loadSettings(store._id),
      getWholesaleSettings(store._id),
      loadLiveFlashSales(store._id),
    ]);

    res.json({
      store,
      international,
      wholesale: {
        enabled: wholesale.enabled === true,
        badgeText: wholesale.badgeText,
      },
      products: products.map((product) => {
        const card = {
          ...toCard(product, international.enabled),
          wholesaleBadge: wholesale.enabled ? wholesale.badgeText : "",
        };
        const flash = bestFlashSale({
          sales: flashSales,
          productId: product._id,
          categoryIds: product.categories || [],
          basePaisa: toPaisa(card.price),
        });
        if (flash) {
          card.price = fromPaisa(flash.pricePaisa);
          card.flashSale = {
            ...publicFlashSale(flash.sale),
            price: card.price,
          };
        }
        return card;
      }),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
}

async function getProduct(req, res, next) {
  try {
    const store = await findStore(req.params.slug);
    if (!store) return res.status(404).json({ message: "Store pawa jayni" });

    const key = String(req.params.product || "").trim();
    if (!key) return res.status(404).json({ message: "Product pawa jayni" });

    const filter = { store: store._id, status: "published" };
    if (mongoose.isValidObjectId(key)) {
      filter._id = key;
    } else {
      filter.slug = key.toLowerCase();
    }

    const product = await Product.findOne(filter).lean();
    if (!product) return res.status(404).json({ message: "Product pawa jayni" });

    const [international, wholesale, variations, tierRows, flashSales] = await Promise.all([
      loadSettings(store._id),
      getWholesaleSettings(store._id),
      ProductVariation.find({ store: store._id, product: product._id })
        .select("termName attributeName image regularPrice salePrice stock")
        .sort({ createdAt: 1 })
        .lean(),
      ProductPriceTier.find({ store: store._id, product: product._id })
        .sort({ minQty: 1 })
        .lean(),
      loadLiveFlashSales(store._id),
    ]);

    const productTiers = [];
    const variationTiers = new Map();
    for (const row of tierRows) {
      const tier = { minQty: row.minQty, maxQty: row.maxQty, pricePaisa: row.pricePaisa };
      if (!row.variation) {
        productTiers.push(tier);
        continue;
      }
      const key = String(row.variation);
      if (!variationTiers.has(key)) variationTiers.set(key, []);
      variationTiers.get(key).push(tier);
    }

    const basePrice =
      product.salePrice > 0 ? product.salePrice : product.regularPrice || product.price || 0;
    const flash = bestFlashSale({
      sales: flashSales,
      productId: product._id,
      categoryIds: product.categories || [],
      basePaisa: toPaisa(basePrice),
    });

    res.json({
      store,
      product,
      flashSale: flash
        ? {
            ...publicFlashSale(flash.sale),
            price: fromPaisa(flash.pricePaisa),
            discountPaisa: flash.discountPaisa,
          }
        : null,
      variations: variations.map((v) => ({
        id: v._id,
        termName: v.termName,
        attributeName: v.attributeName,
        image: v.image,
        regularPrice: v.regularPrice,
        salePrice: v.salePrice,
        stock: v.stock,
      })),
      international,
      isInternational: international.enabled && !!product.internationalConfig,
      wholesale: {
        enabled: wholesale.enabled === true,
        badgeText: wholesale.badgeText,
        moq: wholesale.moq,
        buyers: wholesale.buyers,
        showRetailPrice: wholesale.showRetailPrice,
        tiers: productTiers,
        variationTiers: [...variationTiers.entries()].map(([variation, tiers]) => ({
          variation,
          tiers,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getStorefront, listHeroSlides, listProducts, getProduct };
