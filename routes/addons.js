const express = require("express");
const router = express.Router();
const { auth, requireAdmin } = require("../middleware/auth");
const { listForStore } = require("../lib/addons");

// store owner-er dashboard ei list theke sidebar-e add-on menu bosay
router.get("/", auth, requireAdmin, async (req, res) => {
  try {
    res.json(await listForStore(req.store));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;