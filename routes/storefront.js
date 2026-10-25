const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/storefrontController");

router.get("/:slug", ctrl.getStorefront);
router.get("/:slug/hero-slides", ctrl.listHeroSlides);
router.get("/:slug/products", ctrl.listProducts);
router.get("/:slug/products/:product", ctrl.getProduct);

module.exports = router;
