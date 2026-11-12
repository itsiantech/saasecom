process.env.PLATFORM_DOMAIN = "";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Store = require("../models/Store");
const Settings = require("../models/Settings");
const publicStore = require("../middleware/publicStore");

const state = {};
const owner = new mongoose.Types.ObjectId();
const plan = new mongoose.Types.ObjectId();

function makeStore(slug, extra = {}) {
  return Store.create({ name: slug, slug, owner, plan, ...extra });
}

async function storeRow(slug) {
  const res = await request(state.app).get("/api/public/identity").set("Host", slug + ".amarbazaar.bd");
  return res;
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("shop_host"));
  await Settings.init();
  await Settings.create({ key: "platformDomain", value: "amarbazaar.bd" });

  // the shopper-facing address is Store.slug — no subdomain field needed
  await makeStore("tara-mart");
  // legacy shops keep their custom subdomain as an alias of a different slug
  await makeStore("other-slug", { subdomain: "dokan" });
  // ambiguous pair (should not happen, but slug must win deterministically)
  await makeStore("alias-slug", { subdomain: "shared" });
  await makeStore("shared");
  await makeStore("closed", { status: "suspended" });
  await makeStore("trashed", { deletedAt: new Date() });
  await makeStore("owned", { customDomain: "shop.example.com", customDomainStatus: "verified" });
  await makeStore("pending", { customDomain: "pending.example.com", customDomainStatus: "pending" });

  state.app = express();
  state.app.use("/api/public", publicStore, (req, res) => res.json({ slug: req.publicStore.slug }));
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("a shop subdomain resolves Store.slug (no subdomain field)", async () => {
  const res = await storeRow("tara-mart");
  assert.equal(res.status, 200);
  assert.equal(res.body.slug, "tara-mart");
});

test("a legacy subdomain still resolves its shop", async () => {
  const res = await storeRow("dokan");
  assert.equal(res.status, 200);
  assert.equal(res.body.slug, "other-slug");
});

test("slug wins when a subdomain collides with another shop's address", async () => {
  const res = await storeRow("shared");
  assert.equal(res.status, 200);
  assert.equal(res.body.slug, "shared");
});

test("a verified custom domain resolves and a pending one does not", async () => {
  const ok = await request(state.app).get("/api/public/identity").set("Host", "shop.example.com");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.slug, "owned");

  const pending = await request(state.app).get("/api/public/identity").set("Host", "pending.example.com");
  assert.equal(pending.status, 404);
});

test("an unknown subdomain is a friendly 404, not another shop", async () => {
  const res = await storeRow("nope");
  assert.equal(res.status, 404);
  assert.match(res.body.message, /dokan nei/i);
});

test("suspended shops answer 403 and trashed shops 404", async () => {
  const suspended = await storeRow("closed");
  assert.equal(suspended.status, 403);

  const trashed = await storeRow("trashed");
  assert.equal(trashed.status, 404);
});

test("the x-store-slug header (Next proxy) and ?store= (dev fallback) still work", async () => {
  const viaHeader = await request(state.app)
    .get("/api/public/identity")
    .set("Host", "127.0.0.1:3000")
    .set("x-store-slug", "tara-mart");
  assert.equal(viaHeader.status, 200);
  assert.equal(viaHeader.body.slug, "tara-mart");

  const viaQuery = await request(state.app)
    .get("/api/public/identity?store=tara-mart")
    .set("Host", "127.0.0.1:3000");
  assert.equal(viaQuery.status, 200);
  assert.equal(viaQuery.body.slug, "tara-mart");

  // the Next server derives the label from the URL and sends it as a slug hint,
  // so a legacy subdomain must resolve through this path too
  const alias = await request(state.app)
    .get("/api/public/identity")
    .set("Host", "127.0.0.1:3000")
    .set("x-store-slug", "dokan");
  assert.equal(alias.status, 200);
  assert.equal(alias.body.slug, "other-slug");
});

test("x-store-domain with a platform subdomain resolves the slug label", async () => {
  const res = await request(state.app)
    .get("/api/public/identity")
    .set("Host", "127.0.0.1:3000")
    .set("x-store-domain", "tara-mart.amarbazaar.bd");
  assert.equal(res.status, 200);
  assert.equal(res.body.slug, "tara-mart");
});
