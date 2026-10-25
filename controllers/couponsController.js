const mongoose = require("mongoose");
const Coupon = require("../models/Coupon");
const Product = require("../models/Product");
const Category = require("../models/Category");
const { getStoreId } = require("../lib/tenantContext");
const { getDescendantIds } = require("../lib/categoryHelpers");
const { normalizeCode, windowStatus, clampPercent, couponBenefitLabel } = require("../services/promotions");

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

async function validatePayload(storeId, body, excludeId = null) {
  const code = normalizeCode(body.code);
  if (!code) throw new Error("Coupon code lagbe");
  if (code.length > 40) throw new Error("Coupon code 40 character er beshi hote parbe na");

  const duplicateFilter = { store: storeId, code };
  if (excludeId) duplicateFilter._id = { $ne: excludeId };
  if (await Coupon.findOne(duplicateFilter).select("_id").lean()) {
    throw new Error("Ei coupon code age theke ache");
  }

  const discountType = body.discountType === "fixed" ? "fixed" : "percent";
  let discountValue = Number(body.discountValue) || 0;
  if (discountType === "percent") discountValue = clampPercent(discountValue);
  else discountValue = Math.max(0, Math.round(discountValue * 100) / 100);
  const freeDelivery = body.freeDelivery === true;
  if (discountValue <= 0 && !freeDelivery) {
    throw new Error("Discount value din ba free delivery on korun");
  }

  const startAt = dateOf(body.startAt);
  const endAt = dateOf(body.endAt);
  if (!startAt || !endAt) throw new Error("Start ar end date lagbe");
  if (endAt.getTime() <= startAt.getTime()) {
    throw new Error("End date start date er pore hote hobe");
  }

  const productIds = idList(body.products);
  const categoryIdsSelected = idList(body.categories);
  let products = [];
  let categories = [];
  let categoryIds = [];

  if (productIds.length) {
    products = await Product.find({ store: storeId, _id: { $in: productIds } }).select("_id").lean();
    if (products.length !== productIds.length) throw new Error("Kichhu product pawa jayni");
    products = products.map((p) => p._id);
  }
  if (categoryIdsSelected.length) {
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
    code,
    discountType,
    discountValue,
    minOrderAmount: Math.max(0, Number(body.minOrderAmount) || 0),
    startAt,
    endAt,
    products,
    categories,
    categoryIds,
    freeDelivery,
  };
}

function adminView(coupon, now = new Date()) {
  const productNames = (coupon.products || [])
    .map((p) => (p && (p.title || p.name)) || "")
    .filter(Boolean);
  const categoryNames = (coupon.categories || []).map((c) => (c && c.name) || "").filter(Boolean);
  return {
    id: coupon._id,
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: Number(coupon.discountValue) || 0,
    minOrderAmount: Number(coupon.minOrderAmount) || 0,
    startAt: coupon.startAt,
    endAt: coupon.endAt,
    freeDelivery: coupon.freeDelivery === true,
    products: (coupon.products || []).map((p) => (p && p._id) || p).filter(Boolean),
    categories: (coupon.categories || []).map((c) => (c && c._id) || c).filter(Boolean),
    productNames,
    categoryNames,
    label: couponBenefitLabel(coupon),
    status: windowStatus(coupon, now),
    createdAt: coupon.createdAt,
  };
}

async function list(req, res, next) {
  try {
    const storeId = storeIdOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    const items = await Coupon.find({ store: storeId })
      .populate("products", "title name")
      .populate("categories", "name")
      .sort({ createdAt: -1 })
      .lean();
    const now = new Date();
    res.json({ items: items.map((coupon) => adminView(coupon, now)) });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const storeId = storeIdOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    const payload = await validatePayload(storeId, req.body || {});
    const coupon = await Coupon.create({ store: storeId, ...payload });
    res.status(201).json({ ok: true, item: adminView(coupon.toObject()) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(400).json({ message: "Ei coupon code age theke ache" });
    }
    if (err instanceof Error && !err.status) return res.status(400).json({ message: err.message });
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const storeId = storeIdOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Coupon pawa jayni" });
    }
    const coupon = await Coupon.findOne({ _id: req.params.id, store: storeId });
    if (!coupon) return res.status(404).json({ message: "Coupon pawa jayni" });

    const payload = await validatePayload(storeId, req.body || {}, coupon._id);
    Object.assign(coupon, payload);
    await coupon.save();
    res.json({ ok: true, item: adminView(coupon.toObject()) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(400).json({ message: "Ei coupon code age theke ache" });
    }
    if (err instanceof Error && !err.status) return res.status(400).json({ message: err.message });
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const storeId = storeIdOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    const result = await Coupon.deleteOne({ _id: req.params.id, store: storeId });
    if (!result.deletedCount) return res.status(404).json({ message: "Coupon pawa jayni" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove };
