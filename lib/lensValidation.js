/* ==========================================================================
   Lens Selector — input guards shared by the admin CRUD API (and reused by
   the public pricing step later). Same hand-written style as
   lib/supplierValidation.js: throw lensError(message, status).
   ========================================================================== */

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const MAX_PRICE_PAISA = 1000000000; // ৳1,00,00,000
const MAX_IDS = 100;

function lensError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function text(value, { field = "Field", max = 300, required = false } = {}) {
  const s = String(value == null ? "" : value).trim();
  if (required && !s) throw lensError(`${field} lagbe`);
  if (s.length > max) throw lensError(`${field} ${max} character er beshi hote parbe na`);
  return s;
}

function bool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === 1 || value === "1";
}

function intIn(value, { field = "Value", min = 0, max = 10000, fallback = 0 } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw lensError(`${field} number hote hobe`);
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) throw lensError(`${field} ${min}–${max} er moddhe hote hobe`);
  return rounded;
}

// Admin UI sends taka; pricePaisa wins when both are present.
function pricePaisaOf(body = {}) {
  if (body.pricePaisa !== undefined && body.pricePaisa !== null && body.pricePaisa !== "") {
    const paisa = intIn(body.pricePaisa, { field: "Price", min: 0, max: MAX_PRICE_PAISA, fallback: null });
    if (paisa === null) throw lensError("Package price lagbe");
    return paisa;
  }
  if (body.price !== undefined && body.price !== null && body.price !== "") {
    const taka = Number(body.price);
    if (!Number.isFinite(taka) || taka < 0) throw lensError("Price valid taka hote hobe");
    const paisa = Math.round(taka * 100);
    if (paisa > MAX_PRICE_PAISA) throw lensError("Price onek beshi");
    return paisa;
  }
  throw lensError("Package price lagbe");
}

function idList(value, { field = "Ids", max = MAX_IDS } = {}) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  const out = [];
  const seen = new Set();
  raw.forEach((entry) => {
    const id = String(entry || "").trim();
    if (!id) return;
    if (!OBJECT_ID_RE.test(id)) throw lensError(`${field} e invalid id ache`);
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  if (out.length > max) throw lensError(`${field} ${max} er beshi hote parbe na`);
  return out;
}

function parseTypePayload(body = {}) {
  return {
    name: text(body.name, { field: "Type name", max: 80, required: true }),
    needsPrescription: bool(body.needsPrescription, true),
    note: text(body.note, { field: "Note", max: 200 }),
    sortOrder: intIn(body.sortOrder, { field: "Sort order", min: 0, max: 9999, fallback: 0 }),
    active: bool(body.active, true),
  };
}

function parseCategoryPayload(body = {}) {
  return {
    name: text(body.name, { field: "Category name", max: 80, required: true }),
    typeIds: idList(body.typeIds, { field: "Types" }),
    sortOrder: intIn(body.sortOrder, { field: "Sort order", min: 0, max: 9999, fallback: 0 }),
    active: bool(body.active, true),
  };
}

function parsePackagePayload(body = {}) {
  return {
    name: text(body.name, { field: "Package name", max: 100, required: true }),
    brand: text(body.brand, { field: "Brand", max: 80 }),
    lensIndex: text(body.lensIndex, { field: "Lens index", max: 20 }),
    badge: text(body.badge, { field: "Badge", max: 40 }),
    description: text(body.description, { field: "Description", max: 400 }),
    pricePaisa: pricePaisaOf(body),
    typeIds: idList(body.typeIds, { field: "Types" }),
    categoryIds: idList(body.categoryIds, { field: "Categories" }),
    sortOrder: intIn(body.sortOrder, { field: "Sort order", min: 0, max: 9999, fallback: 0 }),
    active: bool(body.active, true),
  };
}

module.exports = {
  lensError,
  text,
  bool,
  intIn,
  pricePaisaOf,
  idList,
  parseTypePayload,
  parseCategoryPayload,
  parsePackagePayload,
  MAX_PRICE_PAISA,
};
