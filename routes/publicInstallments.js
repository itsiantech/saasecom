const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/publicInstallmentController");
const { optionalAuth } = require("../middleware/auth");
const { rateLimit } = require("../lib/rateLimit");

// plan/store gate runs for every route — off means 404, exactly like a
// storefront that never shipped the module.
router.use(ctrl.installmentsGate);

router.get("/config", ctrl.getConfig);
router.post("/quote", ctrl.quote);
// keyed by phone as well as IP so one noisy number cannot lock out a shared
// connection (and vice versa); 5 applications per 10 minutes is plenty.
router.post(
  "/apply",
  optionalAuth,
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    keyPrefix: "emi-apply",
    keyOf: (req) => req.body && req.body.applicant && req.body.applicant.phone,
    message: "অনেকবার কিস্তি আবেদন করা হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন",
  }),
  ctrl.apply
);

// NID / photo upload — one file per call, base64 JSON (5 MB body = ~3.7 MB file).
router.post(
  "/documents",
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 30,
    keyPrefix: "emi-documents",
    message: "অনেকবার ডকুমেন্ট আপলোড হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন",
  }),
  ctrl.uploadDocument
);

module.exports = router;
