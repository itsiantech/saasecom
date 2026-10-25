const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/settingsController");
const { auth, optionalAuth } = require("../middleware/auth");
const { upload } = require("../middleware/upload");

// image upload for logo / favicon / social icons / footer logo
router.post("/upload", auth, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Image lagbe" });
  res.json({ path: "/uploads/" + req.file.filename });
});

// public (checkout) — specific routes before "/"
router.get("/shipping", ctrl.shippingGet);
router.post("/shipping-quote", ctrl.shippingQuote);
// optionalAuth: logged-in customer hole prefill data ashe
router.get("/checkout", optionalAuth, ctrl.checkoutGet);

// dashboard chrome (logo, title, favicon, footer)
router.get("/site", auth, ctrl.siteGet);

// notification test + invoice preview (admin)
router.post("/email/test", auth, ctrl.emailTest);
router.post("/sms/test", auth, ctrl.smsTest);
router.get("/invoice/preview", auth, ctrl.invoicePreview);
router.post("/invoice/preview", auth, ctrl.invoicePreview);

// admin settings page
router.get("/", auth, ctrl.adminGet);
router.put("/", auth, ctrl.adminSave);

module.exports = router;
