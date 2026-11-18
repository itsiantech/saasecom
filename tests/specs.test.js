process.env.JWT_SECRET = "specs-test-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { tenantStorage } = require("../lib/tenantContext");
const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Category = require("../models/Category");
const Product = require("../models/Product");
const SpecDefinition = require("../models/SpecDefinition");
const { planHas } = require("../lib/features");

const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function as(storeSlug, method, url, body, token) {
  const req = request(state.app)[method](url)
    .set("x-store-slug", storeSlug)
    .set("Authorization", `Bearer ${token || state.tokenA}`);
  if (body === undefined) return req;
  if (typeof body === "string") return req.set("Content-Type", "text/csv").send(body);
  return req.send(body);
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("specs"));
  await Promise.all([
    Plan.init(),
    Store.init(),
    User.init(),
    Category.init(),
    Product.init(),
    SpecDefinition.init(),
  ]);

  const pro = await Plan.create({ name: "Pro", slug: "pro", features: { productBuilder: true } });
  const lite = await Plan.create({ name: "Lite", slug: "lite", features: { productBuilder: false } });

  const ownerA = await User.create({ name: "Owner A", email: "spec-a@example.com", role: "customer" });
  const ownerB = await User.create({ name: "Owner B", email: "spec-b@example.com", role: "customer" });
  const ownerC = await User.create({ name: "Owner C", email: "spec-c@example.com", role: "customer" });
  state.ownerA = ownerA;

  state.storeA = await Store.create({ name: "Specs A", slug: "spec-a", owner: ownerA._id, plan: pro._id });
  state.storeB = await Store.create({ name: "Specs B", slug: "spec-b", owner: ownerB._id, plan: pro._id });
  state.storeC = await Store.create({ name: "Specs C", slug: "spec-c", owner: ownerC._id, plan: lite._id });

  state.tokenA = tokenFor(ownerA);
  state.tokenB = tokenFor(ownerB);
  state.tokenC = tokenFor(ownerC);

  state.catA = await Category.create({ store: state.storeA._id, name: "Laptops", slug: "laptops", status: "published" });
  state.catA2 = await Category.create({ store: state.storeA._id, name: "Desktops", slug: "desktops", status: "published" });
  state.catB = await Category.create({ store: state.storeB._id, name: "Laptops", slug: "laptops", status: "published" });

  state.app = express();
  state.app.use(express.json());
  state.app.use(async (req, res, next) => {
    try {
      const slug = String(req.headers["x-store-slug"] || "").trim().toLowerCase();
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
  state.app.use("/api/specs", require("../routes/specs"));
  state.app.use("/api/product-form", require("../routes/productForm"));
  state.app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("productBuilder is off by default for plans that predate it", () => {
  assert.equal(planHas({ features: {} }, "productBuilder"), false);
  assert.equal(planHas({ features: { productBuilder: true } }, "productBuilder"), true);
});

test("the specs API answers 403 while the plan has no productBuilder", async () => {
  const res = await as("spec-c", "get", "/api/specs", undefined, state.tokenC);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "feature_locked");
  assert.equal(res.body.feature, "productBuilder");
});

test("creating a spec validates key, label, type and enum values", async () => {
  const badKey = await as("spec-a", "post", "/api/specs", { key: "9cpu", label: "CPU" });
  assert.equal(badKey.status, 400);

  const noLabel = await as("spec-a", "post", "/api/specs", { key: "cpu", label: "" });
  assert.equal(noLabel.status, 400);

  const badType = await as("spec-a", "post", "/api/specs", { key: "cpu", label: "CPU", type: "video" });
  assert.equal(badType.status, 400);

  const noEnums = await as("spec-a", "post", "/api/specs", {
    key: "socket",
    label: "Socket",
    type: "enum",
    category: String(state.catA._id),
  });
  assert.equal(noEnums.status, 400);
});

test("specs are scoped to the store and unique per category + key", async () => {
  const created = await as("spec-a", "post", "/api/specs", {
    category: String(state.catA._id),
    key: "cpu_socket",
    label: "CPU socket",
    labelBn: "সিপিইউ সকেট",
    type: "enum",
    enumValues: [{ value: "lga1700", label: "LGA 1700" }, { value: "am5", label: "AM5" }],
    filterable: true,
    showInList: true,
    sortOrder: 1,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.key, "cpu_socket");
  state.socketId = created.body._id;

  const storeWide = await as("spec-a", "post", "/api/specs", {
    key: "origin",
    label: "Origin",
    type: "text",
    category: null,
  });
  assert.equal(storeWide.status, 201);
  state.originId = storeWide.body._id;

  const duplicate = await as("spec-a", "post", "/api/specs", {
    category: String(state.catA._id),
    key: "cpu_socket",
    label: "Duplicate",
  });
  assert.equal(duplicate.status, 409);

  const listA = await as("spec-a", "get", "/api/specs");
  assert.equal(listA.status, 200);
  assert.equal(listA.body.total, 2);
  assert.ok(listA.body.definitions.find((d) => d.key === "cpu_socket").categoryName === "Laptops");

  const listB = await as("spec-b", "get", "/api/specs", undefined, state.tokenB);
  assert.equal(listB.status, 200);
  assert.equal(listB.body.total, 0);

  const editFromB = await as("spec-b", "put", "/api/specs/" + state.socketId, { label: "Hijack" }, state.tokenB);
  assert.equal(editFromB.status, 404);

  const deleteFromB = await as("spec-b", "delete", "/api/specs/" + state.socketId, undefined, state.tokenB);
  assert.equal(deleteFromB.status, 404);
});

test("meta returns category scoped plus store-wide specs and reorder persists", async () => {
  const second = await as("spec-a", "post", "/api/specs", {
    category: String(state.catA._id),
    key: "ram",
    label: "RAM",
    type: "number",
    unit: "GB",
    sortOrder: 5,
  });
  assert.equal(second.status, 201);
  state.ramId = second.body._id;

  const meta = await as("spec-a", "get", "/api/specs/meta?categories=" + state.catA._id);
  assert.equal(meta.status, 200);
  const keys = meta.body.definitions.map((d) => d.key).sort();
  assert.deepEqual(keys, ["cpu_socket", "origin", "ram"]);

  const other = await as("spec-a", "get", "/api/specs/meta?categories=" + state.catA2._id);
  assert.deepEqual(other.body.definitions.map((d) => d.key), ["origin"]);

  const reorder = await as("spec-a", "post", "/api/specs/reorder", {
    ids: [state.ramId, String(state.socketId), state.originId].map(String),
  });
  assert.equal(reorder.status, 200);
  const ram = await SpecDefinition.findById(state.ramId).lean();
  assert.equal(ram.sortOrder, 0);
});

test("product form saves typed specs, rejects unknown keys and keeps specs on partial update", async () => {
  const created = await as("spec-a", "post", "/api/product-form", {
    title: "Builder laptop",
    regularPrice: 1000,
    stock: 5,
    categories: [String(state.catA._id)],
    specs: { cpu_socket: "AM5", ram: "16", origin: "  China  " },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.product.specs, { cpu_socket: "am5", ram: 16, origin: "China" });
  state.productId = created.body.product._id;

  const unknown = await as("spec-a", "post", "/api/product-form", {
    title: "Bad laptop",
    regularPrice: 10,
    categories: [String(state.catA._id)],
    specs: { nope: "x" },
  });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.message, /nope/);

  const wrongCategory = await as("spec-a", "post", "/api/product-form", {
    title: "Desktop",
    regularPrice: 10,
    categories: [String(state.catA2._id)],
    specs: { ram: 8 },
  });
  assert.equal(wrongCategory.status, 400);

  const partial = await as("spec-a", "put", "/api/product-form/" + state.productId, {
    title: "Builder laptop",
    regularPrice: 1000,
    stock: 5,
    categories: [String(state.catA._id)],
  });
  assert.equal(partial.status, 200);
  assert.deepEqual(partial.body.product.specs, { cpu_socket: "am5", ram: 16, origin: "China" });

  const cleared = await as("spec-a", "put", "/api/product-form/" + state.productId, {
    title: "Builder laptop",
    regularPrice: 1000,
    stock: 5,
    categories: [String(state.catA._id)],
    specs: {},
  });
  assert.equal(cleared.status, 200);
  // mongoose minimizes an empty Mixed map to undefined — either way there are no values
  assert.equal(Object.keys(cleared.body.product.specs || {}).length, 0);

  const loaded = await as("spec-a", "get", "/api/product-form/" + state.productId);
  assert.equal(loaded.status, 200);
  assert.equal(Object.keys(loaded.body.product.specs || {}).length, 0);
});

test("product form meta exposes spec definitions for the Specification card", async () => {
  const res = await as("spec-a", "get", "/api/product-form/meta");
  assert.equal(res.status, 200);
  const keys = res.body.specDefinitions.map((d) => d.key).sort();
  assert.deepEqual(keys, ["cpu_socket", "origin", "ram"]);
  const socket = res.body.specDefinitions.find((d) => d.key === "cpu_socket");
  assert.equal(socket.category, String(state.catA._id));
  assert.equal(socket.enumValues.length, 2);
});

test("CSV import previews creates, updates and validation errors, then applies", async () => {
  const good = [
    "category,key,label,label_bn,type,unit,enum_values,filterable,show_in_list,active,sort_order",
    "laptops,weight,Weight,,number,kg,,true,false,true,3",
    ",warranty,Warranty,,text,,,false,false,true,9",
    "laptops,cpu_socket,CPU socket,,enum,,lga1700|am5,true,true,true,1",
  ].join("\n");

  const preview = await as("spec-a", "post", "/api/specs/import", good);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.ok, true);
  assert.equal(preview.body.total, 3);
  assert.equal(preview.body.creates, 2);
  assert.equal(preview.body.updates, 1);

  const broken = [
    "category,key,label,type",
    "missing,weight,Weight,text",
    "laptops,9bad,Bad,text",
    "laptops,ram,RAM,number",
    "laptops,ram,RAM again,number",
  ].join("\n");
  const rejected = await as("spec-a", "post", "/api/specs/import", broken);
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.ok, false);
  assert.equal(rejected.body.errors.length, 3);
  assert.equal(rejected.body.errors[0].line, 2);

  const applyBroken = await as("spec-a", "post", "/api/specs/import?dryRun=0", broken);
  assert.equal(applyBroken.status, 400);
  assert.equal(applyBroken.body.errors.length, 3);

  const applied = await as("spec-a", "post", "/api/specs/import?dryRun=0", good);
  assert.equal(applied.status, 200);
  assert.equal(applied.body.creates, 2);
  assert.equal(applied.body.updates, 1);

  const list = await as("spec-a", "get", "/api/specs");
  assert.equal(list.body.total, 5); // cpu_socket, origin, ram + weight, warranty

  const exported = await as("spec-a", "get", "/api/specs/export.csv");
  assert.equal(exported.status, 200);
  assert.match(exported.headers["content-type"], /text\/csv/);
  assert.match(exported.text, /Weight/);
  assert.match(exported.text, /lga1700/);
});

test("deleting a spec removes it from the list", async () => {
  const res = await as("spec-a", "delete", "/api/specs/" + state.socketId);
  assert.equal(res.status, 200);
  const list = await as("spec-a", "get", "/api/specs");
  assert.equal(list.body.definitions.some((d) => d.key === "cpu_socket"), false);
});
