process.env.JWT_SECRET = "tenant-single-mode-secret";
// no APP_MODE → the app follows the Settings flag, which this test sets to
// "false" (standalone / single-store deployments)
delete process.env.APP_MODE;

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Settings = require("../models/Settings");

const state = {};

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("tenant_single_mode"));
  await Promise.all([Plan.init(), Store.init(), User.init(), Settings.init()]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0 });
  const owner = await User.create({ name: "Owner", email: "owner@example.com", role: "admin" });
  state.first = await Store.create({ name: "First Shop", slug: "first-shop", owner: owner._id, plan: plan._id });
  state.second = await Store.create({ name: "Second Shop", slug: "second-shop", owner: owner._id, plan: plan._id });
  await Settings.create({ key: "saasEnabled", value: "false" });

  state.app = express();
  state.app.use(express.json());
  state.app.use(require("../middleware/tenant"));
  state.app.get("/api/probe", (req, res) => res.json({ slug: req.store ? req.store.slug : null }));
  state.app.use((err, req, res, next) => res.status(err.status || 500).json({ message: err.message }));
});

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

function slugOf(res) {
  return res.body && res.body.slug;
}

test("single mode still resolves the only shop when nothing selects one", async () => {
  const res = await request(state.app).get("/api/probe");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(slugOf(res), state.first.slug);
});

test("an explicit panel selection wins over the first shop", async () => {
  const viaHeader = await request(state.app).get("/api/probe").set("x-store-slug", "second-shop");
  assert.equal(slugOf(viaHeader), state.second.slug);

  const viaQuery = await request(state.app).get("/api/probe?store=second-shop");
  assert.equal(slugOf(viaQuery), state.second.slug);
});

test("an unknown selection falls back to the first shop instead of failing", async () => {
  const res = await request(state.app).get("/api/probe").set("x-store-slug", "no-such-shop");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(slugOf(res), state.first.slug);
});
