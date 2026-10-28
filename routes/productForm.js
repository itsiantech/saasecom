const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/productFormController");
const { auth, requireAdmin } = require("../middleware/auth");
const { upload } = require("../middleware/upload");

// image upload used by the product form (product / variation / swatch images)
router.post("/upload", auth, requireAdmin, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Image lagbe" });
  res.json({ path: "/uploads/" + req.file.filename });
});

// /settings must be declared before /:id
router.get("/meta", auth, requireAdmin, ctrl.meta);
router.get("/settings", auth, requireAdmin, ctrl.getSettingsHandler);
router.put("/settings", auth, requireAdmin, ctrl.putSettingsHandler);

router.post("/", auth, requireAdmin, ctrl.create);
router.get("/:id", auth, requireAdmin, ctrl.getOne);
router.put("/:id", auth, requireAdmin, ctrl.update);

module.exports = router;
