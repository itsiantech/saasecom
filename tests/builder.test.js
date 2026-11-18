process.env.JWT_SECRET = "builder-test-secret";

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
const ProductCategory = require("../models/ProductCategory");
const BuilderTemplate = require("../models/BuilderTemplate");
const SavedBuild = require("../models/SavedBuild");
const BuilderEvent = require("../models/BuilderEvent");
const Cart = require("../models/Cart");
const { cleanTemplate } = require("../lib/builderTemplates");
const { evaluateRules } = require("../lib/builderRules");

const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function as(method, url, { store = "builder-a", body, token } = {}) {
  const req = request(state.app)[method](url).set("x-store-slug", store).set("x-session-id", "guest-session");
  if (token) req.set("Authorization", `Bearer ${token}`);
  if (body === undefined) return req;
  return req.send(body);
}

const TEMPLATE_INPUT = {
  name: "PC Builder",
  slug: "pc-builder",
  status: "published",
  groups: [{ key: "core", name: "Core", nameBn: "মূল" }],
  slots: [
    { key: "cpu", label: "Processor", labelBn: "প্রসেসর", group: "core", required: true, filter: { categories: [] } },
    { key: "motherboard", label: "Motherboard", labelBn: "মাদারবোর্ড", group: "core", required: true, filter: { categories: [] } },
    { key: "gpu", label: "Graphics card", labelBn: "গ্রাফিক্স কার্ড", group: "core", filter: { categories: [] } },
    { key: "psu", label: "Power supply", labelBn: "পাওয়ার সাপ্লাই", group: "core" },
    { key: "case", label: "Case", labelBn: "কেস", group: "core" },
  ],
  rules: [
    {
      key: "cpu-socket",
      type: "set-membership",
      level: "block",
      message: "CPU socket is not supported by this motherboard",
      messageBn: "সিপিইউ সকেট এই মাদারবোর্ডে সাপোর্টেড নয়",
      left: { slot: "cpu", spec: "socket" },
      right: { slot: "motherboard", spec: "sockets" },
    },
    {
      key: "gpu-clearance",
      type: "lte",
      level: "block",
      message: "Graphics card is too long for this case",
      messageBn: "গ্রাফিক্স কার্ড কেসে ফিট করবে না",
      left: { slot: "gpu", spec: "length" },
      right: { slot: "case", spec: "max_gpu_length" },
    },
    {
      key: "psu-power",
      type: "sum-lte",
      level: "block",
      message: "Power supply would be overloaded",
      messageBn: "পাওয়ার সাপ্লাই ওভারলোড হবে",
      terms: [
        { slot: "cpu", spec: "tdp" },
        { slot: "gpu", spec: "tdp", multiplier: 1.2 },
      ],
      limit: 650,
    },
    {
      key: "gpu-slot",
      type: "equals",
      level: "block",
      message: "Graphics card slot does not match the motherboard",
      messageBn: "গ্রাফিক্স কার্ডের স্লট মাদারবোর্ডের সাথে মিলছে না",
      left: { slot: "gpu", spec: "slot_type" },
      right: { slot: "motherboard", spec: "gpu_slot" },
    },
    {
      key: "warranty",
      type: "gte",
      level: "warn",
      message: "CPU warranty is shorter than the motherboard warranty",
      messageBn: "সিপিইউ ওয়ারেন্টি মাদারবোর্ডের ওয়ারেন্টির চেয়ে কম",
      left: { slot: "cpu", spec: "warranty_months" },
      right: { slot: "motherboard", spec: "warranty_months" },
    },
  ],
};

async function product(storeId, title, specs, extra = {}) {
  return Product.create({
    store: storeId,
    title,
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    status: "published",
    regularPrice: 1000,
    stock: 10,
    specs,
    ...extra,
  });
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("builder"));
  await Promise.all([
    Plan.init(),
    Store.init(),
    User.init(),
    Category.init(),
    Product.init(),
    ProductCategory.init(),
    BuilderTemplate.init(),
    SavedBuild.init(),
    Cart.init(),
  ]);

  const pro = await Plan.create({ name: "Pro", slug: "pro", features: { productBuilder: true } });
  const lite = await Plan.create({ name: "Lite", slug: "lite", features: { productBuilder: false } });

  const ownerA = await User.create({ name: "Owner A", email: "builder-a@example.com", role: "customer" });
  const ownerB = await User.create({ name: "Owner B", email: "builder-b@example.com", role: "customer" });
  const ownerC = await User.create({ name: "Owner C", email: "builder-c@example.com", role: "customer" });
  const shopper = await User.create({ name: "Shopper", email: "shopper@example.com", role: "customer" });
  state.shopperToken = tokenFor(shopper);
  state.tokenA = tokenFor(ownerA);
  state.tokenB = tokenFor(ownerB);
  state.tokenC = tokenFor(ownerC);

  state.storeA = await Store.create({ name: "Builder A", slug: "builder-a", owner: ownerA._id, plan: pro._id });
  state.storeB = await Store.create({ name: "Builder B", slug: "builder-b", owner: ownerB._id, plan: pro._id });
  state.storeC = await Store.create({ name: "Builder C", slug: "builder-c", owner: ownerC._id, plan: lite._id });

  state.catCpu = await Category.create({ store: state.storeA._id, name: "CPU", slug: "cpu", status: "published" });
  state.catMb = await Category.create({ store: state.storeA._id, name: "Motherboard", slug: "mb", status: "published" });
  state.catGpu = await Category.create({ store: state.storeA._id, name: "GPU", slug: "gpu", status: "published" });

  state.cpuAmd = await product(state.storeA._id, "AMD Ryzen", {
    socket: "am5",
    tdp: 105,
    warranty_months: 12,
  }, { salePrice: 20000, categories: [state.catCpu._id] });
  state.cpuIntel = await product(state.storeA._id, "Intel Core", {
    socket: "lga1700",
    tdp: 125,
    warranty_months: 36,
  }, { regularPrice: 18000, categories: [state.catCpu._id] });
  state.cpuMystery = await product(state.storeA._id, "Mystery CPU", undefined, {
    categories: [state.catCpu._id],
  });

  state.mbAm5 = await product(state.storeA._id, "ASUS AM5", {
    socket: "am5",
    sockets: ["am5", "am4"],
    gpu_slot: "pcie5",
    warranty_months: 24,
  }, { categories: [state.catMb._id] });
  state.mbIntel = await product(state.storeA._id, "MSI Intel", {
    socket: "lga1700",
    sockets: ["lga1700"],
    gpu_slot: "pcie5",
    warranty_months: 24,
  }, { regularPrice: 15000 });

  // join-only product: must show up in the slot via ProductCategory
  await ProductCategory.create({ store: state.storeA._id, product: state.mbIntel._id, category: state.catMb._id });

  state.gpuSmall = await product(state.storeA._id, "RTX 4060", {
    tdp: 150,
    length: 250,
    slot_type: "pcie5",
  }, { categories: [state.catGpu._id] });
  state.gpuBig = await product(state.storeA._id, "RTX 5080", {
    tdp: 600,
    length: 360,
    slot_type: "pcie5",
  }, { regularPrice: 90000, categories: [state.catGpu._id] });
  state.caseSmall = await product(state.storeA._id, "Mini Case", { max_gpu_length: 300 });
  state.caseBig = await product(state.storeA._id, "Full Tower", { max_gpu_length: 400 });

  state.productB = await product(state.storeB._id, "Store B CPU", { socket: "am5" });

  const input = JSON.parse(JSON.stringify(TEMPLATE_INPUT));
  input.slots[0].filter.categories = [String(state.catCpu._id)];
  input.slots[1].filter.categories = [String(state.catMb._id)];
  input.slots[2].filter.categories = [String(state.catGpu._id)];
  state.template = await BuilderTemplate.create({ store: state.storeA._id, ...cleanTemplate(input) });

  const draft = JSON.parse(JSON.stringify(TEMPLATE_INPUT));
  draft.name = "Draft Builder";
  draft.slug = "draft-builder";
  draft.status = "draft";
  await BuilderTemplate.create({ store: state.storeA._id, ...cleanTemplate(draft) });

  state.app = express();
  state.app.use(express.json());
  state.app.use(async (req, res, next) => {
    try {
      const slug = String(req.headers["x-store-slug"] || "").trim().toLowerCase();
      const store = slug ? await Store.findOne({ slug }) : null;
      if (!store) return res.status(404).json({ message: "no store" });
      tenantStorage.run({ storeId: store._id }, () => {
        req.store = store;
        req.publicStore = store;
        next();
      });
    } catch (err) {
      next(err);
    }
  });
  state.app.use("/api/public/builder", require("../routes/publicBuilder"));
  state.app.use("/api/builder", require("../routes/builder"));
  state.app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

/* ---------------- gate + template ---------------- */

test("builder is hidden when the plan has productBuilder off", async () => {
  const res = await as("get", "/api/public/builder/templates", { store: "builder-c" });
  assert.equal(res.status, 404);
});

test("published templates are public, drafts are not", async () => {
  const list = await as("get", "/api/public/builder/templates");
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.templates.map((row) => row.slug), ["pc-builder"]);

  const draft = await as("get", "/api/public/builder/templates/draft-builder");
  assert.equal(draft.status, 404);

  const tpl = await as("get", "/api/public/builder/templates/pc-builder");
  assert.equal(tpl.status, 200);
  assert.equal(tpl.body.template.name, "PC Builder");
  assert.equal(tpl.body.template.groups[0].key, "core");
  assert.deepEqual(tpl.body.template.slots.map((slot) => slot.key), [
    "cpu",
    "motherboard",
    "gpu",
    "psu",
    "case",
  ]);
  assert.equal(tpl.body.template.rules.find((rule) => rule.key === "psu-power").limit, 650);
});

test("templates and saved builds never leak across stores", async () => {
  const tpl = await as("get", "/api/public/builder/templates/pc-builder", { store: "builder-b" });
  assert.equal(tpl.status, 404);
});

/* ---------------- slot products + compatibility ---------------- */

test("slot products exclude incompatible parts and explain why", async () => {
  const res = await as("post", "/api/public/builder/templates/pc-builder/slots/motherboard/products", {
    body: { selections: { cpu: String(state.cpuIntel._id) } },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((item) => item.id), [String(state.mbIntel._id)]);
  assert.equal(res.body.excluded.length, 1);
  assert.equal(res.body.excluded[0].id, String(state.mbAm5._id));
  assert.match(res.body.excluded[0].reasonsBn[0], /সিপিইউ সকেট/);

  const all = await as("post", "/api/public/builder/templates/pc-builder/slots/motherboard/products", {
    body: { selections: { cpu: String(state.cpuIntel._id) }, includeIncompatible: true },
  });
  assert.equal(all.body.items.length, 2);
  assert.equal(all.body.items.filter((item) => item.compatible).length, 1);
});

test("join-only categories and warnings stay visible", async () => {
  const res = await as("post", "/api/public/builder/templates/pc-builder/slots/motherboard/products", {
    body: { selections: { cpu: String(state.cpuAmd._id) } },
  });
  assert.equal(res.status, 200);
  const ids = res.body.items.map((item) => item.id);
  assert.ok(ids.includes(String(state.mbAm5._id)));
  // join-only product is incompatible with an AMD CPU, so it moves to excluded
  assert.ok(!ids.includes(String(state.mbIntel._id)));
  assert.ok(res.body.excluded.some((row) => row.id === String(state.mbIntel._id)));
  const am5 = res.body.items.find((item) => item.id === String(state.mbAm5._id));
  assert.equal(am5.compatible, true);
  assert.ok(am5.warnings.length >= 1); // warranty warn, never blocking
});

test("unknown slot answers 404", async () => {
  const res = await as("post", "/api/public/builder/templates/pc-builder/slots/monitor/products", {
    body: {},
  });
  assert.equal(res.status, 404);
});

/* ---------------- validate ---------------- */

async function validate(selections, store = "builder-a") {
  return as("post", "/api/public/builder/templates/pc-builder/validate", { store, body: { selections } });
}

test("validate blocks an incompatible build and reports warnings separately", async () => {
  const res = await validate({
    cpu: String(state.cpuAmd._id),
    motherboard: String(state.mbAm5._id),
    gpu: String(state.gpuBig._id),
    case: String(state.caseSmall._id),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, false);
  const keys = res.body.violations.map((row) => row.rule);
  assert.ok(keys.includes("gpu-clearance"));
  assert.ok(keys.includes("psu-power"));
  const warn = res.body.violations.find((row) => row.rule === "warranty");
  assert.equal(warn.level, "warn");
  assert.match(warn.messageBn, /ওয়ারেন্টি/);
  assert.equal(res.body.totals.count, 4);
});

test("a product without spec values never blocks the build", async () => {
  const res = await validate({
    cpu: String(state.cpuMystery._id),
    motherboard: String(state.mbAm5._id),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.violations.length, 0);
});

test("missing required slots are block-level violations", async () => {
  const res = await validate({ cpu: String(state.cpuAmd._id) });
  assert.equal(res.body.ok, false);
  assert.deepEqual(res.body.missing, ["motherboard"]);
  assert.equal(res.body.violations[0].code, "required");
});

/* ---------------- save / share ---------------- */

async function saveBuild(selections, extra = {}) {
  return as("post", "/api/public/builder/templates/pc-builder/save", {
    body: { selections, ...extra.body },
    token: extra.token,
  });
}

test("guests can save and load a shared build", async () => {
  const saved = await saveBuild({
    cpu: String(state.cpuAmd._id),
    motherboard: String(state.mbAm5._id),
    gpu: String(state.gpuSmall._id),
  });
  assert.equal(saved.status, 201);
  assert.ok(saved.body.token);
  assert.equal(saved.body.ok, true);
  assert.equal(saved.body.url, `/builder?build=${saved.body.token}`);

  const loaded = await as("get", `/api/public/builder/builds/${saved.body.token}`);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.items.length, 3);
  assert.ok(loaded.body.items.every((item) => item.available && item.inStock));
  assert.equal(loaded.body.template.slug, "pc-builder");

  const foreign = await as("get", `/api/public/builder/builds/${saved.body.token}`, { store: "builder-b" });
  assert.equal(foreign.status, 404);
});

test("a logged-in save links the customer", async () => {
  const saved = await saveBuild(
    { cpu: String(state.cpuAmd._id), motherboard: String(state.mbAm5._id) },
    { token: state.shopperToken }
  );
  assert.equal(saved.status, 201);
  const doc = await SavedBuild.findOne({ token: saved.body.token }).lean();
  assert.ok(doc.user);
});

/* ---------------- add to cart ---------------- */

test("a compatible build lands in the cart with snapshotted prices", async () => {
  const res = await as("post", "/api/public/builder/templates/pc-builder/cart", {
    body: {
      selections: {
        cpu: String(state.cpuAmd._id),
        motherboard: String(state.mbAm5._id),
        gpu: String(state.gpuSmall._id),
      },
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.items.length, 3);
  const cpuLine = res.body.items.find((item) => String(item.product) === String(state.cpuAmd._id));
  assert.equal(cpuLine.unitPrice, 20000);
  assert.equal(cpuLine.quantity, 1);
  assert.equal(cpuLine.build, null);
});

test("cart from a saved build tags lines with the build id", async () => {
  await Cart.deleteMany({ store: state.storeA._id });
  const saved = await saveBuild({
    cpu: String(state.cpuAmd._id),
    motherboard: String(state.mbAm5._id),
  });
  const res = await as("post", "/api/public/builder/templates/pc-builder/cart", {
    body: { token: saved.body.token },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.token, saved.body.token);
  const build = await SavedBuild.findOne({ token: saved.body.token }).lean();
  assert.ok(res.body.items.every((item) => String(item.build) === String(build._id)));
});

test("incompatible, incomplete and off-slot builds are refused before touching the cart", async () => {
  await Cart.deleteMany({});

  const incompatible = await as("post", "/api/public/builder/templates/pc-builder/cart", {
    body: {
      selections: {
        cpu: String(state.cpuAmd._id),
        motherboard: String(state.mbAm5._id),
        gpu: String(state.gpuBig._id),
        case: String(state.caseSmall._id),
      },
    },
  });
  assert.equal(incompatible.status, 409);
  assert.equal(incompatible.body.code, "build_incompatible");

  const incomplete = await as("post", "/api/public/builder/templates/pc-builder/cart", {
    body: { selections: { cpu: String(state.cpuAmd._id) } },
  });
  assert.equal(incomplete.status, 409);
  assert.equal(incomplete.body.code, "build_incomplete");

  const offSlot = await as("post", "/api/public/builder/templates/pc-builder/cart", {
    body: {
      selections: {
        cpu: String(state.gpuSmall._id),
        motherboard: String(state.mbAm5._id),
      },
    },
  });
  assert.equal(offSlot.status, 409);
  assert.equal(offSlot.body.code, "slot_changed");

  const foreign = await as("post", "/api/public/builder/templates/pc-builder/cart", {
    body: {
      selections: {
        cpu: String(state.productB._id),
        motherboard: String(state.mbAm5._id),
      },
    },
  });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.code, "build_invalid");

  const cart = await Cart.findOne({ store: state.storeA._id }).lean();
  assert.ok(!cart || cart.items.length === 0);
});

test("stock is re-checked when the build is added", async () => {
  await state.gpuSmall.updateOne({ stock: 0 });
  const res = await as("post", "/api/public/builder/templates/pc-builder/cart", {
    body: {
      selections: {
        cpu: String(state.cpuAmd._id),
        motherboard: String(state.mbAm5._id),
        gpu: String(state.gpuSmall._id),
      },
    },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /Stock/);
  await state.gpuSmall.updateOne({ stock: 10 });
});

/* ---------------- shopper analytics events ---------------- */

test("chosen-part and abandoned-build events are stored for the template", async () => {
  const chosen = await as("post", "/api/public/builder/templates/pc-builder/events", {
    body: { event: "part_chosen", slot: "cpu", productId: String(state.cpuAmd._id) },
  });
  assert.equal(chosen.status, 202);

  const abandoned = await as("post", "/api/public/builder/templates/pc-builder/events", {
    body: { event: "build_abandoned", parts: 3 },
  });
  assert.equal(abandoned.status, 202);

  const rows = await BuilderEvent.find({ template: state.template._id }).sort({ createdAt: 1 }).lean();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].event, "part_chosen");
  assert.equal(rows[0].slot, "cpu");
  assert.equal(String(rows[0].product), String(state.cpuAmd._id));
  assert.equal(rows[0].sessionId, "guest-session");
  assert.equal(rows[1].event, "build_abandoned");
  assert.equal(rows[1].parts, 3);
});

test("unknown events, foreign slots and bad product ids are sanitised away", async () => {
  const before = await BuilderEvent.countDocuments({ template: state.template._id });

  const unknown = await as("post", "/api/public/builder/templates/pc-builder/events", {
    body: { event: "page_view" },
  });
  assert.equal(unknown.status, 204);

  const odd = await as("post", "/api/public/builder/templates/pc-builder/events", {
    body: { event: "part_chosen", slot: "not-a-slot", productId: "not-an-object-id", parts: 9999 },
  });
  assert.equal(odd.status, 202);
  const row = await BuilderEvent.findOne({ template: state.template._id }).sort({ createdAt: -1 }).lean();
  assert.equal(row.slot, "");
  assert.equal(row.product, null);

  assert.equal(await BuilderEvent.countDocuments({ template: state.template._id }), before + 1);
});

test("events follow the plan gate and the template's store", async () => {
  const gated = await as("post", "/api/public/builder/templates/pc-builder/events", {
    store: "builder-c",
    body: { event: "part_chosen", slot: "cpu", productId: String(state.cpuAmd._id) },
  });
  assert.equal(gated.status, 404);

  const foreign = await as("post", "/api/public/builder/templates/pc-builder/events", {
    store: "builder-b",
    body: { event: "part_chosen", slot: "cpu", productId: String(state.cpuAmd._id) },
  });
  assert.equal(foreign.status, 404);
});

/* ---------------- rule engine + template validation ---------------- */

test("the rule engine covers in, includes, gte and block/warn levels", () => {
  const cpu = { specs: { socket: "am5", features: ["oc"] } };
  const mb = { specs: { sockets: ["am5", "am4"] } };
  const kit = { specs: { ram_slots: 4 } };
  const ctx = { products: { cpu, mb, kit } };

  const rules = [
    { key: "in", type: "in", level: "block", left: { slot: "cpu", spec: "socket" }, value: ["am4"] },
    { key: "includes", type: "includes", level: "block", left: { slot: "cpu", spec: "features" }, value: "rgb" },
    { key: "gte", type: "gte", level: "warn", left: { slot: "kit", spec: "ram_slots" }, right: { slot: "cpu", spec: "socket" } },
    { key: "missing", type: "equals", level: "block", left: { slot: "mb", spec: "socket" }, value: "am5" },
  ];
  const violations = evaluateRules(rules, ctx);
  assert.deepEqual(violations.map((row) => row.rule), ["in", "includes"]);
  assert.equal(violations[0].level, "block");
  assert.equal(violations[0].messageBn, "এই কম্বিনেশনটি সাপোর্টেড নয়");

  const passing = evaluateRules(
    [
      { key: "in", type: "in", left: { slot: "cpu", spec: "socket" }, value: ["am5", "am4"] },
      { key: "includes", type: "includes", left: { slot: "cpu", spec: "features" }, value: "oc" },
      { key: "membership", type: "set-membership", left: { slot: "cpu", spec: "socket" }, right: { slot: "mb", spec: "sockets" } },
    ],
    ctx
  );
  assert.equal(passing.length, 0);

  const warn = evaluateRules([rules[2]], ctx);
  assert.equal(warn.length, 0); // "4" >= "am5" is not numeric → silent

  const warnOk = evaluateRules(
    [{ key: "gte", type: "gte", level: "warn", left: { slot: "kit", spec: "ram_slots" }, value: 8 }],
    ctx
  );
  assert.equal(warnOk[0].level, "warn");
});

test("templates reject rules that point at unknown slots", () => {
  const input = JSON.parse(JSON.stringify(TEMPLATE_INPUT));
  input.rules[0].left.slot = "monitor";
  assert.throws(() => cleanTemplate(input), /slot pawa jayni/);

  const dup = JSON.parse(JSON.stringify(TEMPLATE_INPUT));
  dup.rules[1].key = dup.rules[0].key;
  assert.throws(() => cleanTemplate(dup), /duibar/);

  const badType = JSON.parse(JSON.stringify(TEMPLATE_INPUT));
  badType.rules[0].type = "eval";
  assert.throws(() => cleanTemplate(badType), /type thik nei/);

  const badTerm = JSON.parse(JSON.stringify(TEMPLATE_INPUT));
  badTerm.rules[2].terms[0].multiplier = 100;
  assert.throws(() => cleanTemplate(badTerm), /multiplier/);
});

/* ---------------- admin API ---------------- */

test("admin builder API is gated by the plan too", async () => {
  const res = await as("get", "/api/builder/templates", { store: "builder-c", token: state.tokenC });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "feature_locked");
});

test("admin meta exposes categories and spec definitions", async () => {
  const res = await as("get", "/api/builder/templates/meta", { token: state.tokenA });
  assert.equal(res.status, 200);
  assert.ok(res.body.categories.some((row) => row.id === String(state.catCpu._id)));
  assert.ok(Array.isArray(res.body.specs));
  assert.ok(Array.isArray(res.body.brands));
  assert.ok(Array.isArray(res.body.tags));
});

test("admin list mixes template rows with saved-build counts", async () => {
  const res = await as("get", "/api/builder/templates", { token: state.tokenA });
  assert.equal(res.status, 200);
  const row = res.body.templates.find((tpl) => tpl.slug === "pc-builder");
  assert.ok(row);
  assert.equal(row.slotCount, 5);
  assert.equal(row.ruleCount, 5);
  assert.ok(row.builds >= 1);
});

test("admin template create, update, sandbox and delete", async () => {
  const created = await as("post", "/api/builder/templates", {
    token: state.tokenA,
    body: {
      name: "Admin Builder",
      slug: "admin-builder",
      slots: [
        { key: "cpu", label: "CPU" },
        { key: "motherboard", label: "Motherboard" },
      ],
      rules: [
        {
          key: "socket",
          type: "set-membership",
          level: "block",
          message: "Socket mismatch",
          messageBn: "সকেট মিলছে না",
          left: { slot: "cpu", spec: "socket" },
          right: { slot: "motherboard", spec: "sockets" },
        },
      ],
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.template.status, "draft");
  const id = created.body.template.id;

  const dup = await as("post", "/api/builder/templates", {
    token: state.tokenA,
    body: { name: "Other", slug: "admin-builder", slots: [{ key: "cpu", label: "CPU" }] },
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "slug_taken");

  const full = { ...created.body.template, status: "published" };
  const updated = await as("put", `/api/builder/templates/${id}`, { token: state.tokenA, body: full });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.template.status, "published");

  const sandbox = await as("post", `/api/builder/templates/${id}/sandbox`, {
    token: state.tokenA,
    body: {
      selections: {
        cpu: String(state.cpuIntel._id),
        motherboard: String(state.mbAm5._id),
      },
    },
  });
  assert.equal(sandbox.status, 200);
  assert.equal(sandbox.body.ok, false);
  assert.equal(sandbox.body.violations[0].rule, "socket");
  assert.equal(sandbox.body.totals.count, 2);

  const removed = await as("delete", `/api/builder/templates/${id}`, { token: state.tokenA });
  assert.equal(removed.status, 200);
  assert.equal(await BuilderTemplate.findById(id), null);
});

test("admin can create the PC Builder starter with 21 slots", async () => {
  const first = await as("post", "/api/builder/templates/starter", {
    store: "builder-b",
    token: state.tokenB,
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.template.slug, "pc-builder");
  assert.equal(first.body.template.slots.length, 21);
  assert.equal(first.body.template.rules.length, 5);

  const again = await as("post", "/api/builder/templates/starter", {
    store: "builder-b",
    token: state.tokenB,
  });
  assert.equal(again.status, 409);

  await as("delete", `/api/builder/templates/${first.body.template.id}`, {
    store: "builder-b",
    token: state.tokenB,
  });
});

test("admin sees saved builds and analytics for a template", async () => {
  const id = String(state.template._id);
  const builds = await as("get", `/api/builder/templates/${id}/builds`, { token: state.tokenA });
  assert.equal(builds.status, 200);
  assert.ok(builds.body.total >= 1);
  assert.ok(builds.body.builds[0].url.startsWith("/builder?build="));

  const analytics = await as("get", `/api/builder/templates/${id}/analytics`, {
    token: state.tokenA,
  });
  assert.equal(analytics.status, 200);
  assert.ok(analytics.body.analytics.totalBuilds >= 1);
  assert.ok(analytics.body.analytics.topParts.length >= 1);
  assert.equal(typeof analytics.body.analytics.averageSubtotal, "number");
  assert.ok(analytics.body.analytics.partsChosen >= 2);
  assert.ok(analytics.body.analytics.abandonedBuilds >= 1);
  assert.equal(typeof analytics.body.analytics.abandoned30, "number");
});
