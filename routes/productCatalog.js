const express = require("express");
const router = express.Router();
const { auth, requireAdmin } = require("../middleware/auth");
const { requireFeature } = require("../lib/features");
const ctrl = require("../controllers/productCatalogController");

const guard = [auth, requireAdmin, requireFeature("products")];

// product catalog (list + view pages) — shob admin-only
router.get("/list", ...guard, ctrl.list);
router.post("/bulk", ...guard, ctrl.bulk);
router.patch("/:id/status", ...guard, ctrl.setStatus);
router.delete("/:id", ...guard, ctrl.remove);
router.get("/:id", ...guard, ctrl.detail);

module.exports = router;
