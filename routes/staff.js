const express = require("express");
const router = express.Router();
const Staff = require("../models/Staff");
const { auth, requireAdmin } = require("../middleware/auth");
const requireTenant = require("../middleware/requireTenant");

// staff list ekhane email/permission ache — shudhu oei dokan er admin
const guard = [requireTenant, auth, requireAdmin];

// shob staff dekha
router.get("/", guard, async (req, res) => {
  const staff = await Staff.find();
  res.json(staff);
});

// ekta staff dekha
router.get("/:id", guard, async (req, res) => {
  try {
    const staff = await Staff.findById(req.params.id);
    if (!staff) return res.status(404).json({ message: "Staff pawa jayni" });
    res.json(staff);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// notun staff add kora
router.post("/", guard, async (req, res) => {
  try {
    const staff = await Staff.create(req.body);
    res.status(201).json(staff);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// staff update kora (admin only)
router.put("/:id", guard, async (req, res) => {
  try {
    const staff = await Staff.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!staff) return res.status(404).json({ message: "Staff pawa jayni" });
    res.json(staff);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// staff delete kora (admin only)
router.delete("/:id", guard, async (req, res) => {
  try {
    const staff = await Staff.findByIdAndDelete(req.params.id);
    if (!staff) return res.status(404).json({ message: "Staff pawa jayni" });
    res.json({ message: "Staff delete hoyeche" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
