process.env.JWT_SECRET = "installment-scope-secret";
process.env.INSTALLMENT_WEBHOOK_SECRET = "installment-webhook-secret";

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
const Order = require("../models/Order");
const OrderInstallment = require("../models/OrderInstallment");
const Payment = require("../models/Payment");

const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function call(who, method, url, { slug, body } = {}) {
  const req = request(state.app)[method](url)
    .set("x-store-slug", slug || "shop-a")
    .set("Authorization", `Bearer ${state[who + "Token"]}`);
  return body === undefined ? req : req.send(body);
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("installment_scope"));
  await Promise.all([
    Plan.init(), Store.init(), User.init(), Order.init(), OrderInstallment.init(), Payment.init(),
  ]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const ownerA = await User.create({ name: "Owner A", email: "ia@example.com", phone: "01711111111", role: "admin" });
  const ownerB = await User.create({ name: "Owner B", email: "ib@example.com", phone: "01722222222", role: "admin" });
  const buyer = await User.create({ name: "Buyer", email: "buyer@example.com", phone: "01733333333", role: "customer" });
  const stranger = await User.create({ name: "Stranger", email: "x@example.com", role: "customer" });

  state.storeA = await Store.create({ name: "Shop A", slug: "shop-a", owner: ownerA._id, plan: plan._id });
  state.storeB = await Store.create({ name: "Shop B", slug: "shop-b", owner: ownerB._id, plan: plan._id });

  state.order = await Order.create({
    store: state.storeA._id,
    orderNumber: "ORD-I-1",
    customer: buyer._id,
    customerName: "Buyer",
    customerPhone: "01733333333",
    items: [{ product: new mongoose.Types.ObjectId(), quantity: 1, price: 1000 }],
    totalAmount: 3000,
    paidAmount: 0,
    dueAmount: 300000,
    paymentMode: "installment",
    status: "pending",
    paymentStatus: "pending",
  });
  state.installment = await OrderInstallment.create({
    store: state.storeA._id,
    order: state.order._id,
    number: 1,
    amountPaisa: 100000,
    dueDate: new Date("2026-12-01"),
    status: "pending",
  });
  state.payment = await Payment.create({
    store: state.storeA._id,
    order: state.order._id,
    installment: state.installment._id,
    method: "mobile:bkash",
    amountPaisa: 100000,
    status: "pending",
  });

  state.aToken = tokenFor(ownerA);
  state.bToken = tokenFor(ownerB);
  state.buyerToken = tokenFor(buyer);
  state.strangerToken = tokenFor(stranger);

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
  state.app.use("/api/installments", require("../routes/installments"));
  state.app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("a store admin cannot open another store's installment order by switching ?store=", async () => {
  const fine = await call("a", "get", `/api/installments/orders/${state.order._id}`);
  assert.equal(fine.status, 200, JSON.stringify(fine.body));

  const buyer = await call("buyer", "get", `/api/installments/orders/${state.order._id}`);
  assert.equal(buyer.status, 200, JSON.stringify(buyer.body));

  const stranger = await call("stranger", "get", `/api/installments/orders/${state.order._id}`);
  assert.equal(stranger.status, 404);

  // Admin B claims store A in the URL — role alone must not grant access.
  const intruder = await call("b", "get", `/api/installments/orders/${state.order._id}`, { slug: "shop-a" });
  assert.equal(intruder.status, 404);

  const wrongStore = await call("b", "get", `/api/installments/orders/${state.order._id}`, { slug: "shop-b" });
  assert.equal(wrongStore.status, 404);
});

test("receipts follow the same store owner rule", async () => {
  const own = await call("a", "get", `/api/installments/payments/${state.payment._id}/receipt`);
  assert.equal(own.status, 200);

  const buyer = await call("buyer", "get", `/api/installments/payments/${state.payment._id}/receipt`);
  assert.equal(buyer.status, 200);

  const intruder = await call("b", "get", `/api/installments/payments/${state.payment._id}/receipt`, { slug: "shop-a" });
  assert.equal(intruder.status, 403);

  const stranger = await call("stranger", "get", `/api/installments/payments/${state.payment._id}/receipt`);
  assert.equal(stranger.status, 403);
});

test("webhook is store-scoped and needs the exact amount", async () => {
  const wrongStore = await request(state.app)
    .post(`/api/installments/webhook/mobile`)
    .set("x-store-slug", "shop-b")
    .set("x-webhook-secret", "installment-webhook-secret")
    .send({ paymentId: String(state.payment._id), amountPaisa: 100000, status: "verified" });
  assert.equal(wrongStore.status, 404);

  const noSecret = await request(state.app)
    .post(`/api/installments/webhook/mobile`)
    .set("x-store-slug", "shop-a")
    .send({ paymentId: String(state.payment._id), amountPaisa: 100000, status: "verified" });
  assert.equal(noSecret.status, 401);

  const wrongAmount = await request(state.app)
    .post(`/api/installments/webhook/mobile`)
    .set("x-store-slug", "shop-a")
    .set("x-webhook-secret", "installment-webhook-secret")
    .send({ paymentId: String(state.payment._id), amountPaisa: 1000, status: "verified" });
  assert.equal(wrongAmount.status, 400);
  assert.match(wrongAmount.body.message, /amount/i);

  const ok = await request(state.app)
    .post(`/api/installments/webhook/mobile`)
    .set("x-store-slug", "shop-a")
    .set("x-webhook-secret", "installment-webhook-secret")
    .send({ paymentId: String(state.payment._id), amountPaisa: 100000, status: "verified" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.payment.status, "verified");

  // Provider retry: acknowledged, not applied twice.
  const retry = await request(state.app)
    .post(`/api/installments/webhook/mobile`)
    .set("x-store-slug", "shop-a")
    .set("x-webhook-secret", "installment-webhook-secret")
    .send({ paymentId: String(state.payment._id), amountPaisa: 100000, status: "verified" });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.duplicate, true);

  const fresh = await Payment.findById(state.payment._id).lean();
  assert.equal(fresh.status, "verified");
});
