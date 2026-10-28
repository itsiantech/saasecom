process.env.JWT_SECRET = "products-orders-scope-secret";

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
const Category = require("../models/Category");
const Brand = require("../models/Brand");
const Staff = require("../models/Staff");

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

function buildApp({ withTenant = true } = {}) {
  const app = express();
  app.use(express.json());
  app.use(async (req, res, next) => {
    try {
      // noTenantApp emulates the router mounted without middleware/tenant
      if (!withTenant) return next();
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
  app.use("/api/products", require("../routes/products"));
  app.use("/api/orders", require("../routes/orders"));
  app.use("/api/categories", require("../routes/categories"));
  app.use("/api/brands", require("../routes/brands"));
  app.use("/api/staff", require("../routes/staff"));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message || "Server error" }));
  return app;
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("products_orders_scope"));
  await Promise.all([
    Plan.init(), Store.init(), User.init(), Product.init(), Order.init(),
    Category.init(), Brand.init(), Staff.init(),
  ]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const ownerA = await User.create({ name: "Owner A", email: "a@example.com", role: "admin" });
  const ownerB = await User.create({ name: "Owner B", email: "b@example.com", role: "admin" });

  state.storeA = await Store.create({ name: "Shop A", slug: "shop-a", owner: ownerA._id, plan: plan._id });
  state.storeB = await Store.create({ name: "Shop B", slug: "shop-b", owner: ownerB._id, plan: plan._id });

  for (let i = 1; i <= 5; i++) {
    await Product.create({
      store: state.storeA._id, name: `A item ${i}`, slug: `a-item-${i}`,
      regularPrice: 100, price: 100, stock: 1, status: i === 5 ? "draft" : "published",
    });
  }
  state.bProduct = await Product.create({
    store: state.storeB._id, name: "B item", slug: "b-item", regularPrice: 50, price: 50, stock: 1, status: "published",
  });

  state.aProduct = await Product.findOne({ slug: "a-item-1" });
  state.orderA = await Order.create({
    store: state.storeA._id, orderNumber: "ORD-A-1", customerName: "Rahim", customerPhone: "01700000000",
    items: [{ product: state.aProduct._id, quantity: 1, price: 100 }], totalAmount: 100, status: "processing",
  });
  state.orderB = await Order.create({
    store: state.storeB._id, orderNumber: "ORD-B-1", customerName: "Karim", customerPhone: "01800000000",
    items: [{ product: state.bProduct._id, quantity: 1, price: 50 }], totalAmount: 50, status: "processing",
  });

  state.aToken = tokenFor(ownerA);
  state.bToken = tokenFor(ownerB);

  state.app = buildApp();
  state.noTenantApp = buildApp({ withTenant: false });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("anonymous callers cannot read or write products", async () => {
  const list = await request(state.app).get("/api/products").set("x-store-slug", "shop-a");
  assert.equal(list.status, 401);

  const one = await request(state.app).get(`/api/products/${state.bProduct._id}`).set("x-store-slug", "shop-a");
  assert.equal(one.status, 401);

  const create = await request(state.app)
    .post("/api/products").set("x-store-slug", "shop-a").send({ name: "Hack", price: 1 });
  assert.equal(create.status, 401);
  assert.equal(await Product.countDocuments({ name: "Hack" }), 0);
});

test("a product list only carries the requested store and is paginated", async () => {
  const res = await as("a", "get", "/api/products");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.total, 5);
  assert.equal(res.body.products.length, 5);
  assert.ok(res.body.products.every((p) => String(p.store) === String(state.storeA._id)));
  assert.ok(!res.body.products.some((p) => p.name === "B item"));

  const page2 = await as("a", "get", "/api/products?page=2&limit=2");
  assert.equal(page2.status, 200, JSON.stringify(page2.body));
  assert.equal(page2.body.products.length, 2);
  assert.equal(page2.body.page, 2);
  assert.equal(page2.body.pages, 3);

  const drafts = await as("a", "get", "/api/products?status=draft");
  assert.equal(drafts.body.total, 1);
  assert.equal(drafts.body.products[0].name, "A item 5");
});

test("an owner manages their own store's products only", async () => {
  const other = await as("a", "get", "/api/products", { slug: "shop-b" });
  assert.equal(other.status, 403);

  const readB = await as("a", "get", `/api/products/${state.bProduct._id}`);
  assert.equal(readB.status, 404);

  const writeB = await as("a", "put", `/api/products/${state.bProduct._id}`, { body: { price: 1 } });
  assert.equal(writeB.status, 404);
  assert.equal((await Product.findById(state.bProduct._id)).price, 50);

  const createElsewhere = await as("a", "post", "/api/products", { body: { name: "A only", price: 10 } });
  assert.equal(createElsewhere.status, 201);
  assert.equal(String(createElsewhere.body.store), String(state.storeA._id));
});

test("anonymous callers cannot read or write orders", async () => {
  const list = await request(state.app).get("/api/orders").set("x-store-slug", "shop-a");
  assert.equal(list.status, 401);

  const one = await request(state.app).get(`/api/orders/${state.orderB._id}`).set("x-store-slug", "shop-a");
  assert.equal(one.status, 401);

  const create = await request(state.app)
    .post("/api/orders").set("x-store-slug", "shop-a")
    .send({ customerName: "Ghost", customerPhone: "01900000000", items: [], totalAmount: 0 });
  assert.equal(create.status, 401);
});

test("one store's admin never sees another store's order", async () => {
  const own = await as("a", "get", `/api/orders/${state.orderA._id}`);
  assert.equal(own.status, 200, JSON.stringify(own.body));

  const cross = await as("a", "get", `/api/orders/${state.orderB._id}`);
  assert.equal(cross.status, 404);

  const crossList = await as("a", "get", "/api/orders");
  assert.equal(crossList.status, 200, JSON.stringify(crossList.body));
  assert.equal(crossList.body.total, 1);
  assert.equal(crossList.body.orders[0].customerName, "Rahim");

  const crossDelete = await as("a", "delete", `/api/orders/${state.orderB._id}`);
  assert.equal(crossDelete.status, 404);
  assert.ok(await Order.findById(state.orderB._id));
});

test("the same panel APIs (categories, brands, staff) are admin-only too", async () => {
  for (const path of ["/api/categories", "/api/brands", "/api/staff"]) {
    const anon = await request(state.app).get(path).set("x-store-slug", "shop-a");
    assert.equal(anon.status, 401, path);

    const wrongOwner = await as("a", "get", path, { slug: "shop-b" });
    assert.equal(wrongOwner.status, 403, path);
  }

  const own = await as("a", "get", "/api/categories");
  assert.equal(own.status, 200, JSON.stringify(own.body));
  const created = await as("a", "post", "/api/categories", { body: { name: "A cat" } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(String(created.body.store), String(state.storeA._id));
});

test("without a tenant context the APIs refuse instead of dumping every store", async () => {
  const products = await request(state.noTenantApp).get("/api/products").set("x-store-slug", "shop-a");
  assert.equal(products.status, 400);

  const orders = await request(state.noTenantApp).get("/api/orders").set("x-store-slug", "shop-a");
  assert.equal(orders.status, 400);
});
