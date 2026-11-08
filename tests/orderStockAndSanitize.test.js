const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const { sanitizeRichText } = require("../lib/richText");
const { restoreOrderStock } = require("../services/orderStock");
const { changeOrderStatus } = require("../services/orderStatusChange");

const state = {};
let seq = 0;

async function makeOrder(overrides = {}) {
  seq += 1;
  return Order.create({
    store: state.store._id,
    orderNumber: "TST-" + seq,
    customerName: "Buyer",
    items: [{ product: state.product._id, quantity: 2, price: 200 }],
    totalAmount: 200,
    stockDeducted: true,
    ...overrides,
  });
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("order_stock"));
  await Promise.all([Plan.init(), Store.init(), User.init(), Product.init(), Order.init()]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const owner = await User.create({ name: "Owner", email: "stock-owner@example.com", role: "admin" });
  state.store = await Store.create({ name: "Stock Shop", slug: "stock-shop", owner: owner._id, plan: plan._id });
  state.product = await Product.create({ store: state.store._id, name: "Item", slug: "item", stock: 3 });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("rich text sanitizer drops scripts, handlers and unsafe links", () => {
  const cleaned = sanitizeRichText(
    '<p>Hi <b>there</b></p><script>alert(1)</script><img src="/a.png" onerror="alert(1)"><a href="javascript:alert(1)">x</a>'
  );
  assert.equal(cleaned, '<p>Hi <b>there</b></p><img src="/a.png"><a>x</a>');
});

test("product description is sanitized on write", async () => {
  const product = await Product.create({
    store: state.store._id,
    name: "XSS item",
    slug: "xss-item",
    description: '<p>Safe</p><script>alert(1)</script><img src=x onerror=alert(1)>',
  });
  assert.equal(product.description, '<p>Safe</p><img src="x">');
});

test("deleting restores deducted stock exactly once", async () => {
  const order = await makeOrder();
  assert.equal((await Product.findById(state.product._id)).stock, 3);

  assert.equal(await restoreOrderStock(order), true);
  assert.equal((await Product.findById(state.product._id)).stock, 5);

  // second claim (cancel after delete, double click, etc.) must not add again
  assert.equal(await restoreOrderStock(order), false);
  assert.equal((await Product.findById(state.product._id)).stock, 5);
});

test("manual orders that never deducted stock are not restocked", async () => {
  const order = await makeOrder({ stockDeducted: false });
  assert.equal(await restoreOrderStock(order), false);
  assert.equal((await Product.findById(state.product._id)).stock, 5);
});

test("cancelling an order returns its stock", async () => {
  await Product.updateOne({ _id: state.product._id }, { $set: { stock: 8 } });
  const order = await makeOrder();

  await changeOrderStatus({
    orderId: order._id,
    toStatus: "cancelled",
    actor: { id: state.store.owner, name: "Owner" },
    note: "test cancel",
  });

  assert.equal((await Product.findById(state.product._id)).stock, 10);
  const stored = await Order.findById(order._id).lean();
  assert.equal(stored.stockRestored, true);
});
