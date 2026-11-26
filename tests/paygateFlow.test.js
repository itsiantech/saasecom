process.env.JWT_SECRET = "paygate-flow-test-secret";
["PAYGATE_BASE_URL", "PAYGATE_PUBLIC_KEY", "PAYGATE_WEBHOOK_SECRET", "PAYGATE_RETURN_URL", "PLATFORM_DOMAIN"].forEach(
  (key) => delete process.env[key]
);

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
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
const paygate = require("../lib/paygate");
const settlement = require("../lib/paygateSettlement");

const SECRET = "whsec_test_0123456789";
const PK = "pk_test_0123456789";
const DAY = 24 * 60 * 60 * 1000;

const state = { payments: new Map(), seq: 0, events: 0 };

function bearer(user) {
  return "Bearer " + jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function post(path, user, body) {
  let req = request(state.app).post(path);
  if (user) req = req.set("Authorization", bearer(user));
  return body === undefined ? req : req.send(body);
}

function get(path, user) {
  let req = request(state.app).get(path);
  if (user) req = req.set("Authorization", bearer(user));
  return req;
}

/* ------------------------------------------------- fake PayGate server */
function startFakePayGate() {
  const api = express();
  api.use(express.json());

  api.post("/api/payments", (req, res) => {
    if (req.headers.authorization !== "Bearer " + PK) return res.status(401).json({ error: { code: "unauthorized" } });
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: { code: "invalid_amount" } });
    const id = "pay_" + ++state.seq;
    state.payments.set(id, {
      id,
      object: "payment",
      amount,
      amount_poisha: Math.round(amount * 100),
      currency: req.body.currency,
      status: "pending",
      trx_id: null,
      sender_number: req.body.sender_number || null,
      device_type: null,
      metadata: req.body.metadata || {},
      return_url: req.body.return_url || null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + (req.body.expires_in || 600) * 1000).toISOString(),
      paid_at: null,
    });
    res.status(201).json({
      payment: state.payments.get(id),
      checkout_url: "http://127.0.0.1:" + state.pgPort + "/pay/" + id,
      payment_methods: [{ type: "bkash", label: "bKash", number: "01700000000" }],
    });
  });

  api.get("/api/payments/:id", (req, res) => {
    const row = state.payments.get(req.params.id);
    if (!row) return res.status(404).json({ error: { code: "not_found" } });
    res.json({ payment: row });
  });

  return new Promise((resolve) => {
    const srv = api.listen(0, () => {
      state.pgServer = srv;
      resolve(srv.address().port);
    });
  });
}

// How PayGate marks a payment paid: a real bKash/Nagad SMS matched to it.
function markSuccess(pgId, { trx, sender, device = "bkash" }) {
  const row = state.payments.get(pgId);
  row.status = "success";
  row.trx_id = trx;
  row.sender_number = sender;
  row.device_type = device;
  row.paid_at = new Date().toISOString();
}

function markTerminal(pgId, status) {
  state.payments.get(pgId).status = status;
}

function pgEvent(pgId, type) {
  return {
    id: "evt_" + ++state.events,
    object: "event",
    type,
    created_at: new Date().toISOString(),
    data: { ...state.payments.get(pgId) },
  };
}

/* ------------------------------------------------------- signed calls */
function sendEvent(event, opts = {}) {
  const app = opts.app || state.app;
  const secret = opts.secret || SECRET;
  const timestamp = opts.timestamp === undefined ? Math.floor(Date.now() / 1000) : opts.timestamp;
  const body = opts.raw === undefined ? JSON.stringify(event) : opts.raw;
  const signature = "sha256=" + crypto.createHmac("sha256", secret).update(timestamp + "." + body).digest("hex");
  return request(app)
    .post("/api/webhooks/paygate")
    .set("Content-Type", "application/json")
    .set("x-paygate-signature", signature)
    .set("x-paygate-timestamp", String(timestamp))
    .send(body);
}

async function enableGateway() {
  await billing.saveSettings({
    manualEnabled: true,
    bkash: { enabled: true, number: "01711111111", accountName: "LUXE" },
    api: { enabled: true, provider: "paygate", baseUrl: "http://127.0.0.1:" + state.pgPort, publicKey: PK, secretKey: SECRET },
  });
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("paygate_flow"));
  await Promise.all([
    Plan.init(), Store.init(), User.init(), Settings.init(),
    Subscription.init(), PlatformPayment.init(), PlatformCounter.init(),
  ]);

  state.pgPort = await startFakePayGate();

  state.owner = await User.create({ name: "Buyer", email: "buyer@pg.test", role: "customer" });
  state.other = await User.create({ name: "Stranger", email: "stranger@pg.test", role: "customer" });
  state.pro = await Plan.create({ name: "Pro", slug: "pro", price: 990, durationDays: 30, trialDays: 0 });

  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use("/api/webhooks", require("../routes/paygateWebhook"));
  app.use("/api/billing/paygate", require("../routes/billingPaygate"));
  app.use("/api/billing", require("../routes/billing"));
  state.app = app;
}, { timeout: 180000 });

after(async () => {
  if (state.pgServer) state.pgServer.close();
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

/* ------------------------------------------------------------- config */

test("an unconfigured gateway offers no method and refuses to open a checkout", async () => {
  const config = await paygate.getConfig();
  assert.equal(config.configured, false);

  const methods = await get("/api/billing/methods");
  assert.equal(methods.status, 200);
  assert.deepEqual(methods.body.methods.map((m) => m.id), []);
  assert.equal(methods.body.paygateEnabled, false);

  const res = await post("/api/billing/paygate", state.owner, {
    planSlug: "pro", cycle: "1m", senderNumber: "01712345678", storeName: "Early Shop", storeSlug: "early-shop",
  });
  assert.equal(res.status, 503);
  assert.equal(await PlatformPayment.countDocuments({ user: state.owner._id }), 0);

  const hook = await sendEvent({ id: "evt_x", type: "payment.succeeded", data: { id: "pay_x", metadata: {} } });
  assert.equal(hook.status, 503);
});

test("settings beat env, and the gateway keys are encrypted in the settings row", async () => {
  await enableGateway();
  process.env.PAYGATE_BASE_URL = "http://127.0.0.1:1";

  const config = await paygate.getConfig();
  assert.equal(config.configured, true);
  assert.equal(config.source, "settings");
  assert.equal(config.baseUrl, "http://127.0.0.1:" + state.pgPort);
  assert.equal(config.webhookSecret, SECRET);

  const doc = await Settings.findOne({ key: billing.BILLING_KEY });
  assert.ok(!doc.value.includes(SECRET), "whsec must not sit plaintext in settings");
  assert.ok(!doc.value.includes(PK), "pk must not sit plaintext in settings");
  assert.ok(doc.value.includes("v1:"), "gateway keys are secretBox blobs");

  const masked = billing.maskedSettings(await billing.loadSettings());
  assert.equal(masked.api.secretKey, "••••" + SECRET.slice(-4));
  assert.equal(masked.api.publicKey, "••••" + PK.slice(-4));
});

test("the checkout list offers PayGate without leaking any key", async () => {
  const res = await get("/api/billing/methods");
  assert.deepEqual(res.body.methods.map((m) => m.id), ["paygate", "bkash"]);
  assert.equal(res.body.methods[0].gateway, true);
  const raw = JSON.stringify(res.body);
  assert.ok(!raw.includes(SECRET) && !raw.includes(PK));
});

test("webhook deliveries need a fresh signature from our secret", async () => {
  const event = { id: "evt_sig", type: "payment.succeeded", data: { id: "pay_sig", amount: 990, metadata: {} } };

  const badSecret = await sendEvent(event, { secret: "whsec_other" });
  assert.equal(badSecret.status, 401);

  const stale = await sendEvent(event, { timestamp: Math.floor(Date.now() / 1000) - paygate.MAX_SKEW_SECONDS - 60 });
  assert.equal(stale.status, 401);

  const broken = await request(state.app)
    .post("/api/webhooks/paygate")
    .set("Content-Type", "application/json")
    .set("x-paygate-signature", "sha256=" + "0".repeat(64))
    .set("x-paygate-timestamp", String(Math.floor(Date.now() / 1000)))
    .send("{not json");
  assert.equal(broken.status, 400);

  const unsigned = await request(state.app).post("/api/webhooks/paygate").send(event);
  assert.equal(unsigned.status, 401);
});

test("the webhook reaches its route instead of tenant resolution's store 400", async () => {
  const event = { id: "evt_host", object: "event", type: "payment.expired", data: { id: "pay_host", metadata: {} } };
  const inOrder = await sendEvent(event);
  assert.notEqual(inOrder.body.message, "Prothome ekta store khulun (/setup.html)");

  // Same request against a chain where tenant middleware comes first — the exact
  // production failure this mount order fixes.
  const late = express();
  late.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  late.use(require("../middleware/tenant"));
  late.use("/api/webhooks", require("../routes/paygateWebhook"));
  const broken = await sendEvent(event, { app: late });
  assert.equal(broken.status, 400);
  assert.match(broken.body.message, /store khulun/);
});

/* ------------------------------------------------------------ checkout */

test("a PayGate checkout stores a pending row and hands back the hosted url", async () => {
  const res = await post("/api/billing/paygate", state.owner, {
    planSlug: "pro", cycle: "3m", senderNumber: "01712 345678",
    storeName: "SMS Shop", storeSlug: "sms-shop",
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.payment.status, "pending");
  assert.equal(res.body.payment.method, "paygate");
  assert.equal(res.body.payment.gateway, "paygate");
  assert.equal(res.body.payment.amount, 2970);
  assert.match(res.body.checkoutUrl, /^http:\/\/127\.0\.0\.1:\d+\/pay\/pay_\d+$/);

  const row = await PlatformPayment.findById(res.body.payment.id);
  assert.equal(row.paygateId, res.body.checkoutUrl.split("/pay/")[1]);
  assert.equal(row.senderNumber, "01712345678");
  assert.equal(row.storeSlug, "sms-shop");
  assert.equal(row.trxKey, undefined);
  assert.ok(row.paygateCheckoutUrl.includes("/pay/"));
  // return_url must bring the buyer back to the polling page
  assert.match(state.payments.get(row.paygateId).return_url, new RegExp("plan-checkout\\.html\\?pp=" + row._id));
  assert.equal(await Store.countDocuments({ slug: "sms-shop" }), 0);

  state.checkout = { id: row._id, pgId: row.paygateId };
});

test("checkout needs a phone, a real plan and a signed-in buyer", async () => {
  const noPhone = await post("/api/billing/paygate", state.other, {
    planSlug: "pro", senderNumber: "01", storeName: "X", storeSlug: "x-shop",
  });
  assert.equal(noPhone.status, 400);

  const noPlan = await post("/api/billing/paygate", state.other, {
    planSlug: "nope", senderNumber: "01712345678", storeName: "X", storeSlug: "x-shop",
  });
  assert.equal(noPlan.status, 404);

  const anon = await request(state.app).post("/api/billing/paygate").send({ planSlug: "pro", senderNumber: "01712345678" });
  assert.equal(anon.status, 401);
});

test("the manual endpoint cannot be talked into a paygate claim", async () => {
  const res = await post("/api/billing/payments", state.other, {
    planSlug: "pro", method: "paygate", senderNumber: "01712345678", trxid: "PGHACK01",
    storeName: "Hijack", storeSlug: "hijack-shop",
  });
  assert.equal(res.status, 400);
  assert.equal(await PlatformPayment.countDocuments({ storeSlug: "hijack-shop" }), 0);
});

/* ------------------------------------------------------------ webhook */

test("an event for a payment we did not create is acknowledged, not settled", async () => {
  const before = await PlatformPayment.countDocuments({});
  // Same PayGate server, another integration's payment — no platformPaymentId.
  const res = await sendEvent({
    id: "evt_orphan",
    object: "event",
    type: "payment.succeeded",
    created_at: new Date().toISOString(),
    data: { id: "pay_orphan", object: "payment", amount: 450, status: "success", trx_id: "ORPHAN01", metadata: { invoiceNo: "INV-2026-7777" } },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ignored, true);
  assert.equal(await PlatformPayment.countDocuments({}), before);
});

test("a signed success event approves the payment and creates the store", async () => {
  markSuccess(state.checkout.pgId, { trx: "PGTRX0001", sender: "01712345678" });
  const event = pgEvent(state.checkout.pgId, "payment.succeeded");
  const res = await sendEvent(event);
  assert.equal(res.status, 200);
  assert.equal(res.body.received, true);

  const row = await PlatformPayment.findById(state.checkout.id);
  assert.equal(row.status, "approved");
  assert.equal(row.method, "bkash");
  assert.equal(row.gateway, "paygate");
  assert.equal(row.paygateDeviceType, "bkash");
  assert.equal(row.trxid, "PGTRX0001");
  assert.equal(row.trxKey, "bkash:pgtrx0001");
  assert.equal(row.paygateEventId, event.id);
  assert.equal(row.decidedBy, null);
  assert.ok(row.paygatePaidAt instanceof Date);
  assert.match(row.rejectReason || "", /^$/);

  const store = await Store.findOne({ slug: "sms-shop" });
  assert.ok(store, "the webhook alone opened the shop");
  assert.equal(String(store.owner), String(state.owner._id));
  const sub = await Subscription.findOne({ store: store._id });
  assert.equal(sub.status, "active");
  assert.ok(Math.abs(sub.endDate.getTime() - Date.now() - 90 * DAY) < 60 * 1000);
});

test("replaying the same event does not buy a second store", async () => {
  const res = await sendEvent(pgEvent(state.checkout.pgId, "payment.succeeded"));
  assert.equal(res.status, 200);
  assert.ok(res.body.received || res.body.duplicate);
  assert.equal(await Store.countDocuments({ slug: "sms-shop" }), 1);
  assert.equal(await PlatformPayment.countDocuments({ status: "approved" }), 1);
});

test("an amount mismatch is refused and left for a human", async () => {
  const user = await User.create({ name: "Short", email: "short@pg.test", role: "customer" });
  const made = await post("/api/billing/paygate", user, {
    planSlug: "pro", senderNumber: "01812345678", storeName: "Short Shop", storeSlug: "short-shop",
  });
  assert.equal(made.status, 201);

  const pgId = made.body.checkoutUrl.split("/pay/")[1];
  markSuccess(pgId, { trx: "PGTRX0002", sender: "01812345678" });
  const event = pgEvent(pgId, "payment.succeeded");
  event.data.amount = 99;
  const res = await sendEvent(event);
  assert.equal(res.status, 200);
  assert.equal(res.body.ignored, true);

  const row = await PlatformPayment.findById(made.body.payment.id);
  assert.equal(row.status, "pending");
  assert.equal(row.trxid, "");
  assert.equal(await Store.countDocuments({ slug: "short-shop" }), 0);
  state.shortShop = { user, paymentId: row._id, pgId };
});

test("a TrxID already claimed by hand blocks the auto approval", async () => {
  const claim = await post("/api/billing/payments", state.other, {
    planSlug: "pro", method: "bkash", senderNumber: "01812345678", trxid: "PGDUP001",
    storeName: "Claim Shop", storeSlug: "claim-shop",
  });
  assert.equal(claim.status, 201);

  const buyer = await User.create({ name: "Late", email: "late@pg.test", role: "customer" });
  const made = await post("/api/billing/paygate", buyer, {
    planSlug: "pro", senderNumber: "01912345678", storeName: "Late Shop", storeSlug: "late-shop",
  });
  const pgId = made.body.checkoutUrl.split("/pay/")[1];
  markSuccess(pgId, { trx: "PGDUP001", sender: "01912345678" });
  const res = await sendEvent(pgEvent(pgId, "payment.succeeded"));
  assert.equal(res.status, 200);

  const row = await PlatformPayment.findById(made.body.payment.id);
  assert.equal(row.status, "rejected");
  assert.match(row.rejectReason, /TrxID/);
  assert.equal(row.trxid, "");
  assert.equal(row.trxKey, undefined);
  assert.equal(await Store.countDocuments({ slug: "late-shop" }), 0);
});

test("an expired event frees the buyer for a new attempt", async () => {
  markTerminal(state.shortShop.pgId, "expired");
  const res = await sendEvent(pgEvent(state.shortShop.pgId, "payment.expired"));
  assert.equal(res.status, 200);

  const row = await PlatformPayment.findById(state.shortShop.paymentId);
  assert.equal(row.status, "rejected");
  assert.match(row.rejectReason, /সময় শেষ/);
  assert.equal(await Store.countDocuments({ slug: "short-shop" }), 0);

  const retry = await post("/api/billing/paygate", state.shortShop.user, {
    planSlug: "pro", senderNumber: "01812345678", storeName: "Short Shop", storeSlug: "short-shop",
  });
  assert.equal(retry.status, 201);
  state.retried = { id: retry.body.payment.id, pgId: retry.body.checkoutUrl.split("/pay/")[1] };
});

test("an unknown event type is acknowledged and changes nothing", async () => {
  const res = await sendEvent(pgEvent(state.retried.pgId, "payment.something_new"));
  assert.equal(res.status, 200);
  assert.equal(res.body.received, true);
  assert.equal((await PlatformPayment.findById(state.retried.id)).status, "pending");
});

/* --------------------------------------------------------------- poll */

test("the checkout page settles by polling when the webhook never arrives", async () => {
  const first = await get("/api/billing/paygate/" + state.retried.id + "/status", state.shortShop.user);
  assert.equal(first.status, 200);
  assert.equal(first.body.payment.status, "pending");
  assert.equal(first.body.payment.gateway, "paygate");

  markSuccess(state.retried.pgId, { trx: "PGTRX0003", sender: "01812345678" });
  const polled = await get("/api/billing/paygate/" + state.retried.id + "/status", state.shortShop.user);
  assert.equal(polled.status, 200);
  assert.equal(polled.body.payment.status, "approved");
  assert.equal(polled.body.payment.paygateId, state.retried.pgId);
  assert.equal(polled.body.payment.trxid, "PGTRX0003");

  const store = await Store.findOne({ slug: "short-shop" });
  assert.ok(store, "poll settled the store without any webhook");
  assert.equal(await Store.countDocuments({ slug: "short-shop" }), 1);
});

test("polling is private", async () => {
  const denied = await get("/api/billing/paygate/" + state.retried.id + "/status", state.other);
  assert.equal(denied.status, 403);
  const missing = await get("/api/billing/paygate/6650f0000000000000000099/status", state.owner);
  assert.equal(missing.status, 404);
});

/* --------------------------------------------------------------- lib */

test("settlement only touches gateway rows and compares whole poisha", async () => {
  const manual = await PlatformPayment.create({
    invoiceNo: "INV-2999-9999", user: state.owner._id, storeName: "Manual", plan: state.pro._id,
    amount: 990, method: "bkash", trxid: "MANUAL99", trxKey: "bkash:manual99",
  });
  await assert.rejects(
    () => settlement.settlePayment({ platformPaymentId: manual._id, paygatePayment: { id: "pay_z", status: "success", amount: 990 } }),
    /PayGate/
  );
  assert.equal((await PlatformPayment.findById(manual._id)).status, "pending");

  assert.equal(settlement.amountPoisha("990"), 99000);
  assert.equal(settlement.amountPoisha(990.001), 99000);
  assert.equal(settlement.amountPoisha(undefined), 0);
});
