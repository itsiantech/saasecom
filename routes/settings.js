const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/settingsController");
const { auth, optionalAuth, requireAdmin } = require("../middleware/auth");
const { upload } = require("../middleware/upload");

// image upload for logo / favicon / social icons / footer logo
router.post("/upload", auth, requireAdmin, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Image lagbe" });
  res.json({ path: "/uploads/" + req.file.filename });
});

// public (checkout) — specific routes before "/"
router.get("/shipping", ctrl.shippingGet);
router.post("/shipping-quote", ctrl.shippingQuote);
// optionalAuth: logged-in customer hole prefill data ashe
router.get("/checkout", optionalAuth, ctrl.checkoutGet);

// dashboard chrome (logo, title, favicon, footer)
router.get("/site", auth, requireAdmin, ctrl.siteGet);

// notification test + invoice preview (admin)
router.post("/email/test", auth, requireAdmin, ctrl.emailTest);
router.post("/sms/test", auth, requireAdmin, ctrl.smsTest);
router.get("/invoice/preview", auth, requireAdmin, ctrl.invoicePreview);
router.post("/invoice/preview", auth, requireAdmin, ctrl.invoicePreview);

// admin settings page
router.get("/", auth, requireAdmin, ctrl.adminGet);
router.put("/", auth, requireAdmin, ctrl.adminSave);

/* ------------------------------------------------------------------ *
 * Per-store settings page (public/settings.html).
 * GET reads the live store docs, PUT writes the form through to them —
 * StoreSettings is kept as the page's own record, but Store / SiteSetting
 * / ShopFavicon / SocialLink are what the storefront actually renders.
 * ------------------------------------------------------------------ */
const StoreSettings = require("../models/StoreSettings");
const storeSettings = require("../services/storeSettings");
const { CURRENCIES } = require("../lib/currencies");

router.get("/store", auth, requireAdmin, async (req, res) => {
  try {
    if (!req.store) return res.status(400).json({ message: "Store pawa jayni" });
    const settings = await StoreSettings.findOne({ storeId: req.store._id });
    res.json(settings || new StoreSettings({ storeId: req.store._id }));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/admin", auth, requireAdmin, async (req, res) => {
  try {
    const storeId = req.store?._id || null;
    if (!storeId) {
      let settings = await StoreSettings.findOne({ storeId });
      if (!settings) settings = await StoreSettings.create({ storeId });
      return res.json(settings);
    }
    res.json(await storeSettings.view(storeId));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/admin", auth, requireAdmin, async (req, res) => {
  try {
    const storeId = req.store?._id || null;
    if (!storeId) {
      const settings = await StoreSettings.findOneAndUpdate(
        { storeId },
        { $set: req.body },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      return res.json(settings);
    }
    const result = await storeSettings.apply(storeId, req.body);
    if (result.error) return res.status(400).json({ message: result.error });
    res.json(result.settings);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

const multer = require("multer");
const nodePath = require("path");
const nodeFs = require("fs");

const settingsUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = nodePath.join(__dirname, "../public/uploads/settings");
      if (!nodeFs.existsSync(dir)) nodeFs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + nodePath.extname(file.originalname));
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|ico|webp|svg/.test(nodePath.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error("Images only (jpeg, jpg, png, gif, ico, webp, svg)"), ok);
  },
});

for (const field of ["logo", "favicon"]) {
  router.post(`/admin/${field}`, auth, requireAdmin, settingsUpload.single(field), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const url = `/uploads/settings/${req.file.filename}`;
      const storeId = req.store?._id || null;
      await storeSettings.setImage(storeId, field, url);
      const settings = storeId ? await storeSettings.view(storeId) : await StoreSettings.findOne({ storeId });
      res.json({ [field]: url, settings });
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });

  router.delete(`/admin/${field}`, auth, requireAdmin, async (req, res) => {
    try {
      const storeId = req.store?._id || null;
      await storeSettings.setImage(storeId, field, "");
      const settings = storeId ? await storeSettings.view(storeId) : await StoreSettings.findOne({ storeId });
      res.json({ [field]: "", settings: settings || {} });
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  });
}

router.get("/currencies", (req, res) => {
  res.json(CURRENCIES);
});

// storefront er html lang + number/date locale shudhu bn/en support kore
router.get("/languages", (req, res) => {
  res.json([
    { code: "bn", name: "Bengali", native: "বাংলা" },
    { code: "en", name: "English", native: "English" },
  ]);
});

module.exports = router;
