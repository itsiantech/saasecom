const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/lensAdminController");
const { auth, requireAdmin } = require("../middleware/auth");
const requireTenant = require("../middleware/requireTenant");
const { requireFeature } = require("../lib/features");

// Lens Selector admin CRUD — requires lensSelector feature + admin access
router.use(requireTenant, auth, requireAdmin, requireFeature("lensSelector"));

/* =============================== LENS TYPES =============================== */
router.get("/types", ctrl.listTypes);
router.post("/types", ctrl.createType);
router.put("/types/:id", ctrl.updateType);
router.delete("/types/:id", ctrl.deleteType);

/* =============================== LENS CATEGORIES =============================== */
router.get("/categories", ctrl.listCategories);
router.post("/categories", ctrl.createCategory);
router.put("/categories/:id", ctrl.updateCategory);
router.delete("/categories/:id", ctrl.deleteCategory);

/* =============================== LENS PACKAGES =============================== */
router.get("/packages", ctrl.listPackages);
router.post("/packages", ctrl.createPackage);
router.put("/packages/:id", ctrl.updatePackage);
router.delete("/packages/:id", ctrl.deletePackage);

module.exports = router;
