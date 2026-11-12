process.env.JWT_SECRET = "feature-entitlements-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Store = require("../models/Store");
const Plan = require("../models/Plan");
const User = require("../models/User");
const Settings = require("../models/Settings");
const WholesaleSettings = require("../models/WholesaleSettings");
const AuditLog = require("../models/AuditLog");
const {
  planHas,
  resolveFeatures,
  featuresForStore,
  requireFeature,
  pruneSelection,
  overridesForSelection,
} = require("../lib/features");
const { syncFeatureEntitlements } = require("../lib/storeProvisioning");
const { scopedKey } = require("../lib/settingsScope");

const state = {};

function bearer(user) {
  return "Bearer " + jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("features"));
  await Promise.all([
    Store.init(),
    Plan.init(),
    User.init(),
    Settings.init(),
    WholesaleSettings.init(),
    AuditLog.init(),
  ]);

  state.superadmin = await User.create({ name: "Root", email: "root@feature.test", role: "superadmin" });
  state.owner = await User.create({ name: "Owner", email: "owner@feature.test", role: "customer" });

  state.pro = await Plan.create({
    name: "Pro",
    slug: "pro",
    features: {
      wholesale: true,
      partialPayment: true,
      serverSideTracking: true,
      supplierPortal: false,
      customDomain: true,
      analytics: true,
    },
  });
  state.starter = await Plan.create({
    name: "Starter",
    slug: "starter",
    features: {
      wholesale: false,
      partialPayment: false,
      serverSideTracking: false,
      supplierPortal: false,
      customDomain: false,
      analytics: false,
    },
  });
  state.legacy = await Plan.create({ name: "Legacy", slug: "legacy", features: {} });

  state.app = express();
  state.app.use(express.json());
  state.app.use("/api/admin", require("../routes/admin"));
  state.app.use("/api/plans", require("../routes/plans"));
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

async function makeStore(slug, plan, extra = {}) {
  return Store.create({ name: slug, slug, owner: state.owner._id, plan: plan._id, ...extra });
}

test("a legacy plan keeps the modules that predate package gating", async () => {
  assert.equal(planHas(state.legacy, "wholesale"), true);
  assert.equal(planHas(state.legacy, "partialPayment"), true);
  assert.equal(planHas(state.legacy, "serverSideTracking"), true);
  assert.equal(planHas(state.legacy, "supplierPortal"), true);
  assert.equal(planHas(state.legacy, "customDomain"), false);
});

test("a plan can switch a module off explicitly", async () => {
  assert.equal(planHas(state.starter, "wholesale"), false);
  assert.equal(planHas(state.pro, "wholesale"), true);
});

test("per-store grant adds access and revoke wins over the plan", async () => {
  const store = await makeStore("grant-store", state.starter, {
    featureOverrides: { granted: ["serverSideTracking"], revoked: [] },
  });
  const access = await featuresForStore(store);
  assert.equal(access.features.serverSideTracking, true);
  assert.equal(access.sources.serverSideTracking, "granted");
  assert.equal(access.features.wholesale, false);
  assert.equal(access.sources.wholesale, "none");

  const blocked = await featuresForStore(
    { ...store.toObject(), featureOverrides: { granted: [], revoked: ["wholesale"] } },
    state.pro
  );
  assert.equal(blocked.features.wholesale, false);
  assert.equal(blocked.sources.wholesale, "blocked");
});

test("partial payment cannot be used without wholesale", async () => {
  const store = await makeStore("partial-only", state.starter, {
    featureOverrides: { granted: ["partialPayment"], revoked: [] },
  });
  const access = resolveFeatures(store, state.starter);
  assert.equal(access.features.partialPayment, false);

  const granted = resolveFeatures(
    { featureOverrides: { granted: ["partialPayment", "wholesale"], revoked: [] } },
    state.starter
  );
  assert.equal(granted.features.partialPayment, true);
  assert.equal(granted.sources.partialPayment, "granted");
});

test("requireFeature answers 403 feature_locked for a plan without the module", async () => {
  const store = await makeStore("locked-store", state.starter);
  const app = express();
  app.get(
    "/locked",
    (req, _res, next) => {
      req.store = store;
      next();
    },
    requireFeature("wholesale"),
    (_req, res) => res.json({ ok: true })
  );
  const res = await request(app).get("/locked");
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "feature_locked");
  assert.equal(res.body.feature, "wholesale");
});

test("new admin modules default on for plans that predate them", () => {
  const modules = [
    "products",
    "orders",
    "categories",
    "brands",
    "customers",
    "settings",
    "flashSales",
    "coupons",
    "inventory",
    "accounts",
    "reports",
  ];
  modules.forEach((key) => assert.equal(planHas(state.legacy, key), true, key));
  assert.equal(planHas(state.legacy, "apiAccess"), false);
  assert.equal(planHas(state.legacy, "customDomain"), false);
});

test("selection prunes dependent modules and splits grants from revokes", () => {
  assert.deepEqual([...pruneSelection(["partialPayment"])], []);
  assert.deepEqual([...pruneSelection(["wholesale", "partialPayment"])].sort(), ["partialPayment", "wholesale"]);

  const grants = overridesForSelection(state.starter, ["wholesale", "partialPayment", "products"]);
  assert.deepEqual(grants.granted.sort(), ["partialPayment", "wholesale"]);
  assert.equal(grants.granted.includes("products"), false);
  assert.equal(grants.revoked.includes("wholesale"), false);

  const revokes = overridesForSelection(state.starter, ["products", "orders"]);
  assert.equal(revokes.revoked.includes("wholesale"), false);
  assert.equal(revokes.granted.includes("products"), false);
});

test("a plan cannot enable partial payment without wholesale", async () => {
  const plan = await Plan.create({ name: "Dep", slug: "dep-check", features: {} });
  const res = await request(state.app)
    .put("/api/plans/" + plan._id)
    .set("Authorization", bearer(state.superadmin))
    .send({ features: { wholesale: false, partialPayment: true } });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /হোলসেল/);
});

test("a plan can carry the new module keys independently", async () => {
  const plan = await Plan.create({ name: "Modules", slug: "module-check", features: {} });
  const res = await request(state.app)
    .put("/api/plans/" + plan._id)
    .set("Authorization", bearer(state.superadmin))
    .send({ features: { products: true, orders: false, inventory: true, accounts: false, reports: true } });
  assert.equal(res.status, 200);
  assert.equal(planHas(res.body, "products"), true);
  assert.equal(planHas(res.body, "orders"), false);
  assert.equal(planHas(res.body, "inventory"), true);
  assert.equal(planHas(res.body, "accounts"), false);
});

test("superadmin bypasses module gates", async () => {
  const store = await makeStore("bypass-store", state.starter);
  const app = express();
  app.get(
    "/bypass",
    (req, _res, next) => {
      req.store = store;
      req.user = { role: "superadmin" };
      next();
    },
    requireFeature("accounts"),
    (_req, res) => res.json({ ok: true })
  );
  const res = await request(app).get("/bypass");
  assert.equal(res.status, 200);
});

test("superadmin can create a store with a hand-picked module set", async () => {
  const res = await request(state.app)
    .post("/api/admin/stores")
    .set("Authorization", bearer(state.superadmin))
    .send({
      email: state.owner.email,
      name: "Picker Shop",
      slug: "picker-shop",
      planSlug: "starter",
      features: ["wholesale", "partialPayment", "orders"],
    });
  assert.equal(res.status, 201);
  const { store, access } = res.body;
  assert.ok(store.featureOverrides.granted.includes("wholesale"));
  assert.ok(store.featureOverrides.granted.includes("partialPayment"));
  // legacy plan key products defaults on, so leaving it out becomes a revoke
  assert.ok(store.featureOverrides.revoked.includes("products"));
  assert.equal(access.features.wholesale, true);
  assert.equal(access.features.products, false);
  assert.equal(access.features.customers, false);

  const audit = await AuditLog.findOne({ action: "store.create", entityId: String(store._id) });
  assert.ok(audit);
});

test("superadmin grants extra access and the action is audited", async () => {
  const store = await makeStore("access-store", state.starter);
  const res = await request(state.app)
    .patch("/api/admin/stores/" + store._id + "/features")
    .set("Authorization", bearer(state.superadmin))
    .send({ granted: ["wholesale", "serverSideTracking"], revoked: [] });
  assert.equal(res.status, 200);
  assert.equal(res.body.features.wholesale, true);
  assert.equal(res.body.sources.wholesale, "granted");

  const fresh = await Store.findById(store._id);
  assert.deepEqual(fresh.featureOverrides.granted.sort(), ["serverSideTracking", "wholesale"]);
  assert.ok(fresh.featureOverrides.updatedAt instanceof Date);

  const audit = await AuditLog.findOne({ action: "store.features.update", entityId: String(store._id) });
  assert.ok(audit);
  assert.deepEqual(audit.newValue.granted.sort(), ["serverSideTracking", "wholesale"]);
});

test("revoking wholesale turns the store switches off but keeps the settings row", async () => {
  const store = await makeStore("revoke-store", state.pro);
  await WholesaleSettings.create({ store: store._id, enabled: true, partialPaymentEnabled: true });
  await request(state.app)
    .patch("/api/admin/stores/" + store._id + "/features")
    .set("Authorization", bearer(state.superadmin))
    .send({ granted: [], revoked: ["wholesale"] })
    .expect(200);

  const fresh = await WholesaleSettings.findOne({ store: store._id });
  assert.equal(fresh.enabled, false);
  assert.equal(fresh.partialPaymentEnabled, false);
});

test("syncFeatureEntitlements does not touch a store that still has the plan", async () => {
  const store = await makeStore("keep-store", state.pro);
  await WholesaleSettings.create({ store: store._id, enabled: true, partialPaymentEnabled: true });
  const access = await syncFeatureEntitlements(store, state.pro);
  assert.equal(access.features.wholesale, true);
  const fresh = await WholesaleSettings.findOne({ store: store._id });
  assert.equal(fresh.enabled, true);
  assert.equal(fresh.partialPaymentEnabled, true);
});

test("plan feature edits apply to every store on that plan immediately", async () => {
  const store = await makeStore("plan-store", state.pro);
  await WholesaleSettings.create({ store: store._id, enabled: true, partialPaymentEnabled: true });
  await Settings.create({ key: scopedKey(store._id, "sst_enabled"), value: "true" });

  const body = {
    features: {
      wholesale: false,
      partialPayment: false,
      serverSideTracking: false,
      supplierPortal: false,
      customDomain: true,
      analytics: true,
    },
  };
  const res = await request(state.app)
    .put("/api/plans/" + state.pro._id)
    .set("Authorization", bearer(state.superadmin))
    .send(body);
  assert.equal(res.status, 200);

  const wholesale = await WholesaleSettings.findOne({ store: store._id });
  assert.equal(wholesale.enabled, false);
  assert.equal(wholesale.partialPaymentEnabled, false);
  const tracking = await Settings.findOne({ key: scopedKey(store._id, "sst_enabled") });
  assert.equal(tracking.value, "false");

  const audit = await AuditLog.findOne({ action: "plan.features.update", entityId: String(state.pro._id) });
  assert.ok(audit);
});
