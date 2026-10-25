const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/installmentController");
const { auth, optionalAuth, requireAdmin } = require("../middleware/auth");

// Gateway webhook scaffold; needs ?store=slug because tenant middleware runs before this router.
router.post("/webhook/:provider", ctrl.webhook);

// Public checkout previews (guest token optional).
router.use(optionalAuth);
router.get("/plans", ctrl.getConfig);
router.post("/preview", ctrl.preview);

// Customer account.
router.get("/my", auth, ctrl.myOrders);
router.get("/orders/:id", auth, ctrl.myOrder);
router.post("/orders/:id/pay", auth, ctrl.payInstallment);
router.get("/payments/:id/receipt", auth, ctrl.receipt);

// Admin.
router.use(auth, requireAdmin);
router.get("/admin/orders", ctrl.adminListOrders);
router.get("/admin/orders/:id", ctrl.adminOrder);
router.get("/admin/payments", ctrl.adminListPayments);
router.patch("/admin/payments/:id/verify", ctrl.adminVerifyPayment);
router.patch("/admin/payments/:id/reject", ctrl.adminRejectPayment);
router.post("/admin/run-scheduler", ctrl.adminRunScheduler);

module.exports = router;
