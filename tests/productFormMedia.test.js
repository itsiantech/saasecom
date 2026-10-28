process.env.JWT_SECRET = "product-form-media-secret";

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
const Product = require("../models/Product");

const state = {};

function as(method, url, body) {
  const req = request(state.app)[method](url)
    .set("x-store-slug", "shop-a")
    .set("Authorization", "Bearer " + state.token);
  return body === undefined ? req : req.send(body);
}

before(async () => {
  process.env.NODE_ENV = "test";
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("product_form_media"));
  await Promise.all([Plan.init(), Store.init(), User.init(), Product.init()]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const owner = await User.create({ name: "Owner", email: "owner@example.com", role: "admin" });
  state.store = await Store.create({ name: "Shop A", slug: "shop-a", owner: owner._id, plan: plan._id });
  state.token = jwt.sign({ id: String(owner._id), role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1h" });

  state.app = express();
  state.app.use(express.json());
  state.app.use(async (req, res, next) => {
    const slug = String(req.headers["x-store-slug"] || "").trim().toLowerCase();
    const store = slug ? await Store.findOne({ slug }) : null;
    if (!store) return res.status(400).json({ message: "Store pawa jayni" });
    tenantStorage.run({ storeId: store._id }, () => {
      req.store = store;
      next();
    });
  });
  state.app.use("/api/product-form", require("../routes/productForm"));
  state.app.use((err, req, res) => res.status(err.status || 500).json({ message: err.message }));
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("create stores the gallery, the featured flags and a safe video link", async () => {
  const res = await as("post", "/api/product-form", {
    title: "Somogol chobi",
    regularPrice: 500,
    status: "published",
    images: ["/uploads/a.jpg", "/uploads/b.jpg"],
    videoUrl: "https://www.youtube.com/watch?v=abc123",
    isTopFeature: true,
    isHotDeal: false,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const saved = await Product.findById(res.body.product._id).lean();
  assert.deepEqual(saved.images, ["/uploads/a.jpg", "/uploads/b.jpg"]);
  assert.equal(saved.isTopFeature, true);
  assert.equal(saved.isHotDeal, false);
  assert.equal(saved.videoUrl, "https://www.youtube.com/watch?v=abc123");
});

test("a video that is not an http link is dropped, the rest still saves", async () => {
  const res = await as("post", "/api/product-form", {
    title: "Kharap video",
    regularPrice: 100,
    images: ["/uploads/c.jpg"],
    videoUrl: "javascript:alert(1)",
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const saved = await Product.findById(res.body.product._id).lean();
  assert.equal(saved.videoUrl, "");
  assert.deepEqual(saved.images, ["/uploads/c.jpg"]);
});

test("update replaces the gallery and turns the flags off again", async () => {
  const created = await as("post", "/api/product-form", {
    title: "Edit korte parbo",
    regularPrice: 200,
    images: ["/uploads/old.jpg"],
    videoUrl: "https://vimeo.com/12345",
    isTopFeature: true,
    isHotDeal: true,
  });
  const id = created.body.product._id;

  const updated = await as("put", "/api/product-form/" + id, {
    title: "Edit korte parbo",
    regularPrice: 200,
    images: ["/uploads/new-1.jpg", "/uploads/new-2.jpg"],
    videoUrl: "https://player.vimeo.com/video/12345",
    isTopFeature: false,
    isHotDeal: false,
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));

  const saved = await Product.findById(id).lean();
  assert.deepEqual(saved.images, ["/uploads/new-1.jpg", "/uploads/new-2.jpg"]);
  assert.equal(saved.isTopFeature, false);
  assert.equal(saved.isHotDeal, false);
  assert.equal(saved.videoUrl, "https://player.vimeo.com/video/12345");

  const loaded = await as("get", "/api/product-form/" + id);
  assert.equal(loaded.status, 200);
  assert.deepEqual(loaded.body.product.images, ["/uploads/new-1.jpg", "/uploads/new-2.jpg"]);
  assert.equal(loaded.body.product.videoUrl, "https://player.vimeo.com/video/12345");
});
