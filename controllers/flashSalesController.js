const mongoose = require("mongoose");
const FlashSale = require("../models/FlashSale");
const Product = require("../models/Product");
const Category = require("../models/Category");
const { getStoreId } = require("../lib/tenantContext");
const { getDescendantIds } = require("../lib/categoryHelpers");
const { windowStatus, clampPercent } = require("../services/promotions");

function storeIdOf(req) {
  if (req.store && req.store._id) return req.store._id;
  return getStoreId();
}

function idList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((id) => String(id || ""))
    .filter((id) => mongoose.isValidObjectId(id) && !seen.has(id) && seen.add(id));
}

function dateOf(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

async function validatePayload(storeId, body) {
  const title = String(body.title || "").trim().slice(0, 160);
  if (!title) throw new Error("Campaign title lagbe");

  const startAt = dateOf(body.startAt);
  const endAt = dateOf(body.endAt);
  if (!startAt || !endAt) throw new Error("Start ar end date-time lagbe");
  if (endAt.getTime() <= startAt.getTime()) {
    throw new Error("End time start time er pore hote hobe");
  }

  const targetType = body.targetType === "category" ? "category" : "product";
  const productIds = idList(body.products);
  const categoryIdsSelected = idList(body.categories);

  if (targetType === "product" && !productIds.length) {
    throw new Error("At least ekta product select korun");
  }
  if (targetType === "category" && !categoryIdsSelected.length) {
    throw new Error("At least ekta category select korun");
  }

  let products = [];
  let categories = [];
  let categoryIds = [];

  if (targetType === "product") {
    products = await Product.find({ store: storeId, _id: { $in: productIds } }).select("_id").lean();
    if (products.length !== productIds.length) throw new Error("Kichhu product pawa jayni");
    products = products.map((p) => p._id);
  } else {
    categories = await Category.find({
      store: storeId,
      _id: { $in: categoryIdsSelected },
      status: { $ne: "trashed" },
    })
      .select("_id")
      .lean();
    if (categories.length !== categoryIdsSelected.length) throw new Error("Kichhu category pawa jayni");
    categories = categories.map((c) => c._id);
    categoryIds = (await getDescendantIds(Category, storeId, categories)).map(
      (id) => new mongoose.Types.ObjectId(id)
    );
  }

  return {
    title,
    description: String(body.description || "").trim().slice(0, 2000),
    startAt,
    endAt,
    targetType,
    products,
    categories,
    categoryIds,
    discountPercent: clampPercent(body.discountPercent),
  };
}

function adminView(sale, now = new Date()) {
  const productNames = (sale.products || [])
    .map((p) => (p && (p.title || p.name)) || "")
    .filter(Boolean);
  const categoryNames = (sale.categories || []).map((c) => (c && c.name) || "").filter(Boolean);
  return {
    id: sale._id,
    title: sale.title,
    description: sale.description,
    startAt: sale.startAt,
    endAt: sale.endAt,
    targetType: sale.targetType,
    products: (sale.products || []).map((p) => (p && p._id) || p).filter(Boolean),
    categories: (sale.categories || []).map((c) => (c && c._id) || c).filter(Boolean),
    productNames,
    categoryNames,
    discountPercent: clampPercent(sale.discountPercent),
    status: windowStatus(sale, now),
    createdAt: sale.createdAt,
  };
}

async function list(req, res, next) {
  try {
    const storeId = storeIdOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    const items = await FlashSale.find({ store: storeId })
      .populate("products", "title name")
      .populate("categories", "name")
      .sort({ startAt: -1 })
      .lean();
    const now = new Date();
    res.json({ items: items.map((sale) => adminView(sale, now)) });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const storeId = storeIdOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    const payload = await validatePayload(storeId, req.body || {});
    const sale = await FlashSale.create({ store: storeId, ...payload });
    res.status(201).json({ ok: true, item: adminView(sale.toObject()) });
  } catch (err) {
    if (err instanceof Error && !err.status) return res.status(400).json({ message: err.message });
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const storeId = storeIdOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Campaign pawa jayni" });
    }
    const sale = await FlashSale.findOne({ _id: req.params.id, store: storeId });
    if (!sale) return res.status(404).json({ message: "Campaign pawa jayni" });

    const payload = await validatePayload(storeId, req.body || {});
    Object.assign(sale, payload);
    await sale.save();
    res.json({ ok: true, item: adminView(sale.toObject()) });
  } catch (err) {
    if (err instanceof Error && !err.status) return res.status(400).json({ message: err.message });
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const storeId = storeIdOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    const result = await FlashSale.deleteOne({ _id: req.params.id, store: storeId });
    if (!result.deletedCount) return res.status(404).json({ message: "Campaign pawa jayni" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
