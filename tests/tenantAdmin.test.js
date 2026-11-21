process.env.PLATFORM_DOMAIN = "amarbazaar.bd";
process.env.JWT_SECRET = "tenant-admin-secret";
process.env.APP_MODE = "saas";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Store = require("../models/Store");
const Plan = require("../models/Plan");
const Settings = require("../models/Settings");
const { auth, requireAdmin } = require("../middleware/auth");

const state = {};

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("tenant_admin"));
  await Promise.all([User.init(), Store.init(), Plan.init(), Settings.init()]);

  const hash = await bcrypt.hash("secret123", 4);
  state.ownerA = await User.create({ name: "Owner A", email: "a@example.com", password: hash, role: "admin" });
  state.ownerB = await User.create({ name: "Owner B", email: "b@example.com", password: hash, role: "admin" });
  state.root = await User.create({ name: "Root", email: "root@example.com", password: hash, role: "superadmin" });
  state.shopper = await User.create({ name: "Shopper", email: "c@example.com", password: hash, role: "customer" });
  // self-serve owner: registered after the first account, so the role stayed "customer"
  state.selfOwner = await User.create({ name: "Self Owner", email: "self@example.com", password: hash, role: "customer" });

  state.planOn = await Plan.create({
    name: "White label",
    slug: "white",
    price: 0,
    features: { whiteLabelAdmin: true },
  });
  state.planOff = await Plan.create({
    name: "Basic",
    slug: "basic",
    price: 0,
    features: { whiteLabelAdmin: false },
  });

  state.storeA = await Store.create({ name: "Dokan A", slug: "shop-a", owner: state.ownerA._id, plan: state.planOn._id });
  state.storeB = await Store.create({ name: "Dokan B", slug: "shop-b", owner: state.ownerB._id, plan: state.planOn._id });
  state.storeC = await Store.create({
    name: "Ongkur",
    slug: "ongkur",
    owner: state.ownerA._id,
    plan: state.planOn._id,
    customDomain: "ongkurbd.com",
    customDomainStatus: "verified",
  });
  state.storeOff = await Store.create({ name: "Plain", slug: "shop-off", owner: state.ownerB._id, plan: state.planOff._id });
  state.storeSelf = await Store.create({ name: "Self Dokan", slug: "shop-self", owner: state.selfOwner._id, plan: state.planOn._id });
  state.storeRoot = await Store.create({ name: "Root Dokan", slug: "shop-root", owner: state.root._id, plan: state.planOn._id });

  state.app = express();
  state.app.use(express.json());
  state.app.use("/api/public", require("../routes/publicApi"));
  // a route mounted before tenant resolution, like /api/public/*
  state.app.get("/pre/check", auth, (req, res) => res.json({ ok: true }));
  state.app.use(require("../middleware/tenant"));
  state.app.use("/api/auth", require("../routes/auth"));
  state.app.get("/api/tenant-check", auth, requireAdmin, (req, res) => {
    res.json({ ok: true, store: String(req.store._id) });
  });
  state.app.post("/api/tenant-check", auth, requireAdmin, (req, res) => {
    res.json({ ok: true, store: String(req.store._id) });
  });
  state.app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

const HOST_A = "shop-a.amarbazaar.bd";
const HOST_B = "shop-b.amarbazaar.bd";
const HOST_CUSTOM = "ongkurbd.com";

function post(path, host, body) {
  return request(state.app).post(path).set("Host", host).send(body);
}

function login(host, identifier, extra) {
  return post("/api/auth/tenant-login", host, { identifier, password: "secret123" })
    .set(extra || {});
}

function cookieHeader(res) {
  const rows = res.headers["set-cookie"] || [];
  const session = rows.find((row) => row.startsWith("tnt_session="));
  const csrf = rows.find((row) => row.startsWith("tnt_csrf="));
  assert.ok(session, "tnt_session cookie missing");
  assert.ok(csrf, "tnt_csrf cookie missing");
  const sessionPair = session.split(";")[0];
  const csrfPair = csrf.split(";")[0];
  return {
    session,
    csrf,
    header: sessionPair + "; " + csrfPair,
    csrfValue: decodeURIComponent(csrfPair.slice("tnt_csrf=".length)),
  };
}

test("tenant meta answers from the shop host and leaks no secrets", async () => {
  const res = await request(state.app).get("/api/public/tenant-meta").set("Host", HOST_A);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.store.name, "Dokan A");
  assert.equal(res.body.whiteLabelAdmin, true);
  assert.equal(res.body.suspended, false);
  const raw = JSON.stringify(res.body);
  ["password", "owner", "domainToken", "JWT_SECRET", "a@example.com"].forEach((needle) => {
    assert.equal(raw.includes(needle), false, needle + " leaked into tenant meta");
  });
});

test("custom domain host resolves too, and removing the domain closes the panel", async () => {
  const ok = await request(state.app).get("/api/public/tenant-meta").set("Host", HOST_CUSTOM);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.store.name, "Ongkur");

  const signed = await login(HOST_CUSTOM, "a@example.com");
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  const jar = cookieHeader(signed);
  const before = await request(state.app).get("/pre/check").set("Host", HOST_CUSTOM).set("Cookie", jar.header);
  assert.equal(before.status, 200, JSON.stringify(before.body));

  await Store.updateOne({ _id: state.storeC._id }, { $unset: { customDomain: 1 }, $set: { customDomainStatus: "none" } });
  const gone = await request(state.app).get("/api/public/tenant-meta").set("Host", HOST_CUSTOM);
  assert.equal(gone.status, 404);
  const apiGone = await request(state.app).get("/pre/check").set("Host", HOST_CUSTOM).set("Cookie", jar.header);
  assert.equal(apiGone.status, 401);

  await Store.updateOne(
    { _id: state.storeC._id },
    { $set: { customDomain: "ongkurbd.com", customDomainStatus: "verified" } }
  );
});

test("unknown host and feature-off stores have no tenant panel", async () => {
  const unknown = await request(state.app).get("/api/public/tenant-meta").set("Host", "nope.amarbazaar.bd");
  assert.equal(unknown.status, 404);

  const off = await request(state.app).get("/api/public/tenant-meta").set("Host", "shop-off.amarbazaar.bd");
  assert.equal(off.status, 403);
  assert.equal(off.body.code, "feature_locked");

  const loginOff = await login("shop-off.amarbazaar.bd", "b@example.com");
  assert.equal(loginOff.status, 403);
});

test("owner signs in on their own host with a host-only httpOnly cookie", async () => {
  const res = await login(HOST_A, "a@example.com", { "X-Forwarded-Proto": "https" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.user.email, "a@example.com");
  assert.equal(res.body.token, undefined, "token must stay out of the body");

  const { session, csrf } = cookieHeader(res);
  assert.match(session, /HttpOnly/);
  assert.match(session, /SameSite=Lax/);
  assert.match(session, /Secure/);
  assert.match(session, /Path=\//);
  assert.doesNotMatch(session, /Domain=/);
  assert.doesNotMatch(csrf, /HttpOnly/);

  const jwt = require("jsonwebtoken");
  const payload = jwt.verify(session.match(/tnt_session=([^;]+)/)[1], process.env.JWT_SECRET);
  assert.equal(String(payload.tnt), String(state.storeA._id));
  assert.equal(payload.role, "admin");
});

test("another store's owner, the superadmin and customers get one generic denial", async () => {
  const other = await login(HOST_A, "b@example.com");
  assert.equal(other.status, 401);
  assert.equal(other.body.message, "লগইন তথ্য সঠিক নয়");

  const root = await login(HOST_A, "root@example.com");
  assert.equal(root.status, 401);
  assert.equal(root.body.message, "লগইন তথ্য সঠিক নয়");

  const shopper = await login(HOST_A, "c@example.com");
  assert.equal(shopper.status, 401);
  assert.equal(shopper.body.message, "লগইন তথ্য সঠিক নয়");
});

test("a self-serve owner still marked customer signs in; a superadmin-owned store does not", async () => {
  const self = await login("shop-self.amarbazaar.bd", "self@example.com");
  assert.equal(self.status, 200, JSON.stringify(self.body));
  assert.equal(self.body.user.role, "customer");
  const jar = cookieHeader(self);
  const check = await request(state.app)
    .get("/api/tenant-check")
    .set("Host", "shop-self.amarbazaar.bd")
    .set("Cookie", jar.header);
  assert.equal(check.status, 200, JSON.stringify(check.body));
  assert.equal(check.body.store, String(state.storeSelf._id));

  const rootOwned = await login("shop-root.amarbazaar.bd", "root@example.com");
  assert.equal(rootOwned.status, 401);
});

test("cookie session needs the CSRF header for writes and is bound to one store", async () => {
  const res = await login(HOST_A, "a@example.com");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const jar = cookieHeader(res);

  const read = await request(state.app).get("/api/tenant-check").set("Host", HOST_A).set("Cookie", jar.header);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(read.body.store, String(state.storeA._id));

  const noCsrf = await request(state.app).post("/api/tenant-check").set("Host", HOST_A).set("Cookie", jar.header).send({});
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.body.code, "csrf_failed");

  const withCsrf = await request(state.app)
    .post("/api/tenant-check")
    .set("Host", HOST_A)
    .set("Cookie", jar.header)
    .set("x-csrf-token", jar.csrfValue)
    .send({});
  assert.equal(withCsrf.status, 200, JSON.stringify(withCsrf.body));

  const wrongStore = await request(state.app).get("/api/tenant-check").set("Host", HOST_B).set("Cookie", jar.header);
  assert.equal(wrongStore.status, 401);
});

test("a suspended store still shows meta and allows the owner in to pay", async () => {
  await Store.updateOne({ _id: state.storeA._id }, { $set: { status: "suspended" } });
  const meta = await request(state.app).get("/api/public/tenant-meta").set("Host", HOST_A);
  assert.equal(meta.status, 200, JSON.stringify(meta.body));
  assert.equal(meta.body.suspended, true);

  const res = await login(HOST_A, "a@example.com");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.suspended, true);

  await Store.updateOne({ _id: state.storeA._id }, { $set: { status: "active" } });
});

test("logout clears both cookies", async () => {
  const res = await request(state.app).post("/api/auth/tenant-logout");
  assert.equal(res.status, 200);
  const rows = res.headers["set-cookie"] || [];
  assert.ok(rows.some((row) => row.startsWith("tnt_session=;")), "session cookie cleared");
  assert.ok(rows.some((row) => row.startsWith("tnt_csrf=;")), "csrf cookie cleared");
});
