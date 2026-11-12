const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/brandController");
const { makeImageUpload, singleImage, finalizeImage } = require("../middleware/upload");
const { auth, requireAdmin } = require("../middleware/auth");
const requireTenant = require("../middleware/requireTenant");
const { requireFeature } = require("../lib/features");

const imageUpload = makeImageUpload({ maxBytes: 2 * 1024 * 1024 });

// public storefront er brand /api/public/brands theke ase — eta admin panel er
router.use(requireTenant, auth, requireAdmin, requireFeature("brands"));

// NOTE: /reorder and /bulk are declared before "/:id" so they are not shadowed.
router.get("/", ctrl.list);
router.post("/", singleImage(imageUpload, "image"), finalizeImage(), ctrl.create);
router.patch("/reorder", ctrl.reorder);
router.patch("/bulk", ctrl.bulk);

router.get("/:id", ctrl.getOne);
router.put("/:id", singleImage(imageUpload, "image"), finalizeImage(), ctrl.update);
router.patch("/:id/restore", ctrl.restore);

router.delete("/:id", ctrl.softDelete);
router.delete("/:id/permanent", ctrl.permanentDelete);

module.exports = router;
