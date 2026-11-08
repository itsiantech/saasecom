process.env.JWT_SECRET = "landing-branding-secret";
process.env.PLATFORM_DOMAIN = "amarbazaar.bd";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const { MongoMemoryServer } = require("mongodb-memory-server");

const User = require("../models/User");
const Settings = require("../models/Settings");
const branding = require("../lib/landingBranding");

const state = { uploaded: [] };

before(async () => {
  state.mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
  await mongoose.connect(state.mongo.getUri("landing_branding"));
  await Promise.all([User.init(), Settings.init()]);

  state.superadmin = await User.create({ name: "Root", email: "root@example.com", role: "superadmin" });
  state.owner = await User.create({ name: "Owner", email: "owner@example.com", role: "admin" });
  state.superToken = jwt.sign({ id: state.superadmin._id.toString(), role: "superadmin" }, process.env.JWT_SECRET);
  state.ownerToken = jwt.sign({ id: state.owner._id.toString(), role: "admin" }, process.env.JWT_SECRET);

  state.app = express();
  state.app.use(express.json());
  state.app.use("/api/admin", require("../routes/admin"));
  state.app.use("/api/public", require("../routes/publicApi"));
  state.app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  for (const url of state.uploaded) {
    const file = path.join(__dirname, "..", "public", ...url.split("/").filter(Boolean));
    await fs.promises.unlink(file).catch(() => {});
  }
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

function admin(method, url, token) {
  return request(state.app)[method](url).set("Authorization", "Bearer " + token);
}

test("defaults cover every branding field", () => {
  const value = branding.defaults();
  assert.deepEqual(Object.keys(value).sort(), ["copyright", "favicon", "footerLeft", "footerRight", "logo", "title"]);
  assert.equal(value.logo, "");
  assert.equal(value.favicon, "");
  assert.equal(value.footerRight, branding.DEFAULT_FOOTER_RIGHT);
  assert.match(value.copyright, new RegExp(String(new Date().getFullYear())));
});

test("text fields are trimmed, capped and unknown keys dropped", () => {
  const value = branding.normalizeBranding({
    title: "  My   Platform  ",
    footerLeft: " left ",
    footerRight: "right",
    copyright: "Design and Developed by ITSIAN",
    evil: "<script>alert(1)</script>",
    logo: 42,
  });
  assert.equal(value.title, "My Platform");
  assert.equal(value.footerLeft, "left");
  assert.equal(value.footerRight, "right");
  assert.equal(value.copyright, "Design and Developed by ITSIAN");
  assert.equal(value.logo, "");
  assert.ok(!("evil" in value));

  assert.equal(branding.normalizeBranding({ title: "   " }).title, branding.DEFAULT_TITLE);
  assert.equal(branding.normalizeBranding({ footerLeft: "" }).footerLeft, "");
  assert.equal(branding.normalizeBranding({ title: "x".repeat(300) }).title.length, 140);
});

test("only uploaded paths and http(s) urls survive normalization", () => {
  assert.equal(branding.cleanImage("/uploads/branding/logo.png"), "/uploads/branding/logo.png");
  assert.equal(branding.cleanImage("https://cdn.example.com/logo.svg"), "https://cdn.example.com/logo.svg");
  assert.equal(branding.cleanImage("javascript:alert(1)"), "");
  assert.equal(branding.cleanImage("data:image/svg+xml,<svg/>"), "");
  assert.equal(branding.cleanImage("/uploads/../../etc/passwd"), "");
  assert.equal(branding.cleanImage("logo.png"), "");
});

test("parseBranding survives broken rows", () => {
  assert.deepEqual(branding.parseBranding(""), branding.defaults());
  assert.deepEqual(branding.parseBranding("{not json"), branding.defaults());
  assert.equal(branding.parseBranding(JSON.stringify({ title: "Saved" })).title, "Saved");
});

test("public branding is readable without a login", async () => {
  const res = await request(state.app).get("/api/public/branding");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.branding.title, branding.DEFAULT_TITLE);
});

test("only the superadmin can read or write landing settings", async () => {
  const anon = await request(state.app).get("/api/admin/settings/landing");
  assert.equal(anon.status, 401);

  const ownerGet = await admin("get", "/api/admin/settings/landing", state.ownerToken);
  assert.equal(ownerGet.status, 403);

  const ownerPut = await admin("put", "/api/admin/settings/landing", state.ownerToken).send({ branding: { title: "hack" } });
  assert.equal(ownerPut.status, 403);

  const ok = await admin("get", "/api/admin/settings/landing", state.superToken);
  assert.equal(ok.status, 200);
  assert.ok(ok.body.branding);
});

test("saving updates the landing texts and is visible publicly", async () => {
  const res = await admin("put", "/api/admin/settings/landing", state.superToken).send({
    branding: {
      title: "আমার প্ল্যাটফর্ম",
      footerLeft: "",
      copyright: "Design and Developed by ITSIAN",
      footerRight: "Built in Bangladesh",
      logo: "javascript:alert(1)",
      favicon: "https://cdn.example.com/favicon.ico",
      evil: "nope",
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.branding.title, "আমার প্ল্যাটফর্ম");
  assert.equal(res.body.branding.footerLeft, "");
  assert.equal(res.body.branding.copyright, "Design and Developed by ITSIAN");
  assert.equal(res.body.branding.footerRight, "Built in Bangladesh");
  assert.equal(res.body.branding.logo, "");
  assert.equal(res.body.branding.favicon, "https://cdn.example.com/favicon.ico");
  assert.ok(!("evil" in res.body.branding));

  const pub = await request(state.app).get("/api/public/branding");
  assert.equal(pub.status, 200);
  assert.equal(pub.body.branding.title, "আমার প্ল্যাটফর্ম");
  assert.equal(pub.body.branding.copyright, "Design and Developed by ITSIAN");

  const blank = await admin("put", "/api/admin/settings/landing", state.superToken).send({ branding: { title: "  " } });
  assert.equal(blank.body.branding.title, branding.DEFAULT_TITLE);
  assert.equal(blank.body.branding.footerRight, "Built in Bangladesh");
});

test("logo upload stores the image and remove clears it", async () => {
  const upload = await admin("post", "/api/admin/settings/landing/logo", state.superToken).attach(
    "logo",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
      "base64"
    ),
    { filename: "logo.png", contentType: "image/png" }
  );
  assert.equal(upload.status, 200, JSON.stringify(upload.body));
  assert.match(upload.body.logo, /^\/uploads\/branding\/[A-Za-z0-9._-]+\.png$/);
  assert.equal(upload.body.branding.logo, upload.body.logo);
  state.uploaded.push(upload.body.logo);

  const pub = await request(state.app).get("/api/public/branding");
  assert.equal(pub.body.branding.logo, upload.body.logo);

  const removed = await admin("delete", "/api/admin/settings/landing/logo", state.superToken);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.branding.logo, "");
});

test("oversized uploads are refused with a clear message", async () => {
  const res = await admin("post", "/api/admin/settings/landing/logo", state.superToken).attach(
    "logo",
    Buffer.alloc(10 * 1024 * 1024 + 1024, 0x89),
    { filename: "big.png", contentType: "image/png" }
  );
  assert.equal(res.status, 400);
  assert.match(res.body.message, /10MB/);
});

test("non-superadmins cannot upload branding images", async () => {
  const res = await admin("post", "/api/admin/settings/landing/favicon", state.ownerToken).attach(
    "favicon",
    Buffer.from([0x00]),
    { filename: "favicon.png", contentType: "image/png" }
  );
  assert.equal(res.status, 403);
});
