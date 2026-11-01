process.env.JWT_SECRET = "platform-billing-test-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Settings = require("../models/Settings");
const Subscription = require("../models/Subscription");
const PlatformPayment = require("../models/PlatformPayment");
const PlatformCounter = require("../models/PlatformCounter");
const billing = require("../lib/platformBilling");

const state = {};
const DAY = 24 * 60 * 60 * 1000;

function bearer(user) {
  return "Bearer " + jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function send(path, method, user, body) {
  let req = request(state.app)[method](path);
  if (user) req = req.set("Authorization", bearer(user));
  return body === undefined ? req : req.send(body);
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("platform_billing"));

  await Promise.all([
    Plan.init(),
    Store.init(),
    User.init(),
    Settings.init(),
    Subscription.init(),
    PlatformPayment.init(),
    PlatformCounter.init(),
  ]);

  state.owner = await User.create({ name: "Owner", email: "owner@bill.test", role: "customer" });
  state.other = await User.create({ name: "Other", email: "other@bill.test", role: "customer" });
  state.admin = await User.create({ name: "Root", email: "root@bill.test", role: "superadmin" });

  state.free = await Plan.create({ name: "Free", slug: "free", price: 0, durationDays: 30 });
  state.pro = await Plan.create({ name: "Pro", slug: "pro", price: 990, durationDays: 30, trialDays: 0 });

  state.app = express();
  state.app.use(express.json());
  state.app.use("/api/billing", require("../routes/billing"));
  state.app.use("/api/admin", require("../routes/admin"));
  state.app.use("/api/stores", require("../routes/stores"));
}, { timeout: 180000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("checkout sees no method until the admin configures one", async () => {
  const res = await send("/api/billing/methods", "get");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.methods, []);
});

test("admin settings are saved, secrets masked, and masked values keep the stored key", async () => {
  const saved = await send("/api/admin/billing/settings", "put", state.admin, {
    settings: {
      manualEnabled: true,
      bkash: { enabled: true, number: "01711111111", accountName: "LUXE" },
      nagad: { enabled: true, number: "" },
      api: { enabled: true, provider: "bkash", publicKey: "pk_live_abcd", secretKey: "sk_live_wxyz", sandbox: false },
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.settings.api.publicKey, "••••abcd");
  assert.equal(saved.body.settings.api.secretKey, "••••wxyz");

  // UI sends the masked values back unchanged → stored secret must survive
  const again = await send("/api/admin/billing/settings", "put", state.admin, { settings: saved.body.settings });
  assert.equal(again.status, 200);
  const stored = await billing.loadSettings();
  assert.equal(stored.api.secretKey, "sk_live_wxyz");
  assert.equal(stored.api.sandbox, false);

  const denied = await send("/api/admin/billing/settings", "get", state.owner);
  assert.equal(denied.status, 403);
});

test("public methods list enabled + complete methods only", async () => {
  const res = await send("/api/billing/methods", "get");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.methods.map((m) => m.id), ["bkash"]);
  assert.equal(res.body.methods[0].number, "01711111111");
  assert.ok(!JSON.stringify(res.body).includes("sk_live_wxyz"));
});

test("payment submission validates method, phone and TRXID", async () => {
  const noMethod = await send("/api/billing/payments", "post", state.owner, { planSlug: "pro", trxid: "TRX12345" });
  assert.equal(noMethod.status, 400);

  const offMethod = await send("/api/billing/payments", "post", state.owner, {
    planSlug: "pro", method: "nagad", senderNumber: "01712345678", trxid: "TRX12345", storeName: "X", storeSlug: "x-shop",
  });
  assert.equal(offMethod.status, 400);

  const badPhone = await send("/api/billing/payments", "post", state.owner, {
    planSlug: "pro", method: "bkash", senderNumber: "12345", trxid: "TRX12345", storeName: "X", storeSlug: "x-shop",
  });
  assert.equal(badPhone.status, 400);

  const badSlug = await send("/api/billing/payments", "post", state.owner, {
    planSlug: "pro", method: "bkash", senderNumber: "01712345678", trxid: "TRX12345", storeName: "X", storeSlug: "AP",
  });
  assert.equal(badSlug.status, 400);
});

test("a paid store cannot be created without an approved payment", async () => {
  const res = await send("/api/stores", "post", state.owner, { name: "Sneaky", slug: "sneaky-shop", planSlug: "pro" });
  assert.equal(res.status, 402);
  assert.equal(res.body.requiresPayment, true);
  assert.equal(await Store.countDocuments({ slug: "sneaky-shop" }), 0);
});

test("a pending payment creates an invoice with server-side amount", async () => {
  const res = await send("/api/billing/payments", "post", state.owner, {
    planSlug: "pro",
    planPrice: 1,
    method: "bkash",
    senderNumber: "01712345678",
    trxid: "TRX80001",
    storeName: "Blue Shop",
    storeSlug: "blue-shop",
  });
  assert.equal(res.status, 201);
  state.payment = res.body.payment;

  assert.equal(state.payment.amount, 990); // plan price wins over any client value
  assert.match(state.payment.invoiceNo, /^INV-\d{4}-0001$/);
  assert.equal(state.payment.status, "pending");
  assert.ok(state.payment.invoiceUrl.includes("token="));
  assert.ok(new Date(state.payment.nextDueDate) - Date.now() > 29 * DAY);
  assert.equal(await Store.countDocuments({ slug: "blue-shop" }), 0);
});

test("the same TRXID cannot be claimed twice", async () => {
  const res = await send("/api/billing/payments", "post", state.other, {
    planSlug: "pro", method: "bkash", senderNumber: "01812345678", trxid: "trx80001",
    storeName: "Copy Shop", storeSlug: "copy-shop",
  });
  assert.equal(res.status, 409);
  assert.match(res.body.message, /TRXID/);
});

test("one pending payment per user at a time", async () => {
  const res = await send("/api/billing/payments", "post", state.owner, {
    planSlug: "pro", method: "bkash", senderNumber: "01712345678", trxid: "TRX80002",
    storeName: "Second Shop", storeSlug: "second-shop",
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.payment.id, state.payment.id);
});

test("invoice opens with its signed link but not anonymously", async () => {
  const ok = await request(state.app).get(state.payment.invoiceUrl);
  assert.equal(ok.status, 200);
  assert.match(ok.text, /INV-\d{4}-0001/);
  assert.ok(ok.text.includes("Blue Shop"));

  const denied = await request(state.app).get("/api/billing/payments/" + state.payment.id + "/invoice");
  assert.equal(denied.status, 403);
});

test("admin approval creates the store and a paid subscription exactly once", async () => {
  const res = await send("/api/admin/billing/payments/" + state.payment.id + "/approve", "put", state.admin);
  assert.equal(res.status, 200);
  assert.equal(res.body.payment.status, "approved");
  assert.equal(res.body.storeSlug, "blue-shop");
  assert.equal(res.body.slugAdjusted, false);

  const store = await Store.findOne({ slug: "blue-shop" });
  assert.ok(store);
  assert.equal(String(store.owner), String(state.owner._id));
  assert.equal(String(store.plan), String(state.pro._id));

  const sub = await Subscription.findOne({ store: store._id });
  assert.equal(sub.status, "active");
  assert.equal(sub.lastPaymentAt instanceof Date, true);
  assert.ok(Math.abs(sub.endDate.getTime() - Date.now() - 30 * DAY) < 60 * 1000);

  const again = await send("/api/admin/billing/payments/" + state.payment.id + "/approve", "put", state.admin);
  assert.equal(again.status, 409);
  assert.equal(await Store.countDocuments({ slug: "blue-shop" }), 1);
});

test("upgrade payment for an existing store, rejection frees the TRXID", async () => {
  const store = await Store.findOne({ slug: "blue-shop" });
  const made = await send("/api/billing/payments", "post", state.owner, {
    planSlug: "pro", method: "bkash", senderNumber: "01712345678", trxid: "TRX80003", storeId: String(store._id),
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.payment.kind, "existing");
  assert.notEqual(made.body.payment.invoiceNo, state.payment.invoiceNo);

  const id = made.body.payment.id;
  const noReason = await send("/api/admin/billing/payments/" + id + "/reject", "put", state.admin, { reason: "" });
  assert.equal(noReason.status, 400);

  const rejected = await send("/api/admin/billing/payments/" + id + "/reject", "put", state.admin, { reason: "টাকা পাওয়া যায়নি" });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.payment.status, "rejected");

  const row = await PlatformPayment.findById(id);
  assert.equal(row.trxKey, undefined);

  // rejected claim no longer blocks the same TRXID
  const retry = await send("/api/billing/payments", "post", state.owner, {
    planSlug: "pro", method: "bkash", senderNumber: "01712345678", trxid: "TRX80003", storeId: String(store._id),
  });
  assert.equal(retry.status, 201);

  // leaving it pending would block the next test's user? different user → fine
  const sub = await Subscription.findOne({ store: store._id });
  assert.ok(sub.endDate.getTime() - Date.now() > 29 * DAY);
});

test("a slug taken between checkout and approval is adjusted, not lost", async () => {
  const made = await send("/api/billing/payments", "post", state.other, {
    planSlug: "pro", method: "bkash", senderNumber: "01812345678", trxid: "TRX80010",
    storeName: "Race Shop", storeSlug: "race-shop",
  });
  assert.equal(made.status, 201);

  // someone else grabs the slug while the payment is waiting
  await Store.create({ name: "Rival", slug: "race-shop", owner: state.owner._id, plan: state.free._id });

  const res = await send("/api/admin/billing/payments/" + made.body.payment.id + "/approve", "put", state.admin);
  assert.equal(res.status, 200);
  assert.equal(res.body.slugAdjusted, true);
  assert.equal(res.body.storeSlug, "race-shop-2");

  const row = await PlatformPayment.findById(made.body.payment.id);
  assert.equal(row.storeSlug, "race-shop-2");
  assert.equal(row.slugAdjusted, true);
});

test("admin list filters by status and carries invoice links", async () => {
  const res = await send("/api/admin/billing/payments?status=approved", "get", state.admin);
  assert.equal(res.status, 200);
  assert.ok(res.body.counts.approved >= 2);
  assert.ok(res.body.payments.length >= 2);
  for (const row of res.body.payments) {
    assert.equal(row.status, "approved");
    assert.ok(row.invoiceUrl.includes("token="));
    assert.ok(row.user && row.user.email);
  }

  const search = await send("/api/admin/billing/payments?q=blue-shop", "get", state.admin);
  assert.equal(search.status, 200);
  assert.ok(search.body.payments.every((row) => row.storeName.toLowerCase().includes("blue") || row.storeSlug.includes("blue")));

  const denied = await send("/api/admin/billing/payments", "get", state.owner);
  assert.equal(denied.status, 403);
});

test("invoice numbers keep incrementing per year", async () => {
  const rows = await PlatformPayment.find({}).sort({ createdAt: -1 });
  const seen = new Set(rows.map((r) => r.invoiceNo));
  assert.equal(seen.size, rows.length); // no duplicate numbers
  assert.ok(rows.every((r) => /^INV-\d{4}-\d{4}$/.test(r.invoiceNo)));
});
