const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/categoryController");
const { upload } = require("../middleware/upload");

// NOTE: /reorder and /bulk are declared before "/:id" so they are not shadowed.
router.get("/", ctrl.list);
router.post("/", upload.single("image"), ctrl.create);
router.patch("/reorder", ctrl.reorder);
router.patch("/bulk", ctrl.bulk);

router.get("/:id", ctrl.getOne);
router.put("/:id", upload.single("image"), ctrl.update);
router.patch("/:id/restore", ctrl.restore);

router.delete("/:id", ctrl.softDelete);
router.delete("/:id/permanent", ctrl.permanentDelete);

module.exports = router;
