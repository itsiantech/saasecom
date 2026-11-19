process.env.JWT_SECRET = "saas-billing-email-secret";
process.env.APP_URL = "https://platform.test";
delete process.env.REDIS_URL;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.MAIL_FROM;

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Subscription = require("../models/Subscription");
const BillingNotification = require("../models/BillingNotification");
const { renderEmail, money, formatDate } = require("../src/mail/templates");
const {
  nextDailyRunAt,
  tryConsumeSlot,
  processJob,
  resetInlineState,
  dhakaDayKey,
} = require("../src/queues/emailQueue");
const {
  runBillingReminders,
  broadcastToActiveTenants,
  reminderFor,
  paymentUrl,
} = require("../src/jobs/billingCron");

const state = {};
const NOW = new Date("2026-11-19T03:00:00.000Z"); // 09:00 Asia/Dhaka
const DAY = 24 * 60 * 60 * 1000;

function daysFrom(now, days) {
  return new Date(now.getTime() + days * DAY);
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

async function makeOwner(email) {
  return User.create({ name: "Owner", email, role: "admin" });
}

async function makeSubscription({ slug, email, status = "active", trialEndsAt = null, nextBillingDate = null, endDate = null, deleted = false }) {
  const owner = await makeOwner(email);
  const store = await Store.create({
    name: "Shop " + slug,
    slug,
    owner: owner._id,
    plan: state.plan._id,
    ...(deleted ? { deletedAt: new Date() } : {}),
  });
  const sub = await Subscription.create({
    store: store._id,
    plan: state.plan._id,
    status,
    startDate: daysFrom(NOW, -30),
    endDate: endDate || daysFrom(NOW, 30),
    trialEndsAt,
    nextBillingDate,
    lastPaymentAt: daysFrom(NOW, -30),
  });
  return { owner, store, sub };
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("saas_billing_email"));
  await Promise.all([Plan.init(), Store.init(), User.init(), Subscription.init(), BillingNotification.init()]);
  state.plan = await Plan.create({ name: "Growth", slug: "growth", price: 1500, durationDays: 30, active: true });
});

after(async () => {
  await mongoose.disconnect();
  await state.mongo.stop();
});

beforeEach(async () => {
  await Promise.all([
    BillingNotification.deleteMany({}),
    Subscription.deleteMany({}),
    Store.deleteMany({}),
    User.deleteMany({}),
  ]);
  resetInlineState();
  delete process.env.SAAS_EMAIL_DAILY_CAP;
  delete process.env.BILLING_AUTO_SUSPEND;
  delete process.env.BILLING_SUSPEND_AFTER_DAYS;
});

/* ------------------------------------------------------------ templates */
test("templates render Bengali subject and invoice summary", () => {
  const { subject, html } = renderEmail("invoice", {
    brand: "LUXE",
    storeName: "Rasha Cart",
    planName: "Growth",
    invoiceNo: "BL-20261119-ABC123",
    amount: money(1500),
    paragraphs: ["আপনার বিল আজ পরিশোধ করুন।"],
    rows: [
      { label: "ইনভয়েস", value: "BL-20261119-ABC123" },
      { label: "পরিমাণ", value: money(1500) },
    ],
    ctaUrl: "https://platform.test/plan-checkout.html?plan=growth&store=1",
    ctaLabel: "পেমেন্ট করুন",
  });

  assert.match(subject, /Rasha Cart/);
  assert.match(html, /BL-20261119-ABC123/);
  assert.match(html, /৳1,500/);
  assert.match(html, /পেমেন্ট করুন/);
  assert.match(html, /<!doctype html>/i);
});

test("formatDate uses Dhaka calendar dates", () => {
  assert.equal(formatDate(new Date("2026-11-19T03:00:00.000Z")), "19 নভেম্বর 2026");
  // 18 Nov 23:30 UTC is already 19 Nov in Dhaka
  assert.equal(formatDate(new Date("2026-11-18T23:30:00.000Z")), "19 নভেম্বর 2026");
});

/* ------------------------------------------------------------ planner */
test("trial reminders fire at 3 days and 1 day before trial end", async () => {
  const { sub } = await makeSubscription({
    slug: "trial-shop",
    email: "trial@test.com",
    status: "trial",
    trialEndsAt: daysFrom(NOW, 3),
    nextBillingDate: daysFrom(NOW, 3),
  });

  const action3 = reminderFor(await Subscription.findById(sub._id).populate("plan").populate({ path: "store", populate: { path: "owner" } }), NOW);
  assert.equal(action3.kind, "trial_warning_3d");
  assert.equal(action3.to, "trial@test.com");

  const action1 = reminderFor(
    await Subscription.findById(sub._id).populate("plan").populate({ path: "store", populate: { path: "owner" } }),
    daysFrom(NOW, 2)
  );
  assert.equal(action1.kind, "trial_warning_1d");
});

test("invoice fires on the billing date and payment link points at checkout", async () => {
  const { store } = await makeSubscription({
    slug: "due-shop",
    email: "due@test.com",
    nextBillingDate: NOW,
  });
  const payload = fakeEnqueue();
  const summary = await runBillingReminders({ now: NOW, enqueue: payload });

  assert.equal(summary.queued, 1);
  assert.equal(payload.sent.length, 1);
  assert.equal(payload.sent[0].template, "invoice");
  assert.match(payload.sent[0].subject, /due-shop|Shop due-shop/i);
  assert.equal(
    payload.sent[0].data.ctaUrl,
    "https://platform.test/plan-checkout.html?plan=growth&store=" + String(store._id)
  );
  assert.equal(paymentUrl(store, state.plan), payload.sent[0].data.ctaUrl);
});

test("overdue at 3 days marks past_due and warns about suspension", async () => {
  const { sub } = await makeSubscription({
    slug: "late-shop",
    email: "late@test.com",
    nextBillingDate: daysFrom(NOW, -3),
  });
  const payload = fakeEnqueue();
  await runBillingReminders({ now: NOW, enqueue: payload });

  assert.equal(payload.sent.length, 1);
  assert.equal(payload.sent[0].template, "overdue");
  assert.match(payload.sent[0].data.note, /সাসপেন্ড/);

  const fresh = await Subscription.findById(sub._id).lean();
  assert.equal(fresh.status, "past_due");
  assert.ok(fresh.lastNotifiedAt);
});

test("suspend after the grace window, store suspension only when opted in", async () => {
  process.env.BILLING_AUTO_SUSPEND = "true";
  const { sub, store } = await makeSubscription({
    slug: "dead-shop",
    email: "dead@test.com",
    nextBillingDate: daysFrom(NOW, -8),
  });
  const payload = fakeEnqueue();
  await runBillingReminders({ now: NOW, enqueue: payload });

  assert.equal(payload.sent[0].template, "suspend");
  const fresh = await Subscription.findById(sub._id).lean();
  assert.equal(fresh.status, "suspended");
  assert.ok(fresh.billingSuspendedAt);
  const freshStore = await Store.findById(store._id).lean();
  assert.equal(freshStore.status, "suspended");
});

/* ---------------------------------------------------------- idempotency */
test("second run on the same day sends nothing and duplicates only the cycle row", async () => {
  await makeSubscription({ slug: "once-shop", email: "once@test.com", nextBillingDate: NOW });

  const first = fakeEnqueue();
  const s1 = await runBillingReminders({ now: NOW, enqueue: first });
  assert.equal(s1.queued, 1);

  const second = fakeEnqueue();
  const s2 = await runBillingReminders({ now: new Date(NOW.getTime() + 60 * 60 * 1000), enqueue: second });
  assert.equal(second.sent.length, 0);
  assert.equal(s2.duplicates, 1);
  assert.equal(await BillingNotification.countDocuments({ kind: "invoice" }), 1);
});

test("a fresh billing cycle mails again even though lastNotifiedAt exists", async () => {
  const { sub } = await makeSubscription({ slug: "cycle-shop", email: "cycle@test.com", nextBillingDate: NOW });
  await runBillingReminders({ now: NOW, enqueue: fakeEnqueue() });

  await Subscription.updateOne(
    { _id: sub._id },
    { $set: { nextBillingDate: daysFrom(NOW, 30), status: "active" } }
  );
  const next = fakeEnqueue();
  const summary = await runBillingReminders({ now: daysFrom(NOW, 30), enqueue: next });
  assert.equal(summary.queued, 1);
  assert.equal(await BillingNotification.countDocuments({ kind: "invoice" }), 2);
});

/* --------------------------------------------------------------- skips */
test("cancelled subscriptions, deleted stores and suspended stores are skipped", async () => {
  await makeSubscription({ slug: "cancel-shop", email: "cancel@test.com", status: "cancelled", nextBillingDate: NOW });
  await makeSubscription({ slug: "deleted-shop", email: "deleted@test.com", nextBillingDate: NOW, deleted: true });
  const suspended = await makeSubscription({ slug: "paused-shop", email: "paused@test.com", nextBillingDate: NOW });
  await Store.updateOne({ _id: suspended.store._id }, { $set: { status: "suspended" } });

  const payload = fakeEnqueue();
  const summary = await runBillingReminders({ now: NOW, enqueue: payload });
  assert.equal(payload.sent.length, 0);
  assert.equal(summary.queued, 0);
});

/* --------------------------------------------------------------- cap */
test("daily cap defers the extra job instead of sending", async () => {
  process.env.SAAS_EMAIL_DAILY_CAP = "1";
  resetInlineState();

  const payload = {
    to: "cap@test.com",
    template: "invoice",
    data: { storeName: "Cap", invoiceNo: "BL-1", rows: [] },
  };
  const first = await processJob({ data: payload });
  assert.equal(first.ok, true);

  const second = await processJob({ data: payload });
  assert.equal(second.deferred, true);
  assert.ok(second.until);
});

test("cap counter is per Dhaka day", async () => {
  const slot = await tryConsumeSlot(NOW);
  assert.equal(slot.allowed, true);
  assert.equal(slot.used, 1);
  assert.match(dhakaDayKey(NOW), /^2026-11-19$/);
});

test("next daily run is 09:00 Asia/Dhaka", () => {
  assert.equal(
    nextDailyRunAt(new Date("2026-11-19T02:00:00.000Z")).toISOString(), // 08:00 Dhaka
    "2026-11-19T03:00:00.000Z"
  );
  assert.equal(
    nextDailyRunAt(new Date("2026-11-19T05:00:00.000Z")).toISOString(), // 11:00 Dhaka
    "2026-11-20T03:00:00.000Z"
  );
});

/* ----------------------------------------------------------- broadcast */
test("broadcast helper reaches every active tenant once per day", async () => {
  await makeSubscription({ slug: "tenant-a", email: "a@test.com", nextBillingDate: daysFrom(NOW, 20) });
  await makeSubscription({ slug: "tenant-b", email: "b@test.com", status: "trial", trialEndsAt: daysFrom(NOW, 10) });
  await makeSubscription({ slug: "tenant-c", email: "c@test.com", status: "cancelled" });

  const payload = fakeEnqueue();
  const first = await broadcastToActiveTenants({
    subject: "নতুন ফিচার: ইনভেন্টরি রিপোর্ট",
    title: "নতুন ফিচার এসেছে",
    body: ["রিপোর্ট পেজ থেকে এখন স্টক রিপোর্ট নামানো যাবে।"],
    ctaUrl: "https://platform.test/app",
    ctaLabel: "দেখুন",
    now: NOW,
    enqueue: payload,
  });
  assert.equal(first.queued, 2);
  assert.equal(payload.sent.length, 2);

  const second = fakeEnqueue();
  const again = await broadcastToActiveTenants({
    subject: "নতুন ফিচার: ইনভেন্টরি রিপোর্ট",
    title: "নতুন ফিচার এসেছে",
    body: ["x"],
    now: NOW,
    enqueue: second,
  });
  assert.equal(second.sent.length, 0);
  assert.equal(again.duplicates, 2);
  assert.equal(await BillingNotification.countDocuments({ kind: "broadcast" }), 2);
});
