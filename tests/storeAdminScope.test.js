process.env.JWT_SECRET = "store-admin-scope-secret";

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
const Order = require("../models/Order");
const SiteSetting = require("../models/SiteSetting");
const Settings = require("../models/Settings");

const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function as(who, method, url, { slug, body } = {}) {
  const req = request(state.app)[method](url)
    .set("x-store-slug", slug || (who === "b" ? "shop-b" : "shop-a"))
    .set("Authorization", `Bearer ${state[who + "Token"]}`);
  return body === undefined ? req : req.send(body);
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("store_admin_scope"));
  await Promise.all([
    Plan.init(), Store.init(), User.init(), Product.init(), Order.init(), SiteSetting.init(), Settings.init(),
  ]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const ownerA = await User.create({ name: "Owner A", email: "a@example.com", role: "admin" });
  const ownerB = await User.create({ name: "Owner B", email: "b@example.com", role: "admin" });
  const shopper = await User.create({ name: "Shopper", email: "shopper@example.com", role: "customer" });

  state.storeA = await Store.create({ name: "Shop A", slug: "shop-a", owner: ownerA._id, plan: plan._id });
  state.storeB = await Store.create({ name: "Shop B", slug: "shop-b", owner: ownerB._id, plan: plan._id });

  await SiteSetting.create({ store: state.storeA._id, logo: "/uploads/a-logo.png" });
  await SiteSetting.create({ store: state.storeB._id, logo: "/uploads/b-logo.png" });

  const product = await Product.create({
    store: state.storeA._id, name: "A item", slug: "a-item", regularPrice: 100, price: 100, stock: 1, status: "published",
  });
  state.orderA = await Order.create({
    store: state.storeA._id,
    orderNumber: "ORD-A-1",
    customerName: "Rahim",
    customerPhone: "01700000000",
    items: [{ product: product._id, quantity: 1, price: 100 }],
    totalAmount: 100,
    status: "processing",
  });

  state.aToken = tokenFor(ownerA);
  state.bToken = tokenFor(ownerB);
  state.cToken = tokenFor(shopper);

  state.app = express();
  state.app.use(express.json());
  state.app.use(async (req, res, next) => {
    try {
      const slug = String(req.headers["x-store-slug"] || "").trim().toLowerCase();
      const store = slug ? await Store.findOne({ slug }) : null;
      if (!store) return res.status(400).json({ message: "Store pawa jayni" });
      tenantStorage.run({ storeId: store._id }, () => {
        req.store = store;
        next();
      });
    } catch (err) {
      next(err);
    }
  });
  state.app.use("/api/settings", require("../routes/settings"));
  state.app.use("/api/product-form", require("../routes/productForm"));
  state.app.use("/api/orders", require("../routes/orders"));
  state.app.use("/api/admin", require("../routes/admin"));
  state.app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("an owner reaches only their own store, strangers and shoppers are refused", async () => {
  const own = await as("a", "get", "/api/settings");
  assert.equal(own.status, 200, JSON.stringify(own.body));

  const other = await as("a", "get", "/api/settings", { slug: "shop-b" });
  assert.equal(other.status, 403);

  const write = await as("a", "put", "/api/settings", { slug: "shop-b", body: { settings: { cod_enabled: false } } });
  assert.equal(write.status, 403);

  const shopper = await as("c", "get", "/api/settings");
  assert.equal(shopper.status, 403);

  const anonymous = await request(state.app).get("/api/settings").set("x-store-slug", "shop-a");
  assert.equal(anonymous.status, 401);
});

test("a saved toggle belongs to one store and leaves the other on its default", async () => {
  const saved = await as("a", "put", "/api/settings", { body: { settings: { flash_sales_enabled: false } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.settings.flash_sales_enabled, "false");

  const rows = await Settings.find({ key: /flash_sales_enabled$/ }).lean();
  const own = rows.find((row) => row.key === `store:${state.storeA._id}:flash_sales_enabled`);
  assert.equal(own && own.value, "false");
  assert.equal(rows.find((row) => row.key === `store:${state.storeB._id}:flash_sales_enabled`), undefined);
  assert.equal(rows.find((row) => row.key === "flash_sales_enabled"), undefined);

  const other = await as("b", "get", "/api/settings");
  assert.equal(other.status, 200, JSON.stringify(other.body));
  assert.equal(other.body.settings.flash_sales_enabled, "true");
});

test("product form toggles are per store too", async () => {
  const off = await as("a", "put", "/api/product-form/settings", { body: { productAttributesEnabled: false } });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.productAttributesEnabled, false);

  const other = await as("b", "get", "/api/product-form/settings");
  assert.equal(other.status, 200, JSON.stringify(other.body));
  assert.equal(other.body.productAttributesEnabled, true);
});

test("an invoice prints the logo of the store that owns the order", async () => {
  const res = await as("a", "get", `/api/orders/${state.orderA._id}/invoice`);
  assert.equal(res.status, 200);
  assert.match(res.text, /a-logo\.png/);
  assert.doesNotMatch(res.text, /b-logo\.png/);
});

test("store owners — even role admin — never reach the super admin APIs", async () => {
  const stats = await as("a", "get", "/api/admin/stats");
  assert.equal(stats.status, 403);

  const readSaas = await as("a", "get", "/api/admin/settings/saas");
  assert.equal(readSaas.status, 403);

  const flipSaas = await as("a", "put", "/api/admin/settings/saas", { body: { enabled: false } });
  assert.equal(flipSaas.status, 403);

  const listStores = await as("a", "get", "/api/admin/stores");
  assert.equal(listStores.status, 403);

  const anonymous = await request(state.app).get("/api/admin/settings/saas").set("x-store-slug", "shop-a");
  assert.equal(anonymous.status, 401);

  const superUser = await User.create({ name: "Super", email: "super@example.com", role: "superadmin" });
  const superToken = tokenFor(superUser);
  const allowed = await request(state.app)
    .get("/api/admin/settings/saas")
    .set("x-store-slug", "shop-a")
    .set("Authorization", "Bearer " + superToken);
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
  assert.equal(typeof allowed.body.saasEnabled, "boolean");
});
