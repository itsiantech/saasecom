const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/productFormController");
const { auth, requireAdmin } = require("../middleware/auth");
const { makeImageUpload, singleImage, finalizeImage } = require("../middleware/upload");
const { requireFeature } = require("../lib/features");

const imageUpload = makeImageUpload({ maxBytes: 2 * 1024 * 1024 });
const productGuard = [auth, requireAdmin, requireFeature("products")];

// image upload used by the product form (product / variation / swatch images)
router.post("/upload", ...productGuard, singleImage(imageUpload, "image"), finalizeImage(), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Image lagbe" });
  res.json({ path: "/uploads/" + req.file.filename });
});

// /settings must be declared before /:id
router.get("/meta", ...productGuard, ctrl.meta);
router.get("/settings", ...productGuard, ctrl.getSettingsHandler);
router.put("/settings", ...productGuard, ctrl.putSettingsHandler);

router.post("/", ...productGuard, ctrl.create);
router.get("/:id", ...productGuard, ctrl.getOne);
router.put("/:id", ...productGuard, ctrl.update);

module.exports = router;
