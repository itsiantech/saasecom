const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const User = require("../models/User");
const { auth, requireAdmin } = require("../middleware/auth");
const { correlation, rateLimit } = require("../middleware/reportRequest");
const { resolvePeriod } = require("../lib/reportPeriods");
const { accountsError, KINDS, VOID_TYPES } = require("../lib/accounts");
const service = require("../services/accountsService");

router.use(correlation);

function wrap(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function requireStore(req) {
  if (!req.store || !req.store._id) throw accountsError("Store context pawa jayni");
  return req.store._id;
}

function assertId(value, label) {
  if (!mongoose.isValidObjectId(value)) throw accountsError(`${label} valid na`);
  return value;
}

function assertKeys(source, allowed, label) {
  for (const key of Object.keys(source || {})) {
    if (!allowed.includes(key)) throw accountsError(`${label} ${key} support kore na`);
  }
}

function single(query, key) {
  const value = query[key];
  if (Array.isArray(value)) throw accountsError(`${key} ekbar e deya jabe`);
  return value;
}

function periodFromQuery(req) {
  assertKeys(req.query, ["preset", "from", "to", "q", "kind", "type"], "Query");
  const preset = single(req.query, "preset");
  const from = single(req.query, "from");
  const to = single(req.query, "to");
  return resolvePeriod({
    preset: preset || (!from && !to ? "this_month" : null),
    from,
    to,
  });
}

// Fail-closed sidebar probe: non-admin gets canView:false, never a 403 logout.
router.get(
  "/access",
  auth,
  wrap(async (req, res) => {
    const user = await User.findById(req.user.id).select("role").lean();
    const role = user && user.role;
    const owner =
      req.store && req.store.owner && String(req.store.owner.toString()) === String(req.user.id);
    const canView = role === "admin" || role === "superadmin" || Boolean(owner);
    res.json({ canView, canExport: canView, canEdit: canView });
  })
);

router.use(auth, requireAdmin);

router.get(
  "/dashboard",
  rateLimit("read"),
  wrap(async (req, res) => {
    const storeId = requireStore(req);
    res.json(await service.dashboard(storeId, periodFromQuery(req)));
  })
);

router.get(
  "/sales",
  rateLimit("read"),
  wrap(async (req, res) => {
    const storeId = requireStore(req);
    const period = periodFromQuery(req);
    const data = await service.salesSnapshot(storeId, period);
    res.json({ period: { from: period.from, to: period.to, days: period.days }, ...data });
  })
);

router.get(
  "/suppliers",
  rateLimit("read"),
  wrap(async (req, res) => {
    const storeId = requireStore(req);
    const period = periodFromQuery(req);
    const q = String(single(req.query, "q") || "").slice(0, 80);
    res.json(await service.supplierLedger(storeId, period, { q }));
  })
);

router.get(
  "/entries",
  rateLimit("read"),
  wrap(async (req, res) => {
    const storeId = requireStore(req);
    const period = periodFromQuery(req);
    const rawKind = String(single(req.query, "kind") || "").trim();
    let kinds = KINDS;
    if (rawKind) {
      kinds = rawKind
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (!kinds.length || kinds.some((kind) => !KINDS.includes(kind))) {
        throw accountsError("Expense type valid na");
      }
    }
    res.json(await service.listEntries(storeId, kinds, period));
  })
);

router.post(
  "/entries",
  rateLimit("read"),
  wrap(async (req, res) => {
    const storeId = requireStore(req);
    assertKeys(req.body, ["kind", "title", "amount", "entryDate", "method", "reference", "note"], "Body");
    const entry = await service.createEntry(storeId, req.user.id, req.body);
    res.status(201).json(entry);
  })
);

router.post(
  "/entries/:id/void",
  rateLimit("read"),
  wrap(async (req, res) => {
    const storeId = requireStore(req);
    assertId(req.params.id, "Entry");
    assertKeys(req.body, ["reason"], "Body");
    res.json(await service.voidEntry(storeId, req.user.id, req.params.id, req.body && req.body.reason));
  })
);

router.get(
  "/voids",
  rateLimit("read"),
  wrap(async (req, res) => {
    const storeId = requireStore(req);
    const period = periodFromQuery(req);
    const type = String(single(req.query, "type") || "all");
    if (type !== "all" && !VOID_TYPES.includes(type)) throw accountsError("Log type valid na");
    res.json(await service.voidLogs(storeId, period, { type }));
  })
);

router.get(
  "/export.xlsx",
  rateLimit("export"),
  wrap(async (req, res) => {
    const storeId = requireStore(req);
    const period = periodFromQuery(req);
    const file = await service.exportWorkbook(storeId, period);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(file.buffer);
  })
);

router.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error("accounts API:", req.correlationId, err.message);
  res.status(status).json({
    message: status >= 500 ? "Accounts report banate parlam na" : err.message,
    requestId: req.correlationId,
  });
});

module.exports = router;
