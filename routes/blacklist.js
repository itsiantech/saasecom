const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Blacklist = require("../models/Blacklist");
const { auth, requireAdmin } = require("../middleware/auth");
const requireTenant = require("../middleware/requireTenant");
const { requireFeature } = require("../lib/features");
const { writeAudit } = require("../lib/audit");
const { normalizeBdPhone } = require("../lib/fraudRisk");
const { normalizeAddress } = require("../services/orderProtection");

const guard = [requireTenant, auth, requireAdmin, requireFeature("orders")];

const TYPES = ["phone", "address", "ip"];

function cleanValue(type, raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (type === "phone") return normalizeBdPhone(text);
  if (type === "address") return normalizeAddress(text).slice(0, 300);
  if (type === "ip") return text.slice(0, 64);
  return "";
}

/* GET /api/blacklist?type= — store er blocklist */
router.get("/", guard, async (req, res) => {
  const query = { store: req.storeId };
  if (TYPES.includes(req.query.type)) query.type = req.query.type;
  const rows = await Blacklist.find(query).sort({ createdAt: -1 }).limit(500).lean();
  res.json({
    entries: rows.map((r) => ({
      id: r._id,
      type: r.type,
      value: r.value,
      reason: r.reason || "",
      createdAt: r.createdAt,
    })),
  });
});

/* POST /api/blacklist  { type, value, reason } */
router.post("/", guard, async (req, res) => {
  const body = req.body || {};
  const type = String(body.type || "").trim();
  if (!TYPES.includes(type)) return res.status(400).json({ message: "Type valid na (phone/address/ip)" });
  const value = cleanValue(type, body.value);
  if (!value) {
    return res.status(400).json({
      message: type === "phone" ? "Phone number valid BD number hote hobe (01XXXXXXXXX)" : "Value khali rakha jabe na",
    });
  }
  const reason = String(body.reason || "").trim().slice(0, 300);
  const exists = await Blacklist.findOne({ store: req.storeId, type, value }).lean();
  if (exists) return res.status(409).json({ message: "Ei entry already blacklist e ache" });

  const entry = await Blacklist.create({
    store: req.storeId,
    type,
    value,
    reason,
    createdBy: req.user && req.user.id,
  });
  await writeAudit({
    store: req.storeId,
    user: req.user && req.user.id,
    action: "blacklist.add",
    entity: "Blacklist",
    entityId: String(entry._id),
    newValue: { type, value, reason },
  });
  res.status(201).json({ ok: true, entry: { id: entry._id, type, value, reason, createdAt: entry.createdAt } });
});

/* DELETE /api/blacklist/:id */
router.delete("/:id", guard, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: "Entry pawa jayni" });
  }
  const entry = await Blacklist.findOne({ _id: req.params.id, store: req.storeId }).lean();
  if (!entry) return res.status(404).json({ message: "Entry pawa jayni" });
  await Blacklist.deleteOne({ _id: entry._id });
  await writeAudit({
    store: req.storeId,
    user: req.user && req.user.id,
    action: "blacklist.remove",
    entity: "Blacklist",
    entityId: String(entry._id),
    oldValue: { type: entry.type, value: entry.value, reason: entry.reason },
  });
  res.json({ ok: true });
});

module.exports = router;