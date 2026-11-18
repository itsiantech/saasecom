const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/specController");
const { auth, requireAdmin } = require("../middleware/auth");
const { requireFeature } = require("../lib/features");
const { correlation, rateLimit } = require("../middleware/reportRequest");

router.use(correlation);
router.use(auth, requireAdmin, requireFeature("productBuilder"));

router.get("/meta", rateLimit("read"), ctrl.meta);
router.post("/reorder", rateLimit("read"), ctrl.reorder);
router.post(
  "/import",
  rateLimit("read"),
  express.text({ type: ["text/csv", "text/plain", "application/csv"], limit: "2mb" }),
  ctrl.importCsv
);
router.get("/export.csv", rateLimit("export"), ctrl.exportCsvFile);

router.get("/", rateLimit("read"), ctrl.list);
router.post("/", rateLimit("read"), ctrl.create);
router.put("/:id", rateLimit("read"), ctrl.update);
router.delete("/:id", rateLimit("read"), ctrl.remove);

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err.status) || 500;
  const message = status < 500 ? err.message : "Spec API te somossa hoyeche";
  console.error("specs API:", req.correlationId, err.message || err);
  return res.status(status).json({ message, requestId: req.correlationId });
});

module.exports = router;
