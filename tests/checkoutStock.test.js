process.env.JWT_SECRET = process.env.JWT_SECRET || "checkout-stock-secret";

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
const Cart = require("../models/Cart");
const Coupon = require("../models/Coupon");
const Settings = require("../models/Settings");
const ShippingArea = require("../models/ShippingArea");

const state = {};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(async (req, res, next) => {
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
  app.use("/api/cart", require("../routes/cart"));
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({ message: err.message || "Server error" })
  );
  return app;
}

async function seedCart(sessionId, quantity, couponCode = "") {
  return Cart.create({
    store: state.store._id,
    sessionId,
    couponCode,
    items: [{ product: state.product._id, unitPrice: 100, quantity }],
  });
}

function couponPayload(code, extra = {}) {
  return {
    store: state.store._id,
    code,
    discountType: "percent",
    discountValue: 10,
    startAt: new Date("2020-01-01"),
    endAt: new Date("2035-01-01"),
    ...extra,
  };
}

function checkout(sessionId, { headers = {}, body = {} } = {}) {
  const req = request(state.app)
    .post("/api/cart/checkout")
    .set("x-store-slug", "stock-shop")
    .set("x-session-id", sessionId);
  for (const [key, value] of Object.entries(headers)) req.set(key, value);
  return req.send({
    customer: { name: "Test Buyer", phone: "01700000000", address: "Dhaka" },
    payment: { method: "cod" },
    shipping: {},
    ...body,
  });
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("checkout_stock"));
  await Promise.all([
    Plan.init(), Store.init(), User.init(), Product.init(), Order.init(), Cart.init(), Coupon.init(),
  ]);

  const plan = await Plan.create({
    name: "Free",
    slug: "free",
    price: 0,
    limits: { products: 0, orders: 0 },
  });
  const owner = await User.create({ name: "Owner", email: "owner@example.com", role: "admin" });
  state.store = await Store.create({
    name: "Stock Shop",
    slug: "stock-shop",
    owner: owner._id,
    plan: plan._id,
  });
  state.product = await Product.create({
    store: state.store._id,
    name: "Retail item",
    slug: "retail-item",
    regularPrice: 100,
    price: 100,
    stock: 5,
    status: "published",
  });
  state.app = buildApp();
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("retail checkout decrements base product stock", async () => {
  await seedCart("retail-1", 2);
  const res = await checkout("retail-1");
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.order.totalAmount, 200);

  const product = await Product.findById(state.product._id);
  assert.equal(product.stock, 3);

  const cart = await Cart.findOne({ store: state.store._id, sessionId: "retail-1" });
  assert.equal(cart.items.length, 0);
});

test("a replayed Idempotency-Key returns the first order instead of charging stock twice", async () => {
  await seedCart("retail-2", 1);
  const headers = { "Idempotency-Key": "checkout-key-1" };

  const first = await checkout("retail-2", { headers });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  state.firstOrderId = first.body.order._id;
  assert.equal((await Product.findById(state.product._id)).stock, 2);

  // Cart is empty now — the replay still resolves the original order.
  const replay = await checkout("retail-2", { headers });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.duplicate, true);
  assert.equal(String(replay.body.order._id), String(first.body.order._id));
  assert.equal((await Product.findById(state.product._id)).stock, 2);
  assert.equal(await Order.countDocuments({ store: state.store._id }), 2);
});

test("the same raw Idempotency-Key from another cart does not leak the first order", async () => {
  await seedCart("retail-4", 1);
  const res = await checkout("retail-4", { headers: { "Idempotency-Key": "checkout-key-1" } });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.duplicate, undefined);
  assert.notEqual(String(res.body.order._id), String(state.firstOrderId));
  assert.equal(await Order.countDocuments({ store: state.store._id }), 3);
});

test("a refused checkout leaves stock untouched", async () => {
  const product = await Product.create({
    store: state.store._id,
    name: "Scarce item",
    slug: "scarce-item",
    regularPrice: 50,
    price: 50,
    stock: 1,
    status: "published",
  });
  await Cart.create({
    store: state.store._id,
    sessionId: "retail-3",
    items: [{ product: product._id, unitPrice: 50, quantity: 2 }],
  });

  const res = await checkout("retail-3");
  assert.equal(res.status, 400);
  assert.equal((await Product.findById(product._id)).stock, 1);
});

test("a coupon with a total usage limit can only be redeemed once", async () => {
  await Product.updateOne({ _id: state.product._id }, { $inc: { stock: 20 } });
  await Coupon.create(couponPayload("SAVE10", { usageLimit: 1 }));

  await seedCart("coupon-1", 1, "SAVE10");
  const first = await checkout("coupon-1");
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.order.couponCode, "SAVE10");
  assert.equal(first.body.order.totalAmount, 90);

  const coupon = await Coupon.findOne({ store: state.store._id, code: "SAVE10" }).lean();
  assert.equal(coupon.usedCount, 1);

  const stockAfterFirst = (await Product.findById(state.product._id)).stock;
  await seedCart("coupon-2", 1, "SAVE10");
  const second = await checkout("coupon-2");
  assert.equal(second.status, 400);
  assert.match(second.body.message, /usage limit/i);
  assert.equal((await Product.findById(state.product._id)).stock, stockAfterFirst);
});

test("per-customer coupon limits need a login and follow the buyer", async () => {
  await Coupon.create(couponPayload("ONCE", { perCustomerLimit: 1 }));

  await seedCart("coupon-guest", 1, "ONCE");
  const guest = await checkout("coupon-guest");
  assert.equal(guest.status, 400);
  assert.match(guest.body.message, /login/i);

  const buyer = await User.create({ name: "Buyer", email: "once@example.com", role: "customer" });
  const token = jwt.sign({ id: String(buyer._id), role: "customer" }, process.env.JWT_SECRET, { expiresIn: "1h" });

  await Cart.create({
    store: state.store._id,
    user: buyer._id,
    sessionId: null,
    couponCode: "ONCE",
    items: [{ product: state.product._id, unitPrice: 100, quantity: 1 }],
  });
  const first = await checkout("ignored", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(String(first.body.order.customer), String(buyer._id));

  await Cart.updateOne(
    { store: state.store._id, user: buyer._id, sessionId: null },
    {
      $set: {
        couponCode: "ONCE",
        items: [{ product: state.product._id, unitPrice: 100, quantity: 1 }],
      },
    }
  );
  const second = await checkout("ignored", { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(second.status, 400);
  assert.match(second.body.message, /sesh/i);
});

test("shipping zone comes from the customer address, not the request context", async () => {
  await Settings.create({ key: "shipping_area_enabled", value: "true" });
  await ShippingArea.create([
    { store: state.store._id, district: "Dhaka", area: "", price: 100 },
    { store: state.store._id, district: "Chattogram", area: "", price: 300 },
  ]);

  await seedCart("zone-1", 1);
  const res = await checkout("zone-1", {
    body: {
      customer: { name: "Zone Buyer", phone: "01700000000", address: "1 Road", district: "Dhaka" },
      // Attacker tries to claim the cheaper... or pricier — either way the spoof must be ignored.
      shipping: { context: { district: "Chattogram" } },
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.order.district, "Dhaka");
  assert.equal(res.body.order.shippingAmount, 100);
  assert.match(res.body.order.shippingLabel, /Dhaka/i);
});
