process.env.JWT_SECRET = "server-tracking-test-secret";

const { test, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { tenantStorage } = require("../lib/tenantContext");
const tracking = require("../lib/serverTracking");
const { buildOrderMeta } = require("../lib/orderMeta");
const { trackOrderPlaced } = require("../services/serverTracking");
const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Settings = require("../models/Settings");

const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function as(method, url, body) {
  const req = request(state.app)[method](url)
    .set("x-store-slug", "track-shop")
    .set("Authorization", `Bearer ${state.token}`);
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

function sampleOrder(storeId) {
  return {
    store: storeId,
    orderNumber: "ORD-TEST-1",
    totalAmount: 1250,
    customerEmail: "Buyer@Example.com",
    customerPhone: "01712345678",
    customer: "64b000000000000000000001",
    items: [
      { product: { _id: "64b000000000000000000010", name: "Test Shirt" }, quantity: 2, price: 500 },
      { product: { _id: "64b000000000000000000011", name: "Cap" }, quantity: 1, price: 250 },
    ],
    clickIds: { gclid: "Cj0KCQtest", fbclid: "fb-click-1", ttclid: "tt-click-1" },
  };
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("server_tracking"));
  await Promise.all([Plan.init(), Store.init(), User.init(), Settings.init()]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const owner = await User.create({ name: "Owner", email: "track-owner@example.com", role: "customer" });
  state.store = await Store.create({ name: "Track Shop", slug: "track-shop", owner: owner._id, plan: plan._id });
  state.otherStore = await Store.create({ name: "Track Shop B", slug: "track-shop-b", owner: owner._id, plan: plan._id });
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
  state.calls = [];
  global.fetch = async (url, opts = {}) => {
    state.calls.push({ url: String(url), opts });
    const href = String(url);
    if (href.includes("tiktok")) return fakeResponse({ code: 0, message: "OK" });
    if (href.includes("facebook")) return fakeResponse({ events_received: 1, fbtrace_id: "x" });
    if (href.includes("google-analytics")) return fakeResponse(undefined, 204);
    return fakeResponse(undefined, 200);
  };
});
afterEach(() => {
  global.fetch = originalFetch;
});

test("settings values normalize and enabled providers need their credentials", () => {
  assert.equal(tracking.normalizeTrackingValue("sst_meta_pixel_id", " 1200 1743 2329 609 "), "120017432329609");
  assert.equal(tracking.normalizeTrackingValue("sst_ga4_measurement_id", " g-abc123xyz "), "G-ABC123XYZ");
  assert.equal(tracking.normalizeTrackingValue("sst_gads_conversion_id", "123456789"), "AW-123456789");
  assert.equal(
    tracking.normalizeTrackingValue("sst_meta_api_version", " V19.0 "),
    "v19.0"
  );

  assert.match(tracking.trackingErrors({ sst_meta_enabled: "true" }), /Pixel ID/);
  assert.match(
    tracking.trackingErrors({ sst_meta_enabled: "true", sst_meta_pixel_id: "120017432329609" }),
    /Access Token/
  );
  assert.equal(
    tracking.trackingErrors({
      sst_meta_enabled: "true",
      sst_meta_pixel_id: "120017432329609",
      sst_meta_access_token: "EAAG-token",
      sst_meta_api_version: "v19.0",
    }),
    ""
  );
  assert.match(tracking.trackingErrors({ sst_gads_enabled: "true", sst_gads_conversion_id: "AW-123456789" }), /Label/);
  assert.equal(
    tracking.trackingErrors({
      sst_gads_enabled: "true",
      sst_gads_conversion_id: "AW-123456789",
      sst_gads_conversion_label: "AbC-D_ef",
    }),
    ""
  );
});

test("master switch gates every provider and IDs are re-validated on read", () => {
  const off = tracking.buildConfig({
    sst_enabled: "false",
    sst_meta_enabled: "true",
    sst_meta_pixel_id: "120017432329609",
    sst_meta_access_token: "token",
  });
  assert.equal(off.enabled, false);
  assert.equal(off.meta.enabled, false);
  assert.equal(off.meta.pixelId, "120017432329609", "kept so turning the master back on restores it");

  const on = tracking.buildConfig({
    sst_enabled: "true",
    sst_meta_enabled: "true",
    sst_meta_pixel_id: "120017432329609",
    sst_meta_access_token: "token",
  });
  assert.equal(on.meta.enabled, true);

  const tampered = tracking.buildConfig({ sst_enabled: "true", sst_ga4_enabled: "true", sst_ga4_measurement_id: "x');alert(1)//" });
  assert.equal(tampered.ga4.measurementId, "");
});

test("purchase payloads hash PII and carry click ids", () => {
  const order = sampleOrder(state.store._id);
  const cfg = tracking.buildConfig({
    sst_enabled: "true",
    sst_meta_enabled: "true",
    sst_meta_pixel_id: "120017432329609",
    sst_meta_access_token: "EAAG-token",
    sst_meta_test_mode: "true",
    sst_meta_test_event_code: "TEST123",
    sst_tiktok_enabled: "true",
    sst_tiktok_pixel_id: "CABCDEF123456",
    sst_tiktok_access_token: "tt-token",
    sst_ga4_enabled: "true",
    sst_ga4_measurement_id: "G-ABC123XYZ",
    sst_ga4_api_secret: "ga4-secret",
    sst_gads_enabled: "true",
    sst_gads_conversion_id: "AW-123456789",
    sst_gads_conversion_label: "AbC-D_ef",
  });

  const ctx = { sourceUrl: "https://shop.example.com/checkout", time: 1700000000, timeMs: 1700000000000 };
  const meta = tracking.metaPurchase(cfg.meta, order, { ...ctx, fbclid: "fb-click-1" });
  assert.match(meta.url, /graph\.facebook\.com\/v19\.0\/120017432329609\/events/);
  assert.equal(meta.body.data[0].event_name, "Purchase");
  assert.equal(meta.body.data[0].event_id, "ORD-TEST-1");
  assert.equal(meta.body.data[0].action_source, "website");
  assert.equal(meta.body.test_event_code, "TEST123", "test mode routes the event to Test Events");
  assert.equal(meta.body.data[0].user_data.em[0], tracking.hashEmail("Buyer@Example.com"));
  assert.equal(meta.body.data[0].user_data.ph[0], tracking.hashPhone("01712345678"));
  assert.match(meta.body.data[0].user_data.fbc, /^fb\.1\.1700000000000\.fb-click-1$/);
  assert.ok(!JSON.stringify(meta.body).includes("Buyer@Example.com"), "email never leaves in plaintext");
  assert.equal(meta.body.data[0].custom_data.value, 1250);
  assert.equal(meta.body.data[0].custom_data.num_items, 3);

  const noTest = tracking.metaPurchase({ ...cfg.meta, testMode: false }, order, ctx);
  assert.equal(noTest.body.test_event_code, undefined, "live events ignore the test code");

  const tiktok = tracking.tiktokPurchase(cfg.tiktok, order, { ...ctx, ttclid: "tt-click-1" });
  assert.equal(tiktok.body.event_source, "web");
  assert.equal(tiktok.body.event_source_id, "CABCDEF123456");
  assert.equal(tiktok.body.data[0].event, "CompletePayment");
  assert.match(tiktok.body.data[0].event_time, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(tiktok.body.data[0].user.ttclid, "tt-click-1");
  assert.equal(tiktok.headers["Access-Token"], "tt-token");
  assert.equal(tiktok.body.data[0].properties.value, 1250);

  const ga4 = tracking.ga4Purchase(cfg.ga4, order, ctx);
  assert.match(ga4.url, /measurement_id=G-ABC123XYZ&api_secret=ga4-secret/);
  assert.equal(ga4.body.events[0].name, "purchase");
  assert.equal(ga4.body.events[0].params.transaction_id, "ORD-TEST-1");
  assert.equal(ga4.body.events[0].params.items.length, 2);

  assert.equal(tracking.gadsConversionUrl(cfg.gads, { ...order, clickIds: {} }), "", "no gclid, no ping");
  const gads = tracking.gadsConversionUrl(cfg.gads, order);
  assert.match(gads, /googleadservices\.com\/pagead\/conversion\/123456789\/\?/);
  assert.match(gads, /gclid=Cj0KCQtest/);
  assert.match(gads, /label=AbC-D_ef/);
});

test("order meta keeps only URL-safe click ids", () => {
  const req = { get: () => "" };
  const meta = buildOrderMeta(req, {
    clickIds: { gclid: " abc123_-x ", fbclid: "<script>", ttclid: "ok.value~1" },
  });
  assert.equal(meta.clickIds.gclid, "abc123_-x");
  assert.equal(meta.clickIds.fbclid, "");
  assert.equal(meta.clickIds.ttclid, "ok.value~1");
});

test("admin save encrypts secrets, masks the view and validates enabled providers", async () => {
  const bad = await as("put", "/api/settings", {
    settings: { sst_enabled: "true", sst_meta_enabled: "true", sst_meta_pixel_id: "abc" },
  });
  assert.equal(bad.status, 400, JSON.stringify(bad.body));
  assert.match(bad.body.message, /Pixel ID/);

  const saved = await as("put", "/api/settings", {
    settings: {
      sst_enabled: "true",
      sst_meta_enabled: "true",
      sst_meta_name: "My Pixel",
      sst_meta_pixel_id: "120017432329609",
      sst_meta_access_token: "EAAG-secret-1234",
      sst_meta_test_event_code: "TEST123",
      sst_meta_api_version: "v19.0",
      sst_meta_test_mode: "true",
      sst_ga4_enabled: "true",
      sst_ga4_measurement_id: "g-abc123xyz",
      sst_ga4_api_secret: "ga4-secret-9876",
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.settings.sst_meta_access_token, "••••1234");
  assert.equal(saved.body.settings.sst_ga4_api_secret, "••••9876");
  assert.equal(saved.body.settings.sst_ga4_measurement_id, "G-ABC123XYZ");

  const row = await Settings.findOne({ key: "store:" + state.store._id + ":sst_meta_access_token" }).lean();
  assert.ok(row.value.startsWith("v1:"), "token is encrypted at rest");
  assert.ok(!row.value.includes("EAAG-secret-1234"), "ciphertext does not contain the token");

  const keep = await as("put", "/api/settings", {
    settings: { sst_meta_access_token: "••••1234", sst_meta_name: "Renamed" },
  });
  assert.equal(keep.status, 200, JSON.stringify(keep.body));
  const keptRow = await Settings.findOne({ key: "store:" + state.store._id + ":sst_meta_access_token" }).lean();
  assert.equal(keptRow.value, row.value, "masked input keeps the stored secret");
  assert.equal(keep.body.settings.sst_meta_name, "Renamed");

  const orphan = await as("put", "/api/settings", {
    settings: { sst_tiktok_enabled: "true", sst_tiktok_pixel_id: "CABCDEF123456" },
  });
  assert.equal(orphan.status, 400, JSON.stringify(orphan.body));
  assert.match(orphan.body.message, /TikTok Access Token/);
});

test("admin settings are per store", async () => {
  await Settings.updateOne(
    { key: "store:" + state.otherStore._id + ":sst_enabled" },
    { $set: { value: "false" } },
    { upsert: true }
  );
  const other = await request(state.app)
    .get("/api/settings")
    .set("x-store-slug", "track-shop-b")
    .set("Authorization", `Bearer ${state.token}`);
  assert.equal(other.status, 200, JSON.stringify(other.body));
  assert.equal(other.body.settings.sst_enabled, "false");
  assert.equal(other.body.settings.sst_meta_access_token, "");
});

test("test endpoints fall back to the stored token and report provider answers", async () => {
  const conn = await as("post", "/api/settings/tracking/test-connection", {
    provider: "meta",
    config: { sst_meta_pixel_id: "120017432329609", sst_meta_access_token: "••••1234" },
  });
  assert.equal(conn.status, 200, JSON.stringify(conn.body));
  assert.equal(conn.body.ok, true, JSON.stringify(conn.body));
  assert.match(state.calls.at(-1).url, /access_token=EAAG-secret-1234/, "masked token resolves to the stored one");

  const event = await as("post", "/api/settings/tracking/test-event", {
    provider: "meta",
    config: {
      sst_meta_pixel_id: "120017432329609",
      sst_meta_access_token: "••••1234",
      sst_meta_test_mode: "true",
      sst_meta_test_event_code: "TEST123",
    },
  });
  assert.equal(event.status, 200, JSON.stringify(event.body));
  assert.equal(event.body.ok, true, JSON.stringify(event.body));
  const body = JSON.parse(state.calls.at(-1).opts.body);
  assert.equal(body.test_event_code, "TEST123");
  assert.equal(body.data[0].event_name, "Purchase");

  const ga4 = await as("post", "/api/settings/tracking/test-connection", { provider: "ga4" });
  assert.equal(ga4.body.ok, true, JSON.stringify(ga4.body));

  const gads = await as("post", "/api/settings/tracking/test-event", { provider: "gads" });
  assert.equal(gads.body.ok, false);
  assert.match(gads.body.message, /Conversion ID/);
});

test("trackOrderPlaced sends one purchase per enabled provider", async () => {
  await as("put", "/api/settings", {
    settings: {
      sst_enabled: "true",
      sst_meta_enabled: "true",
      sst_meta_pixel_id: "120017432329609",
      sst_meta_access_token: "EAAG-secret-1234",
      sst_meta_test_mode: "false",
      sst_tiktok_enabled: "true",
      sst_tiktok_pixel_id: "CABCDEF123456",
      sst_tiktok_access_token: "tt-token",
      sst_ga4_enabled: "true",
      sst_ga4_measurement_id: "G-ABC123XYZ",
      sst_ga4_api_secret: "ga4-secret-9876",
      sst_gads_enabled: "true",
      sst_gads_conversion_id: "AW-123456789",
      sst_gads_conversion_label: "AbC-D_ef",
    },
  });

  await trackOrderPlaced(sampleOrder(state.store._id));
  const urls = state.calls.map((c) => c.url);
  assert.equal(urls.length, 4, urls.join("\n"));
  assert.ok(urls.some((u) => u.includes("graph.facebook.com")), "meta sent");
  assert.ok(urls.some((u) => u.includes("business-api.tiktok.com")), "tiktok sent");
  assert.ok(urls.some((u) => u.includes("google-analytics.com/mp/collect")), "ga4 sent");
  assert.ok(urls.some((u) => u.includes("googleadservices.com")), "gads sent");

  const metaCall = state.calls.find((c) => c.url.includes("facebook"));
  const metaBody = JSON.parse(metaCall.opts.body);
  assert.equal(metaBody.data[0].custom_data.order_id, "ORD-TEST-1");
  assert.match(metaBody.data[0].user_data.fbc, /fb-click-1/);
  assert.equal(metaBody.test_event_code, undefined);

  const tiktokCall = state.calls.find((c) => c.url.includes("tiktok"));
  assert.equal(JSON.parse(tiktokCall.opts.body).data[0].user.ttclid, "tt-click-1");

  const gadsCall = state.calls.find((c) => c.url.includes("googleadservices"));
  assert.match(gadsCall.url, /gclid=Cj0KCQtest/);

  // master off -> nothing is sent
  state.calls = [];
  await as("put", "/api/settings", { settings: { sst_enabled: "false" } });
  await trackOrderPlaced(sampleOrder(state.store._id));
  assert.equal(state.calls.length, 0);

  await as("put", "/api/settings", { settings: { sst_enabled: "true" } });
});
