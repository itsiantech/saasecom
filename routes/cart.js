const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/cartController");
const { optionalAuth } = require("../middleware/auth");

// optionalAuth: Bearer token valid hole user er cart, na hole guest cart
router.use(optionalAuth);
router.get("/", ctrl.getCart);
router.get("/shipping-quote", ctrl.shippingQuote);
router.post("/items", ctrl.addItem);
router.patch("/items/:itemId", ctrl.updateItem);
router.delete("/items/:itemId", ctrl.removeItem);
router.post("/coupon", ctrl.applyCoupon);
router.delete("/coupon", ctrl.removeCoupon);
router.post("/checkout", ctrl.createOrder);

module.exports = router;
