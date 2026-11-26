const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Product = require("../models/Product");
const { auth, requireAdmin } = require("../middleware/auth");
const requireTenant = require("../middleware/requireTenant");
const { sanitizeRichText } = require("../lib/richText");
const { requireFeature } = require("../lib/features");
const { getSettingsMap } = require("../controllers/settingsController");

// ei panel api gulo shudhu oei dokan er malik er (public catalog /api/public + /api/storefront e chole)
const guard = [requireTenant, auth, requireAdmin];
// dashboard stats GET use kore, tai read khula; product management write-only gate
const writeGuard = [...guard, requireFeature("products")];

// Client shudhu ei field gulo likhte parbe — store/_id/isDemo/soldCount baad.
const PRODUCT_FIELDS = [
  "name", "title", "slug", "price", "regularPrice", "salePrice",
  "description", "shortDescription", "stock", "weightKg", "sku", "status",
  "images", "videoUrl", "brand", "categories", "tags", "supplierId",
  "hasVariations", "hasSwatches", "internationalConfig",
  "productType", "isHotDeal", "isTopFeature", "moq", "shipsAbroad",
];

function productPayload(body = {}) {
  const out = {};
  for (const key of PRODUCT_FIELDS) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  if (out.description !== undefined) out.description = sanitizeRichText(out.description);
  return out;
}

// shob product dekha (admin) — paginated
router.get("/", guard, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const status = ["draft", "published"].includes(req.query.status) ? req.query.status : null;
  const q = status ? { status } : {};

  const total = await Product.countDocuments(q);
  const products = await Product.find(q)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  res.json({ products, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
});

// ekta product dekha (admin)
router.get("/:id", guard, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product pawa jayni" });
    res.json(product);
  } catch (err) {
    res.status(400).json({ message: "Invalid id" });
  }
});

// Matching add-ons — PUBLIC: the storefront vanilla component hits this from
// the product page. Returns [] when the store has the feature OFF or the
// product doesn't exist (so the section just hides). requireTenant keeps the
// query scoped to the current store; no auth needed for shoppers.
router.get("/:id/addons", requireTenant, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.json([]);
    const map = await getSettingsMap();
    if (String(map.matching_addons_enabled) === "false") return res.json([]);
    const product = await Product.findOne({ _id: req.params.id, store: req.storeId })
      .select("addons")
      .lean();
    if (!product || !Array.isArray(product.addons)) return res.json([]);
    const rows = product.addons
      .slice()
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((row) => ({ id: String(row._id), title: row.title, price: Number(row.price) || 0 }));
    res.json(rows);
  } catch (err) {
    res.status(400).json({ message: "Invalid id" });
  }
});

// notun product add kora (admin)
router.post("/", writeGuard, async (req, res) => {
  try {
    const product = await Product.create({ ...productPayload(req.body), store: req.storeId });
    res.status(201).json(product);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// product update kora (admin only)
router.put("/:id", writeGuard, async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, store: req.storeId },
      productPayload(req.body),
      { new: true, runValidators: true }
    );
    if (!product) return res.status(404).json({ message: "Product pawa jayni" });
    res.json(product);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// product delete kora (admin only)
router.delete("/:id", writeGuard, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: "Product pawa jayni" });
    res.json({ message: "Product delete hoyeche" });
  } catch (err) {
    res.status(400).json({ message: "Invalid id" });
  }
});

module.exports = router;
