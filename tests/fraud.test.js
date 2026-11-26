process.env.JWT_SECRET = "fraud-test-secret";

const { test, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { tenantStorage } = require("../lib/tenantContext");
const cache = require("../lib/cache");
const { normalizeBdPhone, calculateRisk } = require("../lib/fraudRisk");
const { PROTECTION_DEFAULTS } = require("../lib/protectionSettings");
const steadfast = require("../lib/couriers/steadfast");
const pathao = require("../lib/couriers/pathao");
const { checkOrderNow } = require("../services/fraudCheck");
const { evaluateProtection, BLACKLIST_MESSAGE } = require("../services/orderProtection");
const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Order = require("../models/Order");
const Settings = require("../models/Settings");
const Blacklist = require("../models/Blacklist");

const state = {};
let orderSeq = 0;

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function as(method, url, body, token) {
  const req = request(state.app)[method](url)
    .set("x-store-slug", "fraud-shop")
    .set("Authorization", `Bearer ${token || state.token}`);
  return body === undefined ? req : req.send(body);
}

function fakeResponse(payload, status = 200) {
  const text = payload === undefined ? "" : JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => (text ? JSON.parse(text) : null),
  };
}

async function makeOrder(overrides = {}) {
  orderSeq += 1;
  return Order.create({
    store: state.store._id,
    orderNumber: "ORD-F-" + String(orderSeq).padStart(4, "0"),
    customerName: "Karim Uddin",
    customerPhone: "01712345678",
    address: "House 4, Road 2",
    thana: "Mirpur",
    district: "Dhaka",
    division: "Dhaka",
    totalAmount: 1850,
    status: "pending",
    items: [{ product: "64b000000000000000000010", quantity: 2, unitPrice: 925, price: 1850 }],
    ...overrides,
  });
}

async function enableFraud(extra = {}) {
  const res = await as("put", "/api/settings", {
    settings: {
      courier_steadfast_api_key: "sf-key",
      courier_steadfast_secret_key: "sf-secret",
      fraud_check_enabled: "true",
      fraud_steadfast_enabled: "true",
      fraud_low_from: "80",
      fraud_high_below: "50",
      ...extra,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res;
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("fraud"));
  await Promise.all([Plan.init(), Store.init(), User.init(), Order.init(), Settings.init(), Blacklist.init()]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const owner = await User.create({ name: "Owner", email: "fraud-owner@example.com", role: "customer" });
  state.store = await Store.create({ name: "Fraud Shop", slug: "fraud-shop", owner: owner._id, plan: plan._id });
  state.token = tokenFor(owner);

  state.app = express();
  state.app.use(express.json());
  state.app.use(async (req, res, next) => {
    try {
      const slug = String(req.headers["x-store-slug"] || req.query.store || "").trim().toLowerCase();
      const store = slug ? await Store.findOne({ slug }) : null;
      if (!store) return res.status(404).json({ message: "no store" });
      tenantStorage.run({ storeId: store._id }, () => {
        req.store = store;
        next();
      });
    } catch (err) {
      next(err);
    }
  });
  state.app.use("/api/settings", require("../routes/settings"));
  state.app.use("/api/orders", require("../routes/orders"));
  state.app.use("/api/blacklist", require("../routes/blacklist"));
  state.app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

let originalFetch;
beforeEach(() => {
  originalFetch = global.fetch;
  cache.clear();
  pathao.resetCaches();
  state.calls = [];
  state.sfCounts = { total_parcels: 10, delivered_count: 9, cancelled_count: 1 };
  state.paRating = { customer_rating: "excellent_customer" };
  state.fetchMode = "ok";
  global.fetch = async (url, opts = {}) => {
    const href = String(url);
    state.calls.push({ url: href, opts });
    if (state.fetchMode === "network-error") throw new TypeError("fetch failed");
    if (href.includes("/issue-token")) return fakeResponse({ access_token: "pathao-token", expires_in: 3600 });
    if (href.includes("/fraud_check/")) {
      if (state.fetchMode === "sf-500") return fakeResponse({ message: "server error" }, 500);
      return fakeResponse(state.sfCounts);
    }
    if (href.includes("/user/success")) return fakeResponse({ data: state.paRating });
    return fakeResponse(undefined, 200);
  };
});
afterEach(() => {
  global.fetch = originalFetch;
});

function fraudCalls() {
  return state.calls.filter((c) => c.url.includes("/fraud_check/") || c.url.includes("/user/success"));
}

/* ===================== phone normalization ===================== */

test("normalizeBdPhone accepts BD formats and rejects the rest", () => {
  assert.equal(normalizeBdPhone("01712345678"), "01712345678");
  assert.equal(normalizeBdPhone("+8801712345678"), "01712345678");
  assert.equal(normalizeBdPhone("8801712345678"), "01712345678");
  assert.equal(normalizeBdPhone("01712-345678"), "01712345678");
  assert.equal(normalizeBdPhone(" 01712 345 678 "), "01712345678");
  assert.equal(normalizeBdPhone("12345"), "");
  assert.equal(normalizeBdPhone("021712345678"), "");
  assert.equal(normalizeBdPhone("0171234567"), ""); // 10 digits
  assert.equal(normalizeBdPhone(""), "");
  assert.equal(normalizeBdPhone(null), "");
});

/* ===================== risk math ===================== */

test("calculateRisk combines enabled couriers and applies thresholds", () => {
  const s = { steadfastEnabled: true, pathaoEnabled: true, lowFrom: 80, highBelow: 50 };
  const sf = { success: 9, cancel: 1, total: 10 };
  const pa = { success: 8, cancel: 2, total: 10 };
  const low = calculateRisk(sf, pa, s);
  assert.equal(low.level, "low");
  assert.equal(low.combinedPercent, 85);
  assert.equal(low.perCourier.steadfast.percent, 90);
  assert.equal(low.perCourier.pathao.percent, 80);

  const medium = calculateRisk({ success: 6, cancel: 4, total: 10 }, { success: 7, cancel: 3, total: 10 }, s);
  assert.equal(medium.level, "medium");
  assert.equal(medium.combinedPercent, 65);

  const high = calculateRisk({ success: 2, cancel: 8, total: 10 }, { success: 4, cancel: 6, total: 10 }, s);
  assert.equal(high.level, "high");
  assert.equal(high.combinedPercent, 30);

  // disabled courier is ignored even if it returned data
  const onlySf = calculateRisk(sf, pa, { ...s, pathaoEnabled: false });
  assert.equal(onlySf.combinedPercent, 90);
  assert.equal(onlySf.perCourier.pathao, undefined);

  // errored courier is ignored
  const sfErr = calculateRisk({ error: "timeout" }, pa, s);
  assert.equal(sfErr.combinedPercent, 80);
  assert.equal(sfErr.level, "low");
});

test("calculateRisk: no history is new, ratings map categorically, new never high", () => {
  const s = { steadfastEnabled: true, pathaoEnabled: true, lowFrom: 80, highBelow: 50 };
  const zero = calculateRisk({ success: 0, cancel: 0, total: 0 }, null, s);
  assert.equal(zero.level, "new");
  assert.equal(zero.combinedPercent, null);

  assert.equal(calculateRisk(null, { rating: "new_customer" }, s).level, "new");
  assert.equal(calculateRisk(null, { rating: "risky_customer" }, s).level, "high");
  assert.equal(calculateRisk(null, { rating: "excellent_customer" }, s).level, "low");
  assert.equal(calculateRisk(null, { rating: "good_customer" }, s).level, "low");
  assert.equal(calculateRisk(null, null, s).level, "unavailable");
  assert.equal(calculateRisk({ error: "x" }, { error: "y" }, s).level, "unavailable");

  // counts win over rating when both present
  const mixed = calculateRisk({ success: 9, cancel: 1, total: 10 }, { rating: "risky_customer" }, s);
  assert.equal(mixed.level, "low");
  assert.equal(mixed.combinedPercent, 90);
});

/* ===================== adapters ===================== */

test("steadfast fraudCheck validates phone, retries once on network error, never throws", async () => {
  const cfg = { apiKey: "k", secretKey: "s" };
  const bad = await steadfast.fraudCheck(cfg, "12345");
  assert.ok(bad.error);
  assert.equal(state.calls.length, 0, "invalid phone never hits the API");

  state.fetchMode = "network-error";
  const out = await steadfast.fraudCheck(cfg, "+8801712345678");
  assert.ok(out.error);
  assert.equal(fraudCalls().length, 2, "one retry on network failure");
  assert.ok(fraudCalls()[0].url.includes("/fraud_check/score/01712345678"), "phone normalized in URL");

  state.fetchMode = "ok";
  const good = await steadfast.fraudCheck(cfg, "01712345678");
  assert.deepEqual(good, { success: 9, cancel: 1, total: 10 });
});

test("pathao fraudCheck rejects sandbox and maps rating-only responses", async () => {
  const sandbox = await pathao.fraudCheck(
    { env: "sandbox", clientId: "c", clientSecret: "s", username: "u", password: "p" },
    "01712345678"
  );
  assert.ok(sandbox.error);

  const live = await pathao.fraudCheck(
    { env: "live", clientId: "c", clientSecret: "s", username: "u", password: "p" },
    "01712345678"
  );
  assert.equal(live.rating, "excellent_customer");
  assert.equal(live.total, undefined, "counts are never invented");

  state.paRating = { customer_rating: "good_customer", delivered_orders: 8, returned_orders: 2, total_orders: 10 };
  const counted = await pathao.fraudCheck(
    { env: "live", clientId: "c", clientSecret: "s", username: "u", password: "p" },
    "01712345678"
  );
  assert.equal(counted.success, 8);
  assert.equal(counted.cancel, 2);
  assert.equal(counted.total, 10);
});

/* ===================== service: check + cache ===================== */

test("checkOrderNow saves risk on the order and caches per phone for 6h", async () => {
  await enableFraud();
  const order = await makeOrder();

  const fraud = await checkOrderNow(state.store._id, order._id);
  assert.equal(fraud.status, "done");
  assert.equal(fraud.riskLevel, "low");
  assert.equal(fraud.combinedPercent, 90);
  assert.equal(fraud.steadfast.total, 10);
  assert.ok(fraud.checkedAt);
  assert.equal(fraudCalls().length, 1);

  const saved = await Order.findById(order._id).lean();
  assert.equal(saved.fraud.riskLevel, "low");

  // already-checked guard: no second run, no extra API call
  const again = await checkOrderNow(state.store._id, order._id);
  assert.equal(again.riskLevel, "low");
  assert.equal(fraudCalls().length, 1);

  // force (Re-check) bypasses the order guard AND the phone cache → fresh call
  const forced = await checkOrderNow(state.store._id, order._id, { force: true });
  assert.equal(forced.status, "done");
  assert.equal(fraudCalls().length, 2);

  // another order with the same phone hits the 6h cache — no new courier call
  const sibling = await makeOrder();
  const cached = await checkOrderNow(state.store._id, sibling._id);
  assert.equal(cached.riskLevel, "low");
  assert.equal(fraudCalls().length, 2, "cache hit — no new courier call");

  // cache miss → fresh call
  cache.invalidatePrefix("fraud:");
  await checkOrderNow(state.store._id, order._id, { force: true });
  assert.equal(fraudCalls().length, 3);
});

test("new customer with zero parcels is new, courier failure degrades to unavailable", async () => {
  await enableFraud();
  state.sfCounts = { total_parcels: 0, delivered_count: 0, cancelled_count: 0 };
  const fresh = await makeOrder({ customerPhone: "01812345678" });
  const f1 = await checkOrderNow(state.store._id, fresh._id);
  assert.equal(f1.riskLevel, "new");
  assert.notEqual(f1.riskLevel, "high");

  state.fetchMode = "sf-500";
  const broken = await makeOrder({ customerPhone: "01912345678" });
  const f2 = await checkOrderNow(state.store._id, broken._id);
  assert.equal(f2.status, "done", "courier failure still completes the check");
  assert.equal(f2.riskLevel, "unavailable");
  assert.ok(f2.steadfast.error);
});

test("fraud check off → service returns null and route answers 400", async () => {
  await as("put", "/api/settings", { settings: { fraud_check_enabled: "false" } });
  const order = await makeOrder({ customerPhone: "01612345678" });
  assert.equal(await checkOrderNow(state.store._id, order._id), null);
  const res = await as("post", `/api/orders/${order._id}/fraud-check`);
  assert.equal(res.status, 400);
});

/* ===================== blacklist + protection ===================== */

test("blacklist add/list/remove works and checkout rejects a blacklisted phone", async () => {
  const bad = await as("post", "/api/blacklist", { type: "phone", value: "12345" });
  assert.equal(bad.status, 400);

  const added = await as("post", "/api/blacklist", { type: "phone", value: "+8801712345678", reason: "fake orders" });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.entry.value, "01712345678", "phone normalized before store");

  const dup = await as("post", "/api/blacklist", { type: "phone", value: "01712345678" });
  assert.equal(dup.status, 409);

  const hit = await evaluateProtection({
    storeId: state.store._id,
    phone: "01712345678",
    ip: "1.2.3.4",
    address: "House 4, Road 2",
    settings: { ...PROTECTION_DEFAULTS },
  });
  assert.equal(hit.reject, BLACKLIST_MESSAGE);

  const list = await as("get", "/api/blacklist?type=phone");
  assert.equal(list.status, 200);
  assert.ok(list.body.entries.some((e) => e.value === "01712345678"));

  const entryId = added.body.entry.id;
  const removed = await as("delete", "/api/blacklist/" + entryId);
  assert.equal(removed.status, 200);
  const after = await evaluateProtection({
    storeId: state.store._id,
    phone: "01712345678",
    ip: "",
    address: "",
    settings: { ...PROTECTION_DEFAULTS },
  });
  assert.equal(after.reject, null);
});

test("rate limit flags by default and rejects when the store chooses reject", async () => {
  const phone = "01512345678";
  for (let i = 0; i < 3; i += 1) {
    await makeOrder({ customerPhone: phone, customerIp: "9.9.9.9", address: "Rate street " + i });
  }
  const settings = { ...PROTECTION_DEFAULTS };
  const flagged = await evaluateProtection({ storeId: state.store._id, phone, ip: "", address: "", settings });
  assert.equal(flagged.reject, null, "default action is flag, not reject");
  assert.ok(flagged.flags.some((f) => f.rule === "rate_phone"));

  const rejected = await evaluateProtection({
    storeId: state.store._id,
    phone,
    ip: "",
    address: "",
    settings: { ...settings, protect_rate_action: "reject" },
  });
  assert.ok(rejected.reject);

  const ipFlag = await evaluateProtection({ storeId: state.store._id, phone: "01312345678", ip: "9.9.9.9", address: "", settings });
  // 3 orders < IP max 5 → no IP flag yet
  assert.ok(!ipFlag.flags.some((f) => f.rule === "rate_ip"));
});

test("duplicate address with many identities flags", async () => {
  const address = "House 99, Duplicate Road";
  for (let i = 0; i < 3; i += 1) {
    await makeOrder({
      customerName: "Name " + i,
      customerPhone: "0141234567" + i,
      address,
    });
  }
  const out = await evaluateProtection({
    storeId: state.store._id,
    phone: "01412345679",
    ip: "",
    address,
    settings: { ...PROTECTION_DEFAULTS },
  });
  assert.ok(out.flags.some((f) => f.rule === "duplicate_address"));
  assert.equal(out.reject, null);
});

/* ===================== order routes ===================== */

test("fraud-check, call-done, detail shape and risk filter on the list", async () => {
  await enableFraud();
  const order = await makeOrder({ customerPhone: "01712345678" });

  const check = await as("post", `/api/orders/${order._id}/fraud-check`);
  assert.equal(check.status, 200, JSON.stringify(check.body));
  assert.equal(check.body.fraud.riskLevel, "low");

  const call = await as("post", `/api/orders/${order._id}/call-done`);
  assert.equal(call.status, 200, JSON.stringify(call.body));

  const detail = await as("get", `/api/orders/${order._id}/detail`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.order.fraud.riskLevel, "low");
  assert.ok(detail.body.order.fraud.callDoneAt, "call-done timestamp survives re-check shape");

  const filtered = await as("get", "/api/orders/list?risk=low&limit=50");
  assert.equal(filtered.status, 200);
  assert.ok(filtered.body.orders.some((o) => o.id === String(order._id)));
  assert.ok(filtered.body.orders.every((o) => o.fraud && o.fraud.riskLevel === "low"));

  const none = await as("get", "/api/orders/list?risk=high&limit=50");
  assert.ok(!none.body.orders.some((o) => o.id === String(order._id)));
});