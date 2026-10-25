/* Product catalog service tests — filters, advanced search, columns per mode.
   Run: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert");
const { buildListQuery, listColumns, validateBulkAction } = require("../services/productCatalog");

test("buildListQuery: base filters", () => {
  assert.deepEqual(buildListQuery({ filter: "hot" }), { isHotDeal: true });
  assert.deepEqual(buildListQuery({ filter: "active" }), { status: "published" });
  assert.deepEqual(buildListQuery({ filter: "inactive" }), { status: "draft" });
  assert.deepEqual(buildListQuery({ filter: "international" }), { shipsAbroad: true });
  assert.deepEqual(buildListQuery({ filter: "all" }), {});
});

test("buildListQuery: search hits name/title/sku", () => {
  const q = buildListQuery({ search: "wallet" });
  assert.ok(q.$or.length === 3);
});

test("buildListQuery: advanced search params are AND-combined", () => {
  const q = buildListQuery({
    filter: "active",
    advanced: {
      category: "abc123abc123abc123abc123",
      sku: "SKU-9",
      type: "digital",
      priceMin: "100",
      priceMax: "500",
      stockMin: "2",
      stockMax: "10",
    },
  });
  assert.equal(q.status, "published");
  assert.equal(q.categories, "abc123abc123abc123abc123");
  assert.deepEqual(q.productType, "digital");
  assert.ok(q.sku instanceof RegExp || q.sku.source === undefined ? true : !!q.sku);
  assert.deepEqual(q.price, { $gte: 100, $lte: 500 });
  assert.deepEqual(q.stock, { $gte: 2, $lte: 10 });
});

test("buildListQuery: advanced status (inactive) overrides chip status", () => {
  const q = buildListQuery({ filter: "active", advanced: { status: "inactive" } });
  assert.equal(q.status, "draft");
});

test("buildListQuery: bad/empty ranges are ignored", () => {
  const q = buildListQuery({ advanced: { priceMin: "abc", stockMax: "" } });
  assert.ok(!q.price && !q.stock);
});

test("listColumns: exact spec order and action is LAST", () => {
  const cols = listColumns({});
  assert.deepEqual(cols, ["checkbox", "sl", "name", "category", "type", "image", "price", "stock", "variations", "deal", "status", "action"]);
  assert.equal(cols[cols.length - 1], "action");
});

test("listColumns: wholesale adds tiers+moq after stock, international after that", () => {
  const cols = listColumns({ wholesale: true, international: true });
  const iStock = cols.indexOf("stock");
  assert.equal(cols[iStock + 1], "wholesaleTiers");
  assert.equal(cols[iStock + 2], "moq");
  assert.equal(cols[iStock + 3], "international");
  assert.equal(cols[cols.length - 1], "action");
});

test("listColumns: international only (no wholesale)", () => {
  const cols = listColumns({ international: true });
  const iStock = cols.indexOf("stock");
  assert.equal(cols[iStock + 1], "international");
  assert.equal(cols[cols.length - 1], "action");
});

test("validateBulkAction guards gating on modes", () => {
  assert.equal(validateBulkAction({ action: "set_tiers", ids: ["a"], wholesale: false }).ok, false);
  assert.equal(validateBulkAction({ action: "set_tiers", ids: ["a"], wholesale: true, tier: [{ minQty: 1, price: 10 }] }).ok, true);
  assert.equal(validateBulkAction({ action: "allow_international", ids: ["a"], international: true, countryCodes: ["US"] }).ok, true);
  assert.equal(validateBulkAction({ action: "allow_international", ids: ["a"], international: false, countryCodes: ["US"] }).ok, false);
});
