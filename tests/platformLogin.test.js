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

test("five bad passwords lock the account for a while", async () => {
  const hash = await bcrypt.hash("correct123", 4);
  const locked = await User.create({
    name: "Locked",
    email: "lock@example.com",
    password: hash,
    role: "customer",
  });

  for (let i = 0; i < 5; i += 1) {
    const bad = await post("/api/auth/login", "localhost", {
      email: "lock@example.com",
      password: "wrong123",
    });
    assert.equal(bad.status, 401, JSON.stringify(bad.body));
  }

  const row = await User.findById(locked._id).lean();
  assert.ok(row.lockedUntil && new Date(row.lockedUntil) > new Date());

  const blocked = await post("/api/auth/login", "localhost", {
    email: "lock@example.com",
    password: "correct123",
  });
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.message, /minute/);

  // An unlocked account can log in again.
  await User.updateOne({ _id: locked._id }, { $set: { lockedUntil: null, failedLoginAttempts: 0 } });
  const again = await post("/api/auth/login", "localhost", {
    email: "lock@example.com",
    password: "correct123",
  });
  assert.equal(again.status, 200, JSON.stringify(again.body));
});

test("registration refuses weak passwords", async () => {
  const short = await post("/api/auth/register", "localhost", {
    name: "Weak",
    email: "weak@example.com",
    password: "abc1",
  });
  assert.equal(short.status, 400);
  assert.match(short.body.message, /8 character/);

  const lettersOnly = await post("/api/auth/register", "localhost", {
    name: "Weak",
    email: "weak@example.com",
    password: "abcdefgh",
  });
  assert.equal(lettersOnly.status, 400);
  assert.match(lettersOnly.body.message, /letter ar number/);
});
