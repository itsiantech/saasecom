process.env.JWT_SECRET = "landing-content-secret";
process.env.PLATFORM_DOMAIN = "amarbazaar.bd";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const { MongoMemoryServer } = require("mongodb-memory-server");

const User = require("../models/User");
const Settings = require("../models/Settings");
const landing = require("../lib/landingContent");

const state = {};

before(async () => {
  state.mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
  await mongoose.connect(state.mongo.getUri("landing_content"));
  await Promise.all([User.init(), Settings.init()]);

  state.superadmin = await User.create({ name: "Root", email: "root@example.com", role: "superadmin" });
  state.owner = await User.create({ name: "Owner", email: "owner@example.com", role: "admin" });
  state.superToken = jwt.sign({ id: state.superadmin._id.toString(), role: "superadmin" }, process.env.JWT_SECRET);
  state.ownerToken = jwt.sign({ id: state.owner._id.toString(), role: "admin" }, process.env.JWT_SECRET);

  state.app = express();
  state.app.use(express.json());
  state.app.use("/api/admin", require("../routes/admin"));
  state.app.use("/api/public", require("../routes/publicApi"));
  state.app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

function admin(method, url, token) {
  return request(state.app)[method](url).set("Authorization", "Bearer " + (token || state.superToken));
}

test("defaults carry every landing section", () => {
  const value = landing.defaults();
  assert.equal(value.brand.name, "Amar");
  assert.equal(value.brand.accent, "Bazaar");
  assert.equal(value.nav.links.length, 4);
  assert.equal(value.features.items.length, 7);
  assert.equal(value.features.items[6].wide, true);
  assert.equal(value.pricing.plans.length, 2);
  assert.equal(value.steps.items.length, 5);
  assert.equal(value.designs.items.length, 4);
  assert.equal(value.faq.items.length, 4);
  assert.equal(value.whatsapp.enabled, true);
  assert.deepEqual(value.extras, []);
});

test("normalize keeps safe values and rejects hostile ones", () => {
  const out = landing.normalizeContent({
    nav: {
      loginHref: "javascript:alert(1)",
      ctaHref: "https://example.com/start",
      links: [{ label: "হোম", href: "/" }, { label: "বাইরে", href: "https://ok.test/x" }],
    },
    brand: { name: "  Test   Shop ", accent: "Store", logo: "javascript:alert(1)" },
    hero: {
      title: "নতুন শিরোনাম",
      primaryHref: "//evil.test",
      chips: [
        { label: "bKash", color: "#e2136e" },
        { label: "X", color: "red" },
        { label: "Y", color: "#ff0000" },
        { label: "Z", color: "#00ff00" },
      ],
    },
    designs: { items: [{ name: "One", image: "/uploads/landing/a.jpg", scene: "ev" }] },
    extras: [
      {
        id: "promo",
        title: "অফার",
        body: "লাইন এক\nলাইন দুই",
        buttonHref: "https://example.com/promo",
        image: "https://cdn.example.com/promo.jpg",
      },
      { id: "bad id!", buttonHref: "javascript:alert(1)" },
    ],
  });

  assert.equal(out.brand.name, "Test Shop");
  assert.equal(out.brand.logo, "");
  assert.equal(out.nav.loginHref, landing.defaults().nav.loginHref);
  assert.equal(out.nav.ctaHref, "https://example.com/start");
  assert.equal(out.nav.links[0].href, "/");
  assert.equal(out.hero.primaryHref, landing.defaults().hero.primaryHref);
  assert.equal(out.hero.chips.length, 3, "chips are capped at the three mock positions");
  assert.equal(out.hero.chips[1].color, landing.defaults().hero.chips[1].color);
  assert.equal(out.designs.items[0].image, "/uploads/landing/a.jpg");
  assert.equal(out.extras.length, 2);
  assert.equal(out.extras[0].id, "promo");
  assert.match(out.extras[0].body, /লাইন এক/);
  assert.notEqual(out.extras[1].id, "bad id!");
  assert.equal(out.extras[1].buttonHref, "");
});

test("public landing API returns defaults before anything is saved", async () => {
  const res = await request(state.app).get("/api/public/landing");
  assert.equal(res.status, 200);
  assert.equal(res.body.content.brand.name, "Amar");
  assert.equal(res.headers["cache-control"], "no-store");
});

test("only superadmin can read or write landing content", async () => {
  const read = await admin("get", "/api/admin/settings/landing/content", state.ownerToken);
  assert.equal(read.status, 403);

  const write = await admin("put", "/api/admin/settings/landing/content", state.ownerToken).send({
    content: { brand: { name: "Hack" } },
  });
  assert.equal(write.status, 403);

  const anon = await request(state.app).get("/api/admin/settings/landing/content");
  assert.equal(anon.status, 401);
});

test("superadmin saves content and the public page sees it", async () => {
  const saved = await admin("put", "/api/admin/settings/landing/content").send({
    content: {
      brand: { name: "Amar", accent: "Bazar", logo: "/uploads/landing/logo.png" },
      hero: { title: "নতুন হিরো" },
      features: {
        items: [
          { title: "A", text: "a" },
          { title: "B", text: "b", wide: true },
        ],
      },
      extras: [
        {
          id: "notice",
          title: "নোটিশ",
          body: "ঈদ অফার চলছে",
          after: "hero",
          enabled: true,
        },
      ],
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.content.hero.title, "নতুন হিরো");
  assert.equal(saved.body.content.features.items.length, 2);
  assert.equal(saved.body.content.features.eyebrow, landing.defaults().features.eyebrow);
  assert.equal(saved.body.content.extras[0].after, "hero");

  const pub = await request(state.app).get("/api/public/landing");
  assert.equal(pub.body.content.hero.title, "নতুন হিরো");
  assert.equal(pub.body.content.brand.accent, "Bazar");
  assert.equal(pub.body.content.extras.length, 1);

  const stored = await Settings.findOne({ key: landing.SETTINGS_KEY });
  assert.ok(stored && stored.value.includes("নতুন হিরো"));

  const read = await admin("get", "/api/admin/settings/landing/content");
  assert.equal(read.body.content.hero.title, "নতুন হিরো");
});

test("partial saves merge into existing content", async () => {
  const saved = await admin("put", "/api/admin/settings/landing/content").send({
    content: { cta: { title: "শেষ কথা" } },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.content.cta.title, "শেষ কথা");
  assert.equal(saved.body.content.hero.title, "নতুন হিরো");
  assert.equal(saved.body.content.features.items.length, 2);
});