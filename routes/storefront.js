const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/storefrontController");
const { resolveHostStore } = require("../lib/hostStore");

// /api/storefront/current = host (subdomain/custom domain) ye store, seta
async function fromHost(req, res, next) {
  if (req.params.slug !== "current") return next();
  try {
    const store = await resolveHostStore(req);
    if (!store) return res.status(404).json({ message: "Ei thikanay kono dokan nei" });
    req.params.slug = store.slug;
    next();
  } catch (err) {
    next(err);
  }
}

router.get("/:slug", fromHost, ctrl.getStorefront);
router.get("/:slug/hero-slides", fromHost, ctrl.listHeroSlides);
router.get("/:slug/products", fromHost, ctrl.listProducts);
router.get("/:slug/products/:product", fromHost, ctrl.getProduct);

module.exports = router;
