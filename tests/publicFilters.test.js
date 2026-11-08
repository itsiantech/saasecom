process.env.JWT_SECRET = "public-filters-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { tenantStorage } = require("../lib/tenantContext");
const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Category = require("../models/Category");
const Brand = require("../models/Brand");
const Product = require("../models/Product");
const ProductCategory = require("../models/ProductCategory");
const Attribute = require("../models/Attribute");
const AttributeTerm = require("../models/AttributeTerm");
const ProductVariation = require("../models/ProductVariation");

const state = {};

function get(path, slug = "shop-a") {
  return request(state.app).get(path).set("x-store-slug", slug);
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("public_filters"));
  await Promise.all([
    Plan.init(), Store.init(), User.init(), Category.init(), Brand.init(), Product.init(),
    ProductCategory.init(), Attribute.init(), AttributeTerm.init(), ProductVariation.init(),
  ]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const owner = await User.create({ name: "Owner", email: "owner@example.com", role: "admin" });
  state.storeA = await Store.create({ name: "Shop A", slug: "shop-a", owner: owner._id, plan: plan._id });
  state.storeB = await Store.create({ name: "Shop B", slug: "shop-b", owner: owner._id, plan: plan._id });

  // category tree: fragrances -> attar
  state.fragrances = await Category.create({ store: state.storeA._id, name: "Fragrances", slug: "fragrances", status: "published" });
  state.attar = await Category.create({
    store: state.storeA._id,
    name: "Attar",
    slug: "attar",
    parent: state.fragrances._id,
    ancestors: [state.fragrances._id],
    level: 1,
    status: "published",
  });
  state.foreignCat = await Category.create({ store: state.storeB._id, name: "Foreign", slug: "foreign", status: "published" });

  // brand tree: Acme -> Acme Attar
  state.acme = await Brand.create({ store: state.storeA._id, name: "Acme", slug: "acme", status: "published" });
  state.acmeAttar = await Brand.create({
    store: state.storeA._id,
    name: "Acme Attar",
    slug: "acme-attar",
    parent: state.acme._id,
    ancestors: [state.acme._id],
    level: 1,
    status: "published",
  });
  state.foreignBrand = await Brand.create({ store: state.storeB._id, name: "Foreign brand", slug: "foreign-brand", status: "published" });

  state.color = await Attribute.create({ store: state.storeA._id, name: "Color" });
  state.size = await Attribute.create({ store: state.storeA._id, name: "Size" });
  state.red = await AttributeTerm.create({ store: state.storeA._id, attribute: state.color._id, name: "Red" });
  state.blue = await AttributeTerm.create({ store: state.storeA._id, attribute: state.color._id, name: "Blue" });
  state.medium = await AttributeTerm.create({ store: state.storeA._id, attribute: state.size._id, name: "M" });
  state.large = await AttributeTerm.create({ store: state.storeA._id, attribute: state.size._id, name: "L" });
  state.onlyDraft = await AttributeTerm.create({ store: state.storeA._id, attribute: state.size._id, name: "XL" });
  state.foreignTerm = await AttributeTerm.create({ store: state.storeB._id, attribute: state.color._id, name: "Red" });

  // Products saved by the product form have EMPTY legacy categories and a join row.
  const products = await Product.insertMany([
    { store: state.storeA._id, title: "Rose attar", name: "Rose attar", slug: "rose-attar", regularPrice: 500, price: 500, stock: 5, status: "published", categories: [], brand: state.acmeAttar._id },
    { store: state.storeA._id, title: "Legacy musk", name: "Legacy musk", slug: "legacy-musk", regularPrice: 700, price: 700, stock: 5, status: "published", categories: [state.fragrances._id], brand: state.acme._id },
    { store: state.storeA._id, title: "Oud attar", name: "Oud attar", slug: "oud-attar", regularPrice: 900, price: 900, stock: 5, status: "published", categories: [state.attar._id], brand: state.acmeAttar._id },
    { store: state.storeA._id, title: "Draft attar", name: "Draft attar", slug: "draft-attar", regularPrice: 100, price: 100, stock: 1, status: "draft", categories: [state.fragrances._id] },
    { store: state.storeB._id, title: "Foreign scent", name: "Foreign scent", slug: "foreign-scent", regularPrice: 300, price: 300, stock: 3, status: "published", categories: [state.foreignCat._id], brand: state.foreignBrand._id },
  ]);
  const [rose, , oud, draft, foreign] = products;

  state.rose = rose;
  await ProductCategory.create({ store: state.storeA._id, product: rose._id, category: state.fragrances._id });
  await ProductCategory.create({ store: state.storeB._id, product: foreign._id, category: state.foreignCat._id });

  // variations are the attribute source of truth
  await ProductVariation.insertMany([
    { store: state.storeA._id, product: rose._id, attribute: state.color._id, term: state.red._id, attributeName: "Color", termName: "Red" },
    { store: state.storeA._id, product: rose._id, attribute: state.size._id, term: state.medium._id, attributeName: "Size", termName: "M" },
    { store: state.storeA._id, product: oud._id, attribute: state.color._id, term: state.blue._id, attributeName: "Color", termName: "Blue" },
    { store: state.storeA._id, product: oud._id, attribute: state.size._id, term: state.medium._id, attributeName: "Size", termName: "M" },
    { store: state.storeA._id, product: draft._id, attribute: state.size._id, term: state.onlyDraft._id, attributeName: "Size", termName: "XL" },
  ]);

  state.app = express();
  state.app.use(express.json());
  state.app.use((req, res, next) => {
    tenantStorage.run({ storeId: state.storeA._id }, next);
  });
  state.app.use("/api/public", require("../routes/publicApi"));
  state.app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

function slugs(body) {
  return (body.products || []).map((product) => product.slug).sort();
}

test("join-only products show on the storefront category page (root + child)", async () => {
  const root = await get("/api/public/products?category=fragrances");
  assert.equal(root.status, 200, JSON.stringify(root.body));
  // empty legacy array + ProductCategory row, plus the legacy-array products
  assert.deepEqual(slugs(root.body), ["legacy-musk", "oud-attar", "rose-attar"]);

  const child = await get("/api/public/products?category=attar");
  assert.equal(child.status, 200, JSON.stringify(child.body));
  assert.deepEqual(slugs(child.body), ["oud-attar"]);
});

test("parent brand filter includes sub-brand products and /brands exposes the tree", async () => {
  const byParent = await get("/api/public/products?brand=acme");
  assert.equal(byParent.status, 200, JSON.stringify(byParent.body));
  assert.deepEqual(slugs(byParent.body), ["legacy-musk", "oud-attar", "rose-attar"]);

  const tree = await get("/api/public/brands");
  assert.equal(tree.status, 200, JSON.stringify(tree.body));
  assert.equal(tree.body.brands.length, 2);
  const acme = tree.body.tree.find((row) => row.slug === "acme");
  assert.ok(acme, JSON.stringify(tree.body.tree));
  assert.deepEqual(acme.children.map((row) => row.slug), ["acme-attar"]);
});

test("attributes endpoint lists only published-product terms of this store", async () => {
  const res = await get("/api/public/attributes");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const byName = new Map(res.body.attributes.map((row) => [row.name, row]));
  assert.deepEqual([...byName.keys()].sort(), ["Color", "Size"]);
  assert.deepEqual(byName.get("Color").terms.map((term) => term.name).sort(), ["Blue", "Red"]);
  // XL is only on a draft product and L is unused, so neither becomes a facet
  assert.deepEqual(byName.get("Size").terms.map((term) => term.name).sort(), ["M"]);
});

test("attrs filter is OR inside an attribute and AND across attributes", async () => {
  const both = await get(`/api/public/products?attrs=${state.red._id}`);
  assert.equal(both.status, 200, JSON.stringify(both.body));
  assert.deepEqual(slugs(both.body), ["rose-attar"]);

  const anyColor = await get(`/api/public/products?attrs=${state.red._id},${state.blue._id}`);
  assert.equal(anyColor.status, 200, JSON.stringify(anyColor.body));
  assert.deepEqual(slugs(anyColor.body), ["oud-attar", "rose-attar"]);

  const colorAndSize = await get(`/api/public/products?attrs=${state.blue._id},${state.medium._id}`);
  assert.equal(colorAndSize.status, 200, JSON.stringify(colorAndSize.body));
  assert.deepEqual(slugs(colorAndSize.body), ["oud-attar"]);

  const noMatch = await get(`/api/public/products?attrs=${state.blue._id},${state.large._id}`);
  assert.equal(noMatch.status, 200, JSON.stringify(noMatch.body));
  assert.deepEqual(slugs(noMatch.body), []);
});

test("foreign store facets never match and never leak", async () => {
  const foreignTerm = await get(`/api/public/products?attrs=${state.foreignTerm._id}`);
  assert.equal(foreignTerm.status, 200, JSON.stringify(foreignTerm.body));
  assert.deepEqual(slugs(foreignTerm.body), []);

  const foreignBrand = await get("/api/public/products?brand=foreign-brand");
  assert.equal(foreignBrand.status, 200, JSON.stringify(foreignBrand.body));
  assert.deepEqual(slugs(foreignBrand.body), []);

  const foreignCat = await get("/api/public/products?category=foreign");
  assert.equal(foreignCat.status, 200, JSON.stringify(foreignCat.body));
  assert.deepEqual(slugs(foreignCat.body), []);

  const theirs = await get("/api/public/products?category=fragrances", "shop-b");
  assert.equal(theirs.status, 200, JSON.stringify(theirs.body));
  assert.deepEqual(slugs(theirs.body), []);
});

test("product detail returns categories from the join table for legacy-empty products", async () => {
  const res = await get("/api/public/products/rose-attar");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.product.categories.map((row) => row.slug), ["fragrances"]);
  assert.equal(res.body.product.brand.slug, "acme-attar");
});
