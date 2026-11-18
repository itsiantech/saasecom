const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/publicBuilderController");
const { optionalAuth } = require("../middleware/auth");

// plan/store gate runs for every route — off means 404, exactly like the
// storefront not shipping the module at all.
router.use(ctrl.builderGate);

router.get("/templates", ctrl.listTemplates);
router.get("/templates/:slug", ctrl.getTemplate);
router.post("/templates/:slug/slots/:slotKey/products", ctrl.slotProducts);
router.post("/templates/:slug/validate", ctrl.validateBuild);
router.post("/templates/:slug/save", optionalAuth, ctrl.saveBuild);
router.post("/templates/:slug/cart", optionalAuth, ctrl.addBuildToCart);
router.post("/templates/:slug/events", optionalAuth, ctrl.trackEvent);
router.get("/builds/:token", ctrl.getBuild);

module.exports = router;
