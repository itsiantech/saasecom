const express = require("express");
const router = express.Router();
const { auth, requireAdmin } = require("../middleware/auth");
const { requireFeature } = require("../lib/features");
const ctrl = require("../controllers/couponsController");

const featureGuard = requireFeature("coupons");

// fixed paths before /:id
router.post("/draft", auth, requireAdmin, featureGuard, ctrl.saveDraft);
router.get("/drafts", auth, requireAdmin, featureGuard, ctrl.listDrafts);
router.delete("/drafts/:id", auth, requireAdmin, featureGuard, ctrl.removeDraft);

router.get("/", auth, requireAdmin, featureGuard, ctrl.list);
router.post("/", auth, requireAdmin, featureGuard, ctrl.create);
router.put("/:id", auth, requireAdmin, featureGuard, ctrl.update);
router.delete("/:id", auth, requireAdmin, featureGuard, ctrl.remove);

module.exports = router;