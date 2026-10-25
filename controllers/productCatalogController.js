const mongoose = require("mongoose");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Tag = require("../models/Tag");
const ProductVariation = require("../models/ProductVariation");
const ProductSwatch = require("../models/ProductSwatch");
const ProductPriceTier = require("../models/ProductPriceTier");
const ProductCountry = require("../models/ProductCountry");
const { isWholesale } = require("../lib/wholesaleSettings");
const { isInternational } = require("../lib/internationalSettings");
const { getStoreId } = require("../lib/tenantContext");
const { writeAudit } = require("../lib/audit");
const { toPaisa } = require("../lib/money");
const {
  buildListQuery,
  tierLines,
  validateBulkAction,
} = require("../services/productCatalog");

function storeOf(req) {
  if (req.store && req.store._id) return req.store._id;
  return getStoreId();
}

function validIds(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id) => mongoose.Types.ObjectId.isValid(id)).map(String);
}

// category/tag names eager-load kore id->name map banay
async function nameMaps(products) {
  const catIds = [...new Set(products.flatMap((p) => p.categories || []).map(String))];
  const tagIds = [...new Set(products.flatMap((p) => p.tags || []).map(String))];
  const [cats, tags] = await Promise.all([
    catIds.length ? Category.find({ _id: { $in: catIds } }).select("name").lean() : [],
    tagIds.length ? Tag.find({ _id: { $in: tagIds } }).select("name").lean() : [],
  ]);
  return {
    cats: Object.fromEntries(cats.map((c) => [String(c._id), c.name])),
    tags: Object.fromEntries(tags.map((t) => [String(t._id), t.name])),
  };
}

// product-level tier lines group kore: { [productId]: ["1-10: 520", ...] }
async function tierMapFor(productIds) {
  if (!productIds.length) return {};
  const tiers = await ProductPriceTier.find({ product: { $in: productIds }, variation: null }).lean();
  const grouped = {};
  for (const t of tiers) {
    const key = String(t.product);
    (grouped[key] = grouped[key] || []).push(t);
  }
  return Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, tierLines(v)]));
}

// variation count group kore: { [productId]: n }
async function variationCountMap(productIds) {
  if (!productIds.length) return {};
  const rows = await ProductVariation.find({ product: { $in: productIds } }).select("product").lean();
  const counts = {};
  for (const r of rows) counts[String(r.product)] = (counts[String(r.product)] || 0) + 1;
  return counts;
}

// country count group kore: { [productId]: n }
async function countryCountMap(productIds) {
  if (!productIds.length) return {};
  const rows = await ProductCountry.find({ product: { $in: productIds } }).select("product").lean();
  const counts = {};
  for (const r of rows) counts[String(r.product)] = (counts[String(r.product)] || 0) + 1;
  return counts;
}

/* GET /api/product-catalog/list */
async function list(req, res, next) {
  try {
    const storeId = storeOf(req);
    const wholesale = await isWholesale(storeId);
    const international = await isInternational(storeId);

    const filter = String(req.query.filter || "all");
    const search = String(req.query.search || "").trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const advanced = {
      category: String(req.query.category || "").trim(),
      sku: String(req.query.sku || "").trim(),
      type: String(req.query.type || "").trim(),
      status: String(req.query.status || "").trim(),
      priceMin: req.query.priceMin,
      priceMax: req.query.priceMax,
      stockMin: req.query.stockMin,
      stockMax: req.query.stockMax,
    };

    // "Has tiers" filter er jonge age tier-wala product ids ber kori (wholesale only)
    let tierProductIds = null;
    if (filter === "tiers" && wholesale) {
      tierProductIds = await ProductPriceTier.distinct("product", { variation: null });
    }
    const query = buildListQuery({ filter, search, tierProductIds, advanced });

    const total = await Product.countDocuments(query);
    const rows = await Product.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
    const ids = rows.map((p) => String(p._id));

    const [{ cats, tags }, variations, tiers, countries] = await Promise.all([
      nameMaps(rows),
      variationCountMap(ids),
      wholesale ? tierMapFor(ids) : Promise.resolve({}),
      international ? countryCountMap(ids) : Promise.resolve({}),
    ]);

    const products = rows.map((p, i) => ({
      id: p._id,
      sl: (page - 1) * limit + i + 1,
      name: p.title || p.name || "",
      sku: p.sku || "",
      image: (p.images && p.images[0]) || "",
      categoryNames: (p.categories || []).map((c) => cats[String(c)]).filter(Boolean),
      tagNames: (p.tags || []).map((t) => tags[String(t)]).filter(Boolean),
      productType: p.productType || "physical",
      regularPrice: p.regularPrice || p.price || 0,
      salePrice: p.salePrice || 0,
      stock: p.stock || 0,
      moq: p.moq || 1,
      variationCount: variations[String(p._id)] || 0,
      hasSwatches: !!p.hasSwatches,
      isHotDeal: !!p.isHotDeal,
      isTopFeature: !!p.isTopFeature,
      status: p.status === "published" ? "active" : "inactive",
      soldCount: p.soldCount || 0,
      createdAt: p.createdAt,
      tierLines: tiers[String(p._id)] || [],
      countryCount: countries[String(p._id)] || 0,
      shipsAbroad: !!p.shipsAbroad,
    }));

    res.json({
      products,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      modes: { wholesale, international },
    });
  } catch (err) {
    next(err);
  }
}

/* GET /api/product-catalog/:id */
async function detail(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid product id" });
    }
    const storeId = storeOf(req);
    const wholesale = await isWholesale(storeId);
    const international = await isInternational(storeId);

    const p = await Product.findById(req.params.id).lean();
    if (!p) return res.status(404).json({ message: "Product pawa jayni" });

    const [{ cats, tags }, variations, swatches, tiers, countries] = await Promise.all([
      nameMaps([p]),
      ProductVariation.find({ product: p._id }).sort({ createdAt: 1 }).lean(),
      ProductSwatch.find({ product: p._id }).sort({ createdAt: 1 }).lean(),
      wholesale ? ProductPriceTier.find({ product: p._id, variation: null }).sort({ minQty: 1 }).lean() : Promise.resolve([]),
      international ? ProductCountry.find({ product: p._id }).sort({ countryCode: 1 }).lean() : Promise.resolve([]),
    ]);

    res.json({
      product: {
        id: p._id,
        name: p.title || p.name || "",
        sku: p.sku || "",
        description: p.description || "",
        shortDescription: p.shortDescription || "",
        images: p.images || [],
        productType: p.productType || "physical",
        regularPrice: p.regularPrice || p.price || 0,
        salePrice: p.salePrice || 0,
        stock: p.stock || 0,
        moq: p.moq || 1,
        isHotDeal: !!p.isHotDeal,
        isTopFeature: !!p.isTopFeature,
        status: p.status === "published" ? "active" : "inactive",
        shipsAbroad: !!p.shipsAbroad,
        soldCount: p.soldCount || 0,
        createdAt: p.createdAt,
        categoryNames: (p.categories || []).map((c) => cats[String(c)]).filter(Boolean),
        tagNames: (p.tags || []).map((t) => tags[String(t)]).filter(Boolean),
        hasVariations: !!p.hasVariations,
      },
      variations: variations.map((v) => ({
        id: v._id, attributeName: v.attributeName, termName: v.termName,
        image: v.image || "", regularPrice: v.regularPrice || 0, salePrice: v.salePrice || 0, stock: v.stock || 0,
      })),
      swatches: swatches.map((s) => ({ id: s._id, name: s.name, price: s.price, stock: s.stock, image: (s.images && s.images[0]) || "" })),
      tiers: tiers.map((t) => ({ minQty: t.minQty, maxQty: t.maxQty, price: t.pricePaisa / 100 })),
      countries: countries.map((c) => c.countryCode),
      modes: { wholesale, international },
    });
  } catch (err) {
    next(err);
  }
}

/* PATCH /api/product-catalog/:id/status  { active: bool } */
async function setStatus(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid product id" });
    }
    const active = req.body && req.body.active === true;
    const status = active ? "published" : "draft";

    const before = await Product.findById(req.params.id).select("status title name").lean();
    if (!before) return res.status(404).json({ message: "Product pawa jayni" });

    const updated = await Product.findByIdAndUpdate(req.params.id, { status }, { new: true, runValidators: true }).lean();
    await writeAudit({
      store: storeOf(req),
      user: req.user && req.user.id,
      action: "product.status_change",
      entity: "Product",
      entityId: req.params.id,
      oldValue: { status: before.status },
      newValue: { status },
    });
    res.json({ ok: true, status: updated.status === "published" ? "active" : "inactive" });
  } catch (err) {
    next(err);
  }
}

// delete er sathe cascade: tiers, variations, swatches, countries
async function deleteProducts(ids) {
  const [products, tiers, variations, swatches, countries] = await Promise.all([
    Product.find({ _id: { $in: ids } }).select("title name").lean(),
    ProductPriceTier.deleteMany({ product: { $in: ids } }),
    ProductVariation.deleteMany({ product: { $in: ids } }),
    ProductSwatch.deleteMany({ product: { $in: ids } }),
    ProductCountry.deleteMany({ product: { $in: ids } }),
    Product.deleteMany({ _id: { $in: ids } }),
  ]);
  return { products, tiers, variations, swatches, countries };
}

/* POST /api/product-catalog/bulk  { action, ids, tier?, countryCodes? } */
async function bulk(req, res, next) {
  try {
    const storeId = storeOf(req);
    const wholesale = await isWholesale(storeId);
    const international = await isInternational(storeId);

    const { action, tier, countryCodes } = req.body || {};
    const ids = validIds((req.body && req.body.ids) || []);
    const check = validateBulkAction({ action, ids, wholesale, international, tier, countryCodes });
    if (!check.ok) return res.status(400).json({ message: "Bulk action validate hoyni: " + check.code });

    let result = { modified: 0 };

    if (action === "activate" || action === "deactivate") {
      const status = action === "activate" ? "published" : "draft";
      const r = await Product.updateMany({ _id: { $in: ids } }, { status });
      result = { modified: r.modifiedCount, status };
    } else if (action === "delete") {
      const del = await deleteProducts(ids);
      result = { modified: del.products.length };
    } else if (action === "set_tiers") {
      // prottek product er product-level tier replace hoy (variation-level untouched)
      let inserted = 0;
      for (const id of ids) {
        await ProductPriceTier.deleteMany({ product: id, variation: null });
        const docs = tier.map((row) => ({
          product: id,
          variation: null,
          minQty: Number(row.minQty),
          maxQty: row.maxQty == null || row.maxQty === "" ? null : Number(row.maxQty),
          pricePaisa: toPaisa(row.price),
          store: storeId, // insertMany pre('save') fire kore na — explicitly set
        }));
        await ProductPriceTier.insertMany(docs);
        inserted += docs.length;
      }
      result = { modified: ids.length, tiersInserted: inserted };
    } else if (action === "allow_international") {
      const codes = [...new Set(countryCodes.map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
      const r = await Product.updateMany({ _id: { $in: ids } }, { shipsAbroad: true });
      let inserted = 0;
      for (const id of ids) {
        await ProductCountry.deleteMany({ product: id });
        await ProductCountry.insertMany(codes.map((code) => ({ product: id, countryCode: code, store: storeId })));
        inserted += codes.length;
      }
      result = { modified: r.modifiedCount, countriesInserted: inserted };
    }

    await writeAudit({
      store: storeId,
      user: req.user && req.user.id,
      action: "product.bulk_" + action,
      entity: "Product",
      entityId: ids.join(","),
      newValue: { count: result.modified, result },
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
}

/* DELETE /api/product-catalog/:id */
async function remove(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid product id" });
    }
    const del = await deleteProducts([req.params.id]);
    if (!del.products.length) return res.status(404).json({ message: "Product pawa jayni" });
    await writeAudit({
      store: storeOf(req),
      user: req.user && req.user.id,
      action: "product.delete",
      entity: "Product",
      entityId: req.params.id,
      oldValue: { name: del.products[0].title || del.products[0].name },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, detail, setStatus, bulk, remove };
