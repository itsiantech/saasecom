const mongoose = require("mongoose");
const Product = require("../models/Product");
const Attribute = require("../models/Attribute");
const AttributeTerm = require("../models/AttributeTerm");
const ProductVariation = require("../models/ProductVariation");
const ProductSwatch = require("../models/ProductSwatch");
const ProductPriceTier = require("../models/ProductPriceTier");
const Tag = require("../models/Tag");
const ProductTag = require("../models/ProductTag");
const ProductCategory = require("../models/ProductCategory");
const Category = require("../models/Category");
const Brand = require("../models/Brand");
const Settings = require("../models/Settings");
const { getStoreId } = require("../lib/tenantContext");
const { scopedKey, isScopedKey, unscopeKey, keysForStore } = require("../lib/settingsScope");
const { slugify, uniqueSlug, buildTree } = require("../lib/categoryHelpers");
const { normalizeTiers, clearTierCache } = require("../services/tierPricing");
const { writeAudit } = require("../lib/audit");
const { getWholesaleSettings } = require("../lib/wholesaleSettings");

function storeIdOf(req) {
  if (req.store && req.store._id) return req.store._id;
  return getStoreId();
}

const SUPER_KEYS = ["productAttributesEnabled", "productSwatchesEnabled"];
// Settings page (Settings > Product settings) er nirdishto keys
const PRODUCT_SETTING_KEYS = ["attributes_enabled", "swatches_enabled", ...SUPER_KEYS];

async function getSettings(storeId) {
  const docs = await Settings.find({ key: { $in: keysForStore(storeId, PRODUCT_SETTING_KEYS) } }).lean();
  const map = {};
  docs.forEach((d) => { if (!isScopedKey(storeId, d.key)) map[d.key] = d.value; });
  docs.forEach((d) => { if (isScopedKey(storeId, d.key)) map[unscopeKey(storeId, d.key)] = d.value; });
  // notun key na thakle purono key te fallback (migration-safe)
  const attr = map.attributes_enabled !== undefined ? map.attributes_enabled : map.productAttributesEnabled;
  const sw = map.swatches_enabled !== undefined ? map.swatches_enabled : map.productSwatchesEnabled;
  return {
    productAttributesEnabled: attr !== "false",
    productSwatchesEnabled: sw !== "false",
  };
}

async function saveSettings(storeId, body) {
  const ops = [];
  for (const key of SUPER_KEYS) {
    if (body[key] !== undefined) {
      const storageKey = scopedKey(storeId, key);
      ops.push({
        updateOne: {
          filter: { key: storageKey },
          update: { $set: { key: storageKey, value: body[key] ? "true" : "false" } },
          upsert: true,
        },
      });
    }
  }
  if (ops.length) await Settings.bulkWrite(ops);
  return getSettings(storeId);
}

// Make sure the always-present "Uncategorized" category exists for this store.
async function ensureUncategorized(storeId) {
  let cat = await Category.findOne({ store: storeId, slug: "uncategorized" });
  if (!cat) {
    cat = await Category.create({
      store: storeId,
      name: "Uncategorized",
      slug: "uncategorized",
      status: "published",
      order: 9999,
    });
  }
  return cat;
}

/* ------------------------------------------------------------------ *
 * GET /api/product-form/meta — everything the Add Product page needs
 * ------------------------------------------------------------------ */
async function meta(req, res) {
  const storeId = storeIdOf(req);
  if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });

  const attributes = await Attribute.find({ store: storeId }).sort({ name: 1 }).lean();
  const termIds = attributes.map((a) => a._id);
  const terms = termIds.length
    ? await AttributeTerm.find({ store: storeId, attribute: { $in: termIds } }).sort({ name: 1 }).lean()
    : [];
  const byAttr = new Map();
  terms.forEach((t) => {
    const k = t.attribute.toString();
    if (!byAttr.has(k)) byAttr.set(k, []);
    byAttr.get(k).push({ _id: t._id, name: t.name });
  });
  const attributeList = attributes.map((a) => ({
    _id: a._id,
    name: a.name,
    terms: byAttr.get(a._id.toString()) || [],
  }));

  const cats = await Category.find({ store: storeId, status: { $ne: "trashed" } }).sort({ order: 1 }).lean();
  const brands = await Brand.find({ store: storeId, status: { $ne: "trashed" } }).sort({ order: 1 }).lean();
  const tags = await Tag.find({ store: storeId }).sort({ name: 1 }).limit(200).lean();
  const uncategorized = await ensureUncategorized(storeId);
  const settings = await getSettings(storeId);
  const wholesale = await getWholesaleSettings(storeId);

  res.json({
    attributes: attributeList,
    categories: buildTree(cats),
    brands,
    tags,
    settings,
    wholesale: {
      enabled: wholesale.enabled === true,
      badgeText: wholesale.badgeText,
      moq: wholesale.moq,
    },
    uncategorized: { _id: uncategorized._id, name: uncategorized.name, slug: uncategorized.slug },
  });
}

/* ------------------------------------------------------------------ *
 * GET /api/product-form/settings
 * ------------------------------------------------------------------ */
async function getSettingsHandler(req, res) {
  const storeId = storeIdOf(req);
  res.json(await getSettings(storeId));
}

/* ------------------------------------------------------------------ *
 * PUT /api/product-form/settings
 * ------------------------------------------------------------------ */
async function putSettingsHandler(req, res) {
  const storeId = storeIdOf(req);
  res.json(await saveSettings(storeId, req.body || {}));
}

/* ------------------------------------------------------------------ *
 * Upsert helpers
 * ------------------------------------------------------------------ */
async function upsertAttribute(storeId, name) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  let attr = await Attribute.findOne({ store: storeId, name: clean });
  if (!attr) attr = await Attribute.create({ store: storeId, name: clean });
  return attr;
}

async function upsertTerm(storeId, attributeId, name) {
  const clean = String(name || "").trim();
  if (!clean || !attributeId) return null;
  let term = await AttributeTerm.findOne({ store: storeId, attribute: attributeId, name: clean });
  if (!term) term = await AttributeTerm.create({ store: storeId, attribute: attributeId, name: clean });
  return term;
}

async function upsertTags(storeId, names) {
  const ids = [];
  for (const raw of names || []) {
    const clean = String(raw || "").trim().toLowerCase();
    if (!clean) continue;
    let tag = await Tag.findOne({ store: storeId, name: clean });
    if (!tag) tag = await Tag.create({ store: storeId, name: clean });
    ids.push(tag._id);
  }
  return ids;
}

/* ------------------------------------------------------------------ *
 * Build a product (shared by create + update)
 * ------------------------------------------------------------------ */
// only a plain http(s) link may reach the storefront, where it becomes an embed
function safeVideoUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.href.slice(0, 300);
  } catch {
    return "";
  }
}

async function buildProduct(storeId, payload, existing) {
  const data = {
    title: String(payload.title || "").trim(),
    slug: payload.slug !== undefined ? String(payload.slug || "") : undefined,
    regularPrice: Number(payload.regularPrice) || 0,
    salePrice: Number(payload.salePrice) || 0,
    description: typeof payload.description === "string" ? payload.description : "",
    shortDescription: String(payload.shortDescription || "").trim(),
    sku: String(payload.sku || "").trim(),
    stock: Number(payload.stock) || 0,
    weightKg: Math.max(0, Number(payload.weightKg) || 0),
    status: payload.status === "published" ? "published" : "draft",
    images: Array.isArray(payload.images) ? payload.images.filter(Boolean) : [],
    videoUrl: safeVideoUrl(payload.videoUrl),
    isTopFeature: !!payload.isTopFeature,
    isHotDeal: !!payload.isHotDeal,
    brand: payload.brand && mongoose.isValidObjectId(payload.brand) ? payload.brand : null,
    hasVariations: Array.isArray(payload.attributes) && payload.attributes.length > 0,
    hasSwatches: Array.isArray(payload.swatches) && payload.swatches.length > 0,
  };
  if (!data.title) {
    const err = new Error("Product title lagbe");
    err.status = 400;
    throw err;
  }
  // keep the legacy `name`/`price` fields in sync
  data.name = data.title;
  data.price = data.regularPrice;

  const product = existing || new Product({ store: storeId });
  Object.keys(data).forEach((k) => {
    if (data[k] !== undefined) product.set(k, data[k]);
  });
  if (!product.slug) {
    product.slug = await uniqueSlug(Product, slugify(product.title), storeId, product._id || null, "product");
  }
  await product.save();
  return product;
}

/* ------------------------------------------------------------------ *
 * Persist variations / swatches / tags / categories for a product
 * ------------------------------------------------------------------ */
async function syncRelations(storeId, product, payload) {
  // reset old join/variation/swatch rows
  await ProductVariation.deleteMany({ store: storeId, product: product._id });
  await ProductSwatch.deleteMany({ store: storeId, product: product._id });
  await ProductTag.deleteMany({ store: storeId, product: product._id });
  await ProductCategory.deleteMany({ store: storeId, product: product._id });

  // attributes + per-term variations
  for (const attr of payload.attributes || []) {
    const attribute = await upsertAttribute(storeId, attr.attribute);
    if (!attribute) continue;

    for (const termName of attr.terms || []) {
      const term = await upsertTerm(storeId, attribute._id, termName);
      if (!term) continue;
      const v = (attr.variations || []).find((x) => x.term === termName) || {};
      await ProductVariation.create({
        store: storeId,
        product: product._id,
        attribute: attribute._id,
        term: term._id,
        attributeName: attribute.name,
        termName: term.name,
        image: v.image || "",
        regularPrice: Number(v.regularPrice) || 0,
        salePrice: Number(v.salePrice) || 0,
        stock: Number(v.stock) || 0,
      });
    }
  }

  // swatches
  for (const s of payload.swatches || []) {
    await ProductSwatch.create({
      store: storeId,
      product: product._id,
      name: String(s.name || "").trim(),
      price: Number(s.price) || 0,
      stock: Number(s.stock) || 0,
      images: Array.isArray(s.images) ? s.images.filter(Boolean) : [],
    });
  }

  // tags
  const tagIds = await upsertTags(storeId, payload.tags || []);
  for (const tag of tagIds) {
    await ProductTag.create({ store: storeId, product: product._id, tag });
  }

  // categories
  const catIds = (payload.categories || []).filter((c) => mongoose.isValidObjectId(c));
  for (const category of catIds) {
    await ProductCategory.create({ store: storeId, product: product._id, category });
  }

  return { tagIds, categoryIds: catIds };
}

/* ------------------------------------------------------------------ *
 * Wholesale quantity tiers (product default + per-variation sets)
 * ------------------------------------------------------------------ */
// `undefined` means "leave existing tiers alone"; an array replaces all sets.
function parseTierSets(payload) {
  const raw = payload && payload.tiers;
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) {
    const err = new Error("Tier sets array hote hobe");
    err.status = 400;
    throw err;
  }

  const knownTerms = new Set();
  for (const attr of payload.attributes || []) {
    for (const term of attr.terms || []) knownTerms.add(String(term).trim().toLowerCase());
  }

  const seen = new Set();
  return raw.map((set, index) => {
    const termText = set && set.term != null ? String(set.term).trim() : "";
    const term = termText || null;
    if (term && !knownTerms.has(term.toLowerCase())) {
      const err = new Error(`Tier set ${index + 1}: variation "${term}" ei product e nei`);
      err.status = 400;
      throw err;
    }
    const key = term ? `term:${term.toLowerCase()}` : "product";
    if (seen.has(key)) {
      const err = new Error(`Tier set ${index + 1}: "${term || "Product"}" er jonno duibar tier dilen`);
      err.status = 400;
      throw err;
    }
    seen.add(key);
    return { term, tiers: normalizeTiers(set && set.tiers) };
  });
}

async function syncTiers(storeId, product, tierSets, userId) {
  if (tierSets === null) return;

  const variations = await ProductVariation.find({ store: storeId, product: product._id })
    .select("_id termName")
    .lean();
  const byTerm = new Map(
    variations.map((v) => [String(v.termName || "").trim().toLowerCase(), v._id])
  );

  const docs = [];
  for (const set of tierSets) {
    let variationId = null;
    if (set.term) {
      variationId = byTerm.get(set.term.toLowerCase());
      if (!variationId) {
        const err = new Error(`Variation "${set.term}" save hoyni`);
        err.status = 400;
        throw err;
      }
    }
    for (const tier of set.tiers) {
      docs.push({
        ...tier,
        store: storeId,
        product: product._id,
        variation: variationId,
      });
    }
  }

  const before = await ProductPriceTier.find({ store: storeId, product: product._id })
    .sort({ variation: 1, minQty: 1 })
    .lean();
  await ProductPriceTier.deleteMany({ store: storeId, product: product._id });
  if (docs.length) await ProductPriceTier.insertMany(docs);

  clearTierCache(storeId, product._id);
  await writeAudit({
    store: storeId,
    user: userId,
    action: "wholesale.tiers_update",
    entity: "ProductPriceTier",
    entityId: product._id,
    oldValue: before.map((row) => ({
      variation: row.variation || null,
      minQty: row.minQty,
      maxQty: row.maxQty,
      pricePaisa: row.pricePaisa,
    })),
    newValue: tierSets,
  });
}

/* ------------------------------------------------------------------ *
 * POST /api/product-form   (create)
 * ------------------------------------------------------------------ */
async function create(req, res) {
  const storeId = storeIdOf(req);
  if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
  try {
    const body = req.body || {};
    const tierSets = parseTierSets(body);
    const product = await buildProduct(storeId, body, null);
    await syncRelations(storeId, product, body);
    await syncTiers(storeId, product, tierSets, req.user && req.user.id);
    res.status(201).json({ ok: true, product });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}

/* ------------------------------------------------------------------ *
 * PUT /api/product-form/:id   (update)
 * ------------------------------------------------------------------ */
async function update(req, res) {
  const storeId = storeIdOf(req);
  const product = await Product.findOne({ _id: req.params.id, store: storeId });
  if (!product) return res.status(404).json({ message: "Product pawa jayni" });
  try {
    const body = req.body || {};
    const tierSets = parseTierSets(body);
    await buildProduct(storeId, body, product);
    await syncRelations(storeId, product, body);
    await syncTiers(storeId, product, tierSets, req.user && req.user.id);
    res.json({ ok: true, product });
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}

/* ------------------------------------------------------------------ *
 * GET /api/product-form/:id   (load for editing)
 * ------------------------------------------------------------------ */
async function getOne(req, res) {
  const storeId = storeIdOf(req);
  const product = await Product.findOne({ _id: req.params.id, store: storeId }).lean();
  if (!product) return res.status(404).json({ message: "Product pawa jayni" });

  const variations = await ProductVariation.find({ store: storeId, product: product._id }).lean();
  const swatches = await ProductSwatch.find({ store: storeId, product: product._id }).lean();
  const productTags = await ProductTag.find({ store: storeId, product: product._id }).select("tag").lean();
  const productCats = await ProductCategory.find({ store: storeId, product: product._id }).select("category").lean();
  const tierRows = await ProductPriceTier.find({ store: storeId, product: product._id })
    .sort({ minQty: 1 })
    .lean();

  const termByVariation = new Map(variations.map((v) => [String(v._id), v.termName || ""]));
  const productTiers = [];
  const tiersByTerm = new Map();
  for (const row of tierRows) {
    const tier = { minQty: row.minQty, maxQty: row.maxQty, pricePaisa: row.pricePaisa };
    if (!row.variation) {
      productTiers.push(tier);
      continue;
    }
    const term = termByVariation.get(String(row.variation));
    if (!term) continue;
    if (!tiersByTerm.has(term)) tiersByTerm.set(term, []);
    tiersByTerm.get(term).push(tier);
  }

  res.json({
    product,
    variations,
    swatches,
    tags: productTags.map((t) => t.tag),
    categories: productCats.map((c) => c.category),
    tierSets: [
      { term: null, tiers: productTiers },
      ...[...tiersByTerm.entries()].map(([term, tiers]) => ({ term, tiers })),
    ],
  });
}

module.exports = { meta, getSettingsHandler, putSettingsHandler, create, update, getOne };
