process.env.JWT_SECRET = "tenant-isolation-test-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Order = require("../models/Order");
const Review = require("../models/Review");

const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

// /api/public/* needs no session: identity comes from the request itself
function pub(path, { slug, domain, token } = {}) {
  const req = request(state.app).get(path);
  if (slug) req.set("x-store-slug", slug);
  if (domain) req.set("x-store-domain", domain);
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req;
}

function pubPost(path, body, { slug, token } = {}) {
  const req = request(state.app).post(path).send(body);
  if (slug) req.set("x-store-slug", slug);
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req;
}

before(async () => {
  state.replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ dbName: "tenant_isolation" }],
  });
  await mongoose.connect(state.replSet.getUri("tenant_isolation"));

  await Promise.all([
    Plan.init(), Store.init(), User.init(), Product.init(),
    Category.init(), Order.init(), Review.init(),
    require("../models/Wishlist").init(),
    require("../models/SiteSetting").init(),
    require("../models/ShopFavicon").init(),
    require("../models/SocialLink").init(),
    require("../models/HeroSlide").init(),
    require("../models/ProductVariation").init(),
    require("../models/ProductPriceTier").init(),
    require("../models/InternationalSettings").init(),
    require("../models/OrderStatusHistory").init(),
  ]);

  const owner = await User.create({ name: "Owner", email: "owner@example.com", role: "customer" });
  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });

  state.storeA = await Store.create({
    name: "Shop A",
    slug: "shop-a",
    owner: owner._id,
    plan: plan._id,
    subdomain: "a",
    contact: { phone: "01700000000", email: "a@example.com", address: "Dhaka" },
  });
  state.storeB = await Store.create({
    name: "Shop B",
    slug: "shop-b",
    owner: owner._id,
    plan: plan._id,
    customDomain: "bshop.example",
    customDomainStatus: "verified",
  });
  state.storeOff = await Store.create({
    name: "Suspended",
    slug: "shop-off",
    owner: owner._id,
    plan: plan._id,
    status: "suspended",
  });

  state.catA = await Category.create({ store: state.storeA._id, name: "Electronics", slug: "electronics", status: "published" });
  state.catB = await Category.create({ store: state.storeB._id, name: "Electronics", slug: "electronics", status: "published" });

  const [a1, a2, a3, b1] = await Product.insertMany([
    { store: state.storeA._id, name: "A one", title: "A one", slug: "a-one", regularPrice: 100, salePrice: 0, price: 100, stock: 5, status: "published", categories: [state.catA._id], soldCount: 3, supplierId: null },
    { store: state.storeA._id, name: "A two", title: "A two", slug: "a-two", regularPrice: 50, salePrice: 25, price: 50, stock: 0, status: "published", categories: [state.catA._id], soldCount: 9 },
    { store: state.storeA._id, name: "A draft", title: "A draft", slug: "a-draft", regularPrice: 70, price: 70, stock: 2, status: "draft", categories: [state.catA._id] },
    { store: state.storeB._id, name: "B one", title: "B one", slug: "b-one", regularPrice: 300, price: 300, stock: 4, status: "published", categories: [state.catB._id] },
  ]);
  state.a1 = a1; state.a2 = a2; state.a3 = a3; state.b1 = b1;

  state.orderA = await Order.create({
    store: state.storeA._id,
    orderNumber: "ORD-A-1001",
    customerName: "Rahim",
    customerPhone: "01712345678",
    items: [{ product: state.a1._id, quantity: 1, price: 100 }],
    totalAmount: 100,
    status: "processing",
  });

  state.customer = await User.create({ name: "Shopper", email: "shopper@example.com", role: "customer" });
  state.customerToken = tokenFor(state.customer);

  state.app = express();
  state.app.use(express.json());
  state.app.use("/api/public", require("../routes/publicApi"));
  state.app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.replSet) await state.replSet.stop();
});

/* --------------------------- store resolution ---------------------------- */

test("unknown store address 404s and a suspended store 403s", async () => {
  const missing = await pub("/api/public/products", { slug: "no-such-shop" });
  assert.equal(missing.status, 404);

  const suspended = await pub("/api/public/products", { slug: "shop-off" });
  assert.equal(suspended.status, 403);

  const noIdentity = await request(state.app).get("/api/public/products");
  assert.equal(noIdentity.status, 404);
});

test("a logged-in customer cannot point the public API at another store through the token", async () => {
  // publicStore ignores JWT on purpose — without a slug/domain header there is no store at all
  const res = await pub("/api/public/products", { token: state.customerToken });
  assert.equal(res.status, 404);
});

/* ------------------------------ catalog read ----------------------------- */

test("product list returns only the requested store's published products", async () => {
  const res = await pub("/api/public/products", { slug: "shop-a" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.products.map((row) => row.slug).sort(), ["a-one", "a-two"]);
  assert.equal(res.body.pagination.total, 2);
});

test("the $aggregate sort path is store-scoped too (price_asc / discount)", async () => {
  for (const sort of ["price_asc", "price_desc", "discount"]) {
    const res = await pub("/api/public/products?sort=" + sort, { slug: "shop-a" });
    assert.equal(res.status, 200, sort);
    assert.deepEqual(res.body.products.map((row) => row.slug).sort(), ["a-one", "a-two"], sort);
    assert.equal(res.body.pagination.total, 2, sort);
  }
  const asc = await pub("/api/public/products?sort=price_asc", { slug: "shop-a" });
  assert.deepEqual(asc.body.products.map((row) => row.slug), ["a-two", "a-one"]);
});

test("a category id from another store filters nothing out of this store", async () => {
  const res = await pub("/api/public/products?category=" + state.catB._id, { slug: "shop-a" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.products, []);

  const own = await pub("/api/public/products?category=" + state.catA.slug, { slug: "shop-a" });
  assert.equal(own.body.products.length, 2);
});

test("product detail is 404 for another store's slug or id", async () => {
  const bySlug = await pub("/api/public/products/b-one", { slug: "shop-a" });
  assert.equal(bySlug.status, 404);

  const byId = await pub("/api/public/products/" + state.b1._id, { slug: "shop-a" });
  assert.equal(byId.status, 404);

  const draft = await pub("/api/public/products/a-draft", { slug: "shop-a" });
  assert.equal(draft.status, 404);

  const mine = await pub("/api/public/products/a-two", { slug: "shop-a" });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.product.price, 25);
});

test("verified custom domain resolves its own store through x-store-domain", async () => {
  const res = await pub("/api/public/products", { domain: "bshop.example" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.products.map((row) => row.slug), ["b-one"]);
});

test("public product payload never carries supplier or cost data", async () => {
  const res = await pub("/api/public/products/a-one", { slug: "shop-a" });
  const raw = JSON.stringify(res.body.product);
  for (const banned of ["supplierId", "costPrice", "cost", "purchasePrice"]) {
    assert.ok(!raw.includes(banned), "leaked " + banned);
  }
  assert.equal(res.body.product.name, "A one");
});

/* -------------------------------- reviews -------------------------------- */

test("review can be written for own-store products only", async () => {
  const foreign = await pubPost("/api/public/products/b-one/reviews", { rating: 5, body: "nice" }, { slug: "shop-a" });
  assert.equal(foreign.status, 404);

  const badRating = await pubPost("/api/public/products/a-one/reviews", { rating: 9, customerName: "X" }, { slug: "shop-a" });
  assert.equal(badRating.status, 400);

  const created = await pubPost("/api/public/products/a-one/reviews", { rating: 4, title: "Good", body: "Works well", customerName: "Guest" }, { slug: "shop-a" });
  assert.equal(created.status, 201);

  const list = await pub("/api/public/products/a-one/reviews", { slug: "shop-a" });
  assert.equal(list.status, 200);
  assert.equal(list.body.reviews.length, 1);
  assert.equal(list.body.reviews[0].rating, 4);

  // the same review must not appear on the other store
  const other = await pub("/api/public/products/" + state.b1._id + "/reviews", { slug: "shop-b" });
  assert.deepEqual(other.body.reviews, []);

  const detail = await pub("/api/public/products/a-one", { slug: "shop-a" });
  assert.equal(detail.body.reviews.count, 1);
  assert.equal(detail.body.reviews.average, 4);
});

/* -------------------------------- wishlist ------------------------------- */

test("wishlist needs a session and refuses another store's product", async () => {
  const anon = await pubPost("/api/public/wishlist", { product: state.a1._id }, { slug: "shop-a" });
  assert.equal(anon.status, 401);

  const foreign = await pubPost("/api/public/wishlist", { product: state.b1._id }, { slug: "shop-a", token: state.customerToken });
  assert.equal(foreign.status, 404);
  assert.equal(await Review.countDocuments({ store: state.storeA._id }), 1);

  const added = await pubPost("/api/public/wishlist", { product: state.a1._id }, { slug: "shop-a", token: state.customerToken });
  assert.equal(added.status, 200);
  assert.equal(added.body.saved, true);

  const list = await pub("/api/public/wishlist", { slug: "shop-a", token: state.customerToken });
  assert.deepEqual(list.body.items.map((row) => row.slug), ["a-one"]);

  // same shopper, other store → wishlist is per store
  const otherStore = await pub("/api/public/wishlist", { slug: "shop-b", token: state.customerToken });
  assert.deepEqual(otherStore.body.items, []);

  const removed = await pubPost("/api/public/wishlist", { product: state.a1._id }, { slug: "shop-a", token: state.customerToken });
  assert.equal(removed.body.saved, false);
});

/* ------------------------------ order tracking ---------------------------- */

test("order tracking needs the right store AND the order phone", async () => {
  const wrongStore = await pub("/api/public/orders/track?number=ORD-A-1001&phone=01712345678", { slug: "shop-b" });
  assert.equal(wrongStore.status, 404);

  const wrongPhone = await pub("/api/public/orders/track?number=ORD-A-1001&phone=01799999999", { slug: "shop-a" });
  assert.equal(wrongPhone.status, 404);

  const ok = await pub("/api/public/orders/track?number=ORD-A-1001&phone=12345678", { slug: "shop-a" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.order.status, "processing");
  assert.ok(!JSON.stringify(ok.body).includes("01712345678"), "tracking leaked the full phone");
});

/* ------------------------------- store info ------------------------------- */

test("store info exposes only its own branding, contact and settings", async () => {
  const res = await pub("/api/public/store", { slug: "shop-a" });
  assert.equal(res.status, 200);
  assert.equal(res.body.store.name, "Shop A");
  assert.equal(res.body.store.currency, "BDT");
  assert.equal(res.body.store.contact.phone, "01700000000");
  assert.equal(res.body.branding.title, "Shop A");

  const other = await pub("/api/public/store", { domain: "bshop.example" });
  assert.equal(other.body.store.name, "Shop B");
});

test("categories tree and brands are store scoped", async () => {
  const a = await pub("/api/public/categories", { slug: "shop-a" });
  const b = await pub("/api/public/categories", { slug: "shop-b" });
  assert.deepEqual(a.body.categories.map((row) => String(row._id)), [String(state.catA._id)]);
  assert.deepEqual(b.body.categories.map((row) => String(row._id)), [String(state.catB._id)]);
});

// old seeded products have no slug — the storefront still needs a stable url key
test("a product without a slug falls back to its id", async () => {
  const [orphan] = await Product.insertMany([
    { store: state.storeB._id, name: "No slug", title: "No slug", slug: "", regularPrice: 10, price: 10, stock: 1, status: "published" },
  ]);
  const list = await pub("/api/public/products", { domain: "bshop.example" });
  const card = list.body.products.find((row) => String(row.id) === String(orphan._id));
  assert.equal(card.slug, String(orphan._id));

  const detail = await pub("/api/public/products/" + orphan._id, { domain: "bshop.example" });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.product.slug, String(orphan._id));
});
