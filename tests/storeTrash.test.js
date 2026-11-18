process.env.JWT_SECRET = "store-trash-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Subscription = require("../models/Subscription");
const PlatformPayment = require("../models/PlatformPayment");
const SlugHistory = require("../models/SlugHistory");
const AuditLog = require("../models/AuditLog");
const { resolvePublicStore } = require("../middleware/publicStore");

const state = {};

function bearer(user) {
  return "Bearer " + jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function publicLookup(slug) {
  return resolvePublicStore({ headers: { "x-store-slug": slug }, query: {} });
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("store_trash"));
  await Promise.all([
    Plan.init(),
    Store.init(),
    User.init(),
    Product.init(),
    Order.init(),
    Subscription.init(),
    PlatformPayment.init(),
    SlugHistory.init(),
    AuditLog.init(),
  ]);

  state.plan = await Plan.create({ name: "Free", slug: "free", price: 0, active: true });
  state.owner = await User.create({ name: "Owner", email: "owner@trash.test", role: "admin" });
  state.superadmin = await User.create({ name: "Root", email: "root@trash.test", role: "superadmin" });
  state.superToken = bearer(state.superadmin);

  state.storeA = await Store.create({ name: "Trash Me", slug: "trash-me", owner: state.owner._id, plan: state.plan._id });
  state.storeB = await Store.create({ name: "Keep Me", slug: "keep-me", owner: state.owner._id, plan: state.plan._id });

  await Subscription.create({
    store: state.storeA._id,
    plan: state.plan._id,
    startDate: new Date(),
    endDate: new Date(Date.now() + 30 * 864e5),
  });
  await Product.create({ store: state.storeA._id, name: "Widget", slug: "widget", regularPrice: 100, price: 100, stock: 5, status: "published" });
  await Order.create({
    store: state.storeA._id,
    orderNumber: "ORD-TRASH-1",
    customerName: "Rahim",
    customerPhone: "01700000000",
    totalAmount: 100,
    status: "pending",
  });
  await SlugHistory.create({
    slug: "old-trash-me",
    store: state.storeA._id,
    kind: "renamed",
    replacedBySlug: "trash-me",
    quarantineUntil: new Date(Date.now() + 90 * 864e5),
  });
  state.payment = await PlatformPayment.create({
    invoiceNo: "INV-TRASH-1",
    user: state.owner._id,
    store: state.storeA._id,
    storeName: "Trash Me",
    plan: state.plan._id,
    amount: 500,
    method: "bkash",
  });

  state.app = express();
  state.app.use(express.json());
  state.app.use("/api/admin", require("../routes/admin"));
  state.app.use("/api/stores", require("../routes/stores"));
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

function asSuper(method, url) {
  return request(state.app)[method](url).set("Authorization", state.superToken);
}

test("the default store list and stats ignore trashed shops", async () => {
  const trashed = await asSuper("post", `/api/admin/stores/${state.storeA._id}/trash`).send({});
  assert.equal(trashed.status, 200, JSON.stringify(trashed.body));
  assert.ok(trashed.body.deletedAt, "deletedAt is set");
  assert.equal(trashed.body.alreadyTrashed, false);

  const active = await asSuper("get", "/api/admin/stores");
  assert.equal(active.status, 200);
  assert.deepEqual(active.body.map((s) => s.slug), ["keep-me"]);

  const trash = await asSuper("get", "/api/admin/stores?status=trashed");
  assert.equal(trash.status, 200);
  assert.deepEqual(trash.body.map((s) => s.slug), ["trash-me"]);

  const stats = await asSuper("get", "/api/admin/stats");
  assert.equal(stats.body.stores, 1);
  assert.equal(stats.body.trashedStores, 1);

  const again = await asSuper("post", `/api/admin/stores/${state.storeA._id}/trash`).send({});
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyTrashed, true);
});

test("a trashed shop answers nothing publicly and disappears from its owner's panel", async () => {
  assert.equal(await publicLookup("trash-me"), null);

  const mine = await request(state.app)
    .get("/api/stores/mine")
    .set("Authorization", bearer(state.owner));
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.deepEqual(mine.body.map((s) => s.slug), ["keep-me"]);
});

test("restore brings the same shop and data back", async () => {
  const restored = await asSuper("post", `/api/admin/stores/${state.storeA._id}/restore`).send({});
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.deletedAt, null);
  assert.equal(restored.body.alreadyActive, false);

  const active = await asSuper("get", "/api/admin/stores");
  assert.deepEqual(active.body.map((s) => s.slug).sort(), ["keep-me", "trash-me"]);

  const resolved = await publicLookup("trash-me");
  assert.ok(resolved);
  assert.equal(String(resolved._id), String(state.storeA._id));

  assert.equal(await Product.countDocuments({ store: state.storeA._id }), 1);
  assert.equal(await Subscription.countDocuments({ store: state.storeA._id }), 1);

  const again = await asSuper("post", `/api/admin/stores/${state.storeA._id}/restore`).send({});
  assert.equal(again.body.alreadyActive, true);
});

test("permanent delete refuses a shop that is still live", async () => {
  const res = await asSuper("delete", `/api/admin/stores/${state.storeA._id}`);
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "not_trashed");
  assert.ok(await Store.findById(state.storeA._id));
});

test("permanent delete wipes tenant data but keeps payments and the audit trail", async () => {
  await asSuper("post", `/api/admin/stores/${state.storeA._id}/trash`).send({});

  const res = await asSuper("delete", `/api/admin/stores/${state.storeA._id}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.purged, true);
  assert.ok(res.body.removed.products >= 1, "product collection purged");
  assert.ok(res.body.removed.orders >= 1, "order collection purged");
  assert.ok(res.body.removed.subscriptions >= 1, "subscription purged");
  assert.ok(res.body.removed.slughistories >= 1, "slug history purged");

  assert.equal(await Store.findById(state.storeA._id), null);
  assert.equal(await Product.countDocuments({ store: state.storeA._id }), 0);
  assert.equal(await Order.countDocuments({ store: state.storeA._id }), 0);
  assert.equal(await Subscription.countDocuments({ store: state.storeA._id }), 0);
  assert.equal(await SlugHistory.countDocuments({ store: state.storeA._id }), 0);

  assert.ok(await PlatformPayment.findById(state.payment._id), "payment history survives");
  const actions = await AuditLog.find({ store: state.storeA._id }).distinct("action");
  assert.ok(actions.includes("store.trash"));
  assert.ok(actions.includes("store.purge"));

  const other = await Store.findById(state.storeB._id);
  assert.ok(other && !other.deletedAt, "the untouched shop stays live");

  const freed = await Store.create({ name: "Reused", slug: "trash-me", owner: state.owner._id, plan: state.plan._id });
  assert.equal(freed.slug, "trash-me");
  await Store.deleteOne({ _id: freed._id });
});

test("only a super admin can trash, restore or purge", async () => {
  const denied = await request(state.app)
    .post(`/api/admin/stores/${state.storeB._id}/trash`)
    .set("Authorization", bearer(state.owner))
    .send({});
  assert.equal(denied.status, 403);
  assert.ok(!(await Store.findById(state.storeB._id)).deletedAt);
});
