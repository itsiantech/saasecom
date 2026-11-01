process.env.JWT_SECRET = "home-sections-test-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { tenantStorage } = require("../lib/tenantContext");
const { parseSections, normalizeSections } = require("../lib/homeSections");
const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Category = require("../models/Category");
const Product = require("../models/Product");
const Settings = require("../models/Settings");

const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("home_sections"));
  await Promise.all([Plan.init(), Store.init(), User.init(), Category.init(), Product.init(), Settings.init()]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const owner = await User.create({ name: "Owner", email: "owner@example.com", role: "customer" });

  state.storeA = await Store.create({ name: "Shop A", slug: "shop-a", owner: owner._id, plan: plan._id });
  state.storeB = await Store.create({ name: "Shop B", slug: "shop-b", owner: owner._id, plan: plan._id });
  state.owner = owner;
  state.token = tokenFor(owner);

  state.saree = await Category.create({ store: state.storeA._id, name: "শাড়ি", slug: "saree", status: "published" });
  state.jamdani = await Category.create({
    store: state.storeA._id,
    name: "জামদানি",
    slug: "jamdani",
    parent: state.saree._id,
    ancestors: [state.saree._id],
    level: 1,
    status: "published",
  });
  state.emptyCat = await Category.create({ store: state.storeA._id, name: "খালি", slug: "empty", status: "published" });
  state.foreignCat = await Category.create({ store: state.storeB._id, name: "B cat", slug: "b-cat", status: "published" });

  await Product.insertMany([
    { store: state.storeA._id, title: "Saree one", name: "Saree one", slug: "saree-one", regularPrice: 1000, price: 1000, stock: 4, status: "published", categories: [state.saree._id], soldCount: 5 },
    { store: state.storeA._id, title: "Saree two", name: "Saree two", slug: "saree-two", regularPrice: 1200, price: 1200, stock: 4, status: "published", categories: [state.saree._id], soldCount: 9 },
    { store: state.storeA._id, title: "Jamdani one", name: "Jamdani one", slug: "jamdani-one", regularPrice: 2000, price: 2000, stock: 4, status: "published", categories: [state.jamdani._id], soldCount: 3 },
    { store: state.storeA._id, title: "Saree draft", name: "Saree draft", slug: "saree-draft", regularPrice: 900, price: 900, stock: 1, status: "draft", categories: [state.saree._id] },
    { store: state.storeB._id, title: "B product", name: "B product", slug: "b-product", regularPrice: 300, price: 300, stock: 2, status: "published", categories: [state.foreignCat._id] },
  ]);

  state.app = express();
  state.app.use(express.json());
  state.app.use(async (req, res, next) => {
    try {
      const slug = String(req.headers["x-store-slug"] || req.query.store || "shop-a").trim().toLowerCase();
      const store = await Store.findOne({ slug });
      if (!store) return res.status(404).json({ message: "no store" });
      tenantStorage.run({ storeId: store._id }, () => {
        req.store = store;
        next();
      });
    } catch (err) {
      next(err);
    }
  });
  state.app.use("/api/settings", require("../routes/settings"));
  state.app.use("/api/public", require("../routes/publicApi"));
  state.app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

function saveHome(body) {
  return request(state.app)
    .put("/api/settings")
    .set("x-store-slug", "shop-a")
    .set("Authorization", `Bearer ${state.token}`)
    .send(body);
}

function home(slug = "shop-a") {
  return request(state.app).get("/api/public/home").set("x-store-slug", slug);
}

test("parseSections tolerates empty and malformed values", () => {
  assert.deepEqual(parseSections(""), []);
  assert.deepEqual(parseSections("not json"), []);
  assert.deepEqual(parseSections('{"a":1}'), []);
  assert.equal(parseSections('[{"category":"x"}]').length, 1);
});

test("normalizeSections clamps values, drops duplicates and foreign categories", () => {
  const rows = normalizeSections(
    [
      { id: "s1", category: "a", mode: "slider", columns: 5, limit: 60 },
      { id: "s2", category: "a", mode: "grid", columns: 4, limit: 8 },
      { id: "s3", category: "b", mode: "wat", columns: 9, limit: 1 },
      { id: "s4", category: "c", mode: "drag", columns: 6, limit: 12, enabled: false },
    ],
    ["a", "b"]
  );
  assert.deepEqual(rows.map((row) => row.category), ["a", "b"]);
  assert.equal(rows[0].limit, 24);
  assert.equal(rows[0].columns, 5);
  assert.equal(rows[1].mode, "grid");
  assert.equal(rows[1].columns, 4);
  assert.equal(rows[1].limit, 4);
});

test("home settings save validates against this store's categories and keeps order", async () => {
  const res = await saveHome({
    settings: {
      home_category_sections: [
        { id: "s1", category: String(state.jamdani._id), mode: "slider", columns: 5, limit: 8 },
        { id: "s2", category: String(state.saree._id), mode: "grid", columns: 9, limit: 50 },
        { id: "s3", category: String(state.foreignCat._id), mode: "grid", columns: 4, limit: 12 },
        { id: "s4", category: String(state.saree._id), mode: "drag", columns: 6, limit: 12 },
      ],
      home_hot_deals_enabled: "false",
      home_new_products_enabled: "true",
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.homeSections.length, 2);
  assert.equal(res.body.homeSections[0].category, String(state.jamdani._id));
  assert.equal(res.body.homeSections[0].mode, "slider");
  assert.equal(res.body.homeSections[1].category, String(state.saree._id));
  assert.equal(res.body.homeSections[1].columns, 4);
  assert.equal(res.body.homeSections[1].limit, 24);
  assert.equal(res.body.settings.home_hot_deals_enabled, "false");

  const read = await request(state.app)
    .get("/api/settings")
    .set("x-store-slug", "shop-a")
    .set("Authorization", `Bearer ${state.token}`);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.homeSections.length, 2);
});

test("public home returns ordered sections with subtree products, hides empty ones", async () => {
  await saveHome({
    settings: {
      home_category_sections: [
        { id: "s1", category: String(state.saree._id), mode: "slider", columns: 5, limit: 6 },
        { id: "s2", category: String(state.emptyCat._id), mode: "grid", columns: 4, limit: 12 },
      ],
      home_hot_deals_enabled: "false",
      home_new_products_enabled: "true",
    },
  });

  const res = await home();
  assert.equal(res.status, 200, JSON.stringify(res.body));

  // the empty category is not sent at all
  assert.equal(res.body.sections.length, 1);
  const [section] = res.body.sections;
  assert.equal(section.category.slug, "saree");
  assert.equal(section.mode, "slider");
  assert.equal(section.columns, 5);
  // parent + child products, draft excluded, best sellers first
  assert.deepEqual(section.products.map((product) => product.slug), ["saree-two", "saree-one", "jamdani-one"]);
  assert.equal(section.products[0].ratingAverage, 0);
  assert.equal(res.body.flags.hotDeals, false);
  assert.equal(res.body.flags.newProducts, true);
});

test("one store's home layout never leaks into another store", async () => {
  const other = await home("shop-b");
  assert.equal(other.status, 200, JSON.stringify(other.body));
  assert.deepEqual(other.body.sections, []);
  assert.equal(other.body.flags.hotDeals, true);
  assert.equal(other.body.flags.newProducts, true);

  await request(state.app)
    .put("/api/settings")
    .set("x-store-slug", "shop-b")
    .set("Authorization", `Bearer ${state.token}`)
    .send({
      settings: {
        home_category_sections: [{ id: "b1", category: String(state.foreignCat._id), mode: "grid", columns: 4, limit: 12 }],
      },
    });

  const mine = await home();
  assert.deepEqual(mine.body.sections.map((section) => section.category.slug), ["saree"]);
  const theirs = await home("shop-b");
  assert.deepEqual(theirs.body.sections.map((section) => section.category.slug), ["b-cat"]);
});
