process.env.JWT_SECRET = "product-form-categories-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { tenantStorage } = require("../lib/tenantContext");
const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Product = require("../models/Product");
const Category = require("../models/Category");
const ProductCategory = require("../models/ProductCategory");

const state = {};

function as(method, url, body) {
  const req = request(state.app)[method](url)
    .set("x-store-slug", "shop-a")
    .set("Authorization", "Bearer " + state.token);
  return body === undefined ? req : req.send(body);
}

before(async () => {
  process.env.NODE_ENV = "test";
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("product_form_categories"));
  await Promise.all([Plan.init(), Store.init(), User.init(), Product.init(), Category.init(), ProductCategory.init()]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const owner = await User.create({ name: "Owner", email: "owner@example.com", role: "admin" });
  state.store = await Store.create({ name: "Shop A", slug: "shop-a", owner: owner._id, plan: plan._id });
  state.token = jwt.sign({ id: String(owner._id), role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1h" });

  state.uncat = await Category.create({
    store: state.store._id,
    name: "Uncategorized",
    slug: "uncategorized",
    status: "published",
  });

  state.app = express();
  state.app.use(express.json());
  state.app.use(async (req, res, next) => {
    const slug = String(req.headers["x-store-slug"] || "").trim().toLowerCase();
    const store = slug ? await Store.findOne({ slug }) : null;
    if (!store) return res.status(400).json({ message: "Store pawa jayni" });
    tenantStorage.run({ storeId: store._id }, () => {
      req.store = store;
      next();
    });
  });
  state.app.use("/api/product-form", require("../routes/productForm"));
  state.app.use("/api/categories", require("../routes/categories"));
  state.app.use((err, req, res) => res.status(err.status || 500).json({ message: err.message }));
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("a category created inline is the one saved on the product everywhere", async () => {
  const created = await as("post", "/api/categories", { name: "Jamdani", status: "published" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const categoryId = String(created.body._id);

  const saved = await as("post", "/api/product-form", {
    title: "Jamdani saree",
    regularPrice: 2500,
    status: "published",
    categories: [String(state.uncat._id), categoryId],
  });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const productId = saved.body.product._id;

  const product = await Product.findById(productId).lean();
  assert.deepEqual((product.categories || []).map(String), [categoryId]);

  const links = await ProductCategory.find({ product: productId }).select("category").lean();
  assert.deepEqual(links.map((row) => String(row.category)), [categoryId]);

  const list = await as("get", "/api/categories");
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const row = list.body.categories.find((c) => String(c._id) === categoryId);
  assert.equal(row.productCount, 1);
  const uncatRow = list.body.categories.find((c) => String(c._id) === String(state.uncat._id));
  assert.equal(uncatRow.productCount, 0);

  const detail = await as("get", "/api/categories/" + categoryId);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.deepEqual(detail.body.products.map((p) => String(p._id)), [String(productId)]);
});

test("editing moves the product to the newly picked category", async () => {
  const second = await as("post", "/api/categories", { name: "Silk", status: "published" });
  const secondId = String(second.body._id);

  const created = await as("post", "/api/product-form", {
    title: "Silk scarf",
    regularPrice: 900,
  });
  const productId = created.body.product._id;

  let product = await Product.findById(productId).lean();
  assert.deepEqual((product.categories || []).map(String), []);

  const updated = await as("put", "/api/product-form/" + productId, {
    title: "Silk scarf",
    regularPrice: 900,
    categories: [secondId],
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));

  product = await Product.findById(productId).lean();
  assert.deepEqual((product.categories || []).map(String), [secondId]);
  const links = await ProductCategory.find({ product: productId }).select("category").lean();
  assert.deepEqual(links.map((row) => String(row.category)), [secondId]);
});

test("a seeded product keeps its legacy category when loaded for editing", async () => {
  const cat = await Category.create({
    store: state.store._id,
    name: "Legacy",
    slug: "legacy",
    status: "published",
  });
  const product = await Product.create({
    store: state.store._id,
    title: "Seeded item",
    name: "Seeded item",
    regularPrice: 10,
    categories: [cat._id],
  });

  const loaded = await as("get", "/api/product-form/" + product._id);
  assert.equal(loaded.status, 200, JSON.stringify(loaded.body));
  assert.deepEqual(loaded.body.categories.map(String), [String(cat._id)]);
});

test("a product with no real category still falls back to Uncategorized only", async () => {
  const created = await as("post", "/api/product-form", {
    title: "Misplaced item",
    regularPrice: 10,
    categories: [String(state.uncat._id), String(state.uncat._id)],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const product = await Product.findById(created.body.product._id).lean();
  assert.deepEqual((product.categories || []).map(String), [String(state.uncat._id)]);
  const links = await ProductCategory.find({ product: created.body.product._id }).lean();
  assert.equal(links.length, 1);
});
