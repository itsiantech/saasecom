const express = require("express");
const router = express.Router();
const Staff = require("../models/Staff");

// shob staff dekha
router.get("/", async (req, res) => {
  const staff = await Staff.find();
  res.json(staff);
});

// ekta staff dekha
router.get("/:id", async (req, res) => {
  try {
    const staff = await Staff.findById(req.params.id);
    if (!staff) return res.status(404).json({ message: "Staff pawa jayni" });
    res.json(staff);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// notun staff add kora
router.post("/", async (req, res) => {
  try {
    const staff = await Staff.create(req.body);
    res.status(201).json(staff);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// staff update kora (admin only)
router.put("/:id", require("../middleware/auth").auth, require("../middleware/auth").requireAdmin, async (req, res) => {
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
router.delete("/:id", require("../middleware/auth").auth, require("../middleware/auth").requireAdmin, async (req, res) => {
  try {
    const staff = await Staff.findByIdAndDelete(req.params.id);
    if (!staff) return res.status(404).json({ message: "Staff pawa jayni" });
    res.json({ message: "Staff delete hoyeche" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
