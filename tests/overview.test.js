process.env.JWT_SECRET = "overview-test-secret";

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
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const FlashSale = require("../models/FlashSale");
const Settings = require("../models/Settings");
const Supplier = require("../models/Supplier");
const SupplierOrder = require("../models/SupplierOrder");
const SupplierInvoice = require("../models/SupplierInvoice");

const state = {};
const DAY = 24 * 60 * 60 * 1000;

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function as(slug, url, token = state.token) {
  return request(state.app)
    .get(url)
    .set("x-store-slug", slug)
    .set("Authorization", `Bearer ${token}`);
}

function daysAgo(days) {
  return new Date(Date.now() - days * DAY);
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("overview"));
  await Promise.all([
    Plan.init(),
    Store.init(),
    User.init(),
    Product.init(),
    Order.init(),
    Cart.init(),
    FlashSale.init(),
    Settings.init(),
    Supplier.init(),
    SupplierOrder.init(),
    SupplierInvoice.init(),
  ]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const owner = await User.create({ name: "Owner", email: "ov-owner@example.com", role: "customer" });
  state.store = await Store.create({ name: "Overview Store", slug: "ov-store", owner: owner._id, plan: plan._id });
  state.token = tokenFor(owner);
  const store = state.store._id;

  const customerA = await User.create({ name: "Customer A", email: "ov-ca@example.com" });
  const customerB = await User.create({ name: "Customer B", email: "ov-cb@example.com" });

  const p1 = await Product.create({ store, title: "Low Stock Item", name: "Low Stock Item", sku: "OV-1", price: 1000, stock: 3 });
  const p2 = await Product.create({ store, title: "Sold Out Item", name: "Sold Out Item", sku: "OV-2", price: 1000, stock: 0 });
  const p3 = await Product.create({ store, title: "Popular Item", name: "Popular Item", sku: "OV-3", price: 1000, stock: 100 });
  const p4 = await Product.create({ store, title: "Shipped Item", name: "Shipped Item", sku: "OV-4", price: 1500, stock: 100 });
  const p5 = await Product.create({ store, title: "Cancelled Item", name: "Cancelled Item", sku: "OV-5", price: 500, stock: 100 });
  const p6 = await Product.create({ store, title: "Returned Item", name: "Returned Item", sku: "OV-6", price: 400, stock: 100 });
  const p7 = await Product.create({ store, title: "Old Item", name: "Old Item", sku: "OV-7", price: 900, stock: 100 });

  const item = (product, quantity, price, pricingMode = "retail") => ({
    product: product._id,
    quantity,
    price,
    pricingMode,
  });

  const base = { store, customerName: "Guest Buyer", paymentStatus: "paid" };

  await Order.create({
    ...base,
    orderNumber: "OV-ORD-1",
    customer: customerA._id,
    customerName: "Customer A",
    items: [item(p1, 1, 1000)],
    totalAmount: 1000,
    status: "pending",
    paymentStatus: "pending",
    orderSource: "facebook",
    createdAt: new Date(),
  });
  await Order.create({
    ...base,
    orderNumber: "OV-ORD-2",
    items: [item(p3, 1, 2000, "wholesale")],
    totalAmount: 2000,
    status: "processing",
    orderSource: "google",
    createdAt: new Date(),
  });
  await Order.create({
    ...base,
    orderNumber: "OV-ORD-3",
    items: [item(p3, 3, 1000)],
    totalAmount: 3000,
    status: "delivered",
    courierName: "Steadfast",
    orderSource: "direct",
    createdAt: new Date(),
  });
  await Order.create({
    ...base,
    orderNumber: "OV-ORD-4",
    items: [item(p4, 1, 1500)],
    totalAmount: 1500,
    status: "shipped",
    paymentStatus: "pending",
    courierName: "",
    createdAt: new Date(),
  });
  await Order.create({
    ...base,
    orderNumber: "OV-ORD-5",
    items: [item(p5, 1, 500)],
    totalAmount: 500,
    status: "cancelled",
    paymentStatus: "cancelled",
    orderSource: "instagram",
    createdAt: new Date(),
  });
  await Order.create({
    ...base,
    orderNumber: "OV-ORD-6",
    items: [item(p6, 1, 400)],
    totalAmount: 400,
    status: "incomplete",
    paymentStatus: "pending",
    createdAt: new Date(),
  });

  await Order.create({
    ...base,
    orderNumber: "OV-ORD-7",
    customer: customerB._id,
    customerName: "Customer B",
    items: [item(p7, 1, 6000)],
    totalAmount: 6000,
    status: "delivered",
    courierName: "Pathao",
    createdAt: daysAgo(1),
  });

  await Order.create({
    ...base,
    orderNumber: "OV-ORD-8",
    items: [item(p7, 1, 2500)],
    totalAmount: 2500,
    status: "delivered",
    createdAt: daysAgo(8),
  });

  await Order.create({
    ...base,
    orderNumber: "OV-ORD-9",
    items: [item(p7, 1, 500)],
    totalAmount: 500,
    status: "processing",
    paymentStatus: "partially_paid",
    paymentMode: "installment",
    paidAmount: 25000,
    dueAmount: 25000,
    createdAt: daysAgo(40),
  });

  const supplier = await Supplier.create({ store, name: "Supplier One", companyName: "One Trading", phone: "01700000009" });
  const supplierOrder = await SupplierOrder.create({
    store,
    supplier: supplier._id,
    orderNo: "OV-PO-1",
    orderDate: new Date(),
    items: [{ product: p3._id, productCode: "OV-3", name: "Popular Item", quantity: 5, unitCostPaisa: 20000, lineTotalPaisa: 100000 }],
    totalQty: 5,
    totalAmountPaisa: 100000,
    status: "received",
  });
  await SupplierInvoice.create({
    store,
    supplier: supplier._id,
    order: supplierOrder._id,
    invoiceNo: "OV-INV-1",
    issueDate: new Date(),
    totalAmountPaisa: 100000,
    paidAmountPaisa: 40000,
  });

  await Cart.create({
    store,
    sessionId: "ov-guest-cart",
    items: [{ product: p3._id, unitPrice: 1000, quantity: 1 }],
  });

  await FlashSale.create({
    store,
    title: "Weekend Flash",
    startAt: daysAgo(0.1),
    endAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    discountPercent: 10,
  });

  await Settings.create({ key: `store:${store}:sst_enabled`, value: "true" });

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
  state.app.use("/api/admin/overview", require("../routes/overview"));
  state.app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("today overview returns KPIs, buckets, split and latest orders", async () => {
  const res = await as("ov-store", "/api/admin/overview?period=today");
  assert.equal(res.status, 200);
  const body = res.body;

  assert.equal(body.period.preset, "today");
  assert.equal(body.period.days, 1);
  assert.equal(body.period.compareLabel, "vs yesterday");

  assert.equal(body.kpis.totalOrders, 6);
  assert.equal(body.kpis.totalSalesPaisa, 790000, "1000 + 2000 + 3000 + 1500 + 400 BDT");
  assert.equal(body.kpis.pendingOrders, 1);
  assert.equal(body.kpis.newCustomers, 1);
  assert.equal(body.kpis.avgOrderPaisa, Math.round(790000 / 6));
  assert.ok(body.kpis.totalSalesDelta > 0, "yesterday sold less");

  const counts = Object.fromEntries(body.status.rows.map((row) => [row.key, row.count]));
  assert.deepEqual(counts, {
    pending: 1,
    processing: 1,
    shipped: 1,
    delivered: 1,
    cancelled: 1,
    returned: 1,
  });
  assert.equal(body.status.guestPercent, 83);
  assert.equal(body.status.registeredPercent, 17);

  assert.equal(body.latestOrders.length, 5);
  assert.ok(body.latestOrders.some((row) => row.statusKey === "delivered"));
  assert.equal(body.trend.length, 1);
  assert.equal(body.trend[0].retailPaisa, 590000, "1000 + 3000 + 1500 + 400");
  assert.equal(body.trend[0].wholesalePaisa, 200000);
});

test("alerts, courier, finance, products, marketing and flash sale are derived", async () => {
  const res = await as("ov-store", "/api/admin/overview?period=today");
  const body = res.body;

  assert.equal(body.alerts.lowStock, 1);
  assert.equal(body.alerts.outOfStock, 1);
  assert.equal(body.alerts.failedCourier, 1, "shipped order without a courier");
  assert.equal(body.alerts.pendingWholesale, 1);
  assert.equal(body.alerts.tracking, true);

  assert.equal(body.courier.rows[0].name, "Steadfast");
  assert.equal(body.courier.rows[0].delivered, 1);
  assert.equal(body.courier.inTransit, 1);
  assert.equal(body.courier.successRate, 50);
  assert.equal(body.courier.codPendingPaisa, 290000, "1000 + 1500 + 400 BDT");

  assert.equal(body.finance.incomePaisa, 790000);
  assert.equal(body.finance.expensePaisa, 100000, "supplier invoice in the period");
  assert.equal(body.finance.supplierDuePaisa, 60000);
  assert.equal(body.finance.customerDuePaisa, 25000);

  assert.equal(body.topProducts[0].sold, 4, "3 retail + 1 wholesale of the same product");
  assert.equal(body.topProducts[0].name, "Popular Item");

  assert.equal(body.marketing.abandonedCarts, 1);
  assert.equal(body.marketing.conversionRate, 83.3);
  assert.equal(body.marketing.sources.length, 3);

  assert.equal(body.flashSale.active, true);
  assert.equal(body.flashSale.title, "Weekend Flash");
  assert.ok(body.flashSale.progress >= 0 && body.flashSale.progress <= 100);
});

test("7d and 30d windows expand the trend and include older orders", async () => {
  const week = await as("ov-store", "/api/admin/overview?period=7d");
  assert.equal(week.status, 200);
  assert.equal(week.body.period.days, 7);
  assert.equal(week.body.trend.length, 7);
  assert.equal(week.body.kpis.totalOrders, 7, "today 6 + yesterday 1");

  const month = await as("ov-store", "/api/admin/overview?period=30d");
  assert.equal(month.status, 200);
  assert.equal(month.body.period.days, 30);
  assert.equal(month.body.trend.length, 30);
  assert.equal(month.body.kpis.totalOrders, 8, "adds the order from 8 days ago");
});

test("custom range and invalid input are validated", async () => {
  const today = new Date();
  const key = (d) => d.toISOString().slice(0, 10);
  const custom = await as("ov-store", `/api/admin/overview?period=custom&from=${key(new Date(today - 2 * DAY))}&to=${key(today)}`);
  assert.equal(custom.status, 200);
  assert.equal(custom.body.period.preset, "custom");
  assert.equal(custom.body.period.days, 3);

  const badPreset = await as("ov-store", "/api/admin/overview?period=yearly");
  assert.equal(badPreset.status, 400);

  const missingDates = await as("ov-store", "/api/admin/overview?period=custom");
  assert.equal(missingDates.status, 400);

  const reversed = await as("ov-store", `/api/admin/overview?period=custom&from=${key(today)}&to=${key(new Date(today - 5 * DAY))}`);
  assert.equal(reversed.status, 400);
});

test("overview requires an authenticated admin", async () => {
  const anonymous = await request(state.app).get("/api/admin/overview?period=today").set("x-store-slug", "ov-store");
  assert.equal(anonymous.status, 401);
});
