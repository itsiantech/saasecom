const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/cartController");
const { optionalAuth } = require("../middleware/auth");
const { requestOtp } = require("../lib/otp");
const { rateLimit } = require("../lib/rateLimit");
const { getSettingsMap } = require("../controllers/settingsController");

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

// COD order verification OTP — SMS settings + protect_otp_enabled duitai on lagbe
const codOtpLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  keyPrefix: "cod-otp",
  keyOf: (req) => (req.body || {}).phone || "",
});
router.post("/otp/request", codOtpLimit, async (req, res) => {
  const storeId = req.store && req.store._id ? req.store._id : null;
  if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
  const map = await getSettingsMap();
  if (String(map.protect_otp_enabled) !== "true") {
    return res.status(400).json({ message: "COD OTP enable kora nei" });
  }
  const result = await requestOtp(storeId, String((req.body || {}).phone || ""), "cod");
  if (!result.ok) return res.status(400).json({ message: result.message });
  res.json({ ok: true, minutes: result.minutes });
});

module.exports = router;
