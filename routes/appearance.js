const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/appearanceController");
const { auth, requireAdmin } = require("../middleware/auth");

/* ------------------------------------------------------------------ *
 * Storefront appearance for the current store (tenant middleware has
 * already resolved req.store from host/slug/JWT owner).
 * ------------------------------------------------------------------ */

router.use(auth, requireAdmin);

router.get("/", ctrl.getAppearance);
router.put("/draft", ctrl.saveDraft);
router.post("/draft/reset", ctrl.resetDraft);
router.post("/publish", ctrl.publishDraft);
router.post("/revisions/:id/restore", ctrl.restoreRevision);
router.post("/preview", ctrl.createPreview);

module.exports = router;
