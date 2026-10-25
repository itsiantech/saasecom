const { fromPaisa } = require("../lib/money");

// ---- list query building ----

const LIST_FILTERS = ["all", "hot", "active", "inactive", "tiers", "international"];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mongooseLikeId(id) {
  return typeof id === "string" && id.length === 24 && /^[0-9a-f]+$/i.test(id);
}

// clamp an advanced min/max pair into a Mongo range clause
function rangeClause(rawMin, rawMax) {
  const clause = {};
  const min = Number(rawMin);
  const max = Number(rawMax);
  if (rawMin !== "" && rawMin != null && Number.isFinite(min)) clause.$gte = min;
  if (rawMax !== "" && rawMax != null && Number.isFinite(max)) clause.$lte = max;
  return Object.keys(clause).length ? clause : null;
}

// filter: all|hot|active|inactive|tiers|international ; search: name+SKU match.
// tierProductIds: pre-computed product ids having tiers (wholesale mode only).
// advanced: category, sku, type, status, priceMin, priceMax, stockMin, stockMax
function buildListQuery({ filter = "all", search = "", tierProductIds = null, advanced = {} } = {}) {
  const query = {};
  const f = LIST_FILTERS.includes(filter) ? filter : "all";

  if (f === "hot") query.isHotDeal = true;
  else if (f === "active") query.status = "published";
  else if (f === "inactive") query.status = "draft";
  else if (f === "tiers") {
    if (Array.isArray(tierProductIds)) query._id = { $in: tierProductIds };
  } else if (f === "international") query.shipsAbroad = true;

  const s = String(search || "").trim();
  if (s) {
    const rx = new RegExp(escapeRegex(s), "i");
    query.$or = [{ name: rx }, { title: rx }, { sku: rx }];
  }

  advanced = advanced || {};

  // Advanced search panel params — AND-combined with the chip filter
  if (advanced.category && mongooseLikeId(advanced.category)) {
    query.categories = advanced.category;
  }
  const sku = String(advanced.sku || "").trim();
  if (sku) query.sku = new RegExp(escapeRegex(sku), "i");
  if (["physical", "digital"].includes(advanced.type)) query.productType = advanced.type;
  if (advanced.status === "active") query.status = "published";
  else if (advanced.status === "inactive") query.status = "draft";

  const priceClause = rangeClause(advanced.priceMin, advanced.priceMax);
  if (priceClause) query.price = priceClause;
  const stockClause = rangeClause(advanced.stockMin, advanced.stockMax);
  if (stockClause) query.stock = stockClause;

  return query;
}

// ---- columns per mode (ordered exactly as the spec) ----

function listColumns({ wholesale = false, international = false } = {}) {
  // checkbox, SL, name(+SKU), category, type, image, price, stock, variations,
  // deal, status, action — action must stay the LAST column
  const cols = [
    "checkbox", "sl", "name", "category", "type", "image", "price",
    "stock", "variations", "deal", "status", "action",
  ];
  if (wholesale) {
    // price column becomes "Retail price"; add tiers + MOQ after stock
    const i = cols.indexOf("stock");
    cols.splice(i + 1, 0, "wholesaleTiers", "moq");
  }
  if (international) {
    const i = wholesale ? cols.indexOf("moq") : cols.indexOf("stock");
    cols.splice(i + 1, 0, "international");
  }
  return cols;
}

// ---- formatting helpers ----

// [{minQty,maxQty,pricePaisa}] -> ["1-10: 520", "11-50: 450", "51+: 400"]
function tierLines(tiers) {
  if (!Array.isArray(tiers) || !tiers.length) return [];
  return tiers
    .slice()
    .sort((a, b) => a.minQty - b.minQty)
    .map((t) => {
      const range = t.maxQty ? `${t.minQty}-${t.maxQty}` : `${t.minQty}+`;
      return `${range}: ${fromPaisa(t.pricePaisa)}`;
    });
}

// sale bold + regular struck when a valid sale exists
function priceDisplay({ regularPrice = 0, salePrice = 0 } = {}) {
  const regular = Number(regularPrice) || 0;
  const sale = Number(salePrice) || 0;
  if (sale > 0 && sale < regular) return { sale, regular, hasSale: true };
  return { sale: 0, regular, hasSale: false };
}

// ---- bulk actions ----

const BULK_ACTIONS = ["activate", "deactivate", "delete", "set_tiers", "allow_international"];

// returns {ok:true} or {ok:false, code}
function validateBulkAction({ action, ids, wholesale = false, international = false, tier = null, countryCodes = null }) {
  if (!BULK_ACTIONS.includes(action)) return { ok: false, code: "unknown_action" };
  if (!Array.isArray(ids) || !ids.length || ids.length > 500) return { ok: false, code: "bad_ids" };
  if (action === "set_tiers" && !wholesale) return { ok: false, code: "wholesale_off" };
  if (action === "set_tiers") {
    if (!Array.isArray(tier) || !tier.length) return { ok: false, code: "bad_tier" };
    for (const row of tier) {
      const min = Number(row.minQty);
      const price = Number(row.price);
      if (!Number.isFinite(min) || min < 1) return { ok: false, code: "bad_tier" };
      if (!Number.isFinite(price) || price < 0) return { ok: false, code: "bad_tier" };
      if (row.maxQty != null && row.maxQty !== "" && Number(row.maxQty) < min) return { ok: false, code: "bad_tier" };
    }
  }
  if (action === "allow_international" && !international) return { ok: false, code: "international_off" };
  if (action === "allow_international" && (!Array.isArray(countryCodes) || !countryCodes.length)) {
    return { ok: false, code: "bad_countries" };
  }
  return { ok: true };
}

// ---- detail sections (order per spec) ----

function detailSections({ wholesale = false, international = false } = {}) {
  const sections = ["description", "variations"];
  if (wholesale) sections.push("wholesale");
  if (international) sections.push("international");
  sections.push("taxonomy");
  return sections;
}

module.exports = {
  LIST_FILTERS,
  BULK_ACTIONS,
  escapeRegex,
  buildListQuery,
  listColumns,
  tierLines,
  priceDisplay,
  validateBulkAction,
  detailSections,
};
