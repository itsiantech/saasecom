"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildListQuery,
  listColumns,
  tierLines,
  priceDisplay,
  validateBulkAction,
  detailSections,
} = require("../services/productCatalog");

/* ---- buildListQuery ---- */

test("filter 'all' kono extra condition dey na", () => {
  const q = buildListQuery({ filter: "all" });
  assert.deepEqual(q, {});
});

test("filter 'hot' isHotDeal true kore", () => {
  const q = buildListQuery({ filter: "hot" });
  assert.deepEqual(q, { isHotDeal: true });
});

test("filter 'active' -> published, 'inactive' -> draft", () => {
  assert.deepEqual(buildListQuery({ filter: "active" }), { status: "published" });
  assert.deepEqual(buildListQuery({ filter: "inactive" }), { status: "draft" });
});

test("filter 'tiers' tierProductIds er $in use kore", () => {
  const ids = ["aaa", "bbb"];
  const q = buildListQuery({ filter: "tiers", tierProductIds: ids });
  assert.deepEqual(q, { _id: { $in: ids } });
});

test("filter 'international' shipsAbroad true kore", () => {
  assert.deepEqual(buildListQuery({ filter: "international" }), { shipsAbroad: true });
});

test("unknown filter safe fallback: all", () => {
  const q = buildListQuery({ filter: "random" });
  assert.deepEqual(q, {});
});

test("search name+SKU te $or regex dey, regex escaped", () => {
  const q = buildListQuery({ filter: "all", search: "a.b(x)" });
  assert.ok(q.$or);
  assert.equal(q.$or.length, 3);
  assert.equal(q.$or[0].name.source, "a\\.b\\(x\\)");
  assert.equal(q.$or[0].name.ignoreCase, true);
});

test("search + filter eksathe kaj kore", () => {
  const q = buildListQuery({ filter: "hot", search: "bag" });
  assert.equal(q.isHotDeal, true);
  assert.ok(q.$or);
});

/* ---- listColumns ---- */

test("columns: duita mode off hole base column set", () => {
  const c = listColumns({ wholesale: false, international: false });
  assert.deepEqual(c, ["checkbox", "sl", "name", "category", "type", "image", "price", "stock", "variations", "deal", "status", "action"]);
});

test("columns: wholesale hole tiers+moq stock er pore", () => {
  const c = listColumns({ wholesale: true, international: false });
  assert.ok(c.includes("wholesaleTiers"));
  assert.ok(c.includes("moq"));
  assert.ok(c.indexOf("wholesaleTiers") > c.indexOf("stock"));
  assert.ok(c.indexOf("moq") > c.indexOf("wholesaleTiers"));
  assert.ok(!c.includes("international"));
});

test("columns: international hole international column thake, wholesale off hole stock er pore", () => {
  const c = listColumns({ wholesale: false, international: true });
  assert.ok(c.includes("international"));
  assert.ok(c.indexOf("international") > c.indexOf("stock"));
  assert.ok(!c.includes("wholesaleTiers"));
  assert.ok(!c.includes("moq"));
});

test("columns: duita mode on hole sobgulu column thake", () => {
  const c = listColumns({ wholesale: true, international: true });
  for (const k of ["checkbox", "sl", "image", "name", "category", "type", "price", "stock", "wholesaleTiers", "moq", "international", "variations", "deal", "status", "action"]) {
    assert.ok(c.includes(k), "missing " + k);
  }
  // order: stock < wholesaleTiers < moq < international
  assert.ok(c.indexOf("stock") < c.indexOf("wholesaleTiers"));
  assert.ok(c.indexOf("wholesaleTiers") < c.indexOf("moq"));
  assert.ok(c.indexOf("moq") < c.indexOf("international"));
});

/* ---- tierLines ---- */

test("tierLines range format thik kore (open-ended '+')", () => {
  const lines = tierLines([
    { minQty: 11, maxQty: 50, pricePaisa: 45000 },
    { minQty: 1, maxQty: 10, pricePaisa: 52000 },
    { minQty: 51, maxQty: null, pricePaisa: 40000 },
  ]);
  assert.deepEqual(lines, ["1-10: 520", "11-50: 450", "51+: 400"]);
});

test("tierLines empty/null -> []", () => {
  assert.deepEqual(tierLines([]), []);
  assert.deepEqual(tierLines(null), []);
});

/* ---- priceDisplay ---- */

test("priceDisplay: sale < regular hole hasSale", () => {
  assert.deepEqual(priceDisplay({ regularPrice: 1000, salePrice: 800 }), { sale: 800, regular: 1000, hasSale: true });
});

test("priceDisplay: sale >= regular hole sale ignore", () => {
  assert.deepEqual(priceDisplay({ regularPrice: 500, salePrice: 600 }), { sale: 0, regular: 500, hasSale: false });
  assert.deepEqual(priceDisplay({ regularPrice: 500, salePrice: 500 }), { sale: 0, regular: 500, hasSale: false });
});

test("priceDisplay: sale 0 hole plain regular", () => {
  assert.deepEqual(priceDisplay({ regularPrice: 500, salePrice: 0 }), { sale: 0, regular: 500, hasSale: false });
});

/* ---- validateBulkAction ---- */

const IDS = ["507f1f77bcf86cd799439011"];

test("bulk: unknown action reject", () => {
  assert.equal(validateBulkAction({ action: "hack", ids: IDS }).ok, false);
});

test("bulk: empty ids reject", () => {
  assert.equal(validateBulkAction({ action: "activate", ids: [] }).ok, false);
  assert.equal(validateBulkAction({ action: "activate" }).ok, false);
});

test("bulk: activate/deactivate sob mode e cholbe", () => {
  for (const action of ["activate", "deactivate", "delete"]) {
    assert.equal(validateBulkAction({ action, ids: IDS, wholesale: false, international: false }).ok, true);
  }
});

test("bulk: set_tiers wholesale off hole reject", () => {
  const r = validateBulkAction({ action: "set_tiers", ids: IDS, wholesale: false, tier: [{ minQty: 1, price: 10 }] });
  assert.equal(r.ok, false);
  assert.equal(r.code, "wholesale_off");
});

test("bulk: set_tiers wholesale on hole tier lage, validation thik", () => {
  assert.equal(validateBulkAction({ action: "set_tiers", ids: IDS, wholesale: true, tier: null }).code, "bad_tier");
  assert.equal(validateBulkAction({ action: "set_tiers", ids: IDS, wholesale: true, tier: [{ minQty: 0, price: 10 }] }).code, "bad_tier");
  assert.equal(validateBulkAction({ action: "set_tiers", ids: IDS, wholesale: true, tier: [{ minQty: 5, price: -1 }] }).code, "bad_tier");
  assert.equal(validateBulkAction({ action: "set_tiers", ids: IDS, wholesale: true, tier: [{ minQty: 5, maxQty: 2, price: 10 }] }).code, "bad_tier");
  assert.equal(validateBulkAction({ action: "set_tiers", ids: IDS, wholesale: true, tier: [{ minQty: 1, maxQty: 10, price: 520 }] }).ok, true);
  assert.equal(validateBulkAction({ action: "set_tiers", ids: IDS, wholesale: true, tier: [{ minQty: 1, price: 520 }] }).ok, true);
});

test("bulk: allow_international international off hole reject", () => {
  const r = validateBulkAction({ action: "allow_international", ids: IDS, international: false, countryCodes: ["US"] });
  assert.equal(r.ok, false);
  assert.equal(r.code, "international_off");
});

test("bulk: allow_international countryCodes lage", () => {
  assert.equal(validateBulkAction({ action: "allow_international", ids: IDS, international: true, countryCodes: [] }).code, "bad_countries");
  assert.equal(validateBulkAction({ action: "allow_international", ids: IDS, international: true, countryCodes: ["US", "GB"] }).ok, true);
});

/* ---- detailSections ---- */

test("detailSections: mode on/off onujayi section thik kore", () => {
  assert.deepEqual(detailSections({ wholesale: false, international: false }), ["description", "variations", "taxonomy"]);
  assert.deepEqual(detailSections({ wholesale: true, international: false }), ["description", "variations", "wholesale", "taxonomy"]);
  assert.deepEqual(detailSections({ wholesale: false, international: true }), ["description", "variations", "international", "taxonomy"]);
  assert.deepEqual(detailSections({ wholesale: true, international: true }), ["description", "variations", "wholesale", "international", "taxonomy"]);
});
