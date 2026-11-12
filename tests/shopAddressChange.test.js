process.env.JWT_SECRET = "shop-address-change-secret";
process.env.STOREFRONT_URL = "http://localhost:3000";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Store = require("../models/Store");
const User = require("../models/User");
const Settings = require("../models/Settings");
const SlugHistory = require("../models/SlugHistory");
const AuditLog = require("../models/AuditLog");
const { renamedAddress, QUARANTINE_DAYS } = require("../lib/shopAddress");

const state = {};
const DAY = 24 * 60 * 60 * 1000;
const owner = new mongoose.Types.ObjectId();
const plan = new mongoose.Types.ObjectId();

function bearer(user) {
  return "Bearer " + jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function changeSlug(store, user, slug) {
  return request(state.app)
    .patch("/api/stores/" + store._id + "/slug")
    .set("Authorization", bearer(user))
    .send({ slug });
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("shop_address_change"));
  await Promise.all([Store.init(), User.init(), Settings.init(), SlugHistory.init(), AuditLog.init()]);
  await Settings.create({ key: "platformDomain", value: "localtest.me" });

  state.owner = await User.create({ _id: owner, name: "Owner", email: "owner@addr.test", role: "customer" });
  state.admin = await User.create({ name: "Root", email: "root@addr.test", role: "superadmin" });

  state.app = express();
  state.app.use(express.json());
  state.app.use("/api/stores", require("../routes/stores"));
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

function makeStore(slug, extra = {}) {
  return Store.create({ name: slug, slug, owner, plan, ...extra });
}

test("an owner rename updates the address, records history and writes an audit row", async () => {
  const store = await makeStore("tara-mart");
  const res = await changeSlug(store, state.owner, "tara-bazar");
  assert.equal(res.status, 200);
  assert.equal(res.body.slug, "tara-bazar");
  assert.equal(res.body.previousSlug, "tara-mart");
  assert.ok(res.body.nextSlugChangeAt);

  const fresh = await Store.findById(store._id);
  assert.equal(fresh.slug, "tara-bazar");
  assert.ok(fresh.slugChangedAt instanceof Date);

  const history = await SlugHistory.findOne({ slug: "tara-mart", kind: "renamed" });
  assert.ok(history);
  assert.equal(history.replacedBySlug, "tara-bazar");
  assert.equal(String(history.store), String(store._id));
  const quarantineDays = (history.quarantineUntil - history.releasedAt) / DAY;
  assert.ok(Math.abs(quarantineDays - QUARANTINE_DAYS) < 1);

  const audit = await AuditLog.findOne({ action: "store.slug.change", entityId: String(store._id) });
  assert.ok(audit);
  assert.equal(audit.oldValue.slug, "tara-mart");
  assert.equal(audit.newValue.slug, "tara-bazar");
  assert.equal(audit.newValue.by, "owner");
});

test("the old address 301s to the current site while the quarantine lasts", async () => {
  const moved = await renamedAddress("tara-mart.localtest.me");
  assert.ok(moved);
  assert.equal(moved.slug, "tara-bazar");
  assert.equal(moved.url, "http://tara-bazar.localtest.me:3000/");

  assert.equal(await renamedAddress("tara-bazar.localtest.me"), null);
  assert.equal(await renamedAddress("never-used.localtest.me"), null);
  assert.equal(await renamedAddress("shop.example.com"), null);
});

test("an owner cannot rename again inside the cooldown", async () => {
  const store = await Store.findOne({ slug: "tara-bazar" });
  const res = await changeSlug(store, state.owner, "tara-new");
  assert.equal(res.status, 429);
  assert.equal(res.body.code, "slug_cooldown");
  assert.ok(res.body.retryAt);

  const fresh = await Store.findById(store._id);
  assert.equal(fresh.slug, "tara-bazar");
});

test("a superadmin rename bypasses the cooldown and is audited as such", async () => {
  const store = await Store.findOne({ slug: "tara-bazar" });
  const res = await changeSlug(store, state.admin, "tara-super");
  assert.equal(res.status, 200);
  assert.equal(res.body.slug, "tara-super");

  const audit = await AuditLog.findOne({ action: "store.slug.change", "newValue.slug": "tara-super" });
  assert.equal(audit.newValue.by, "superadmin");
});

test("renaming to the current address is a no-op", async () => {
  const store = await Store.findOne({ slug: "tara-super" });
  const before = await SlugHistory.countDocuments({ store: store._id });
  const res = await changeSlug(store, state.owner, "tara-super");
  assert.equal(res.status, 200);
  assert.equal(res.body.slug, "tara-super");
  assert.equal(await SlugHistory.countDocuments({ store: store._id }), before);
});

test("cooldown 0 in platform settings allows back-to-back renames", async () => {
  await Settings.create({ key: "slugChangeCooldownDays", value: "0" });
  const store = await makeStore("cooldown-zero");
  assert.equal((await changeSlug(store, state.owner, "cooldown-one")).status, 200);
  assert.equal((await changeSlug(store, state.owner, "cooldown-two")).status, 200);
  // restore the default for anything that runs later
  await Settings.deleteOne({ key: "slugChangeCooldownDays" });
});

test("history rows outside the quarantine, released aliases and trashed shops do not redirect", async () => {
  const store = await makeStore("expired-shop");
  await SlugHistory.create({
    slug: "expired-label",
    store: store._id,
    kind: "renamed",
    replacedBySlug: store.slug,
    quarantineUntil: new Date(Date.now() - DAY),
  });
  assert.equal(await renamedAddress("expired-label.localtest.me"), null);

  await SlugHistory.create({
    slug: "released-label",
    store: store._id,
    kind: "released",
    quarantineUntil: new Date(Date.now() + DAY),
  });
  assert.equal(await renamedAddress("released-label.localtest.me"), null);

  const trashed = await makeStore("trashed-shop", { deletedAt: new Date() });
  await SlugHistory.create({
    slug: "gone-label",
    store: trashed._id,
    kind: "renamed",
    replacedBySlug: "trashed-shop",
    quarantineUntil: new Date(Date.now() + DAY),
  });
  assert.equal(await renamedAddress("gone-label.localtest.me"), null);
});

test("the public redirect endpoint answers without a store context", async () => {
  const app = express();
  app.use("/api/public", require("../routes/publicApi"));

  const hit = await request(app).get("/api/public/address-redirect?host=tara-mart.localtest.me");
  assert.equal(hit.status, 200);
  assert.equal(hit.body.redirect.slug, "tara-super");
  assert.equal(hit.headers["cache-control"], "no-store");

  const miss = await request(app).get("/api/public/address-redirect?host=nothing.localtest.me");
  assert.equal(miss.body.redirect, null);
});
