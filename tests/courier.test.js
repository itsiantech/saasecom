process.env.JWT_SECRET = "courier-test-secret";

const { test, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { tenantStorage } = require("../lib/tenantContext");
const courier = require("../lib/courierSettings");
const pathao = require("../lib/couriers/pathao");
const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Order = require("../models/Order");
const Settings = require("../models/Settings");

const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function as(method, url, body, token) {
  const req = request(state.app)[method](url)
    .set("x-store-slug", "courier-shop")
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
  return Order.create({
    store: state.store._id,
    orderNumber: "ORD-C-" + Date.now().toString(36).toUpperCase(),
    customerName: "Karim Uddin",
    customerPhone: "01712345678",
    address: "House 4, Road 2",
    thana: "Mirpur",
    district: "Dhaka",
    division: "Dhaka",
    totalAmount: 1850,
    status: "pending",
    items: [
      {
        product: "64b000000000000000000010",
        quantity: 2,
        unitPrice: 925,
        price: 1850,
      },
    ],
    ...overrides,
  });
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("courier"));
  await Promise.all([Plan.init(), Store.init(), User.init(), Order.init(), Settings.init()]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const owner = await User.create({ name: "Owner", email: "courier-owner@example.com", role: "customer" });
  state.store = await Store.create({ name: "Courier Shop", slug: "courier-shop", owner: owner._id, plan: plan._id });
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
  pathao.resetCaches();
  state.calls = [];
  global.fetch = async (url, opts = {}) => {
    const href = String(url);
    state.calls.push({ url: href, opts });
    if (href.includes("/issue-token")) return fakeResponse({ access_token: "pathao-token", expires_in: 3600 });
    if (href.includes("/city-list")) return fakeResponse({ data: { data: [{ city_id: 1, city_name: "Dhaka" }] } });
    if (href.includes("/zone-list")) {
      return fakeResponse({ data: { data: [{ zone_id: 10, zone_name: "Mirpur" }] } });
    }
    if (href.includes("/aladdin/api/v1/orders")) {
      return fakeResponse({ data: { consignment_id: "PTH-78241", order_status: "Pickup_Requested" } });
    }
    if (href.includes("/get_balance")) return fakeResponse({ status: 200, current_balance: 4250 });
    if (href.includes("/create_order")) {
      return fakeResponse({
        status: 200,
        consignment: { consignment_id: 501, tracking_code: "SF-55190", status: "in_review" },
      });
    }
    return fakeResponse(undefined, 200);
  };
});
afterEach(() => {
  global.fetch = originalFetch;
});

async function enablePathao(extra = {}) {
  const res = await as("put", "/api/settings", {
    settings: {
      courier_enabled: "true",
      courier_default: "pathao",
      courier_weight: "0.5",
      courier_sender_phone: "01711111111",
      courier_pathao_enabled: "true",
      courier_pathao_env: "live",
      courier_pathao_store_id: "12345",
      courier_pathao_client_id: "client-1",
      courier_pathao_client_secret: "secret-1",
      courier_pathao_username: "merchant",
      courier_pathao_password: "pass-1",
      ...extra,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res;
}

test("courier values normalize and enabled providers need credentials", () => {
  assert.equal(courier.normalizeCourierValue("courier_default", "fedex"), "pathao");
  assert.equal(courier.normalizeCourierValue("courier_default", "steadfast"), "steadfast");
  assert.equal(courier.normalizeCourierValue("courier_cod_mode", "x"), "due");
  assert.equal(courier.normalizeCourierValue("courier_weight", "0"), "0.5");
  assert.equal(courier.normalizeCourierValue("courier_weight", "2.345"), "2.35");
  assert.equal(courier.normalizeCourierValue("courier_sender_phone", "+8801712345678"), "01712345678");
  assert.equal(courier.normalizeCourierValue("courier_pathao_store_id", " 12a345 "), "12345");

  assert.match(courier.courierErrors({ courier_pathao_enabled: "true" }), /Store ID/);
  assert.match(
    courier.courierErrors({
      courier_pathao_enabled: "true",
      courier_pathao_store_id: "123",
      courier_pathao_client_id: "c",
      courier_pathao_client_secret: "s",
      courier_pathao_username: "u",
    }),
    /Password/
  );
  assert.equal(
    courier.courierErrors({
      courier_pathao_enabled: "true",
      courier_pathao_store_id: "123",
      courier_pathao_client_id: "c",
      courier_pathao_client_secret: "s",
      courier_pathao_username: "u",
      courier_pathao_password: "p",
    }),
    ""
  );
  assert.match(courier.courierErrors({ courier_steadfast_enabled: "true" }), /API Key/);
  assert.equal(
    courier.courierErrors({ courier_steadfast_enabled: "true", courier_steadfast_api_key: "k", courier_steadfast_secret_key: "s" }),
    ""
  );

  assert.deepEqual(courier.enabledProviders({ courier_pathao_enabled: "true", courier_steadfast_enabled: "true" }), [
    "pathao",
    "steadfast",
  ]);
  assert.equal(
    courier.resolveDefaultProvider({ courier_default: "steadfast", courier_pathao_enabled: "true" }),
    "pathao",
    "default falls back to an enabled provider"
  );
});

test("admin save encrypts courier secrets and masks the settings view", async () => {
  const saved = await enablePathao();
  assert.equal(saved.body.settings.courier_pathao_client_secret, "••••et-1");
  assert.equal(saved.body.settings.courier_pathao_password, "••••ss-1");
  assert.equal(saved.body.settings.courier_weight, "0.5");

  const row = await Settings.findOne({ key: "store:" + state.store._id + ":courier_pathao_client_secret" }).lean();
  assert.ok(row.value.startsWith("v1:"), "secret is encrypted at rest");
  assert.ok(!row.value.includes("secret-1"));

  const keep = await as("put", "/api/settings", {
    settings: { courier_pathao_client_secret: "••••et-1" },
  });
  assert.equal(keep.status, 200, JSON.stringify(keep.body));
  const keptRow = await Settings.findOne({ key: "store:" + state.store._id + ":courier_pathao_client_secret" }).lean();
  assert.equal(keptRow.value, row.value, "masked input keeps the stored secret");

  const bad = await as("put", "/api/settings", {
    settings: { courier_steadfast_enabled: "true" },
  });
  assert.equal(bad.status, 400, JSON.stringify(bad.body));
  assert.match(bad.body.message, /API Key/);
});

test("test connection resolves masked secrets and reports provider answers", async () => {
  await enablePathao();
  const conn = await as("post", "/api/settings/couriers/test-connection", {
    provider: "pathao",
    config: { courier_pathao_client_secret: "••••et-1", courier_pathao_password: "••••ss-1" },
  });
  assert.equal(conn.status, 200, JSON.stringify(conn.body));
  assert.equal(conn.body.ok, true, JSON.stringify(conn.body));
  assert.match(conn.body.message, /token OK/);
  const tokenCall = state.calls.find((c) => c.url.includes("/issue-token"));
  assert.ok(tokenCall, "token issued");
  assert.equal(JSON.parse(tokenCall.opts.body).client_secret, "secret-1", "masked secret resolves to stored one");

  await as("put", "/api/settings", {
    settings: {
      courier_steadfast_enabled: "true",
      courier_steadfast_api_key: "sf-key",
      courier_steadfast_secret_key: "sf-secret",
    },
  });
  const sf = await as("post", "/api/settings/couriers/test-connection", { provider: "steadfast" });
  assert.equal(sf.body.ok, true, JSON.stringify(sf.body));
  assert.match(sf.body.message, /4,250/);
});

test("pathao city and zone lists load through the saved credentials", async () => {
  await enablePathao();
  const cities = await as("get", "/api/settings/couriers/pathao/cities");
  assert.equal(cities.status, 200, JSON.stringify(cities.body));
  assert.equal(cities.body.ok, true, JSON.stringify(cities.body));
  assert.deepEqual(cities.body.cities, [{ id: "1", name: "Dhaka" }]);

  const zones = await as("get", "/api/settings/couriers/pathao/zones?cityId=1");
  assert.equal(zones.body.ok, true, JSON.stringify(zones.body));
  assert.deepEqual(zones.body.zones, [{ id: "10", name: "Mirpur" }]);
});

test("sending an order to Pathao books it and keeps the order status unchanged", async () => {
  await enablePathao();
  const order = await makeOrder();

  const res = await as("post", `/api/orders/${order._id}/courier`, { provider: "pathao" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.provider, "pathao");
  assert.equal(res.body.consignmentId, "PTH-78241");
  assert.equal(res.body.codAmount, 1850);

  const createCall = state.calls.find((c) => c.url.endsWith("/aladdin/api/v1/orders"));
  assert.ok(createCall, "pathao order endpoint called");
  const body = JSON.parse(createCall.opts.body);
  assert.equal(body.store_id, 12345);
  assert.equal(body.merchant_order_id, order.orderNumber);
  assert.equal(body.recipient_name, "Karim Uddin");
  assert.equal(body.recipient_phone, "01712345678");
  assert.equal(body.recipient_city, 1);
  assert.equal(body.recipient_zone, 10);
  assert.equal(body.amount_to_collect, 1850);
  assert.equal(body.item_weight, 0.5);
  assert.equal(body.item_quantity, 2);
  assert.equal(createCall.opts.headers.Authorization, "Bearer pathao-token");

  const fresh = await Order.findById(order._id).lean();
  assert.equal(fresh.status, "pending", "sending does not change the order status");
  assert.equal(fresh.courierProvider, "pathao");
  assert.equal(fresh.courierName, "Pathao");
  assert.equal(fresh.courierConsignmentId, "PTH-78241");
  assert.equal(fresh.courierTrackingCode, "PTH-78241");
  assert.ok(fresh.courierSentAt instanceof Date);
});

test("sending an order to Steadfast stores the tracking code and cod amount", async () => {
  await as("put", "/api/settings", {
    settings: {
      courier_enabled: "true",
      courier_default: "steadfast",
      courier_cod_mode: "due",
      courier_steadfast_enabled: "true",
      courier_steadfast_api_key: "sf-key",
      courier_steadfast_secret_key: "sf-secret",
    },
  });
  const order = await makeOrder({ paymentMode: "installment", totalAmount: 12000, dueAmount: 500000 });

  const res = await as("post", `/api/orders/${order._id}/courier`, { provider: "steadfast" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.consignmentId, "501");
  assert.equal(res.body.trackingCode, "SF-55190");
  assert.equal(res.body.codAmount, 5000, "installment order collects only the remaining due");

  const sfCall = state.calls.find((c) => c.url.includes("/create_order"));
  const body = JSON.parse(sfCall.opts.body);
  assert.equal(body.invoice, order.orderNumber);
  assert.equal(body.cod_amount, "5000");
  assert.equal(sfCall.opts.headers["Api-Key"], "sf-key");
  assert.equal(sfCall.opts.headers["Secret-Key"], "sf-secret");

  const fresh = await Order.findById(order._id).lean();
  assert.equal(fresh.courierProvider, "steadfast");
  assert.equal(fresh.courierName, "Steadfast");
  assert.equal(fresh.courierTrackingCode, "SF-55190");
});

test("send guards: disabled API, no provider, already sent and auth", async () => {
  await as("put", "/api/settings", { settings: { courier_enabled: "false" } });
  const order = await makeOrder();
  const off = await as("post", `/api/orders/${order._id}/courier`, { provider: "pathao" });
  assert.equal(off.status, 400, JSON.stringify(off.body));
  assert.match(off.body.message, /bondho/);

  await enablePathao();
  const first = await as("post", `/api/orders/${order._id}/courier`, {});
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const again = await as("post", `/api/orders/${order._id}/courier`, {});
  assert.equal(again.status, 409, JSON.stringify(again.body));
  assert.match(again.body.message, /already/);

  const other = await makeOrder();
  const anon = await request(state.app)
    .post(`/api/orders/${other._id}/courier`)
    .set("x-store-slug", "courier-shop")
    .send({ provider: "pathao" });
  assert.equal(anon.status, 401, JSON.stringify(anon.body));
});

test("order list exposes courier config and tracking fields", async () => {
  await enablePathao();
  await as("put", "/api/settings", {
    settings: {
      courier_steadfast_enabled: "true",
      courier_steadfast_api_key: "sf-key",
      courier_steadfast_secret_key: "sf-secret",
    },
  });
  const order = await makeOrder();
  await as("post", `/api/orders/${order._id}/courier`, { provider: "pathao" });

  const res = await as("get", "/api/orders/list?limit=100");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.courier.enabled, true);
  assert.deepEqual(res.body.courier.providers, [
    { key: "pathao", label: "Pathao" },
    { key: "steadfast", label: "Steadfast" },
  ]);
  assert.equal(res.body.courier.defaultProvider, "pathao");

  const row = res.body.orders.find((o) => String(o.id) === String(order._id));
  assert.ok(row);
  assert.equal(row.courierProvider, "pathao");
  assert.equal(row.courierTrackingCode, "PTH-78241");
  assert.equal(row.courierName, "Pathao");
});
