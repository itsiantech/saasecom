process.env.JWT_SECRET = "shop-address-test-secret";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const shared = require("../public/js/shop-address");
const Store = require("../models/Store");
const Plan = require("../models/Plan");
const Settings = require("../models/Settings");
const SlugHistory = require("../models/SlugHistory");
const { resetRateLimits } = require("../lib/rateLimit");
const { assertShopName, saveReservedSlugs, getReservedSlugs } = require("../lib/shopAddress");
const { createStoreWithSubscription } = require("../lib/storeProvisioning");

const state = {};

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("shop_address"));
  await Promise.all([Store.init(), Plan.init(), Settings.init(), SlugHistory.init()]);

  state.plan = await Plan.create({
    name: "Free",
    slug: "free",
    price: 0,
    durationDays: 30,
    trialDays: 0,
    active: true,
    limits: { products: 100, orders: 100, staffMembers: 1, storageMB: 100 },
    features: {},
  });

  state.app = express();
  state.app.use(express.json());
  state.app.use("/api", require("../routes/shopAddress"));
  state.app.use((err, _req, res, _next) => res.status(500).json({ message: err.message }));
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

beforeEach(async () => {
  resetRateLimits();
  await Promise.all([Store.deleteMany({}), SlugHistory.deleteMany({}), Settings.deleteMany({})]);
});

let seq = 0;
async function makeStore(slug, extra = {}) {
  seq += 1;
  return Store.create({
    name: "Shop " + slug,
    slug,
    owner: new mongoose.Types.ObjectId(),
    plan: state.plan._id,
    ...extra,
  });
}

function check(slug) {
  return request(state.app).get("/api/check-slug").query({ slug });
}

/* ------------------------------------------------------------ validator */

test("format rules match the published rule text", () => {
  assert.equal(shared.validate("amar-dokan").ok, true);
  assert.equal(shared.validate("a1b").ok, true);
  assert.equal(shared.validate("ab").reason, "length");
  assert.equal(shared.validate("a".repeat(64)).reason, "length");
  assert.equal(shared.validate("amar dokan").reason, "charset");
  assert.equal(shared.validate("amar.dokan").reason, "charset");
  assert.equal(shared.validate("-amar").reason, "edge");
  assert.equal(shared.validate("amar-").reason, "edge");
  assert.equal(shared.validate("amar--dokan").reason, "double-hyphen");
  assert.equal(shared.validate("12345").reason, "digits-only");
  assert.equal(shared.validate("xn--amar").reason, "punycode-prefix");
});

test("case, unicode lookalikes and accents fold to the same name", () => {
  assert.equal(shared.validate("  AMAR-DOKAN  ").value, "amar-dokan");
  assert.equal(shared.validate("ＡＭＡＲ-Dokan").value, "amar-dokan");
  assert.equal(shared.validate("ámár-dokan").value, "amar-dokan");
  assert.equal(shared.validate("аmar-dokan").value, "amar-dokan"); // Cyrillic а
  assert.equal(shared.validate("amar-dokan").ok, true);
  assert.equal(shared.validate("amar_dokan").value, "amar-dokan");
  assert.equal(shared.validate("amar—dokan").value, "amar-dokan");
  assert.equal(shared.validate("amar-দোকান").reason, "charset");
});

test("Bangla names transliterate into a usable suggestion", () => {
  assert.equal(shared.slugify("আমার দোকান"), "amar-dokan");
  assert.equal(shared.slugify("ঢাকা শপ"), "dhaka-shop");
  assert.equal(shared.slugify("Aarong Style"), "aarong-style");
  const options = shared.alternatives("আমার দোকান");
  assert.equal(options.length, 3);
  options.forEach((name) => assert.equal(shared.validate(name).ok, true));
});

test("full address uses the platform domain from config", () => {
  assert.equal(shared.fullAddress("amar-dokan", "amarbazaar.bd"), "amar-dokan.amarbazaar.bd");
  assert.equal(shared.fullAddress("amar-dokan", ""), "");
});

/* ------------------------------------------------------------------ API */

test("a free name is available and the response never lists names", async () => {
  const res = await check("amar-dokan");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { available: true, reason: null });
});

test("invalid and reserved names carry a coarse reason", async () => {
  assert.deepEqual((await check("ab")).body, { available: false, reason: "invalid" });
  assert.deepEqual((await check("amar--dokan")).body, { available: false, reason: "invalid" });
  assert.deepEqual((await check("admin")).body, { available: false, reason: "reserved" });
  assert.deepEqual((await check("SuperAdmin")).body, { available: false, reason: "reserved" });
});

test("the reserved list comes from platform settings when set", async () => {
  await Settings.create({ key: "reservedSlugs", value: "mybrand\nanother-name" });
  assert.deepEqual((await check("mybrand")).body, { available: false, reason: "reserved" });
  assert.deepEqual((await check("another-name")).body, { available: false, reason: "reserved" });
  assert.deepEqual((await check("admin")).body, { available: true, reason: null });
});

test("a saved reserved list is normalized and each entry is validated", async () => {
  const saved = await saveReservedSlugs("My-Brand, another");
  assert.deepEqual(saved, ["my-brand", "another"]);
  assert.deepEqual((await check("my-brand")).body, { available: false, reason: "reserved" });
  await assert.rejects(
    () => saveReservedSlugs(["fine-name", "bad name!"]),
    (err) => err.status === 400
  );
  // a rejected save must not replace the previous list
  assert.deepEqual(await getReservedSlugs(), ["my-brand", "another"]);
});

test("taken covers slug, subdomain and verified custom-domain labels", async () => {
  await makeStore("amar-dokan");
  await makeStore("shop-two", { subdomain: "two" });
  await makeStore("shop-three", { customDomain: "dukan-bd.com", customDomainStatus: "verified" });
  await makeStore("shop-four", { customDomain: "pending-one.com", customDomainStatus: "pending" });

  assert.deepEqual((await check("amar-dokan")).body, { available: false, reason: "taken" });
  assert.deepEqual((await check("two")).body, { available: false, reason: "taken" });
  assert.deepEqual((await check("dukan-bd")).body, { available: false, reason: "taken" });
  assert.deepEqual((await check("pending-one")).body, { available: true, reason: null });
});

test("suspended and soft-deleted stores keep their address", async () => {
  await makeStore("paused-shop", { status: "suspended" });
  await makeStore("gone-shop", { deletedAt: new Date() });
  assert.deepEqual((await check("paused-shop")).body, { available: false, reason: "taken" });
  assert.deepEqual((await check("gone-shop")).body, { available: false, reason: "taken" });
});

test("quarantined slugs stay unavailable until the 90 days pass", async () => {
  const store = await makeStore("old-shop");
  const now = Date.now();
  await SlugHistory.create({
    slug: "quarantined-shop",
    store: store._id,
    kind: "renamed",
    replacedBySlug: "new-shop",
    releasedAt: new Date(now),
    quarantineUntil: new Date(now + 90 * 24 * 3600 * 1000),
  });
  await SlugHistory.create({
    slug: "expired-shop",
    store: store._id,
    kind: "released",
    releasedAt: new Date(now - 200 * 24 * 3600 * 1000),
    quarantineUntil: new Date(now - 110 * 24 * 3600 * 1000),
  });

  assert.deepEqual((await check("quarantined-shop")).body, { available: false, reason: "taken" });
  assert.deepEqual((await check("expired-shop")).body, { available: true, reason: null });
});

test("case and unicode lookalikes hit the same taken address", async () => {
  await makeStore("bangla-shop");
  assert.deepEqual((await check("BANGLA-SHOP")).body, { available: false, reason: "taken" });
  assert.deepEqual((await check("bаngla-shop")).body, { available: false, reason: "taken" }); // Cyrillic а
});

test("the public check is rate limited per IP", async () => {
  for (let i = 0; i < 30; i += 1) {
    const res = await check("free-name-" + i);
    assert.equal(res.status, 200);
  }
  const blocked = await check("free-name-30");
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers["retry-after"]) >= 1);
});

/* -------------------------------------------------------------- creation */

test("assertShopName rejects reserved and taken names with http codes", async () => {
  await makeStore("taken-one");
  await assert.rejects(() => assertShopName("admin"), (err) => err.status === 400 && err.code === "slug_reserved");
  await assert.rejects(() => assertShopName("ab"), (err) => err.status === 400 && err.code === "slug_invalid");
  await assert.rejects(() => assertShopName("taken-one"), (err) => err.status === 409 && err.code === "slug_taken");
  assert.equal(await assertShopName("Free-Shop"), "free-shop");
});

test("two simultaneous creations of one address: one succeeds, one gets 409", async () => {
  const ownerA = new mongoose.Types.ObjectId();
  const ownerB = new mongoose.Types.ObjectId();
  const attempt = (ownerId) =>
    createStoreWithSubscription({
      ownerId,
      name: "Race Shop",
      slug: "race-shop",
      plan: state.plan,
      strictSlug: true,
    });

  const results = await Promise.allSettled([attempt(ownerA), attempt(ownerB)]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.status, 409);
  assert.equal(rejected[0].reason.code, "slug_taken");
  assert.equal(await Store.countDocuments({ slug: "race-shop" }), 1);
});
