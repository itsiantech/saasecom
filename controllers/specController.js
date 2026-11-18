const mongoose = require("mongoose");
const SpecDefinition = require("../models/SpecDefinition");
const Category = require("../models/Category");
const { getStoreId } = require("../lib/tenantContext");
const { escapeRegex } = require("../lib/inventory");
const {
  specError,
  cleanDefinition,
  assertCategory,
  resolveDefinitions,
  previewImport,
  applyImport,
  exportCsv,
} = require("../lib/specs");
const { writeAudit } = require("../lib/audit");

function storeIdOf(req) {
  if (req.store && req.store._id) return req.store._id;
  return getStoreId();
}

function requireStore(req) {
  const id = storeIdOf(req);
  if (!id) throw specError("Store context pawa jayni");
  return id;
}

function wrap(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function categoryFilter(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw || raw === "all") return null;
  if (!mongoose.isValidObjectId(raw)) throw specError("Category valid na");
  return raw;
}

async function categoryMap(storeId) {
  const rows = await Category.find({ store: storeId }).select("name slug").lean();
  return new Map(rows.map((c) => [String(c._id), c]));
}

/* ------------------------------------------------------------------ *
 * GET /api/specs — definitions for the Spec Manager table
 * ------------------------------------------------------------------ */
async function list(req, res) {
  const storeId = requireStore(req);
  const filter = { store: storeId };

  const category = categoryFilter(req.query.category);
  if (category) filter.category = category;
  if (String(req.query.category || "").trim() === "all") filter.category = { $ne: null };

  if (String(req.query.q || "").trim()) {
    const rx = new RegExp(escapeRegex(String(req.query.q).trim()), "i");
    filter.$or = [{ key: rx }, { label: rx }, { labelBn: rx }];
  }
  if (req.query.active === "true") filter.active = true;
  else if (req.query.active === "false") filter.active = false;

  const defs = await SpecDefinition.find(filter)
    .sort({ category: 1, sortOrder: 1, label: 1 })
    .lean();
  const cats = await categoryMap(storeId);
  res.json({
    definitions: defs.map((d) => ({
      ...d,
      categoryName: d.category ? (cats.get(String(d.category)) || {}).name || "" : "",
      categorySlug: d.category ? (cats.get(String(d.category)) || {}).slug || "" : "",
    })),
    total: defs.length,
  });
}

/* ------------------------------------------------------------------ *
 * GET /api/specs/meta?categories=id,id — defs for selected categories
 * ------------------------------------------------------------------ */
async function meta(req, res) {
  const storeId = requireStore(req);
  const ids = String(req.query.categories || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => mongoose.isValidObjectId(s));
  const definitions = await resolveDefinitions(storeId, ids);
  res.json({ definitions });
}

/* ------------------------------------------------------------------ *
 * writes
 * ------------------------------------------------------------------ */
async function create(req, res) {
  const storeId = requireStore(req);
  const fields = cleanDefinition(req.body || {});
  if (fields.category === undefined) fields.category = null;
  await assertCategory(storeId, fields.category);

  const dup = await SpecDefinition.findOne({
    store: storeId,
    category: fields.category || null,
    key: fields.key,
  })
    .select("_id")
    .lean();
  if (dup) throw specError(`"${fields.key}" ei category te agei ache`, 409);

  const def = await SpecDefinition.create({ ...fields, store: storeId });
  await writeAudit({
    store: storeId,
    user: req.user && req.user.id,
    action: "productBuilder.spec_create",
    entity: "SpecDefinition",
    entityId: def._id,
    newValue: fields,
  });
  res.status(201).json(def);
}

async function update(req, res) {
  const storeId = requireStore(req);
  const def = await SpecDefinition.findOne({ _id: req.params.id, store: storeId });
  if (!def) throw specError("Spec pawa jayni", 404);

  const fields = cleanDefinition({ ...def.toObject(), ...(req.body || {}) });
  await assertCategory(storeId, fields.category);

  const dup = await SpecDefinition.findOne({
    store: storeId,
    category: fields.category || null,
    key: fields.key,
    _id: { $ne: def._id },
  })
    .select("_id")
    .lean();
  if (dup) throw specError(`"${fields.key}" ei category te agei ache`, 409);

  const before = def.toObject();
  Object.assign(def, fields);
  await def.save();
  await writeAudit({
    store: storeId,
    user: req.user && req.user.id,
    action: "productBuilder.spec_update",
    entity: "SpecDefinition",
    entityId: def._id,
    oldValue: before,
    newValue: fields,
  });
  res.json(def);
}

async function remove(req, res) {
  const storeId = requireStore(req);
  const def = await SpecDefinition.findOne({ _id: req.params.id, store: storeId });
  if (!def) throw specError("Spec pawa jayni", 404);
  await def.deleteOne();
  await writeAudit({
    store: storeId,
    user: req.user && req.user.id,
    action: "productBuilder.spec_delete",
    entity: "SpecDefinition",
    entityId: def._id,
    oldValue: def.toObject(),
  });
  res.json({ ok: true });
}

async function reorder(req, res) {
  const storeId = requireStore(req);
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  if (!ids.length) throw specError("ids array lagbe");
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw specError("Spec id valid na");

  const found = await SpecDefinition.find({ store: storeId, _id: { $in: ids } })
    .select("_id")
    .lean();
  if (found.length !== ids.length) throw specError("Kichu spec ei store er na", 404);

  await SpecDefinition.bulkWrite(
    ids.map((id, index) => ({
      updateOne: {
        filter: { store: storeId, _id: id },
        update: { $set: { sortOrder: index } },
      },
    })),
    { ordered: false }
  );
  res.json({ ok: true, updated: ids.length });
}

/* ------------------------------------------------------------------ *
 * CSV import / export
 * ------------------------------------------------------------------ */
function csvOf(req) {
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body.csv === "string") return req.body.csv;
  return "";
}

async function importCsv(req, res) {
  const storeId = requireStore(req);
  const csv = csvOf(req);
  if (!csv.trim()) throw specError("CSV khali");

  const dryRun = req.query.dryRun !== "0" && req.query.dryRun !== "false";
  if (dryRun) return res.json(await previewImport(storeId, csv));

  try {
    return res.json(await applyImport(storeId, csv, req.user && req.user.id));
  } catch (err) {
    if (err.errors) {
      return res.status(err.status || 400).json({ message: err.message, errors: err.errors });
    }
    throw err;
  }
}

async function exportCsvFile(req, res) {
  const storeId = requireStore(req);
  const csv = await exportCsv(storeId);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="product-specs.csv"');
  res.write("\uFEFF");
  res.end(csv);
}

module.exports = { list, meta, create, update, remove, reorder, importCsv, exportCsvFile };
