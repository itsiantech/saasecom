process.env.JWT_SECRET = "addon-package-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const AdmZip = require("adm-zip");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Store = require("../models/Store");
const Plan = require("../models/Plan");
const User = require("../models/User");
const Settings = require("../models/Settings");
const Addon = require("../models/Addon");
const AuditLog = require("../models/AuditLog");
const addons = require("../lib/addons");

const state = {};
const KEY = "qa-test-addon";

function bearer(user) {
  return "Bearer " + jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function makeZip(files) {
  const zip = new AdmZip();
  Object.entries(files).forEach(([name, content]) => zip.addFile(name, Buffer.from(content)));
  return zip.toBuffer();
}

function validZip(extra = {}, manifestPatch = {}) {
  const manifest = {
    key: KEY,
    name: "QA অ্যাড-অন",
    nameEn: "QA Addon",
    version: "1.0.0",
    entry: "index.html",
    ...manifestPatch,
  };
  return makeZip({
    "manifest.json": JSON.stringify(manifest),
    "index.html": "<!doctype html><html><body><h1>QA addon</h1></body></html>",
    ...extra,
  });
}

function upload(buffer, user, filename = "addon.zip") {
  return request(state.app)
    .post("/api/admin/addons/upload")
    .set("Authorization", bearer(user))
    .attach("zip", buffer, filename);
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("addons"));
  await Promise.all([Store.init(), Plan.init(), User.init(), Settings.init(), Addon.init(), AuditLog.init()]);

  state.superadmin = await User.create({ name: "Root", email: "root@addon.test", role: "superadmin" });
  state.owner = await User.create({ name: "Owner", email: "owner@addon.test", role: "customer" });
  state.plan = await Plan.create({ name: "Pro", slug: "pro", features: {} });
  state.store = await Store.create({ name: "QA Store", slug: "qa-addon-store", owner: state.owner._id, plan: state.plan._id });
  state.currentStore = state.store;

  state.app = express();
  state.app.use(express.json());
  state.app.use("/api/admin", require("../routes/admin"));
  state.app.use(
    "/api/addons",
    (req, _res, next) => {
      req.store = state.currentStore;
      next();
    },
    require("../routes/addons")
  );
}, { timeout: 300000 });

after(async () => {
  await addons.removeAddonFiles(KEY);
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("safeEntryName rejects traversal, absolute and drive paths", () => {
  assert.equal(addons.safeEntryName("../evil.html"), null);
  assert.equal(addons.safeEntryName("a/../../evil.html"), null);
  assert.equal(addons.safeEntryName("/etc/passwd"), null);
  assert.equal(addons.safeEntryName("C:/evil.html"), null);
  assert.equal(addons.safeEntryName("a\\..\\b.html"), null);
  assert.equal(addons.safeEntryName("./ok/file.html"), "ok/file.html");
});

test("a valid zip installs files and creates the addon row", async () => {
  const res = await upload(validZip(), state.superadmin);
  assert.equal(res.status, 201);
  assert.equal(res.body.key, KEY);
  assert.equal(res.body.status, "active");
  assert.equal(res.body.entry, "/addons/" + KEY + "/index.html");
  assert.ok(fs.existsSync(path.join(addons.ADDON_DIR, KEY, "index.html")));
  assert.ok(fs.existsSync(path.join(addons.ADDON_DIR, KEY, "manifest.json")));

  const audit = await AuditLog.findOne({ action: "addon.upload", entityId: res.body.id });
  assert.ok(audit);
});

test("zip without manifest.json is rejected", async () => {
  const res = await upload(makeZip({ "index.html": "<html></html>" }), state.superadmin);
  assert.equal(res.status, 400);
  assert.match(res.body.message, /manifest\.json/);
});

test("zip-slip entry is rejected and nothing is written", async () => {
  // adm-zip addFile() normalizes paths, so the raw entry name is patched back
  // to a traversal path to simulate a hostile zip
  const zip = new AdmZip(validZip());
  zip.addFile("evil.html", Buffer.from("<html></html>"));
  zip.getEntry("evil.html").entryName = "../evil.html";
  const res = await upload(zip.toBuffer(), state.superadmin);
  assert.equal(res.status, 400);
  assert.ok(!fs.existsSync(path.join(addons.ADDON_DIR, "..", "evil.html")));
});

test("forbidden extensions are rejected", async () => {
  const res = await upload(validZip({ "server.php": "<?php echo 1;" }), state.superadmin);
  assert.equal(res.status, 400);
  assert.match(res.body.message, /অনুমোদিত নয়/);
});

test("svg is rejected inside add-on packages", async () => {
  const res = await upload(validZip({ "icon.svg": "<svg></svg>" }), state.superadmin);
  assert.equal(res.status, 400);
});

test("non-zip bytes are rejected", async () => {
  const res = await upload(Buffer.from("not a zip at all"), state.superadmin);
  assert.equal(res.status, 400);
  assert.match(res.body.message, /zip/);
});

test("entry file missing from the zip is rejected", async () => {
  const res = await upload(validZip({}, { entry: "missing.html" }), state.superadmin);
  assert.equal(res.status, 400);
  assert.match(res.body.message, /entry/);
});

test("store owner cannot upload, list or delete addons", async () => {
  const up = await upload(validZip(), state.owner);
  assert.equal(up.status, 403);
  const list = await request(state.app).get("/api/admin/addons").set("Authorization", bearer(state.owner));
  assert.equal(list.status, 403);
  const row = await Addon.findOne({ key: KEY });
  const del = await request(state.app).delete("/api/admin/addons/" + row._id).set("Authorization", bearer(state.owner));
  assert.equal(del.status, 403);
});

test("same key re-upload replaces the package and keeps status", async () => {
  const res = await upload(validZip({}, { version: "2.0.0" }), state.superadmin);
  assert.equal(res.status, 200);
  assert.equal(res.body.version, "2.0.0");
  const rows = await Addon.find({ key: KEY });
  assert.equal(rows.length, 1);
});

test("store dashboard list shows the active addon for owner and superadmin", async () => {
  const res = await request(state.app).get("/api/addons").set("Authorization", bearer(state.owner));
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].key, KEY);
  assert.equal(res.body[0].entry, "/addons/" + KEY + "/index.html");

  const anon = await request(state.app).get("/api/addons");
  assert.equal(anon.status, 401);
});

test("global disable hides the addon from every store", async () => {
  const row = await Addon.findOne({ key: KEY });
  const res = await request(state.app)
    .patch("/api/admin/addons/" + row._id)
    .set("Authorization", bearer(state.superadmin))
    .send({ status: "disabled" });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "disabled");

  const list = await request(state.app).get("/api/addons").set("Authorization", bearer(state.owner));
  assert.equal(list.body.length, 0);

  await request(state.app)
    .patch("/api/admin/addons/" + row._id)
    .set("Authorization", bearer(state.superadmin))
    .send({ status: "active" })
    .expect(200);
});

test("per-store disable hides the addon only for that store and is audited", async () => {
  const other = await Store.create({ name: "Other", slug: "qa-addon-other", owner: state.owner._id, plan: state.plan._id });
  const res = await request(state.app)
    .patch("/api/admin/stores/" + state.store._id + "/addons")
    .set("Authorization", bearer(state.superadmin))
    .send({ disabled: [KEY, "unknown-key"] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.disabledAddons, [KEY]);
  // tenant middleware protita request-e fresh store dey — test-o tai korbe
  state.currentStore = await Store.findById(state.store._id);

  const list = await request(state.app).get("/api/addons").set("Authorization", bearer(state.owner));
  assert.equal(list.body.length, 0);

  state.currentStore = other;
  const otherList = await request(state.app).get("/api/addons").set("Authorization", bearer(state.owner));
  assert.equal(otherList.body.length, 1);
  state.currentStore = state.store;

  const audit = await AuditLog.findOne({ action: "store.addons.update", entityId: String(state.store._id) });
  assert.ok(audit);
  assert.deepEqual(audit.newValue.disabledAddons, [KEY]);

  // owner nijer dokaner addon list bodlate parbe na
  const ownerPatch = await request(state.app)
    .patch("/api/admin/stores/" + state.store._id + "/addons")
    .set("Authorization", bearer(state.owner))
    .send({ disabled: [] });
  assert.equal(ownerPatch.status, 403);
});

test("admin list counts enabled stores", async () => {
  const res = await request(state.app).get("/api/admin/addons").set("Authorization", bearer(state.superadmin));
  assert.equal(res.status, 200);
  const row = res.body.find((a) => a.key === KEY);
  assert.equal(row.enabledStores, 1); // duita store-er ekta off
});

test("delete removes files, the row, and orphan store keys", async () => {
  const row = await Addon.findOne({ key: KEY });
  const res = await request(state.app)
    .delete("/api/admin/addons/" + row._id)
    .set("Authorization", bearer(state.superadmin));
  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, true);
  assert.ok(!fs.existsSync(path.join(addons.ADDON_DIR, KEY)));
  assert.equal(await Addon.countDocuments({ key: KEY }), 0);
  const fresh = await Store.findById(state.store._id);
  assert.deepEqual(fresh.disabledAddons, []);
});