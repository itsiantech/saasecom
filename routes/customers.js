const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/customerController");
const { auth, requireAdmin } = require("../middleware/auth");

router.use(auth, requireAdmin);

router.get("/", ctrl.list);
router.get("/:id", ctrl.detail);
router.patch("/:id", ctrl.update);
router.post("/:id/reset-password", ctrl.resetPassword);
router.post("/:id/notes", ctrl.addNote);
router.delete("/:id", ctrl.hide);

module.exports = router;
