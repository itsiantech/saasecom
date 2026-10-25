const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/wholesaleController");
const { auth, requireAdmin } = require("../middleware/auth");

// Public checkout/storefront config (tenant middleware already resolved the store).
router.get("/public", ctrl.publicConfig);

router.use(auth, requireAdmin);

router.get("/settings", ctrl.getSettings);
router.put("/settings", ctrl.updateSettings);

router.get("/products/:productId/tiers", ctrl.getProductTiers);
router.put("/products/:productId/tiers", ctrl.saveProductTiers);

router.get("/shipping-rules", ctrl.listShippingRules);
router.post("/shipping-rules", ctrl.createShippingRule);
router.put("/shipping-rules/:id", ctrl.updateShippingRule);
router.delete("/shipping-rules/:id", ctrl.deleteShippingRule);

router.get("/vehicles", ctrl.listVehicles);
router.post("/vehicles", ctrl.createVehicle);
router.put("/vehicles/:id", ctrl.updateVehicle);
router.delete("/vehicles/:id", ctrl.deleteVehicle);

router.get("/speeds", ctrl.listSpeeds);
router.post("/speeds", ctrl.createSpeed);
router.put("/speeds/:id", ctrl.updateSpeed);
router.delete("/speeds/:id", ctrl.deleteSpeed);

router.get("/plans", ctrl.listPlans);
router.post("/plans", ctrl.createPlan);
router.put("/plans/:id", ctrl.updatePlan);
router.delete("/plans/:id", ctrl.deletePlan);

router.get("/buyers", ctrl.listBuyers);
router.patch("/buyers/:id/approval", ctrl.setBuyerApproval);

module.exports = router;
