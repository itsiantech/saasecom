const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/builderAdminController");
const { auth, requireAdmin } = require("../middleware/auth");
const { requireFeature } = require("../lib/features");
const { correlation, rateLimit } = require("../middleware/reportRequest");

router.use(correlation);
router.use(auth, requireAdmin, requireFeature("productBuilder"));

router.get("/templates/meta", rateLimit("read"), ctrl.meta);
router.post("/templates/starter", rateLimit("read"), ctrl.createStarter);

router.get("/templates", rateLimit("read"), ctrl.list);
router.post("/templates", rateLimit("read"), ctrl.create);

router.get("/templates/:id", rateLimit("read"), ctrl.get);
router.put("/templates/:id", rateLimit("read"), ctrl.update);
router.delete("/templates/:id", rateLimit("read"), ctrl.remove);

router.get("/templates/:id/builds", rateLimit("read"), ctrl.builds);
router.get("/templates/:id/analytics", rateLimit("read"), ctrl.analytics);
router.post("/templates/:id/sandbox", rateLimit("read"), ctrl.sandbox);
router.post("/templates/:id/slots/:slotKey/products", rateLimit("read"), ctrl.slotProducts);

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err.status) || 500;
  const message = status < 500 ? err.message : "Builder API te somossa hoyeche";
  console.error("builder API:", req.correlationId, err.message || err);
  return res.status(status).json({ message, requestId: req.correlationId, code: err.code });
});

module.exports = router;
