const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/retailInstallmentAdminController");
const { auth, requireAdmin } = require("../middleware/auth");
const { requireFeature } = require("../lib/features");

// Owner-only retail EMI back office. A store without the installments module
// gets a feature_locked 403, the same gate the public API returns 404 for.
router.use(auth, requireAdmin, requireFeature("installments"));

router.get("/config", ctrl.getConfig);
router.put("/settings", ctrl.saveSettings);

router.post("/offers", ctrl.createOffer);
router.put("/offers/:id", ctrl.updateOffer);
router.delete("/offers/:id", ctrl.deleteOffer);

router.get("/applications", ctrl.listApplications);
router.get("/applications/:id", ctrl.getApplication);
router.get("/applications/:id/documents/:docId", ctrl.downloadDocument);
router.post("/applications/:id/approve", ctrl.approve);
router.post("/applications/:id/reject", ctrl.reject);
router.post("/applications/:id/request-info", ctrl.info);
router.post("/applications/:id/cancel", ctrl.cancel);

router.get("/orders", ctrl.listOrders);
router.get("/orders/:id", ctrl.getOrder);
router.post("/orders/:id/payments", ctrl.recordPayment);
router.post("/run-scheduler", ctrl.runScheduler);
router.post("/documents/purge", ctrl.purgeDocuments);

router.get("/reports/overview", ctrl.reportsOverview);
router.get("/reports/export.xlsx", ctrl.exportReport);

module.exports = router;
