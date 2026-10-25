const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/internationalController");
const { auth, requireAdmin } = require("../middleware/auth");

router.get("/settings", auth, requireAdmin, ctrl.getSettings);
router.put("/settings", auth, requireAdmin, ctrl.updateSettings);
router.post("/quote", ctrl.quote);

module.exports = router;
