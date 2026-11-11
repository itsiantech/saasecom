process.env.JWT_SECRET = "store-menu-test-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { tenantStorage } = require("../lib/tenantContext");
const { normalizeMenu, decorateMenu, buildMenu, MAX_ITEMS } = require("../lib/storeMenu");
const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Category = require("../models/Category");
const Settings = require("../models/Settings");
const SiteSetting = require("../models/SiteSetting");

const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function as(method, url, body) {
  const req = request(state.app)[method](url)
    .set("x-store-slug", "shop-a")
    .set("Authorization", `Bearer ${state.token}`);
  return body === undefined ? req : req.send(body);
}

const CATEGORY_ID = "64b000000000000000000001";
const OTHER_ID = "64b000000000000000000002";

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("store_menu"));
  await Promise.all([
    Plan.init(), Store.init(), User.init(), Category.init(), Settings.init(), SiteSetting.init(),
  ]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const owner = await User.create({ name: "Owner", email: "menu-owner@example.com", role: "customer" });
  const storeA = await Store.create({ name: "Shop A", slug: "shop-a", owner: owner._id, plan: plan._id, language: "bn" });
  const storeB = await Store.create({ name: "Shop B", slug: "shop-b", owner: owner._id, plan: plan._id });

  state.category = await Category.create({ store: storeA._id, name: "Fashion", slug: "fashion", status: "published" });
  state.child = await Category.create({
    store: storeA._id, name: "Tshirt", slug: "tshirt", status: "draft", parent: state.category._id,
  });
  state.trashed = await Category.create({
    store: storeA._id, name: "Old", slug: "old", status: "trashed", deletedAt: new Date(),
  });
  state.foreign = await Category.create({ store: storeB._id, name: "Other store", slug: "other", status: "published" });

  state.store = storeA;
  state.token = tokenFor(owner);

  state.app = express();
  state.app.use(express.json());
  state.app.use(async (req, res, next) => {
    try {
      const slug = String(req.headers["x-store-slug"] || req.query.store || "").trim().toLowerCase();
      const store = slug ? await Store.findOne({ slug }) : null;
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

test("normalizer keeps only known pages and owned categories, max 3 levels, no duplicates", () => {
  const raw = [
    { id: "home", type: "page", ref: "home", children: [
      { id: "shop", type: "page", ref: "shop", children: [
        { id: "cat", type: "category", ref: CATEGORY_ID, children: [
          { id: "deep", type: "page", ref: "cart" },
        ] },
      ] },
    ] },
    { id: "home-again", type: "page", ref: "home" },
    { id: "unknown", type: "page", ref: "not-a-page" },
    { id: "foreign", type: "category", ref: OTHER_ID },
    { id: "bad-id", type: "category", ref: "not-an-object-id" },
    { id: "bad-type", type: "folder", ref: "home" },
  ];

  const menu = normalizeMenu(raw, { allowedCategoryIds: [CATEGORY_ID] });
  assert.equal(menu.length, 1);
  assert.equal(menu[0].ref, "home");
  assert.equal(menu[0].children[0].ref, "shop");
  assert.equal(menu[0].children[0].children[0].ref, CATEGORY_ID);
  assert.equal(menu[0].children[0].children[0].children.length, 0, "4th level must be dropped");

  const capped = normalizeMenu(
    Array.from({ length: MAX_ITEMS + 20 }, (_, i) => ({
      type: "category", ref: "64b00000000000000000" + String(1000 + i),
    })),
    { allowedCategoryIds: Array.from({ length: MAX_ITEMS + 20 }, (_, i) => "64b00000000000000000" + String(1000 + i)) }
  );
  assert.equal(capped.length, MAX_ITEMS);
});

test("decorated menu resolves page labels/paths and category links in both languages", () => {
  const menu = normalizeMenu([
    { type: "page", ref: "shop", children: [
      { type: "category", ref: CATEGORY_ID },
      { type: "category", ref: "64b000000000000000000099" },
    ] },
    { type: "category", ref: OTHER_ID },
  ]);
  const categories = [
    { _id: CATEGORY_ID, name: "Fashion", slug: "fashion" },
    { _id: OTHER_ID, name: "Gadgets", slug: "gadgets" },
  ];

  const english = decorateMenu(menu, { categories, language: "en" });
  assert.equal(english[0].label, "Shop");
  assert.equal(english[0].path, "/shop");
  assert.equal(english[0].children.length, 1, "missing category is dropped");
  assert.equal(english[0].children[0].label, "Fashion");
  assert.equal(english[0].children[0].path, "/shop?category=fashion");
  assert.equal(english[1].label, "Gadgets");

  const bengali = buildMenu(JSON.stringify(menu), { categories, language: "bn" });
  assert.equal(bengali[0].label, "শপ");
  assert.equal(bengali[0].children[0].label, "Fashion");
});

test("settings save normalizes the menu and public store returns the resolved tree", async () => {
  const tree = [
    { id: "m-home", type: "page", ref: "home", children: [
      { id: "m-shop", type: "page", ref: "shop", children: [
        { id: "m-cat", type: "category", ref: String(state.category._id) },
      ] },
    ] },
    { id: "m-child", type: "category", ref: String(state.child._id) },
    { id: "m-trash", type: "category", ref: String(state.trashed._id) },
    { id: "m-foreign", type: "category", ref: String(state.foreign._id) },
    { id: "m-unknown", type: "page", ref: "nope" },
  ];

  const saved = await as("put", "/api/settings", {
    settings: { storefront_menu: JSON.stringify(tree) },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const menu = saved.body.menu;
  assert.deepEqual(menu.map((row) => row.id), ["m-home", "m-child"]);
  assert.equal(menu[0].children[0].ref, "shop");
  assert.equal(menu[0].children[0].children[0].label, "Fashion");
  assert.equal(menu[1].label, "Tshirt", "draft category is kept in the menu");

  const admin = await as("get", "/api/settings");
  assert.equal(admin.status, 200, JSON.stringify(admin.body));
  assert.equal(admin.body.menu[0].children[0].children[0].path, "/shop?category=fashion");

  const pub = await request(state.app)
    .get("/api/public/store")
    .set("x-store-slug", "shop-a");
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.menu[0].label, "হোম");
  assert.equal(pub.body.menu[0].children[0].label, "শপ");
  assert.equal(pub.body.menu[0].children[0].children[0].label, "Fashion");

  const row = await Settings.findOne({ key: "store:" + state.store._id + ":storefront_menu" }).lean();
  assert.ok(row, "menu is stored under the store-scoped key");
  const stored = JSON.parse(row.value);
  assert.deepEqual(stored[0].children[0].children[0].children, []);
  assert.equal(stored.length, 2);
});