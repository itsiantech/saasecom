const express = require("express");
const router = express.Router();
const { rateLimit } = require("../lib/rateLimit");
const { checkShopName } = require("../lib/shopAddress");

/* Public live check for the shop address input. Mounted before the tenant
 * middleware — onboarding has no store yet. The response never lists or
 * counts existing names: only available + a coarse reason. */
const checkLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: "check-slug",
  message: "এক মিনিটে অনেকবার চেক করা হয়েছে — একটু পরে আবার চেষ্টা করুন",
});

router.get("/check-slug", checkLimit, async (req, res) => {
  const raw = String(req.query.slug == null ? "" : req.query.slug).slice(0, 100);
  res.set("Cache-Control", "no-store");
  try {
    const result = await checkShopName(raw);
    res.json({ available: result.available, reason: result.reason });
  } catch (err) {
    res.status(500).json({ message: "ঠিকানা চেক করা যায়নি — আবার চেষ্টা করুন" });
  }
});

module.exports = router;
