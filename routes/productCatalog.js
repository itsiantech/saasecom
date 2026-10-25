const express = require("express");
const router = express.Router();
const { auth, requireAdmin } = require("../middleware/auth");
const ctrl = require("../controllers/productCatalogController");

// product catalog (list + view pages) — shob admin-only
router.get("/list", auth, requireAdmin, ctrl.list);
router.post("/bulk", auth, requireAdmin, ctrl.bulk);
router.patch("/:id/status", auth, requireAdmin, ctrl.setStatus);
router.delete("/:id", auth, requireAdmin, ctrl.remove);
router.get("/:id", auth, requireAdmin, ctrl.detail);

module.exports = router;
