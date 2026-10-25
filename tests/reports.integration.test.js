process.env.JWT_SECRET = "reports-integration-test-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const { tenantStorage } = require("../lib/tenantContext");
const { todayKey, addDaysKey } = require("../lib/reportPeriods");
const { zonedMidnightUtc, zonedDateKey } = require("../lib/supplierDomain");
const { rebuildDay, rebuildRange } = require("../services/reportRollups");
const { runReconciliation } = require("../services/reportScheduler");
const { changeOrderStatus } = require("../services/orderStatusChange");
const cache = require("../services/reportCache");

const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Product = require("../models/Product");
const Category = require("../models/Category");
const ProductCategory = require("../models/ProductCategory");
const Order = require("../models/Order");
const ReportDaily = require("../models/ReportDaily");
const ReportDailyProduct = require("../models/ReportDailyProduct");
const ReportDailyCategory = require("../models/ReportDailyCategory");
const ReportDailyCoupon = require("../models/ReportDailyCoupon");
const ReportDailyCustomer = require("../models/ReportDailyCustomer");

const TZ = "Asia/Dhaka";
const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}

function get(path, token = state.adminToken, store = null) {
  const req = request(state.app).get(path).set("Authorization", `Bearer ${token}`);
  if (store) req.set("x-test-store", String(store));
  return req;
}

function post(path, body, token = state.superToken, store = null) {
  const req = request(state.app).post(path).set("Authorization", `Bearer ${token}`).send(body);
  if (store) req.set("x-test-store", String(store));
  return req;
}

function dhakaAt(dayKey, hour = 10, minute = 0) {
  return new Date(zonedMidnightUtc(dayKey, TZ).getTime() + (hour * 60 + minute) * 60 * 1000);
}

function periodQuery(from, to) {
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

let orderSeq = 0;
async function makeOrder({
  store = state.storeA,
  createdAt = null,
  status = "completed",
  totalAmount,
  shippingAmount = 0,
  couponCode = "",
  couponLabel = "",
  couponDiscountPaisa = 0,
  customer = null,
  customerName = "Guest",
  customerPhone = "",
  customerEmail = "",
  items = [],
  installmentPlan = null,
  paymentMode = "full",
} = {}) {
  const order = await Order.create({
    store,
    orderNumber: `ORD-${Date.now()}-${++orderSeq}`,
    customer,
    customerName,
    customerPhone,
    customerEmail,
    items: (items || []).map((item) => ({
      product: item.product,
      quantity: item.quantity,
      unitPrice: item.unitPrice || 0,
      unitPricePaisa: item.unitPricePaisa || 0,
      price: item.price || 0,
    })),
    totalAmount,
    shippingAmount,
    couponCode,
    couponLabel,
    couponDiscount: couponDiscountPaisa / 100,
    couponDiscountPaisa,
    status,
    paymentMode,
    installmentPlan,
  });
  if (createdAt) {
    // Raw update keeps historical timestamps exact for the day buckets.
    await Order.collection.updateOne(
      { _id: order._id },
      { $set: { createdAt, updatedAt: createdAt } }
    );
    order.createdAt = createdAt;
  }
  return order;
}

before(async () => {
  state.replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ dbName: "reports_integration" }],
  });
  await mongoose.connect(state.replSet.getUri("reports_integration"));

  await Promise.all([
    Plan.init(),
    Store.init(),
    User.init(),
    Product.init(),
    Category.init(),
    Order.init(),
    ReportDaily.init(),
    ReportDailyProduct.init(),
    ReportDailyCategory.init(),
    ReportDailyCoupon.init(),
    ReportDailyCustomer.init(),
  ]);

  state.plan = await Plan.create({
    name: "Reports Test Plan",
    slug: `reports-plan-${Date.now()}`,
    price: 0,
    limits: { products: 0, orders: 0, storageMB: 0, staffMembers: 0 },
  });
  state.admin = await User.create({
    name: "Reports Admin",
    email: `reports-admin-${Date.now()}@test.local`,
    phone: "+8801800000001",
    role: "admin",
  });
  state.adminB = await User.create({
    name: "Second Admin",
    email: `reports-admin-b-${Date.now()}@test.local`,
    phone: "+8801800000002",
    role: "admin",
  });
  state.superadmin = await User.create({
    name: "Super Admin",
    email: `reports-super-${Date.now()}@test.local`,
    phone: "+8801800000003",
    role: "superadmin",
  });
  state.customer = await User.create({
    name: "Rahim",
    email: `reports-customer-${Date.now()}@test.local`,
    phone: "+8801700000001",
    role: "customer",
  });

  state.storeA = await Store.create({
    name: "Reports Store A",
    slug: `reports-store-a-${Date.now()}`,
    owner: state.admin._id,
    plan: state.plan._id,
  });
  state.storeB = await Store.create({
    name: "Reports Store B",
    slug: `reports-store-b-${Date.now()}`,
    owner: state.adminB._id,
    plan: state.plan._id,
  });

  state.adminToken = tokenFor(state.admin);
  state.adminBToken = tokenFor(state.adminB);
  state.superToken = tokenFor(state.superadmin);
  state.customerToken = tokenFor(state.customer);

  state.p1 = await Product.create({
    store: state.storeA._id,
    name: "Alpha",
    title: "Alpha",
    slug: `alpha-${Date.now()}`,
    price: 500,
    stock: 100,
    status: "published",
  });
  state.p2 = await Product.create({
    store: state.storeA._id,
    name: "Beta",
    title: "Beta",
    slug: `beta-${Date.now()}`,
    price: 50,
    stock: 100,
    status: "published",
  });
  state.catA = await Category.create({
    store: state.storeA._id,
    name: "Cat A",
    slug: `cat-a-${Date.now()}`,
    status: "published",
  });
  state.catB = await Category.create({
    store: state.storeA._id,
    name: "Cat B",
    slug: `cat-b-${Date.now()}`,
    status: "published",
  });

  // P1 was first filed under Cat A; the later Cat B link must not win.
  await ProductCategory.collection.insertOne({
    store: state.storeA._id,
    product: state.p1._id,
    category: state.catA._id,
    createdAt: dhakaAt(addDaysKey(todayKey(new Date(), TZ), -30), 9),
    updatedAt: dhakaAt(addDaysKey(todayKey(new Date(), TZ), -30), 9),
  });
  await ProductCategory.collection.insertOne({
    store: state.storeA._id,
    product: state.p1._id,
    category: state.catB._id,
    createdAt: dhakaAt(addDaysKey(todayKey(new Date(), TZ), -29), 9),
    updatedAt: dhakaAt(addDaysKey(todayKey(new Date(), TZ), -29), 9),
  });

  state.now = new Date();
  state.today = todayKey(state.now, TZ);
  state.d1 = addDaysKey(state.today, -1);
  state.d2 = addDaysKey(state.today, -2);
  state.ytdFrom = `${state.today.slice(0, 4)}-01-01`;

  // Store A: two valid days, one pending, one cancelled with an installment
  // refund snapshot, one legacy status that must stay excluded.
  state.o1 = await makeOrder({
    createdAt: dhakaAt(state.d2, 10),
    totalAmount: 1150,
    shippingAmount: 50,
    couponCode: "SAVE10",
    couponLabel: "Save 10",
    couponDiscountPaisa: 10000,
    customer: state.customer._id,
    customerName: "Rahim",
    customerPhone: "+8801700000001",
    items: [
      { product: state.p1._id, quantity: 2, unitPricePaisa: 50000, price: 1000 },
      { product: state.p2._id, quantity: 2, unitPricePaisa: 5000, price: 100 },
    ],
  });
  state.o2 = await makeOrder({
    createdAt: dhakaAt(state.d1, 11),
    status: "processing",
    totalAmount: 500,
    customer: state.customer._id,
    customerName: "Rahim",
    customerPhone: "+8801700000001",
    items: [{ product: state.p1._id, quantity: 1, unitPricePaisa: 50000, price: 500 }],
  });
  state.o3 = await makeOrder({
    createdAt: dhakaAt(state.d1, 12),
    status: "pending",
    totalAmount: 999,
    customerName: "Pending Person",
    items: [{ product: state.p1._id, quantity: 1, unitPricePaisa: 99900, price: 999 }],
  });
  state.o4 = await makeOrder({
    createdAt: dhakaAt(state.today, 9),
    totalAmount: 300,
    shippingAmount: 30,
    customerName: "Karim Guest",
    customerPhone: "+8801711111111",
    items: [{ product: state.p2._id, quantity: 2, unitPricePaisa: 13500, price: 270 }],
  });
  state.o5 = await makeOrder({
    createdAt: dhakaAt(state.d2, 14),
    status: "cancelled",
    totalAmount: 800,
    paymentMode: "installment",
    customerName: "Refund Person",
    items: [{ product: state.p1._id, quantity: 1, unitPricePaisa: 80000, price: 800 }],
    installmentPlan: {
      cancellation: {
        at: dhakaAt(state.d1, 12),
        reason: "Customer cancelled",
        refundType: "full",
        refundPercent: 100,
        refundPaisa: 20000,
      },
    },
  });
  state.o7 = await makeOrder({
    createdAt: dhakaAt(state.d1, 15),
    status: "delivered",
    totalAmount: 777,
    customerName: "Legacy Person",
    items: [{ product: state.p1._id, quantity: 1, unitPricePaisa: 77700, price: 777 }],
  });

  // Store B: boundary orders around local midnight plus a pending order used
  // to exercise the status-change hook.
  state.ob1 = await makeOrder({
    store: state.storeB._id,
    createdAt: dhakaAt(state.d1, 23, 30),
    totalAmount: 111,
    customerName: "Midnight Late",
  });
  state.ob2 = await makeOrder({
    store: state.storeB._id,
    createdAt: dhakaAt(state.d2, 0, 30),
    totalAmount: 222,
    customerName: "Midnight Early",
  });
  state.ob3 = await makeOrder({
    store: state.storeB._id,
    createdAt: dhakaAt(state.d1, 9),
    status: "pending",
    totalAmount: 50,
    customerName: "Hook Pending",
  });

  state.app = express();
  state.app.use(express.json());
  state.app.use((req, res, next) => {
    const requested = String(req.get("x-test-store") || "").trim();
    const storePromise = requested ? Store.findById(requested) : Promise.resolve(state.storeA);
    storePromise
      .then((store) => {
        const active = store || state.storeA;
        tenantStorage.run({ storeId: active._id }, () => {
          req.store = active;
          next();
        });
      })
      .catch(next);
  });
  state.app.use("/api/admin/reports", require("../routes/reports"));
  state.app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.replSet) await state.replSet.stop();
});

/* ------------------------------ permissions ------------------------------ */

test("reports access probe and admin guard are fail-closed", async () => {
  const anonymous = await request(state.app).get("/api/admin/reports/sales/summary");
  assert.equal(anonymous.status, 401);

  const customerAccess = await get("/api/admin/reports/access", state.customerToken);
  assert.equal(customerAccess.status, 200);
  assert.deepEqual(customerAccess.body, {
    canView: false,
    canExport: false,
    canRebuild: false,
  });

  const customerSummary = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.d2, state.today)}`,
    state.customerToken
  );
  assert.equal(customerSummary.status, 403);

  const adminAccess = await get("/api/admin/reports/access", state.adminToken);
  assert.deepEqual(adminAccess.body, { canView: true, canExport: true, canRebuild: false });

  const superAccess = await get("/api/admin/reports/access", state.superToken);
  assert.deepEqual(superAccess.body, { canView: true, canExport: true, canRebuild: true });
});

/* -------------------------------- summary -------------------------------- */

test("summary metrics are hand-calculated from valid orders", async () => {
  const res = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.d2, state.today)}`
  );
  assert.equal(res.status, 200, JSON.stringify(res.body));

  assert.equal(res.body.period.from, state.d2);
  assert.equal(res.body.period.to, state.today);
  assert.equal(res.body.period.days, 3);
  assert.equal(res.body.period.timezone, TZ);

  // 1150 (d2) + 500 (d1) + 300 (today); pending/cancelled/delivered excluded.
  assert.equal(res.body.sales, 1950);
  assert.equal(res.body.averageDailySales, 650); // 1950 / 3 calendar days
  assert.equal(res.body.ordersPlaced, 3);
  assert.equal(res.body.itemsPurchased, 7); // 4 + 1 + 2
  assert.equal(res.body.refundedOrders, 1); // refund snapshot dated d1
  assert.equal(res.body.shippingCharged, 80); // 50 + 0 + 30
  assert.equal(res.body.couponsWorth, 100); // SAVE10 on o1

  let ytdSales = 0;
  let ytdShipping = 0;
  for (const order of [state.o1, state.o2, state.o4]) {
    if (zonedDateKey(order.createdAt, TZ) >= state.ytdFrom) {
      ytdSales += order.totalAmount;
      ytdShipping += order.shippingAmount;
    }
  }
  const refundDay = zonedDateKey(state.o5.installmentPlan.cancellation.at, TZ);
  const ytdRefunds = refundDay >= state.ytdFrom ? 200 : 0;
  assert.equal(res.body.netSalesThisYear, ytdSales - ytdRefunds - ytdShipping);

  assert.equal(res.body.chart.granularity, "day");
  assert.deepEqual(
    res.body.chart.buckets.map((bucket) => [bucket.sales, bucket.orders]),
    [
      [1150, 1],
      [500, 1],
      [300, 1],
    ]
  );
});

test("net sales this year is filter-independent and refunds follow refund date", async () => {
  const range = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.d2, state.today)}`
  );
  const lastMonth = await get("/api/admin/reports/sales/summary?preset=last_month");
  const thisMonth = await get("/api/admin/reports/sales/summary?preset=this_month");
  assert.equal(lastMonth.status, 200);
  assert.equal(thisMonth.status, 200);
  assert.equal(lastMonth.body.netSalesThisYear, range.body.netSalesThisYear);
  assert.equal(thisMonth.body.netSalesThisYear, range.body.netSalesThisYear);

  const refundDay = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.d1, state.d1)}`
  );
  assert.equal(refundDay.body.refundedOrders, 1);

  const noRefundDay = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.d2, state.d2)}`
  );
  assert.equal(noRefundDay.body.refundedOrders, 0);
  assert.equal(noRefundDay.body.sales, 1150);
});

test("chart buckets are zero filled and today is always live", async () => {
  const seven = await get("/api/admin/reports/sales/summary?preset=last_7_days");
  assert.equal(seven.status, 200);
  assert.equal(seven.body.chart.granularity, "day");
  assert.equal(seven.body.chart.buckets.length, 7);
  assert.ok(seven.body.chart.buckets.some((bucket) => bucket.sales === 0));

  const before = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.today, state.today)}`
  );
  assert.deepEqual([before.body.sales, before.body.ordersPlaced], [300, 1]);

  const extra = await makeOrder({
    createdAt: new Date(),
    totalAmount: 70,
    items: [{ product: state.p2._id, quantity: 1, unitPricePaisa: 7000, price: 70 }],
  });
  cache.reset();
  const live = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.today, state.today)}`
  );
  assert.deepEqual([live.body.sales, live.body.ordersPlaced, live.body.itemsPurchased], [370, 2, 3]);

  await Order.deleteOne({ _id: extra._id });
  cache.reset();
  const restored = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.today, state.today)}`
  );
  assert.deepEqual([restored.body.sales, restored.body.ordersPlaced], [300, 1]);
});

/* ------------------------------- validation ------------------------------- */

test("invalid report filters return clear 400s and correlation ids", async () => {
  const cases = [
    "/api/admin/reports/sales/summary?preset=weekly",
    `/api/admin/reports/sales/summary?from=${state.d2}&to=${addDaysKey(state.today, 1)}`,
    `/api/admin/reports/sales/summary?from=${addDaysKey(state.today, -367)}&to=${state.today}`,
    `/api/admin/reports/sales/summary?preset=this_month&from=${state.d2}`,
    `/api/admin/reports/sales/summary?${periodQuery(state.d2, state.today)}&foo=1`,
    `/api/admin/reports/sales/products?${periodQuery(state.d2, state.today)}&sort=price`,
    "/api/admin/reports/customers/top?range=weekly",
    "/api/admin/reports/export?report=summary&format=xlsx",
    "/api/admin/reports/export?report=unknown&format=csv",
  ];
  for (const path of cases) {
    const res = await get(path);
    assert.equal(res.status, 400, `${path} -> ${res.status} ${JSON.stringify(res.body)}`);
    assert.equal(typeof res.body.message, "string");
    assert.ok(res.body.requestId, path);
  }

  const array = await request(state.app)
    .get("/api/admin/reports/sales/summary?preset=this_month&preset=last_month")
    .set("Authorization", `Bearer ${state.adminToken}`);
  assert.equal(array.status, 400);

  const correlated = await request(state.app)
    .get("/api/admin/reports/sales/summary?preset=weekly")
    .set("Authorization", `Bearer ${state.adminToken}`)
    .set("X-Request-Id", "reports-test-correlation-123");
  assert.equal(correlated.status, 400);
  assert.equal(correlated.headers["x-request-id"], "reports-test-correlation-123");
  assert.equal(correlated.body.requestId, "reports-test-correlation-123");
});

/* ------------------------------- subreports ------------------------------- */

test("product, category and coupon subreports match the order lines", async () => {
  const products = await get(
    `/api/admin/reports/sales/products?${periodQuery(state.d2, state.today)}&limit=20`
  );
  assert.equal(products.status, 200);
  assert.equal(products.body.total, 2);
  assert.deepEqual(
    products.body.rows.map((row) => [row.name, row.sales, row.quantity, row.orders]),
    [
      ["Alpha", 1500, 3, 2],
      ["Beta", 370, 4, 2],
    ]
  );
  const revenue = products.body.rows.reduce((sum, row) => sum + row.sales, 0);
  assert.equal(revenue, 1950 - 80); // merchandise only

  const byQuantity = await get(
    `/api/admin/reports/sales/products?${periodQuery(state.d2, state.today)}&sort=quantity`
  );
  assert.equal(byQuantity.body.rows[0].name, "Beta");
  assert.equal(byQuantity.body.sort, "quantity");

  const paged = await get(
    `/api/admin/reports/sales/products?${periodQuery(state.d2, state.today)}&limit=1&page=2`
  );
  assert.equal(paged.body.page, 2);
  assert.equal(paged.body.pages, 2);
  assert.equal(paged.body.rows.length, 1);
  assert.equal(paged.body.rows[0].name, "Beta");

  const categories = await get(
    `/api/admin/reports/sales/categories?${periodQuery(state.d2, state.today)}`
  );
  assert.equal(categories.body.total, 2);
  assert.deepEqual(
    categories.body.rows.map((row) => [row.name, row.sales, row.quantity, row.orders]),
    [
      ["Cat A", 1500, 3, 2],
      ["Uncategorized", 370, 4, 2],
    ]
  );

  const coupons = await get(
    `/api/admin/reports/sales/coupons?${periodQuery(state.d2, state.today)}`
  );
  assert.equal(coupons.status, 200);
  assert.equal(coupons.body.total, 1);
  assert.deepEqual(coupons.body.rows[0], {
    code: "SAVE10",
    label: "Save 10",
    discount: 100,
    orders: 1,
  });
});

test("top customers group registered and guest buyers correctly", async () => {
  const res = await get("/api/admin/reports/customers/top?range=yearly&limit=10");
  assert.equal(res.status, 200);
  assert.equal(res.body.range, "yearly");

  const rahim = res.body.rows.find((row) => row.name === "Rahim");
  const rahimOrders =
    (zonedDateKey(state.o1.createdAt, TZ) >= state.ytdFrom ? 1 : 0) +
    (zonedDateKey(state.o2.createdAt, TZ) >= state.ytdFrom ? 1 : 0);
  if (rahimOrders > 0) {
    assert.ok(rahim, JSON.stringify(res.body.rows));
    assert.equal(rahim.orders, rahimOrders);
    assert.equal(rahim.isGuest, false);
    assert.equal(
      rahim.totalSpent,
      (zonedDateKey(state.o1.createdAt, TZ) >= state.ytdFrom ? 1150 : 0) +
        (zonedDateKey(state.o2.createdAt, TZ) >= state.ytdFrom ? 500 : 0)
    );
  }

  if (zonedDateKey(state.o4.createdAt, TZ) >= state.ytdFrom) {
    const karim = res.body.rows.find((row) => row.name === "Karim Guest");
    assert.ok(karim, JSON.stringify(res.body.rows));
    assert.equal(karim.isGuest, true);
    assert.equal(karim.orders, 1);
    assert.equal(karim.totalSpent, 300);
  }

  const isolated = await get(
    `/api/admin/reports/sales/products?${periodQuery(state.d2, state.today)}`,
    state.adminBToken,
    state.storeB._id
  );
  assert.equal(isolated.status, 200);
  assert.equal(isolated.body.total, 0);
});

/* ------------------------- rollups and reconciliation ------------------------- */

test("rollups are idempotent, fall back to raw data and reconcile repairs drift", async () => {
  await rebuildRange(state.storeA._id, state.d2, state.d1, { timezone: TZ });

  const dailyD2 = await ReportDaily.findOne({ store: state.storeA._id, date: state.d2 }).lean();
  assert.equal(dailyD2.salesPaisa, 115000);
  assert.equal(dailyD2.ordersCount, 1);
  assert.equal(dailyD2.itemsCount, 4);
  assert.equal(dailyD2.shippingPaisa, 5000);
  assert.equal(dailyD2.couponDiscountPaisa, 10000);

  const dailyD1 = await ReportDaily.findOne({ store: state.storeA._id, date: state.d1 }).lean();
  assert.equal(dailyD1.salesPaisa, 50000);
  assert.equal(dailyD1.refundsCount, 1);
  assert.equal(dailyD1.refundsAmountPaisa, 20000);

  const rebuilt = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.d2, state.today)}`
  );
  assert.equal(rebuilt.body.sales, 1950);
  assert.equal(rebuilt.body.ordersPlaced, 3);

  const productRows = await ReportDailyProduct.countDocuments({
    store: state.storeA._id,
    date: state.d2,
  });
  await rebuildDay(state.storeA._id, state.d2, TZ);
  await rebuildDay(state.storeA._id, state.d2, TZ);
  assert.equal(
    await ReportDailyProduct.countDocuments({ store: state.storeA._id, date: state.d2 }),
    productRows
  );
  assert.equal(
    await ReportDaily.countDocuments({ store: state.storeA._id, date: { $gte: state.d2, $lte: state.d1 } }),
    2
  );

  // No rollup rows -> reads fall back to raw orders without writing anything.
  await Promise.all([
    ReportDaily.deleteMany({ store: state.storeA._id }),
    ReportDailyProduct.deleteMany({ store: state.storeA._id }),
    ReportDailyCategory.deleteMany({ store: state.storeA._id }),
    ReportDailyCoupon.deleteMany({ store: state.storeA._id }),
    ReportDailyCustomer.deleteMany({ store: state.storeA._id }),
  ]);
  cache.reset();
  const fallback = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.d2, state.today)}`
  );
  assert.equal(fallback.body.sales, 1950);
  assert.equal(await ReportDaily.countDocuments({ store: state.storeA._id }), 0);

  await rebuildRange(state.storeA._id, state.d2, state.d1, { timezone: TZ });

  const drifted = await makeOrder({
    store: state.storeA._id,
    createdAt: dhakaAt(state.d1, 16),
    totalAmount: 40,
    items: [{ product: state.p2._id, quantity: 1, unitPricePaisa: 4000, price: 40 }],
  });
  cache.reset();
  const stale = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.d2, state.today)}`
  );
  assert.equal(stale.body.sales, 1950); // rollup has not seen the new order yet

  await runReconciliation({ now: new Date(), timezone: TZ, days: 3 });
  const repaired = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.d2, state.today)}`
  );
  assert.equal(repaired.body.sales, 1990);
  assert.equal(repaired.body.ordersPlaced, 4);
  assert.equal(repaired.body.itemsPurchased, 8);

  await Order.deleteOne({ _id: drifted._id });
  await runReconciliation({ now: new Date(), timezone: TZ, days: 3 });
  const restored = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.d2, state.today)}`
  );
  assert.equal(restored.body.sales, 1950);
});

/* --------------------------------- exports -------------------------------- */

test("CSV and print exports reflect the active filters and metadata", async () => {
  const csv = await get(
    `/api/admin/reports/export?report=summary&format=csv&${periodQuery(state.d2, state.today)}`
  );
  assert.equal(csv.status, 200);
  assert.match(csv.headers["content-type"], /text\/csv/);
  assert.match(csv.headers["content-disposition"], /sales-summary-.*\.csv/);
  assert.equal(csv.text.charCodeAt(0), 0xfeff);
  assert.match(csv.text, /Report,Sales report/);
  assert.match(csv.text, new RegExp(`Period,${state.d2} – ${state.today}`));
  assert.match(csv.text, /Generated by,Reports Admin/);
  assert.match(csv.text, /Sales in this period,1950/);
  assert.match(csv.text, /Bucket,Sales,Orders/);

  const products = await get(
    `/api/admin/reports/export?report=products&format=csv&${periodQuery(state.d2, state.today)}`
  );
  assert.equal(products.status, 200);
  assert.match(products.text, /Product,Sales \(BDT\),Quantity,Orders/);
  assert.match(products.text, /Alpha,1500,3,2/);

  const customers = await get("/api/admin/reports/export?report=customers&format=csv&range=yearly");
  assert.equal(customers.status, 200);
  assert.match(customers.text, /Customer,Type,Orders,Total spent \(BDT\)/);

  const pdf = await get("/api/admin/reports/export?report=summary&format=pdf&preset=last_7_days");
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers["content-type"], /text\/html/);
  assert.match(pdf.text, /Sales report/);
  assert.match(pdf.text, /Generated by/);
  assert.match(pdf.text, /Reports Admin/);
  assert.match(pdf.text, /Print \/ Save as PDF/);

  const forbidden = await get(
    "/api/admin/reports/export?report=customers&format=csv&preset=this_month",
    state.superToken
  );
  assert.equal(forbidden.status, 400);
});

/* ---------------------- second store: local day + hooks ---------------------- */

test("Dhaka midnight decides the report day and status hooks rebuild that day", async () => {
  const late = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.d1, state.d1)}`,
    state.adminBToken,
    state.storeB._id
  );
  assert.equal(late.status, 200);
  assert.deepEqual([late.body.sales, late.body.ordersPlaced], [111, 1]);

  const early = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.d2, state.d2)}`,
    state.adminBToken,
    state.storeB._id
  );
  assert.deepEqual([early.body.sales, early.body.ordersPlaced], [222, 1]);

  const main = await get(`/api/admin/reports/sales/summary?${periodQuery(state.d1, state.d1)}`);
  assert.equal(main.body.sales, 500); // store B never leaks into store A

  await changeOrderStatus({
    orderId: state.ob3._id,
    toStatus: "completed",
    actor: { id: state.adminB._id, name: "Second Admin" },
  });

  // reportHooks debounces for 2s before rebuilding the affected day.
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const afterHook = await get(
    `/api/admin/reports/sales/summary?${periodQuery(state.d1, state.d1)}`,
    state.adminBToken,
    state.storeB._id
  );
  assert.deepEqual([afterHook.body.sales, afterHook.body.ordersPlaced], [161, 2]);
  const rollup = await ReportDaily.findOne({ store: state.storeB._id, date: state.d1 }).lean();
  assert.equal(rollup.salesPaisa, 16100);
  assert.equal(rollup.ordersCount, 2);
});

/* ------------------------------ rebuild route ------------------------------ */

test("rebuild endpoint is superadmin-only and bounded", async () => {
  const denied = await post(
    "/api/admin/reports/rebuild",
    { from: state.d2, to: state.d1 },
    state.adminToken,
    state.storeA._id
  );
  assert.equal(denied.status, 403);

  const tooLong = await post(
    "/api/admin/reports/rebuild",
    { from: addDaysKey(state.today, -40), to: addDaysKey(state.today, -2) },
    state.superToken,
    state.storeA._id
  );
  assert.equal(tooLong.status, 400);
  assert.match(tooLong.body.message, /31/);

  const ok = await post(
    "/api/admin/reports/rebuild",
    { from: state.d2, to: state.d1 },
    state.superToken,
    state.storeB._id
  );
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual([ok.body.days, ok.body.rebuilt], [2, 2]);
});
