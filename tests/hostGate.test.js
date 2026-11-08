process.env.PLATFORM_DOMAIN = "amarbazaar.bd";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Settings = require("../models/Settings");
const hostGate = require("../middleware/hostGate");
const { classifyHost } = require("../lib/hostKind");

const state = {};

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("host_gate"));
  await Settings.init();

  state.app = express();
  state.app.use(hostGate);
  state.app.use((req, res) => res.status(200).json({ path: req.path }));
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

function get(path, host) {
  return request(state.app).get(path).set("Host", host);
}

test("host classification splits platform, panel, shop and local", () => {
  assert.equal(classifyHost("amarbazaar.bd", "amarbazaar.bd"), "platform");
  assert.equal(classifyHost("www.amarbazaar.bd", "amarbazaar.bd"), "platform");
  assert.equal(classifyHost("api.amarbazaar.bd", "amarbazaar.bd"), "panel");
  assert.equal(classifyHost("admin.amarbazaar.bd", "amarbazaar.bd"), "panel");
  assert.equal(classifyHost("shop1.amarbazaar.bd", "amarbazaar.bd"), "store");
  assert.equal(classifyHost("dokan.example.com", "amarbazaar.bd"), "store");
  assert.equal(classifyHost("localhost", "amarbazaar.bd"), "local");
  assert.equal(classifyHost("185.182.185.238", "amarbazaar.bd"), "local");
  assert.equal(classifyHost("shop.amarbazaar.bd", ""), "local");
});

test("api host only serves the platform admin pages", async () => {
  const root = await get("/", "api.amarbazaar.bd");
  assert.equal(root.status, 302);
  assert.equal(root.headers.location, "/admin-login.html");

  assert.equal((await get("/admin-login.html", "api.amarbazaar.bd")).status, 200);
  assert.equal((await get("/admin.html", "api.amarbazaar.bd")).status, 200);
  assert.equal((await get("/dashboard.html", "api.amarbazaar.bd")).status, 404);
  assert.equal((await get("/portal.html", "api.amarbazaar.bd")).status, 404);
  assert.equal((await get("/login.html", "api.amarbazaar.bd")).status, 404);
  // panel assets must still load
  assert.equal((await get("/css/style.css", "api.amarbazaar.bd")).status, 200);
});

test("platform host keeps the landing and the superadmin's store links reachable", async () => {
  assert.equal((await get("/", "amarbazaar.bd")).status, 200);
  assert.equal((await get("/login.html", "amarbazaar.bd")).status, 200);
  assert.equal((await get("/portal.html", "amarbazaar.bd")).status, 200);
  assert.equal((await get("/admin-login.html", "amarbazaar.bd")).status, 200);
  // superadmin opens a shop dashboard from the platform host
  assert.equal((await get("/dashboard.html", "amarbazaar.bd")).status, 200);
  assert.equal((await get("/settings.html", "amarbazaar.bd")).status, 200);
});

test("shop and local hosts are not gated", async () => {
  assert.equal((await get("/dashboard.html", "shop1.amarbazaar.bd")).status, 200);
  assert.equal((await get("/settings.html", "shop1.amarbazaar.bd")).status, 200);
  assert.equal((await get("/dashboard.html", "localhost")).status, 200);
});
