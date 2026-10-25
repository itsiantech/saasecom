const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/productFormController");
const { auth } = require("../middleware/auth");
const { upload } = require("../middleware/upload");

// image upload used by the product form (product / variation / swatch images)
router.post("/upload", auth, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Image lagbe" });
  res.json({ path: "/uploads/" + req.file.filename });
});

// /settings must be declared before /:id
router.get("/meta", auth, ctrl.meta);
router.get("/settings", auth, ctrl.getSettingsHandler);
router.put("/settings", auth, ctrl.putSettingsHandler);

router.post("/", auth, ctrl.create);
router.get("/:id", auth, ctrl.getOne);
router.put("/:id", auth, ctrl.update);

module.exports = router;
