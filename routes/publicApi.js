const express = require("express");
const router = express.Router();
const publicStore = require("../middleware/publicStore");
const catalog = require("../controllers/publicCatalogController");
const shop = require("../controllers/publicShopController");
const settings = require("../controllers/settingsController");
const appearance = require("../controllers/appearanceController");
const landingBranding = require("../lib/landingBranding");
const { renamedAddress } = require("../lib/shopAddress");
const { auth, optionalAuth } = require("../middleware/auth");

/* ------------------------------------------------------------------ *
 * /api/public/* — read API for the Next.js storefront.
 * Mounted BEFORE middleware/tenant (server.js); middleware/publicStore
 * decides the store from host / x-store-domain / x-store-slug / ?store=
 * only — never from the JWT, so a logged-in shopper cannot read another
 * store's catalog by accident.
 * ------------------------------------------------------------------ */

// platform branding is host-independent — must answer before publicStore,
// which 404s on the platform host (there is no shop there).
router.get("/branding", async (_req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ branding: await landingBranding.getBranding() });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// an old shop address (renamed within the last 90 days) → its current site.
// The Next proxy asks before rendering so old links get a real 301.
router.get("/address-redirect", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const host = String(req.query.host || "").trim().toLowerCase().slice(0, 300);
  if (!host) return res.json({ redirect: null });
  try {
    res.json({ redirect: await renamedAddress(host) });
  } catch {
    res.json({ redirect: null });
  }
});

router.use(publicStore);

router.get("/store", catalog.getStoreInfo);
router.get("/home", catalog.listHome);
router.get("/categories", catalog.listCategories);
router.get("/brands", catalog.listBrands);
router.get("/attributes", catalog.listAttributes);
router.get("/products", catalog.listProducts);
router.get("/products/suggestions", catalog.suggestions);
router.get("/products/:slug", catalog.getProduct);
router.get("/products/:slug/reviews", shop.listReviews);
router.post("/products/:slug/reviews", optionalAuth, shop.createReview);
router.get("/hero-slides", catalog.listHeroSlides);
router.get("/flash-sales", catalog.listFlashSales);
// published theme + tokens for the storefront; ?preview=<token> serves the draft
router.get("/appearance", appearance.publicAppearance);

// checkout config for the storefront (fields, payment options, shipping areas).
// optionalAuth so a logged-in shopper gets their saved address as prefill.
router.get("/checkout", optionalAuth, settings.checkoutGet);
// live shipping options for a district/cart context (area, weight, international…)
router.post("/shipping-quote", settings.shippingQuote);

router.get("/orders/track", shop.trackOrder);
// account: the logged-in customer's own order history
router.get("/orders", auth, shop.listMyOrders);
router.get("/orders/:number", auth, shop.getMyOrder);

router.get("/wishlist", auth, shop.getWishlist);
router.post("/wishlist", auth, shop.toggleWishlist);

module.exports = router;
