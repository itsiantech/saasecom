process.env.JWT_SECRET = "google-seo-test-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { tenantStorage } = require("../lib/tenantContext");
const { buildGoogleSeo, googleSeoError, normalizeSeoValue } = require("../lib/googleSeo");
const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Settings = require("../models/Settings");
const SiteSetting = require("../models/SiteSetting");

const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function as(method, url, body) {
  const req = request(state.app)[method](url)
    .set("x-store-slug", "seo-shop")
    .set("Authorization", `Bearer ${state.token}`);
  return body === undefined ? req : req.send(body);
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("google_seo"));
  await Promise.all([Plan.init(), Store.init(), User.init(), Settings.init(), SiteSetting.init()]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const owner = await User.create({ name: "Owner", email: "seo-owner@example.com", role: "customer" });
  state.store = await Store.create({ name: "SEO Shop", slug: "seo-shop", owner: owner._id, plan: plan._id });
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
  state.app.use("/api/public", require("../routes/publicApi"));
  state.app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("valuers normalize IDs and flag malformed values", () => {
  assert.equal(normalizeSeoValue("seo_ga4_id", " g-abc123xyz "), "G-ABC123XYZ");
  assert.equal(normalizeSeoValue("seo_gtm_id", "gtm-ab12cd"), "GTM-AB12CD");
  assert.equal(normalizeSeoValue("seo_robots_text", "User-agent: *\r\nAllow: /"), "User-agent: *\nAllow: /");

  assert.match(googleSeoError({ seo_ga4_id: "UA-1234" }), /Analytics 4/);
  assert.match(googleSeoError({ seo_gtm_id: "GTM" }), /Tag Manager/);
  assert.match(googleSeoError({ seo_search_console_code: "bad code!" }), /Search Console/);
  assert.equal(googleSeoError({ seo_ga4_id: "G-ABC123XYZ", seo_gtm_id: "GTM-AB12CD", seo_search_console_code: "" }), "", "empty is allowed");
});

test("master switch gates every feature in the public object", () => {
  const off = buildGoogleSeo({ seo_google_enabled: "false", seo_ga4_enabled: "true", seo_ga4_id: "G-ABC123XYZ" });
  assert.equal(off.enabled, false);
  assert.equal(off.ga4.enabled, false);
  assert.equal(off.ga4.id, "G-ABC123XYZ", "the id is kept so turning the master back on restores it");
  assert.equal(off.sitemap.enabled, false);

  const on = buildGoogleSeo({
    seo_google_enabled: "true",
    seo_ga4_enabled: "true",
    seo_ga4_id: "g-abc123xyz",
    seo_robots_enabled: "true",
  });
  assert.equal(on.ga4.enabled, true);
  assert.equal(on.ga4.id, "G-ABC123XYZ");
  assert.equal(on.robots.enabled, true);

  // a row written outside adminSave must not inject into inline scripts
  const tampered = buildGoogleSeo({
    seo_google_enabled: "true",
    seo_ga4_id: "x');alert(1)//",
    seo_search_console_code: "a b",
  });
  assert.equal(tampered.ga4.id, "");
  assert.equal(tampered.searchConsole.code, "");
});

test("admin save validates, stores per store and the public store exposes effective flags", async () => {
  const bad = await as("put", "/api/settings", { settings: { seo_ga4_id: "UA-1234" } });
  assert.equal(bad.status, 400, JSON.stringify(bad.body));
  assert.match(bad.body.message, /Analytics 4/);

  const saved = await as("put", "/api/settings", {
    settings: {
      seo_google_enabled: "true",
      seo_search_console_enabled: "true",
      seo_search_console_code: "aBcD1234-_xyz",
      seo_ga4_enabled: "true",
      seo_ga4_id: "g-abc123xyz",
      seo_gtm_enabled: "false",
      seo_gtm_id: "GTM-AB12CD",
      seo_sitemap_enabled: "true",
      seo_robots_enabled: "true",
      seo_robots_text: "User-agent: *\nDisallow: /cart",
      seo_schema_enabled: "true",
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.settings.seo_ga4_id, "G-ABC123XYZ");
  assert.equal(saved.body.settings.seo_google_enabled, "true");

  const pub = await request(state.app).get("/api/public/store").set("x-store-slug", "seo-shop");
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  const seo = pub.body.googleSeo;
  assert.equal(seo.enabled, true);
  assert.equal(seo.searchConsole.enabled, true);
  assert.equal(seo.searchConsole.code, "aBcD1234-_xyz");
  assert.equal(seo.ga4.enabled, true);
  assert.equal(seo.ga4.id, "G-ABC123XYZ");
  assert.equal(seo.gtm.enabled, false);
  assert.equal(seo.gtm.id, "GTM-AB12CD");
  assert.equal(seo.sitemap.enabled, true);
  assert.equal(seo.robots.enabled, true);
  assert.equal(seo.robots.text, "User-agent: *\nDisallow: /cart");
  assert.equal(seo.schema.enabled, true);

  const row = await Settings.findOne({ key: "store:" + state.store._id + ":seo_ga4_id" }).lean();
  assert.ok(row, "values are stored under the store-scoped key");
  assert.equal(row.value, "G-ABC123XYZ");

  const disabled = await as("put", "/api/settings", { settings: { seo_google_enabled: "false" } });
  assert.equal(disabled.status, 200);
  const pubOff = await request(state.app).get("/api/public/store").set("x-store-slug", "seo-shop");
  assert.equal(pubOff.body.googleSeo.enabled, false);
  assert.equal(pubOff.body.googleSeo.ga4.enabled, false);
  assert.equal(pubOff.body.googleSeo.sitemap.enabled, false);
});
