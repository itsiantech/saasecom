const express = require("express");
const router = express.Router();
const { auth, requireAdmin } = require("../middleware/auth");
const ctrl = require("../controllers/promotionsController");

router.get("/status", auth, requireAdmin, ctrl.status);
router.get("/options", auth, requireAdmin, ctrl.options);

module.exports = router;
