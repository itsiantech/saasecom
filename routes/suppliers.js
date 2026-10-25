const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/supplierController");
const { auth, requireAdmin, requireSuperAdmin } = require("../middleware/auth");
const { correlation, writeLimit } = require("../middleware/supplierRequest");

router.use(auth, requireAdmin, correlation, writeLimit);

// fixed paths before /:id
router.get("/settings", ctrl.getSettings);
router.patch("/settings", requireSuperAdmin, ctrl.updateSettings);
router.get("/reports", ctrl.report);
router.get("/reports/export", ctrl.exportReport);
router.get("/product-options", ctrl.productOptions);
router.get("/invoices/:id", ctrl.invoiceDetail);
router.get("/invoices/:id/print", ctrl.printInvoice);
router.patch("/invoices/:id/hold", ctrl.holdInvoice);
router.post("/invoices/:id/void", ctrl.voidInvoice);
router.post("/invoices/:id/payments", ctrl.addPayment);
router.patch("/payments/:id/void", ctrl.voidPayment);
router.post("/orders/:id/receive", ctrl.receiveOrder);
router.post("/orders/:id/cancel", ctrl.cancelOrder);

router.get("/", ctrl.list);
router.post("/", ctrl.create);

router.get("/:id", ctrl.detail);
router.patch("/:id", ctrl.update);
router.post("/:id/void", ctrl.voidSupplier);
router.post("/:id/trash", ctrl.trash);
router.post("/:id/restore", ctrl.restore);
router.delete("/:id/purge", requireSuperAdmin, ctrl.purge);
router.post("/:id/orders", ctrl.createOrder);
router.get("/:id/invoices", ctrl.listInvoices);
router.get("/:id/payments", ctrl.listPayments);
router.get("/:id/stock-log", ctrl.stockLog);
router.post("/:id/stock-adjustments", ctrl.adjustStock);

router.use(ctrl.supplierErrorHandler);

module.exports = router;
