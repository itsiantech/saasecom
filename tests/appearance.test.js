process.env.JWT_SECRET = "appearance-test-secret";

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
const Appearance = require("../models/Appearance");

const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function admin(method, path, body) {
  const req = request(state.app)[method](path)
    .set("x-store-slug", "shop-a")
    .set("Authorization", `Bearer ${state.adminToken}`);
  return body === undefined ? req : req.send(body);
}

function pub(query = "") {
  return request(state.app).get(`/api/public/appearance${query}`).set("x-store-slug", "shop-a");
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("appearance"));
  await Promise.all([Plan.init(), Store.init(), User.init(), Appearance.init()]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const adminUser = await User.create({ name: "Admin", email: "admin@example.com", role: "admin" });
  const customer = await User.create({ name: "Shopper", email: "shopper@example.com", role: "customer" });

  state.store = await Store.create({ name: "Shop A", slug: "shop-a", owner: adminUser._id, plan: plan._id, subdomain: "a" });
  state.otherStore = await Store.create({ name: "Shop B", slug: "shop-b", owner: adminUser._id, plan: plan._id, subdomain: "b" });

  state.adminToken = tokenFor(adminUser);
  state.customerToken = tokenFor(customer);

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
  state.app.use("/api/appearance", require("../routes/appearance"));
  state.app.use("/api/public", require("../routes/publicApi"));
  state.app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("appearance admin API denies missing and non-admin sessions", async () => {
  assert.equal((await request(state.app).get("/api/appearance").set("x-store-slug", "shop-a")).status, 401);
  const denied = await request(state.app)
    .get("/api/appearance")
    .set("x-store-slug", "shop-a")
    .set("Authorization", `Bearer ${state.customerToken}`);
  assert.equal(denied.status, 403);
});

test("first read creates a default appearance with the theme catalog", async () => {
  const res = await admin("get", "/api/appearance");
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const theme = res.body.themes.find((row) => row.name === "theme1");
  assert.ok(theme, "theme1 must be listed from themes/theme1/theme.json");
  assert.equal(res.body.draft.theme, "theme1");
  assert.deepEqual(res.body.draft.overrides, {});
  assert.equal(res.body.draft.tokens.colorPrimary, theme.tokens.colorPrimary);
  assert.equal(res.body.dirty, false);
  assert.equal(res.body.revisions.length, 0);

  const count = await Appearance.countDocuments({ store: state.store._id });
  assert.equal(count, 1);
});

test("draft keeps only the theme's own token keys and coerces to strings", async () => {
  const res = await admin("put", "/api/appearance/draft", {
    theme: "theme1",
    tokens: { colorPrimary: "#123456", radiusCard: 4, brandInjection: "url(evil)" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.draft.overrides, { colorPrimary: "#123456", radiusCard: "4" });

  const read = await admin("get", "/api/appearance");
  assert.equal(read.body.dirty, true);
  assert.equal(read.body.draft.tokens.radiusCard, "4");
  assert.equal(read.body.published.tokens.colorPrimary, "#e1251b");
});

test("an unknown theme or an over-long value is rejected or capped", async () => {
  const badTheme = await admin("put", "/api/appearance/draft", { theme: "theme-404", tokens: {} });
  assert.equal(badTheme.status, 400);

  const long = "x".repeat(260);
  const capped = await admin("put", "/api/appearance/draft", {
    theme: "theme1",
    tokens: { colorPrimary: "#123456", colorAccent: long },
  });
  assert.equal(capped.status, 200);
  assert.equal(capped.body.draft.overrides.colorAccent.length, 200);
});

test("public read serves published until a live preview token asks for the draft", async () => {
  const before = await pub();
  assert.equal(before.status, 200);
  assert.equal(before.body.appearance.tokens.colorPrimary, "#e1251b");
  assert.equal(before.body.appearance.preview, false);

  const preview = await admin("post", "/api/appearance/preview");
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.ok(preview.body.url.includes(`appearance=${preview.body.token}`));
  assert.equal(preview.body.minutes, 30);

  const draft = await pub(`?preview=${preview.body.token}`);
  assert.equal(draft.body.appearance.tokens.colorPrimary, "#123456");
  assert.equal(draft.body.appearance.preview, true);

  const wrong = await pub("?preview=000000000000000000000000000000000000");
  assert.equal(wrong.body.appearance.tokens.colorPrimary, "#e1251b");
  assert.equal(wrong.body.appearance.preview, false);
});

test("publish makes the draft public, records a revision and clears the preview", async () => {
  const preview = await admin("post", "/api/appearance/preview");
  const res = await admin("post", "/api/appearance/publish");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.published.tokens.colorPrimary, "#123456");

  const live = await pub();
  assert.equal(live.body.appearance.tokens.colorPrimary, "#123456");

  const read = await admin("get", "/api/appearance");
  assert.equal(read.body.dirty, false);
  assert.equal(read.body.revisions.length, 1);
  assert.equal(read.body.revisions[0].tokens.colorPrimary, "#123456");

  const stale = await pub(`?preview=${preview.body.token}`);
  assert.equal(stale.body.appearance.preview, false, "a published draft token must stop working");
});

test("publishing an unchanged draft is rejected", async () => {
  const res = await admin("post", "/api/appearance/publish");
  assert.equal(res.status, 400);
});

test("restore puts an old revision back into the draft, reset returns to published", async () => {
  await admin("put", "/api/appearance/draft", { theme: "theme1", tokens: { colorPrimary: "#222222" } });
  assert.equal((await admin("post", "/api/appearance/publish")).status, 200);

  const read = await admin("get", "/api/appearance");
  assert.equal(read.body.revisions.length, 2);
  const older = read.body.revisions.find((row) => row.tokens.colorPrimary === "#123456");
  assert.ok(older, "the first publish must be kept as a revision");

  const restored = await admin("post", `/api/appearance/revisions/${older.id}/restore`);
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.draft.tokens.colorPrimary, "#123456");

  const afterRestore = await admin("get", "/api/appearance");
  assert.equal(afterRestore.body.dirty, true);
  assert.equal(afterRestore.body.published.tokens.colorPrimary, "#222222");

  const reset = await admin("post", "/api/appearance/draft/reset");
  assert.equal(reset.status, 200);
  assert.equal(reset.body.draft.tokens.colorPrimary, "#222222");

  const afterReset = await admin("get", "/api/appearance");
  assert.equal(afterReset.body.dirty, false);
});

test("appearance is per store: another store starts from theme defaults", async () => {
  const res = await request(state.app)
    .get("/api/appearance")
    .set("x-store-slug", "shop-b")
    .set("Authorization", `Bearer ${state.adminToken}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.published.tokens.colorPrimary, "#e1251b");
  assert.equal(res.body.revisions.length, 0);
});
