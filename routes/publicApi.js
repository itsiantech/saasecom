const express = require("express");
const router = express.Router();
const publicStore = require("../middleware/publicStore");
const catalog = require("../controllers/publicCatalogController");
const shop = require("../controllers/publicShopController");
const settings = require("../controllers/settingsController");
const appearance = require("../controllers/appearanceController");
const { auth, optionalAuth } = require("../middleware/auth");

/* ------------------------------------------------------------------ *
 * /api/public/* — read API for the Next.js storefront.
 * Mounted BEFORE middleware/tenant (server.js); middleware/publicStore
 * decides the store from host / x-store-domain / x-store-slug / ?store=
 * only — never from the JWT, so a logged-in shopper cannot read another
 * store's catalog by accident.
 * ------------------------------------------------------------------ */

router.use(publicStore);

router.get("/store", catalog.getStoreInfo);
router.get("/categories", catalog.listCategories);
router.get("/brands", catalog.listBrands);
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
