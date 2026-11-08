const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/cartController");
const { optionalAuth } = require("../middleware/auth");

// optionalAuth: Bearer token valid hole user er cart, na hole guest cart
router.use(optionalAuth);

// Same cart koekbar ekshathe checkout pathale ekbar-i process hobe.
const checkoutInFlight = new Set();

function checkoutLock(req, res, next) {
  const store = req.store && req.store._id ? String(req.store._id) : "none";
  const who =
    req.user && req.user.id
      ? "user:" + req.user.id
      : "session:" + String(req.header("x-session-id") || (req.body && req.body.sessionId) || "guest");
  const key = store + "|" + who;
  if (checkoutInFlight.has(key)) {
    return res.status(409).json({ message: "Checkout cholche — ektu opekkha korun" });
  }
  checkoutInFlight.add(key);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    checkoutInFlight.delete(key);
  };
  res.on("finish", release);
  res.on("close", release);
  next();
}

router.get("/", ctrl.getCart);
router.get("/shipping-quote", ctrl.shippingQuote);
router.post("/items", ctrl.addItem);
router.patch("/items/:itemId", ctrl.updateItem);
router.delete("/items/:itemId", ctrl.removeItem);
router.post("/coupon", ctrl.applyCoupon);
router.delete("/coupon", ctrl.removeCoupon);
router.post("/checkout", checkoutLock, ctrl.createOrder);

module.exports = router;
