/* ==========================================================================
   Product specs — definitions per category, product values and CSV import.
   A missing definition or missing value is never an error for the rule engine;
   this file only guards what is written through the admin APIs.
   ========================================================================== */
const mongoose = require("mongoose");
const SpecDefinition = require("../models/SpecDefinition");
const { parseCsv, cleanText } = require("./inventory");
const { csvCell } = require("../services/reportExport");

const SPEC_TYPES = ["text", "number", "enum", "boolean", "multi-enum"];
const KEY_RE = /^[a-z][a-z0-9_-]{0,49}$/;
const MAX_SPECS = 100;
const CSV_HEADERS = [
  "category",
  "key",
  "label",
  "label_bn",
  "type",
  "unit",
  "enum_values",
  "filterable",
  "show_in_list",
  "active",
  "sort_order",
];

function specError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(s)) return true;
  if (["false", "0", "no", "off"].includes(s)) return false;
  throw specError(`"${value}" ke true/false e bujhi na`);
}

function parseEnumValues(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/\s*\|\s*|\s*,\s*/);
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const value = typeof item === "object" ? cleanText(item && item.value, 60) : cleanText(item, 60);
    if (!value) continue;
    const lower = value.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    const label = typeof item === "object" ? cleanText(item.label, 80) || value : value;
    out.push({ value, label });
  }
  return out;
}

function parseSortOrder(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1000000, Math.min(1000000, Math.trunc(n)));
}

// Validates one admin/CSV definition. `category` stays undefined when the
// caller is patching and did not send it.
function cleanDefinition(payload) {
  const src = payload || {};
  const key = cleanText(src.key, 50).toLowerCase();
  if (!KEY_RE.test(key)) {
    throw specError("Spec key choto hater akshor diye shuru hobe (a-z, 0-9, -, _)");
  }
  const label = cleanText(src.label, 100);
  if (!label) throw specError("Spec label lagbe");

  const type = String(src.type || "text").trim().toLowerCase();
  if (!SPEC_TYPES.includes(type)) throw specError(`Spec type "${src.type}" support kore na`);

  const enumValues = parseEnumValues(src.enumValues !== undefined ? src.enumValues : src.enum_values);
  if ((type === "enum" || type === "multi-enum") && (!enumValues || !enumValues.length)) {
    throw specError("Enum spec e at least ekta man lagbe");
  }

  let category = src.category === undefined ? undefined : src.category;
  if (category === "" || category === null) category = null;
  else if (!mongoose.isValidObjectId(category)) throw specError("Category valid na");

  return {
    category,
    key,
    label,
    labelBn: cleanText(src.labelBn !== undefined ? src.labelBn : src.label_bn, 100),
    type,
    unit: cleanText(src.unit, 20),
    enumValues: type === "enum" || type === "multi-enum" ? enumValues : [],
    filterable: parseBool(src.filterable, true),
    showInList: parseBool(src.showInList !== undefined ? src.showInList : src.show_in_list, false),
    active: parseBool(src.active, true),
    sortOrder: parseSortOrder(src.sortOrder !== undefined ? src.sortOrder : src.sort_order),
  };
}

async function assertCategory(storeId, categoryId) {
  if (!categoryId) return;
  const Category = require("../models/Category");
  const hit = await Category.findOne({ store: storeId, _id: categoryId }).select("_id").lean();
  if (!hit) throw specError("Category pawa jayni", 404);
}

// Category-scoped specs plus the store-wide (`category: null`) ones.
async function resolveDefinitions(storeId, categoryIds) {
  const ids = (Array.isArray(categoryIds) ? categoryIds : []).filter((id) => mongoose.isValidObjectId(id));
  const scope = [{ category: null }];
  if (ids.length) scope.push({ category: { $in: ids } });
  return SpecDefinition.find({ store: storeId, active: { $ne: false }, $or: scope })
    .sort({ sortOrder: 1, label: 1 })
    .lean();
}

function canonicalEnumValue(def, raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return undefined;
  const hit = (def.enumValues || []).find((v) => String(v.value).toLowerCase() === text.toLowerCase());
  if (!hit) throw specError(`"${def.label}" er man "${text}" allowed list e nei`);
  return hit.value;
}

function sanitizeValue(def, raw) {
  if (raw === undefined || raw === null) return undefined;
  switch (def.type) {
    case "number": {
      if (String(raw).trim() === "") return undefined;
      const n = Number(raw);
      if (!Number.isFinite(n)) throw specError(`"${def.label}" shongkha hote hobe`);
      return n;
    }
    case "boolean": {
      if (typeof raw === "boolean") return raw;
      const s = String(raw).trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(s)) return true;
      if (["false", "0", "no", "off"].includes(s)) return false;
      throw specError(`"${def.label}" er man true/false hote hobe`);
    }
    case "enum":
      return canonicalEnumValue(def, raw);
    case "multi-enum": {
      const list = Array.isArray(raw) ? raw : String(raw).split(/\s*\|\s*|\s*,\s*/);
      const out = [];
      for (const item of list) {
        const value = canonicalEnumValue(def, item);
        if (value !== undefined && !out.includes(value)) out.push(value);
      }
      return out.length ? out : undefined;
    }
    default: {
      const text = String(raw).trim().slice(0, 500);
      return text || undefined;
    }
  }
}

// Product payload -> stored `specs` map. Undefined means "leave the product's
// existing specs alone"; null/{} clears them.
async function sanitizeProductSpecs(storeId, categoryIds, raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw specError("specs object hote hobe");

  const entries = Object.entries(raw);
  if (entries.length > MAX_SPECS) throw specError(`Ek product e ${MAX_SPECS} er beshi spec deya jabe na`);

  const defs = await resolveDefinitions(storeId, categoryIds);
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const out = {};
  const unknown = [];
  entries.forEach(([rawKey, rawValue]) => {
    const def = byKey.get(String(rawKey || "").trim().toLowerCase());
    if (!def) {
      unknown.push(String(rawKey));
      return;
    }
    const value = sanitizeValue(def, rawValue);
    if (value !== undefined) out[def.key] = value;
  });
  if (unknown.length) {
    throw specError(`Ei product er category te spec nei: ${unknown.join(", ")}`);
  }
  return out;
}

/* ------------------------------- CSV ------------------------------- */

function normalizeHeaderCell(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function parseDefinitionImport(text, categories) {
  const rows = parseCsv(text);
  const errors = [];
  const out = [];
  if (!rows.length || !rows[0].some((c) => String(c).trim())) {
    return { rows: out, errors: [{ line: 1, message: "CSV khali" }] };
  }
  const header = rows[0].map(normalizeHeaderCell);
  const idx = {};
  header.forEach((h, i) => {
    if (CSV_HEADERS.includes(h) && idx[h] === undefined) idx[h] = i;
  });
  if (idx.key === undefined || idx.label === undefined) {
    return { rows: out, errors: [{ line: 1, message: "Header e key ar label column lagbe" }] };
  }

  const bySlug = new Map(
    (categories || []).map((c) => [String(c.slug || "").toLowerCase(), c])
  );
  const seen = new Map();

  for (let r = 1; r < rows.length; r += 1) {
    const line = r + 1;
    const cells = rows[r];
    if (!cells.some((c) => String(c).trim())) continue;
    const get = (name) =>
      idx[name] === undefined ? undefined : String(cells[idx[name]] == null ? "" : cells[idx[name]]).trim();

    const slug = String(get("category") || "").toLowerCase();
    let category = null;
    if (slug) {
      const cat = bySlug.get(slug);
      if (!cat) {
        errors.push({ line, message: `Category "${slug}" pawa jayni` });
        continue;
      }
      category = cat._id;
    }

    try {
      const row = cleanDefinition({
        category,
        key: get("key"),
        label: get("label"),
        labelBn: get("label_bn"),
        type: get("type") || "text",
        unit: get("unit"),
        enumValues: get("enum_values"),
        filterable: get("filterable"),
        showInList: get("show_in_list"),
        active: get("active"),
        sortOrder: get("sort_order"),
      });
      const dupKey = `${category || "*"}:${row.key}`;
      if (seen.has(dupKey)) {
        errors.push({ line, message: `"${row.key}" eki category te abar ache (line ${seen.get(dupKey)})` });
        continue;
      }
      seen.set(dupKey, line);
      out.push({ ...row, line });
    } catch (err) {
      errors.push({ line, message: err.message });
    }
  }

  return { rows: out, errors };
}

async function importContext(storeId) {
  const Category = require("../models/Category");
  const [categories, defs] = await Promise.all([
    Category.find({ store: storeId, status: { $ne: "trashed" } }).select("slug name").lean(),
    SpecDefinition.find({ store: storeId }).select("category key label type").lean(),
  ]);
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  const existing = new Map(defs.map((d) => [`${d.category || "*"}:${d.key}`, d]));
  return { categories, byId, existing };
}

async function previewImport(storeId, csv) {
  const ctx = await importContext(storeId);
  const { rows, errors } = parseDefinitionImport(csv, ctx.categories);
  const preview = rows.map((row) => {
    const hit = ctx.existing.get(`${row.category || "*"}:${row.key}`);
    return {
      line: row.line,
      action: hit ? "update" : "create",
      category: row.category ? (ctx.byId.get(String(row.category)) || {}).slug || "" : "",
      key: row.key,
      label: row.label,
      type: row.type,
      unit: row.unit,
    };
  });
  return {
    ok: errors.length === 0,
    total: preview.length,
    creates: preview.filter((r) => r.action === "create").length,
    updates: preview.filter((r) => r.action === "update").length,
    preview,
    errors,
  };
}

async function applyImport(storeId, csv, userId) {
  const ctx = await importContext(storeId);
  const { rows, errors } = parseDefinitionImport(csv, ctx.categories);
  if (errors.length) {
    const err = specError(`CSV e ${errors.length} ta bhul ache — age thik korun`);
    err.errors = errors;
    throw err;
  }
  if (!rows.length) throw specError("CSV te kono spec row nei");

  let creates = 0;
  let updates = 0;
  const ops = rows.map((row) => {
    const key = `${row.category || "*"}:${row.key}`;
    if (ctx.existing.has(key)) updates += 1;
    else creates += 1;
    const { line, ...fields } = row;
    return {
      updateOne: {
        filter: { store: storeId, category: row.category || null, key: row.key },
        update: { $set: { ...fields, store: storeId } },
        upsert: true,
      },
    };
  });
  await SpecDefinition.bulkWrite(ops, { ordered: false });

  const { writeAudit } = require("./audit");
  await writeAudit({
    store: storeId,
    user: userId,
    action: "productBuilder.specs_import",
    entity: "SpecDefinition",
    entityId: null,
    newValue: { total: rows.length, creates, updates },
  });

  return { ok: true, total: rows.length, creates, updates };
}

async function exportCsv(storeId) {
  const { categories } = await importContext(storeId);
  const slugById = new Map(categories.map((c) => [String(c._id), c.slug]));
  const defs = await SpecDefinition.find({ store: storeId })
    .sort({ category: 1, sortOrder: 1, key: 1 })
    .lean();
  const lines = defs.map((d) =>
    [
      d.category ? slugById.get(String(d.category)) || "" : "",
      d.key,
      d.label,
      d.labelBn,
      d.type,
      d.unit,
      (d.enumValues || []).map((v) => v.value).join("|"),
      d.filterable,
      d.showInList,
      d.active,
      d.sortOrder,
    ]
      .map(csvCell)
      .join(",")
  );
  return [CSV_HEADERS.join(","), ...lines].join("\r\n");
}

module.exports = {
  SPEC_TYPES,
  MAX_SPECS,
  CSV_HEADERS,
  specError,
  cleanDefinition,
  assertCategory,
  resolveDefinitions,
  sanitizeProductSpecs,
  sanitizeValue,
  parseDefinitionImport,
  previewImport,
  applyImport,
  exportCsv,
};
