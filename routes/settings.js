const path = require("path");
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/settingsController");
const { auth, optionalAuth, requireAdmin } = require("../middleware/auth");
const { makeImageUpload, singleImage, finalizeImage } = require("../middleware/upload");

const genericImage = makeImageUpload({ maxBytes: 2 * 1024 * 1024 });
const settingsImage = makeImageUpload({ maxBytes: 5 * 1024 * 1024, allowSvg: true });
const SETTINGS_DIR = path.join(__dirname, "..", "public", "uploads", "settings");

// image upload for logo / favicon / social icons / footer logo
router.post(
  "/upload",
  auth,
  requireAdmin,
  singleImage(genericImage, "image"),
  finalizeImage(),
  (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Image lagbe" });
    res.json({ path: "/uploads/" + req.file.filename });
  }
);

// public (checkout) — specific routes before "/"
router.get("/shipping", ctrl.shippingGet);
router.post("/shipping-quote", ctrl.shippingQuote);
// optionalAuth: logged-in customer hole prefill data ashe
router.get("/checkout", optionalAuth, ctrl.checkoutGet);

// dashboard chrome (logo, title, favicon, footer)
router.get("/site", auth, requireAdmin, ctrl.siteGet);

/* ------------------------------------------------------------------ *
 * Store admin dashboard look (Style Settings view).
 * Kept in Settings with the per-store prefix so each store owns its own
 * palette; the dashboard falls back to the dark/light theme when a value
 * is empty.
 * ------------------------------------------------------------------ */
const Settings = require("../models/Settings");
const { scopedKey } = require("../lib/settingsScope");
const { STYLE_KEY, parseStyle, normalizeStyle, styleOptions } = require("../lib/dashboardStyle");

router.get("/dashboard-style", auth, requireAdmin, async (req, res) => {
  try {
    if (!req.store) return res.status(400).json({ message: "Store pawa jayni" });
    const doc = await Settings.findOne({ key: scopedKey(req.store._id, STYLE_KEY) });
    res.json({ style: parseStyle(doc ? doc.value : ""), options: styleOptions() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put("/dashboard-style", auth, requireAdmin, async (req, res) => {
  try {
    if (!req.store) return res.status(400).json({ message: "Store pawa jayni" });
    const style = normalizeStyle(req.body && req.body.style);
    await Settings.findOneAndUpdate(
      { key: scopedKey(req.store._id, STYLE_KEY) },
      { $set: { value: JSON.stringify(style) } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ style, options: styleOptions() });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// notification test + invoice preview (admin)
router.post("/email/test", auth, requireAdmin, ctrl.emailTest);
router.post("/sms/test", auth, requireAdmin, ctrl.smsTest);
router.post("/tracking/test-connection", auth, requireAdmin, ctrl.trackingConnectionTest);
router.post("/tracking/test-event", auth, requireAdmin, ctrl.trackingEventTest);
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

for (const field of ["logo", "favicon"]) {
  router.post(
    `/admin/${field}`,
    auth,
    requireAdmin,
    singleImage(settingsImage, field),
    finalizeImage({ dir: SETTINGS_DIR, allowSvg: true }),
    async (req, res) => {
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
    }
  );

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
