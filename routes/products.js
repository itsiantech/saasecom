const express = require("express");
const router = express.Router();
const Product = require("../models/Product");

// shob product dekha
router.get("/", async (req, res) => {
  const products = await Product.find();
  res.json(products);
});

// ekta product dekha
router.get("/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product pawa jayni" });
    res.json(product);
  } catch (err) {
    res.status(400).json({ message: "Invalid id" });
  }
});

// notun product add kora
router.post("/", async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json(product);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// product update kora (admin only)
router.put("/:id", require("../middleware/auth").auth, require("../middleware/auth").requireAdmin, async (req, res) => {
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
router.delete("/:id", require("../middleware/auth").auth, require("../middleware/auth").requireAdmin, async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ message: "Product pawa jayni" });
    res.json({ message: "Product delete hoyeche" });
  } catch (err) {
    res.status(400).json({ message: "Invalid id" });
  }
});

module.exports = router;