process.env.PLATFORM_DOMAIN = "amarbazaar.bd";
process.env.JWT_SECRET = "platform-login-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Settings = require("../models/Settings");

const state = {};

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("platform_login"));
  await Promise.all([User.init(), Settings.init()]);

  state.hash = await bcrypt.hash("secret123", 4);
  await User.create({ name: "Root", email: "root@example.com", password: state.hash, role: "superadmin" });
  await User.create({ name: "Owner", email: "owner@example.com", password: state.hash, role: "admin" });

  state.app = express();
  state.app.use(express.json());
  state.app.use("/api/auth", require("../routes/auth"));
  state.app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

function post(path, host, body) {
  return request(state.app).post(path).set("Host", host).send(body);
}

test("platform login accepts only the superadmin account", async () => {
  const ok = await post("/api/auth/platform-login", "api.amarbazaar.bd", {
    email: "root@example.com",
    password: "secret123",
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.user.role, "superadmin");
  assert.ok(ok.body.token);

  const owner = await post("/api/auth/platform-login", "api.amarbazaar.bd", {
    email: "owner@example.com",
    password: "secret123",
  });
  assert.equal(owner.status, 401);

  const wrong = await post("/api/auth/platform-login", "api.amarbazaar.bd", {
    email: "root@example.com",
    password: "nope",
  });
  assert.equal(wrong.status, 401);
});

test("platform login is refused on a shop host", async () => {
  const res = await post("/api/auth/platform-login", "shop1.amarbazaar.bd", {
    email: "root@example.com",
    password: "secret123",
  });
  assert.equal(res.status, 403);
});

test("store login refuses superadmin on a shop host but allows owners", async () => {
  const superOnShop = await post("/api/auth/login", "shop1.amarbazaar.bd", {
    email: "root@example.com",
    password: "secret123",
  });
  assert.equal(superOnShop.status, 403);

  const owner = await post("/api/auth/login", "shop1.amarbazaar.bd", {
    email: "owner@example.com",
    password: "secret123",
  });
  assert.equal(owner.status, 200, JSON.stringify(owner.body));
  assert.equal(owner.body.user.role, "admin");
});

test("local dev still allows the superadmin through the normal login", async () => {
  const res = await post("/api/auth/login", "localhost", {
    email: "root@example.com",
    password: "secret123",
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.role, "superadmin");
});
