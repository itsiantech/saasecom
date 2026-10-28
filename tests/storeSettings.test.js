process.env.JWT_SECRET = "store-settings-test-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { tenantStorage } = require("../lib/tenantContext");
const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const StoreSettings = require("../models/StoreSettings");
const SiteSetting = require("../models/SiteSetting");
const ShopFavicon = require("../models/ShopFavicon");
const SocialLink = require("../models/SocialLink");

const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function as(role, method, url, body) {
  const who = role === "a" ? state.ownerA : state.ownerB;
  const slug = role === "a" ? "shop-a" : "shop-b";
  const req = request(state.app)[method](url)
    .set("x-store-slug", slug)
    .set("Authorization", `Bearer ${who.token}`);
  return body === undefined ? req : req.send(body);
}

function pub(query = "") {
  return request(state.app).get(`/api/public/store${query}`).set("x-store-slug", "shop-a");
}

const HOURS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((day) => ({
  day,
  open: "09:00",
  close: "18:00",
  closed: false,
}));

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("store-settings"));
  await Promise.all([Plan.init(), Store.init(), User.init(), StoreSettings.init(), SiteSetting.init()]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const ownerA = await User.create({ name: "Owner A", email: "owner-a@example.com", role: "customer" });
  const ownerB = await User.create({ name: "Owner B", email: "owner-b@example.com", role: "customer" });

  const storeA = await Store.create({
    name: "Shop A",
    slug: "shop-a",
    owner: ownerA._id,
    plan: plan._id,
    currency: "USD",
    contact: {
      phone: "01711111111",
      email: "hello@shop-a.test",
      address: "Old Road, Dhaka",
      mapUrl: "https://maps.example/a",
      hours: "Mon-Fri 9-6",
    },
  });
  const storeB = await Store.create({ name: "Shop B", slug: "shop-b", owner: ownerB._id, plan: plan._id });

  await SiteSetting.create({
    store: storeA._id,
    siteTitle: "Shop A Online",
    footerCopyright: "© Shop A",
  });
  await ShopFavicon.create({ store: storeA._id, icon: "/uploads/a.ico" });
  await StoreSettings.create({
    storeId: storeA._id,
    googleLocation: { address: "Google address", latitude: 23.8103, longitude: 90.4125, embedUrl: "https://maps.google.com/embed/a" },
    currency: { code: "USD", symbol: "$", position: "after", autoCountry: false },
    contact: {
      alternatePhone: "01811111111",
      city: "Dhaka",
      state: "Dhaka",
      country: "Bangladesh",
      postalCode: "1205",
      businessHours: HOURS,
    },
    seo: { metaTitle: "Shop A SEO", metaDescription: "Shop A description", metaKeywords: "shop, a" },
  });
  await SocialLink.create({ store: storeA._id, name: "TikTok", url: "https://tiktok.com/@shopa", sortOrder: 9 });

  state.storeA = storeA;
  state.storeB = storeB;
  state.ownerA = { user: ownerA, token: tokenFor(ownerA) };
  state.ownerB = { user: ownerB, token: tokenFor(ownerB) };

  state.app = express();
  state.app.use(express.json());
  state.app.use(async (req, res, next) => {
    try {
      const slug = String(req.headers["x-store-slug"] || req.query.store || "shop-a").trim().toLowerCase();
      const store = await Store.findOne({ slug });
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

test("settings read is built from the live store docs, not StoreSettings defaults", async () => {
  const res = await as("a", "get", "/api/settings/admin");
  assert.equal(res.status, 200, JSON.stringify(res.body));

  assert.equal(res.body.storeTitle, "Shop A");
  assert.equal(res.body.websiteTitle, "Shop A Online");
  assert.equal(res.body.favicon, "/uploads/a.ico");
  assert.equal(res.body.footerCopyright, "© Shop A");
  assert.equal(res.body.currency.code, "USD");
  assert.equal(res.body.currency.symbol, "$");
  assert.equal(res.body.currency.position, "after");
  assert.equal(res.body.currency.autoCountry, false);
  assert.equal(res.body.language, "bn");
  assert.equal(res.body.contact.phone, "01711111111");
  assert.equal(res.body.contact.email, "hello@shop-a.test");
  assert.equal(res.body.contact.address, "Old Road, Dhaka");
  assert.equal(res.body.contact.alternatePhone, "01811111111");
  assert.equal(res.body.contact.city, "Dhaka");
  assert.equal(res.body.contact.businessHours.length, 7);
  assert.equal(res.body.googleLocation.embedUrl, "https://maps.google.com/embed/a");
  assert.equal(res.body.seo.metaTitle, "Shop A SEO");
});

test("basic save writes the name, title, map url and location through", async () => {
  const res = await as("a", "put", "/api/settings/admin", {
    websiteTitle: "Luxe BD Online",
    storeTitle: "Luxe BD",
    googleLocation: { address: "Gulshan 2", latitude: "23.8103", longitude: "90.4125", embedUrl: "google.com/maps/embed?pb=abc" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.storeTitle, "Luxe BD");
  assert.equal(res.body.websiteTitle, "Luxe BD Online");

  const [store, site, settings] = await Promise.all([
    Store.findById(state.storeA._id).lean(),
    SiteSetting.findOne({ store: state.storeA._id }).lean(),
    StoreSettings.findOne({ storeId: state.storeA._id }).lean(),
  ]);
  assert.equal(store.name, "Luxe BD");
  assert.equal(store.contact.mapUrl, "https://google.com/maps/embed?pb=abc");
  assert.equal(site.siteTitle, "Luxe BD Online");
  assert.equal(settings.googleLocation.address, "Gulshan 2");
  assert.equal(settings.googleLocation.latitude, 23.8103);
  assert.equal(settings.googleLocation.embedUrl, "https://google.com/maps/embed?pb=abc");
});

test("a first save on a new store seeds that store's values, not the schema defaults", async () => {
  const store = await Store.create({
    name: "Shop C",
    slug: "shop-c",
    owner: state.ownerA.user._id,
    plan: state.storeA.plan,
  });
  const res = await request(state.app)
    .put("/api/settings/admin")
    .set("x-store-slug", "shop-c")
    .set("Authorization", `Bearer ${state.ownerA.token}`)
    .send({ contact: { phone: "01799999999" } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.storeTitle, "Shop C");
  assert.equal(res.body.websiteTitle, "Shop C");
  assert.equal(res.body.currency.code, "BDT");
  assert.equal(res.body.currency.symbol, "৳");
  assert.equal(res.body.language, "bn");
  assert.equal(res.body.footerCopyright, "");

  const doc = await StoreSettings.findOne({ storeId: store._id }).lean();
  assert.equal(doc.storeTitle, "Shop C");
  assert.equal(doc.currency.symbol, "৳");
  assert.notEqual(doc.footerCopyright, "© 2024 My Store. All rights reserved.");
  assert.equal(doc.contact.phone, "01799999999");
});

test("a website title equal to the store name unpins siteTitle so the name stays live", async () => {
  const res = await as("a", "put", "/api/settings/admin", { websiteTitle: "Luxe BD", storeTitle: "Luxe BD" });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const site = await SiteSetting.findOne({ store: state.storeA._id }).lean();
  assert.equal(site.siteTitle, "");

  const read = await as("a", "get", "/api/settings/admin");
  assert.equal(read.body.websiteTitle, "Luxe BD");
});

test("contact save composes the storefront address and hours, invalid email is rejected", async () => {
  const hours = [
    ...["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((day) => ({ day, open: "10:00", close: "19:00" })),
    { day: "Saturday", open: "11:00", close: "15:00" },
    { day: "Sunday", open: "09:00", close: "18:00", closed: true },
  ];
  const res = await as("a", "put", "/api/settings/admin", {
    contact: {
      phone: "+880 1700-000000",
      email: "info@luxe.test",
      address: "House 1, Road 2",
      city: "Dhaka",
      state: "Dhaka",
      country: "Bangladesh",
      postalCode: "1212",
      businessHours: hours,
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const store = await Store.findById(state.storeA._id).lean();
  assert.equal(store.contact.phone, "+880 1700-000000");
  assert.equal(store.contact.email, "info@luxe.test");
  assert.equal(store.contact.address, "House 1, Road 2, Dhaka, Dhaka, 1212, Bangladesh");
  assert.equal(store.contact.hours, "Mon-Fri 10:00-19:00, Sat 11:00-15:00, Sun closed");

  const bad = await as("a", "put", "/api/settings/admin", { contact: { email: "not-an-email" } });
  assert.equal(bad.status, 400);
  const again = await Store.findById(state.storeA._id).lean();
  assert.equal(again.contact.email, "info@luxe.test");
});

test("social save upserts networks without wiping links added elsewhere", async () => {
  const saved = await as("a", "put", "/api/settings/admin", {
    social: { facebook: "facebook.com/luxebd", instagram: "", twitter: "" },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.social.facebook, "https://facebook.com/luxebd");
  assert.equal(saved.body.social.instagram, "");

  const rows = await SocialLink.find({ store: state.storeA._id }).lean();
  assert.ok(rows.some((row) => row.name === "Facebook" && row.url === "https://facebook.com/luxebd"));
  assert.ok(rows.some((row) => row.name === "TikTok"), "an unrelated network must survive");
  assert.ok(!rows.some((row) => row.name === "Instagram"));

  const cleared = await as("a", "put", "/api/settings/admin", { social: { facebook: "" } });
  assert.equal(cleared.body.social.facebook, "");
  assert.ok(!(await SocialLink.findOne({ store: state.storeA._id, name: "Facebook" })));
  assert.ok(await SocialLink.findOne({ store: state.storeA._id, name: "TikTok" }));

  const unsafe = await as("a", "put", "/api/settings/admin", { social: { twitter: "javascript:alert(1)" } });
  assert.equal(unsafe.status, 400);
  assert.ok(!(await SocialLink.findOne({ store: state.storeA._id, name: "Twitter" })));
});

test("currency, language and footer save reaches the store row", async () => {
  const saved = await as("a", "put", "/api/settings/admin", {
    currency: { code: "bdt", symbol: "৳", position: "before", autoCountry: true },
    language: "bn",
    footerCopyright: "© 2026 Luxe BD",
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const [store, site, settings] = await Promise.all([
    Store.findById(state.storeA._id).lean(),
    SiteSetting.findOne({ store: state.storeA._id }).lean(),
    StoreSettings.findOne({ storeId: state.storeA._id }).lean(),
  ]);
  assert.equal(store.currency, "BDT");
  assert.equal(store.language, "bn");
  assert.equal(site.footerCopyright, "© 2026 Luxe BD");
  assert.equal(settings.currency.symbol, "৳");

  const badCode = await as("a", "put", "/api/settings/admin", { currency: { code: "taka" } });
  assert.equal(badCode.status, 400);
  const badLang = await as("a", "put", "/api/settings/admin", { language: "es" });
  assert.equal(badLang.status, 400);
});

test("SEO and contact edits show up in the public store payload", async () => {
  const saved = await as("a", "put", "/api/settings/admin", {
    seo: { metaTitle: "Luxe BD — Best Picks", metaDescription: "Shop the best", metaKeywords: "luxe, bd, shop" },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.seo.metaDescription, "Shop the best");

  const res = await pub();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.branding.title, "Luxe BD");
  assert.equal(res.body.seo.title, "Luxe BD — Best Picks");
  assert.equal(res.body.seo.description, "Shop the best");
  assert.equal(res.body.seo.keywords, "luxe, bd, shop");
  assert.equal(res.body.store.contact.phone, "+880 1700-000000");
  assert.equal(res.body.store.language, "bn");
  assert.ok(res.body.social.some((row) => row.name === "TikTok"));
});

test("each store keeps its own settings and strangers are refused", async () => {
  const own = await as("b", "get", "/api/settings/admin");
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.equal(own.body.storeTitle, "Shop B");
  assert.equal(own.body.websiteTitle, "Shop B");
  assert.equal(own.body.contact.phone, "");
  assert.equal(own.body.social.facebook, "");
  assert.equal(own.body.seo.metaTitle, "");

  const saved = await as("b", "put", "/api/settings/admin", { storeTitle: "Shop B Two" });
  assert.equal(saved.status, 200);
  assert.equal((await Store.findById(state.storeB._id).lean()).name, "Shop B Two");
  assert.equal((await Store.findById(state.storeA._id).lean()).name, "Luxe BD");

  const denied = await as("b", "get", "/api/settings/admin").set("x-store-slug", "shop-a");
  assert.equal(denied.status, 403);

  const anonymous = await request(state.app).get("/api/settings/admin").set("x-store-slug", "shop-a");
  assert.equal(anonymous.status, 401);
});

test("favicon upload and delete bridge StoreSettings, SiteSetting and ShopFavicon", async () => {
  const uploaded = await as("a", "post", "/api/settings/admin/favicon")
    .attach("favicon", Buffer.from([0, 0, 1, 0]), { filename: "favicon.ico", contentType: "image/x-icon" });
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  const url = uploaded.body.favicon;
  assert.match(url, /^\/uploads\/settings\//);

  try {
    const [site, shopIcon] = await Promise.all([
      SiteSetting.findOne({ store: state.storeA._id }).lean(),
      ShopFavicon.findOne({ store: state.storeA._id }).lean(),
    ]);
    assert.equal(site.favicon, url);
    assert.equal(shopIcon.icon, url);
    assert.equal((await as("a", "get", "/api/settings/admin")).body.favicon, url);

    const removed = await as("a", "delete", "/api/settings/admin/favicon");
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(removed.body.favicon, "");
    const [siteAfter, shopIconAfter] = await Promise.all([
      SiteSetting.findOne({ store: state.storeA._id }).lean(),
      ShopFavicon.findOne({ store: state.storeA._id }).lean(),
    ]);
    assert.equal(siteAfter.favicon, "");
    assert.equal(shopIconAfter.icon, "");
    assert.notEqual((await as("a", "get", "/api/settings/admin")).body.favicon, url);
  } finally {
    fs.rmSync(path.join(__dirname, "..", "public", url.replace(/^\/+/, "")), { force: true });
  }
});
