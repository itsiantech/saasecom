/* ==========================================================================
   Lens Selector — Admin CRUD API (types, categories, packages).
   All queries are automatically scoped by tenant via tenantPlugin.
   ========================================================================== */
const LensType = require("../models/LensType");
const LensCategory = require("../models/LensCategory");
const LensPackage = require("../models/LensPackage");
const {
  parseTypePayload,
  parseCategoryPayload,
  parsePackagePayload,
  lensError,
} = require("../lib/lensValidation");

/* =============================== LENS TYPES =============================== */

async function listTypes(req, res) {
  try {
    const types = await LensType.find({}).sort({ sortOrder: 1, name: 1 }).lean();
    res.json({ types });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}

async function createType(req, res) {
  try {
    const payload = parseTypePayload(req.body);
    const doc = await LensType.create(payload);
    res.status(201).json(doc);
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ message: err.message });
  }
}

async function updateType(req, res) {
  try {
    const payload = parseTypePayload(req.body);
    const doc = await LensType.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });
    if (!doc) return res.status(404).json({ message: "Type pawa jayni" });
    res.json(doc);
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ message: err.message });
  }
}

async function deleteType(req, res) {
  try {
    const doc = await LensType.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: "Type pawa jayni" });
    res.json({ message: "Type delete hoyeche" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}

/* =============================== LENS CATEGORIES =============================== */

async function listCategories(req, res) {
  try {
    const categories = await LensCategory.find({})
      .populate("typeIds", "_id name")
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    res.json({ categories });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}

async function createCategory(req, res) {
  try {
    const payload = parseCategoryPayload(req.body);
    const doc = await LensCategory.create(payload);
    res.status(201).json(doc);
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ message: err.message });
  }
}

async function updateCategory(req, res) {
  try {
    const payload = parseCategoryPayload(req.body);
    const doc = await LensCategory.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });
    if (!doc) return res.status(404).json({ message: "Category pawa jayni" });
    res.json(doc);
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ message: err.message });
  }
}

async function deleteCategory(req, res) {
  try {
    const doc = await LensCategory.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: "Category pawa jayni" });
    res.json({ message: "Category delete hoyeche" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}

/* =============================== LENS PACKAGES =============================== */

async function listPackages(req, res) {
  try {
    const packages = await LensPackage.find({})
      .populate("typeIds", "_id name")
      .populate("categoryIds", "_id name")
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    res.json({ packages });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}

async function createPackage(req, res) {
  try {
    const payload = parsePackagePayload(req.body);
    const doc = await LensPackage.create(payload);
    res.status(201).json(doc);
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ message: err.message });
  }
}

async function updatePackage(req, res) {
  try {
    const payload = parsePackagePayload(req.body);
    const doc = await LensPackage.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true,
    });
    if (!doc) return res.status(404).json({ message: "Package pawa jayni" });
    res.json(doc);
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ message: err.message });
  }
}

async function deletePackage(req, res) {
  try {
    const doc = await LensPackage.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: "Package pawa jayni" });
    res.json({ message: "Package delete hoyeche" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}

module.exports = {
  // Types
  listTypes,
  createType,
  updateType,
  deleteType,
  // Categories
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  // Packages
  listPackages,
  createPackage,
  updatePackage,
  deletePackage,
};
