const express = require("express");
const router = express.Router();
const { auth, requireAdmin } = require("../middleware/auth");
const ctrl = require("../controllers/couponsController");

// fixed paths before /:id
router.post("/draft", auth, requireAdmin, ctrl.saveDraft);
router.get("/drafts", auth, requireAdmin, ctrl.listDrafts);
router.delete("/drafts/:id", auth, requireAdmin, ctrl.removeDraft);

router.get("/", auth, requireAdmin, ctrl.list);
router.post("/", auth, requireAdmin, ctrl.create);
router.put("/:id", auth, requireAdmin, ctrl.update);
router.delete("/:id", auth, requireAdmin, ctrl.remove);

module.exports = router;