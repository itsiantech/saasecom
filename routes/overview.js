const express = require("express");
const router = express.Router();
const { auth, requireAdmin } = require("../middleware/auth");
const { overview } = require("../services/overviewService");

function wrap(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function single(value) {
  if (Array.isArray(value)) return value[0];
  return value;
}

router.use(auth, requireAdmin);

router.get(
  "/",
  wrap(async (req, res) => {
    if (!req.store || !req.store._id) {
      return res.status(400).json({ message: "Prothome ekta store khulun" });
    }
    const data = await overview(req.store._id, {
      period: single(req.query.period),
      from: single(req.query.from),
      to: single(req.query.to),
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(data);
  })
);

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err.status) || 500;
  const message = status < 500 ? err.message : "Overview data load hoyni";
  if (status >= 500) console.error("overview API:", err.message || err);
  return res.status(status).json({ message });
});

module.exports = router;
