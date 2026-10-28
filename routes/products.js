const express = require("express");
const router = express.Router();
const Product = require("../models/Product");
const { auth, requireAdmin } = require("../middleware/auth");
const requireTenant = require("../middleware/requireTenant");

// ei panel api gulo shudhu oei dokan er malik er (public catalog /api/public + /api/storefront e chole)
const guard = [requireTenant, auth, requireAdmin];

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

// notun product add kora (admin)
router.post("/", guard, async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json(product);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// product update kora (admin only)
router.put("/:id", guard, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!product) return res.status(404).json({ message: "Product pawa jayni" });
    res.json(product);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// product delete kora (admin only)
router.delete("/:id", guard, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: "Product pawa jayni" });
    res.json({ message: "Product delete hoyeche" });
  } catch (err) {
    res.status(400).json({ message: "Invalid id" });
  }
});

module.exports = router;
