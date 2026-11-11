process.env.JWT_SECRET = "promotion-drafts-secret";

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
const PromotionDraft = require("../models/PromotionDraft");
const Coupon = require("../models/Coupon");
const FlashSale = require("../models/FlashSale");

const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function as(who, method, url, body) {
  const req = request(state.app)[method](url)
    .set("x-store-slug", who === "b" ? "shop-b" : "shop-a")
    .set("Authorization", `Bearer ${state[who + "Token"]}`);
  return body === undefined ? req : req.send(body);
}

const DRAFT_KEY = "fg-11111111-2222-3333-4444-555555555555";

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("promotion_drafts"));
  await Promise.all([Plan.init(), Store.init(), User.init(), PromotionDraft.init(), Coupon.init(), FlashSale.init()]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const ownerA = await User.create({ name: "Owner A", email: "a@example.com", role: "admin" });
  const ownerB = await User.create({ name: "Owner B", email: "b@example.com", role: "admin" });
  state.storeA = await Store.create({ name: "Shop A", slug: "shop-a", owner: ownerA._id, plan: plan._id });
  state.storeB = await Store.create({ name: "Shop B", slug: "shop-b", owner: ownerB._id, plan: plan._id });
  state.aToken = tokenFor(ownerA);
  state.bToken = tokenFor(ownerB);

  state.app = express();
  state.app.use(express.json());
  state.app.use(async (req, res, next) => {
    try {
      const slug = String(req.headers["x-store-slug"] || "").trim().toLowerCase();
      const store = slug ? await Store.findOne({ slug }) : null;
      if (!store) return res.status(400).json({ message: "Store pawa jayni" });
      tenantStorage.run({ storeId: store._id }, () => {
        req.store = store;
        next();
      });
    } catch (err) {
      next(err);
    }
  });
  state.app.use("/api/coupons", require("../routes/coupons"));
  state.app.use("/api/flash-sales", require("../routes/flashSales"));
  state.app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("a coupon draft upserts by draftKey and stays out of the live list", async () => {
  const first = await as("a", "post", "/api/coupons/draft", {
    draftKey: DRAFT_KEY,
    cpCode: "SAVE10",
    cpType: "percent",
    cpValue: "10",
    cpFreeDelivery: false,
    cpStart: "2026-11-01",
    cpEnd: "2026-11-30",
    products: ["p1"],
    categories: [],
    nested: { ignored: true },
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(first.body.id);
  assert.equal(first.body.payload.cpCode, "SAVE10");
  assert.deepEqual(first.body.payload.products, ["p1"]);
  assert.equal(first.body.payload.nested, undefined);

  const second = await as("a", "post", "/api/coupons/draft", {
    draftKey: DRAFT_KEY,
    id: first.body.id,
    cpCode: "SAVE20",
    cpType: "percent",
    cpValue: "20",
  });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(String(second.body.id), String(first.body.id));
  assert.equal(second.body.payload.cpCode, "SAVE20");

  const drafts = await as("a", "get", "/api/coupons/drafts");
  assert.equal(drafts.status, 200);
  assert.equal(drafts.body.items.length, 1);
  assert.equal(drafts.body.items[0].payload.cpCode, "SAVE20");

  const live = await as("a", "get", "/api/coupons");
  assert.equal(live.status, 200);
  assert.equal(live.body.items.length, 0, "drafts must not show up as live coupons");
});

test("draft keys and cross-store access are rejected", async () => {
  const badKey = await as("a", "post", "/api/coupons/draft", { draftKey: "x", cpCode: "A" });
  assert.equal(badKey.status, 400);

  const listB = await as("b", "get", "/api/coupons/drafts");
  assert.equal(listB.status, 200);
  assert.equal(listB.body.items.length, 0, "store B sees none of store A's drafts");

  const draftsA = await as("a", "get", "/api/coupons/drafts");
  const draftId = draftsA.body.items[0].id;
  const deleteFromB = await as("b", "delete", "/api/coupons/drafts/" + draftId);
  assert.equal(deleteFromB.status, 404);
});

test("publishing a coupon removes its draft", async () => {
  const publish = await as("a", "post", "/api/coupons", {
    draftKey: DRAFT_KEY,
    code: "SAVE20",
    discountType: "percent",
    discountValue: 20,
    minOrderAmount: 0,
    startAt: "2026-11-01T00:00:00.000Z",
    endAt: "2026-11-30T23:59:59.999Z",
    freeDelivery: false,
    usageLimit: 0,
    perCustomerLimit: 0,
    products: [],
    categories: [],
  });
  assert.equal(publish.status, 201, JSON.stringify(publish.body));

  const drafts = await as("a", "get", "/api/coupons/drafts");
  assert.equal(drafts.body.items.length, 0, "publish cleans the draft by key");

  const live = await as("a", "get", "/api/coupons");
  assert.equal(live.body.items.length, 1);
});

test("flash sale drafts save, list and discard", async () => {
  const key = "fg-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const saved = await as("a", "post", "/api/flash-sales/draft", {
    draftKey: key,
    fsTitle: "Eid sale",
    fsPercent: "25",
    fsStart: "2026-11-01T10:00",
    fsEnd: "2026-11-05T22:00",
    targetType: "product",
    products: ["p1", "p2"],
    categories: [],
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.payload.fsTitle, "Eid sale");

  const list = await as("a", "get", "/api/flash-sales/drafts");
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);

  const live = await as("a", "get", "/api/flash-sales");
  assert.equal(live.body.items.length, 0);

  const removed = await as("a", "delete", "/api/flash-sales/drafts/" + saved.body.id);
  assert.equal(removed.status, 200);
  const again = await as("a", "delete", "/api/flash-sales/drafts/" + saved.body.id);
  assert.equal(again.status, 404);
});