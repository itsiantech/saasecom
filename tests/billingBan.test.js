process.env.JWT_SECRET = "billing-ban-test-secret";
process.env.APP_URL = "https://platform.test";
delete process.env.BILLING_AUTO_SUSPEND;
delete process.env.BILLING_SUSPEND_AFTER_DAYS;

const { test, before, after, beforeEach } = require("node:test");
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
const BillingNotification = require("../models/BillingNotification");
const billing = require("../lib/platformBilling");
const { applyPlanToStore } = require("../lib/storeProvisioning");
const { reminderFor, runBillingReminders } = require("../src/jobs/billingCron");

const state = {};
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-20T03:00:00.000Z"); // 09:00 Asia/Dhaka

function daysFrom(now, days) {
  return new Date(now.getTime() + days * DAY);
}

function bearer(user) {
  return "Bearer " + jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function send(path, method, user, body, headers = {}) {
  let req = request(state.app)[method](path);
  if (user) req = req.set("Authorization", bearer(user));
  Object.entries(headers).forEach(([k, v]) => req = req.set(k, v));
  return body === undefined ? req : req.send(body);
}

async function makeStore({ slug, email, status = "active", dueInDays = -12, graceDaysOverride = null }) {
  const owner = await User.create({ name: "Owner " + slug, email, role: "admin" });
  const store = await Store.create({
    name: "Shop " + slug,
    slug,
    owner: owner._id,
    plan: state.plan._id,
    status,
  });
  const sub = await Subscription.create({
    store: store._id,
    plan: state.plan._id,
    status: status === "suspended" ? "suspended" : "active",
    startDate: daysFrom(NOW, -40),
    endDate: daysFrom(NOW, dueInDays),
    nextBillingDate: daysFrom(NOW, dueInDays),
    lastPaymentAt: daysFrom(NOW, -40),
    graceDaysOverride,
    billingSuspendedAt: status === "suspended" ? NOW : null,
    suspendReason: status === "suspended" ? "manual" : "",
  });
  return { owner, store, sub };
}

function fakeEnqueue() {
  const sent = [];
  const fn = async (payload) => {
    sent.push(payload);
    return { queued: true, jobId: "job-" + sent.length };
  };
  fn.sent = sent;
  return fn;
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("billing_ban"));
  await Promise.all([
    Plan.init(),
    Store.init(),
    User.init(),
    Settings.init(),
    Subscription.init(),
    BillingNotification.init(),
  ]);

  state.plan = await Plan.create({ name: "Growth", slug: "growth", price: 1500, durationDays: 30, active: true });
  state.root = await User.create({ name: "Root", email: "root@ban.test", role: "superadmin" });

  state.app = express();
  state.app.use(express.json());
  state.app.use("/api/storefront", require("../routes/storefront"));
  state.app.use(require("../middleware/tenant"));
  state.app.use("/api/admin", require("../routes/admin"));
  state.app.use("/api/subscriptions", require("../routes/subscriptions"));
  state.app.get("/api/protected-ping", (req, res) => res.json({ ok: true, store: String(req.store._id) }));
}, { timeout: 180000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    Store.deleteMany({}),
    User.deleteMany({ email: { $ne: "root@ban.test" } }),
    Subscription.deleteMany({}),
    Settings.deleteMany({}),
    BillingNotification.deleteMany({}),
  ]);
  await billing.saveSettings({ manualEnabled: false, autoBan: false, defaultGraceDays: 7 });
});

test("superadmin sets due date + per-store grace; ban date = due + grace", async () => {
  const { store } = await makeStore({ slug: "term-shop", email: "term@ban.test", dueInDays: 5 });

  const res = await send("/api/admin/stores/" + store._id + "/billing", "put", state.root, {
    dueDate: "2026-12-01",
    graceDays: 10,
    note: "phone e janano",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.billing.graceDays, 10);
  assert.equal(res.body.billing.graceIsOverride, true);
  const ban = new Date(res.body.billing.banDate).toISOString().slice(0, 10);
  assert.ok(ban.startsWith("2026-12-11"), "ban date should be due + 10 days, got " + ban);

  const list = await send("/api/admin/stores", "get", state.root);
  assert.equal(list.status, 200);
  const row = list.body.find((r) => String(r._id) === String(store._id));
  assert.equal(row.billing.graceDays, 10);
  assert.equal(row.billing.graceIsOverride, true);
});

test("billing terms validate grace and date; owners cannot edit them", async () => {
  const { store, owner } = await makeStore({ slug: "valid-shop", email: "valid@ban.test" });

  const badGrace = await send("/api/admin/stores/" + store._id + "/billing", "put", state.root, { graceDays: 91 });
  assert.equal(badGrace.status, 400);

  const badDate = await send("/api/admin/stores/" + store._id + "/billing", "put", state.root, { dueDate: "not-a-date" });
  assert.equal(badDate.status, 400);

  const denied = await send("/api/admin/stores/" + store._id + "/billing", "put", owner, { graceDays: 5 });
  assert.equal(denied.status, 403);

  // empty grace clears the override and falls back to the platform default
  const clear = await send("/api/admin/stores/" + store._id + "/billing", "put", state.root, { graceDays: "" });
  assert.equal(clear.status, 200);
  assert.equal(clear.body.billing.graceIsOverride, false);
  assert.equal(clear.body.billing.graceDays, 7);
});

test("manual ban closes storefront + owner admin; unban restores both", async () => {
  const { store, owner, sub } = await makeStore({ slug: "ban-shop", email: "ban@ban.test" });

  const denied = await send("/api/admin/stores/" + store._id + "/ban", "post", owner, {});
  assert.equal(denied.status, 403);

  const banned = await send("/api/admin/stores/" + store._id + "/ban", "post", state.root, { note: "unpaid" });
  assert.equal(banned.status, 200);
  assert.equal(banned.body.store.status, "suspended");
  assert.equal(banned.body.billing.status, "suspended");

  const freshSub = await Subscription.findById(sub._id);
  assert.equal(freshSub.suspendReason, "manual");
  assert.equal(String(freshSub.suspendedBy), String(state.root._id));
  assert.ok(freshSub.billingSuspendedAt);

  // storefront data is off
  const storefront = await send("/api/storefront/ban-shop", "get");
  assert.equal(storefront.status, 403);
  assert.equal(storefront.body.code, "STORE_SUSPENDED");

  // owner admin APIs are locked with a stable code
  const ping = await send("/api/protected-ping", "get", owner, undefined, { "x-store-slug": "ban-shop" });
  assert.equal(ping.status, 403);
  assert.equal(ping.body.code, "STORE_SUSPENDED");

  // the payment/billing allowlist still answers for the owner
  const current = await send("/api/subscriptions/current", "get", owner, undefined, { "x-store-slug": "ban-shop" });
  assert.equal(current.status, 200);
  assert.equal(current.body.status, "suspended");

  // escaping the ban by cancelling/changing the plan is locked too
  const cancel = await send("/api/subscriptions/cancel", "post", owner, undefined, { "x-store-slug": "ban-shop" });
  assert.equal(cancel.status, 403);
  assert.equal(cancel.body.code, "STORE_SUSPENDED");

  // superadmin is not locked out of the tenant
  const rootPing = await send("/api/protected-ping", "get", state.root, undefined, { "x-store-slug": "ban-shop" });
  assert.equal(rootPing.status, 200);

  const unbanned = await send("/api/admin/stores/" + store._id + "/unban", "post", state.root, {});
  assert.equal(unbanned.status, 200);
  assert.equal(unbanned.body.store.status, "active");
  assert.equal(unbanned.body.billing.status, "active");

  const after = await Subscription.findById(sub._id);
  assert.equal(after.suspendReason, "");
  assert.equal(after.suspendedBy, null);
  assert.equal(after.billingSuspendedAt, null);

  const storefrontAgain = await send("/api/storefront/ban-shop", "get");
  assert.equal(storefrontAgain.status, 200);
});

test("approving a payment lifts a manual ban automatically", async () => {
  const { store, sub } = await makeStore({ slug: "pay-shop", email: "pay@ban.test" });

  await send("/api/admin/stores/" + store._id + "/ban", "post", state.root, {});
  assert.equal((await Store.findById(store._id)).status, "suspended");

  const renewed = await applyPlanToStore({
    store: await Store.findById(store._id),
    plan: state.plan,
    startedAt: new Date(),
    extend: false,
  });
  assert.equal(renewed.status, "active");
  assert.equal(renewed.billingSuspendedAt, null);
  assert.equal(renewed.suspendReason, "");
  assert.equal((await Store.findById(store._id)).status, "active");
  assert.equal((await Subscription.findById(sub._id)).status, "active");
});

test("cron grace uses the per-store override and the platform default", async () => {
  const defaultPolicy = { autoBan: true, graceDays: 7 };
  const base = {
    store: { _id: new mongoose.Types.ObjectId(), name: "X", slug: "x", owner: { email: "x@ban.test", name: "X" } },
    plan: { name: "Growth", slug: "growth", price: 1500, durationDays: 30 },
    status: "active",
    endDate: daysFrom(NOW, -8),
    nextBillingDate: daysFrom(NOW, -8),
    trialEndsAt: null,
  };

  // 8 days overdue: still a warning under the 7-day platform grace? 8 > 7 → suspend
  const suspendAction = reminderFor({ ...base }, NOW, defaultPolicy);
  assert.equal(suspendAction.kind, "suspend");

  // 6 days overdue → overdue warning, no ban yet
  const warnAction = reminderFor(
    { ...base, endDate: daysFrom(NOW, -6), nextBillingDate: daysFrom(NOW, -6) },
    NOW,
    defaultPolicy
  );
  assert.equal(warnAction.kind, "overdue");

  // per-store override of 10 days keeps an 8-day overdue shop in the warning stage
  const overrideWarn = reminderFor({ ...base, graceDaysOverride: 10 }, NOW, defaultPolicy);
  assert.equal(overrideWarn.kind, "overdue");

  // 11 days overdue passes the override → suspend
  const overrideSuspend = reminderFor(
    { ...base, graceDaysOverride: 10, endDate: daysFrom(NOW, -11), nextBillingDate: daysFrom(NOW, -11) },
    NOW,
    defaultPolicy
  );
  assert.equal(overrideSuspend.kind, "suspend");

  // grace 0 bans the day after the due date, skipping the 3-day warning
  const zeroGrace = reminderFor(
    { ...base, endDate: daysFrom(NOW, -1), nextBillingDate: daysFrom(NOW, -1) },
    NOW,
    { autoBan: true, graceDays: 0 }
  );
  assert.equal(zeroGrace.kind, "suspend");
});

test("cron auto-ban follows the platform switch", async () => {
  const { store, sub } = await makeStore({ slug: "auto-shop", email: "auto@ban.test", dueInDays: -12 });
  // the subscription must be picked up by the scan
  await Subscription.updateOne({ _id: sub._id }, { $set: { lastNotifiedAt: null } });

  await billing.saveSettings({ manualEnabled: false, autoBan: true, defaultGraceDays: 7 });
  await runBillingReminders({ now: NOW, enqueue: fakeEnqueue() });

  const bannedSub = await Subscription.findById(sub._id);
  assert.equal(bannedSub.status, "suspended");
  assert.equal(bannedSub.suspendReason, "payment");
  assert.equal((await Store.findById(store._id)).status, "suspended");

  // platform switch off → the subscription is still marked suspended, the shop stays open
  const second = await makeStore({ slug: "warn-shop", email: "warn@ban.test", dueInDays: -12 });
  await billing.saveSettings({ manualEnabled: false, autoBan: false, defaultGraceDays: 7 });
  await runBillingReminders({ now: NOW, enqueue: fakeEnqueue() });

  const warnedSub = await Subscription.findById(second.sub._id);
  assert.equal(warnedSub.status, "suspended");
  assert.equal((await Store.findById(second.store._id)).status, "active");
});
