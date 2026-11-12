const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const User = require("../models/User");
const { auth, requireAdmin } = require("../middleware/auth");
const { correlation, rateLimit } = require("../middleware/reportRequest");
const { csvCell } = require("../services/reportExport");
const { inventoryError } = require("../lib/inventory");
const service = require("../services/inventoryService");

router.use(correlation);

function wrap(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function requireStore(req) {
  if (!req.store || !req.store._id) throw inventoryError("Store context pawa jayni");
  return req.store._id;
}

function assertId(value, label, required = true) {
  if (value == null || value === "") {
    if (required) throw inventoryError(`${label} lagbe`);
    return null;
  }
  if (!mongoose.isValidObjectId(value)) throw inventoryError(`${label} valid na`);
  return value;
}

function assertKeys(source, allowed, label) {
  for (const key of Object.keys(source || {})) {
    if (!allowed.includes(key)) throw inventoryError(`${label} ${key} support kore na`);
  }
}

function single(query, key) {
  const value = query[key];
  if (Array.isArray(value)) throw inventoryError(`${key} ekbar e deya jabe`);
  return value;
}

// Fail-closed sidebar probe. It skips requireAdmin so a store member gets
// canView:false instead of a 403 that would log them out of the dashboard.
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

/* ------------------------------- reads ------------------------------- */

router.get(
  "/overview",
  rateLimit("read"),
  wrap(async (req, res) => {
    assertKeys(req.query, ["lowStock"], "Query");
    res.json(await service.overview(requireStore(req), { lowStock: single(req.query, "lowStock") }));
  })
);

router.get(
  "/categories",
  rateLimit("read"),
  wrap(async (req, res) => {
    assertKeys(req.query, [], "Query");
    res.json(await service.categoryStock(requireStore(req)));
  })
);

router.get(
  "/variants",
  rateLimit("read"),
  wrap(async (req, res) => {
    assertKeys(req.query, [], "Query");
    res.json(await service.variantStock(requireStore(req)));
  })
);

router.get(
  "/suppliers",
  rateLimit("read"),
  wrap(async (req, res) => {
    assertKeys(req.query, ["status", "q"], "Query");
    res.json(
      await service.supplierStock(requireStore(req), {
        status: single(req.query, "status"),
        q: single(req.query, "q"),
      })
    );
  })
);

router.get(
  "/movements",
  rateLimit("read"),
  wrap(async (req, res) => {
    assertKeys(req.query, ["type", "q", "days", "page", "limit"], "Query");
    res.json(await service.movements(requireStore(req), req.query));
  })
);

router.get(
  "/damage",
  rateLimit("read"),
  wrap(async (req, res) => {
    assertKeys(req.query, ["page", "limit"], "Query");
    res.json(await service.damageReturnList(requireStore(req), req.query));
  })
);

router.get(
  "/adjustments",
  rateLimit("read"),
  wrap(async (req, res) => {
    assertKeys(req.query, ["page", "limit"], "Query");
    res.json(await service.adjustmentList(requireStore(req), req.query));
  })
);

router.get(
  "/products",
  rateLimit("read"),
  wrap(async (req, res) => {
    assertKeys(req.query, ["q"], "Query");
    const products = await service.productOptions(requireStore(req), { q: single(req.query, "q") });
    res.json({ products });
  })
);

router.get(
  "/warehouses",
  rateLimit("read"),
  wrap(async (req, res) => {
    assertKeys(req.query, [], "Query");
    res.json(await service.warehouseList(requireStore(req)));
  })
);

router.get(
  "/transfers",
  rateLimit("read"),
  wrap(async (req, res) => {
    assertKeys(req.query, ["page", "limit"], "Query");
    res.json(await service.transfersList(requireStore(req), req.query));
  })
);

/* ------------------------------- writes ------------------------------ */

router.post(
  "/damage",
  rateLimit("read"),
  wrap(async (req, res) => {
    assertKeys(req.body, ["mode", "productId", "variationId", "swatchId", "quantity", "restock", "reference", "note"], "Body");
    assertId(req.body && req.body.productId, "Product");
    assertId(req.body && req.body.variationId, "Variation", false);
    assertId(req.body && req.body.swatchId, "Swatch", false);
    const result = await service.recordDamageReturn(requireStore(req), req.user.id, req.body || {});
    res.json(result);
  })
);

router.post(
  "/adjust",
  rateLimit("read"),
  wrap(async (req, res) => {
    assertKeys(
      req.body,
      ["mode", "productId", "variationId", "swatchId", "quantity", "reason"],
      "Body"
    );
    assertId(req.body && req.body.productId, "Product");
    assertId(req.body && req.body.variationId, "Variation", false);
    assertId(req.body && req.body.swatchId, "Swatch", false);
    res.json(await service.adjustStock(requireStore(req), req.user.id, req.body || {}));
  })
);

router.post(
  "/import",
  rateLimit("read"),
  express.text({ type: ["text/csv", "text/plain", "application/csv"], limit: "2mb" }),
  wrap(async (req, res) => {
    const csv =
      typeof req.body === "string" ? req.body : String((req.body && req.body.csv) || "");
    if (!csv.trim()) throw inventoryError("CSV khali");
    const dryRun = req.query.dryRun !== "0" && req.query.dryRun !== "false";
    res.json(await service.importStock(requireStore(req), req.user.id, { csv, dryRun }));
  })
);

router.post(
  "/warehouses",
  rateLimit("read"),
  wrap(async (req, res) => {
    assertKeys(req.body, ["name", "address"], "Body");
    res.status(201).json(await service.createWarehouse(requireStore(req), req.body || {}));
  })
);

router.delete(
  "/warehouses/:id",
  rateLimit("read"),
  wrap(async (req, res) => {
    assertId(req.params.id, "Warehouse");
    res.json(await service.deleteWarehouse(requireStore(req), req.params.id));
  })
);

router.post(
  "/transfers",
  rateLimit("read"),
  wrap(async (req, res) => {
    assertKeys(
      req.body,
      ["fromWarehouseId", "toWarehouseId", "productId", "variationId", "swatchId", "quantity", "note"],
      "Body"
    );
    assertId(req.body && req.body.fromWarehouseId, "From warehouse");
    assertId(req.body && req.body.toWarehouseId, "To warehouse");
    assertId(req.body && req.body.productId, "Product");
    assertId(req.body && req.body.variationId, "Variation", false);
    assertId(req.body && req.body.swatchId, "Swatch", false);
    res.json(await service.transferStock(requireStore(req), req.user.id, req.body || {}));
  })
);

/* ------------------------------- export ------------------------------ */

router.get(
  "/export",
  rateLimit("export"),
  wrap(async (req, res) => {
    assertKeys(req.query, ["view", "type", "q", "days", "status"], "Query");
    const view = String(single(req.query, "view") || "");
    const allowed = ["overview", "category", "variant", "supplier", "movements", "damage", "adjustment", "transfer"];
    if (!allowed.includes(view)) throw inventoryError("Export view pawa jayni");
    const data = await service.buildExport(requireStore(req), view, {
      type: single(req.query, "type"),
      q: single(req.query, "q"),
      days: single(req.query, "days"),
      status: single(req.query, "status"),
    });

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${data.fileName}"`);
    res.write("\uFEFF");
    const rows = [data.headers, ...data.rows];
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200).map((row) => row.map(csvCell).join(","));
      res.write(`${chunk.join("\r\n")}\r\n`);
    }
    res.end();
  })
);

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number(err.status) || 500;
  const message = status < 500 ? err.message : "Inventory report banate parlam na";
  console.error("inventory API:", req.correlationId, err.message || err);
  return res.status(status).json({ message, requestId: req.correlationId });
});

module.exports = router;
