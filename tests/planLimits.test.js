const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Product = require("../models/Product");
const Staff = require("../models/Staff");
const Subscription = require("../models/Subscription");
const { applyPlanToStore } = require("../lib/storeProvisioning");

const state = {};

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("plan_limits"));
  await Promise.all([Plan.init(), Store.init(), User.init(), Product.init(), Staff.init(), Subscription.init()]);

  const owner = await User.create({ name: "Owner", email: "plan-owner@example.com", role: "admin" });
  state.owner = owner;

  // inactive plan — limits still apply even when the plan is disabled
  state.limited = await Plan.create({
    name: "Starter",
    slug: "starter",
    price: 0,
    active: false,
    limits: { products: 2, staffMembers: 1 },
  });
  state.limitedStore = await Store.create({
    name: "Limited Shop",
    slug: "limited-shop",
    owner: owner._id,
    plan: state.limited._id,
  });

  state.free = await Plan.create({
    name: "Free",
    slug: "free",
    price: 0,
    limits: { products: 0, staffMembers: 0 },
    features: { customDomain: false },
  });
  state.pro = await Plan.create({
    name: "Pro",
    slug: "pro",
    price: 500,
    limits: { products: 100, staffMembers: 5 },
    features: { customDomain: true },
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("parallel product creates cannot overshoot the plan limit", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      Product.create({
        store: state.limitedStore._id,
        name: "Race product " + i,
        slug: "race-product-" + i,
      })
    )
  );

  const saved = results.filter((r) => r.status === "fulfilled");
  const blocked = results.filter((r) => r.status === "rejected");

  assert.equal(saved.length, 2);
  assert.equal(blocked.length, 4);
  blocked.forEach((r) => assert.equal(r.reason.code, "PLAN_LIMIT"));

  const count = await Product.countDocuments({ store: state.limitedStore._id });
  assert.equal(count, 2);
});

test("staff limit is enforced on the same store", async () => {
  await Staff.create({ store: state.limitedStore._id, name: "First", email: "first@example.com" });
  await assert.rejects(
    Staff.create({ store: state.limitedStore._id, name: "Second", email: "second@example.com" }),
    (err) => err.code === "PLAN_LIMIT"
  );
});

test("a failed save releases the per-store lock", async () => {
  const plan = await Plan.create({ name: "Two", slug: "two", price: 0, limits: { products: 2 } });
  const store = await Store.create({
    name: "Lock Shop",
    slug: "lock-shop",
    owner: state.owner._id,
    plan: plan._id,
  });
  await Product.collection.createIndex({ slug: 1, store: 1 }, { unique: true });

  await Product.create({ store: store._id, name: "A", slug: "dup-slug" });
  await assert.rejects(Product.create({ store: store._id, name: "B", slug: "dup-slug" }), /duplicate key/i);

  // would hang if the failed save never released the lock
  await Product.create({ store: store._id, name: "C", slug: "unique-slug" });
  assert.equal(await Product.countDocuments({ store: store._id }), 2);
});

test("changing to a plan without the feature drops the custom domain", async () => {
  const store = await Store.create({
    name: "Domain Shop",
    slug: "domain-shop",
    owner: state.owner._id,
    plan: state.pro._id,
    customDomain: "shop.example.com",
    customDomainStatus: "verified",
    domainToken: "lxv_test",
  });

  await applyPlanToStore({ store, plan: state.free, startedAt: new Date(), extend: false });
  const downgraded = await Store.findById(store._id).lean();
  assert.equal(downgraded.customDomain, undefined);
  assert.equal(downgraded.customDomainStatus, "none");
  assert.equal(downgraded.domainToken, null);
  assert.equal(String(downgraded.plan), String(state.free._id));
});

test("changing to a plan with the feature keeps the custom domain", async () => {
  const store = await Store.create({
    name: "Domain Shop 2",
    slug: "domain-shop-2",
    owner: state.owner._id,
    plan: state.free._id,
    customDomain: "shop2.example.com",
    customDomainStatus: "verified",
    domainToken: "lxv_test_2",
  });

  await applyPlanToStore({ store, plan: state.pro, startedAt: new Date(), extend: false });
  const upgraded = await Store.findById(store._id).lean();
  assert.equal(upgraded.customDomain, "shop2.example.com");
  assert.equal(upgraded.customDomainStatus, "verified");
  assert.equal(String(upgraded.plan), String(state.pro._id));
});
