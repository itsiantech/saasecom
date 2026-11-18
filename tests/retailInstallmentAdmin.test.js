process.env.JWT_SECRET = "retail-emi-admin-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Product = require("../models/Product");
const InstallmentSettings = require("../models/InstallmentSettings");
const InstallmentOffer = require("../models/InstallmentOffer");
const InstallmentApplication = require("../models/InstallmentApplication");
const Order = require("../models/Order");
const OrderInstallment = require("../models/OrderInstallment");
const Payment = require("../models/Payment");
const { tenantStorage } = require("../lib/tenantContext");
const { computeQuote } = require("../services/installmentPricing");
const { fromPaisa } = require("../lib/money");
const {
  getInstallmentSettings,
  clearInstallmentSettingsCache,
  sanitizeProductPolicy,
} = require("../lib/installmentSettings");
const { verifyPendingPayment } = require("../services/installmentPayments");

const state = {};
let seq = 0;

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role || "admin" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}

const SLUGS = { a: "retail-a", b: "retail-b", off: "retail-off" };

function as(who, method, url, { body } = {}) {
  const req = request(state.app)[method](url)
    .set("Content-Type", "application/json")
    .set("x-store-slug", SLUGS[who])
    .set("Authorization", `Bearer ${state[who + "Token"]}`);
  return body === undefined ? req : req.send(body);
}

function api(method, url, opts) {
  return as("a", method, url, opts);
}

async function createApplication({
  store = state.storeA,
  product = state.productA,
  months = 6,
  downPaymentPercent = 10,
  status = "pending_review",
  applicant = {},
  reserve = true,
} = {}) {
  seq += 1;
  const unitPaisa = Math.round(Number(product.regularPrice || product.price) * 100);
  const quote = computeQuote({
    basePaisa: unitPaisa,
    cashPaisa: unitPaisa,
    months,
    method: "flat_annual",
    annualRatePct: 12,
    markupPct: 0,
    downPaymentPaisa: Math.round((unitPaisa * downPaymentPercent) / 100),
    serviceChargePercent: 0,
    serviceChargeFlatPaisa: 0,
  });
  if (reserve) await Product.updateOne({ _id: product._id }, { $inc: { stock: -1 } });
  return InstallmentApplication.create({
    store: store._id,
    number: `EMI-T${String(seq).padStart(3, "0")}`,
    applicant: {
      name: "Karim Ahmed",
      phone: "0171111" + String(1000 + seq),
      email: "",
      address: "House 1, Dhaka",
      ...applicant,
    },
    items: [
      {
        product: product._id,
        title: product.title,
        slug: product.slug,
        quantity: 1,
        unitBasePaisa: unitPaisa,
        lineBasePaisa: unitPaisa,
      },
    ],
    cashPaisa: unitPaisa,
    basePaisa: unitPaisa,
    quote,
    status,
    stockReserved: reserve,
    termsAcceptedAt: new Date(),
    idempotencyKey: `retail-admin-${seq}-${Date.now()}`,
  });
}

async function settingsPatch(patch) {
  const res = await api("put", "/api/retail-installments/settings", { body: { settings: patch } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  clearInstallmentSettingsCache(state.storeA._id);
  return res.body.settings;
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("retail_emi_admin"));
  await Promise.all([
    Plan.init(),
    Store.init(),
    User.init(),
    Product.init(),
    InstallmentSettings.init(),
    InstallmentOffer.init(),
    InstallmentApplication.init(),
    Order.init(),
    OrderInstallment.init(),
    Payment.init(),
  ]);

  const ownerA = await User.create({ name: "Owner A", email: "owner-a@retail.test", role: "admin" });
  const ownerB = await User.create({ name: "Owner B", email: "owner-b@retail.test", role: "admin" });
  const ownerOff = await User.create({ name: "Owner C", email: "owner-c@retail.test", role: "admin" });

  state.planOn = await Plan.create({
    name: "EMI plan",
    slug: "retail-emi-on",
    features: { installments: true },
  });
  state.planOff = await Plan.create({ name: "Basic", slug: "retail-emi-off", features: {} });

  state.storeA = await Store.create({
    name: "EMI Store A",
    slug: "retail-a",
    owner: ownerA._id,
    plan: state.planOn._id,
  });
  state.storeB = await Store.create({
    name: "EMI Store B",
    slug: "retail-b",
    owner: ownerB._id,
    plan: state.planOn._id,
  });
  state.storeOff = await Store.create({
    name: "No EMI",
    slug: "retail-off",
    owner: ownerOff._id,
    plan: state.planOff._id,
  });

  await InstallmentSettings.create({
    store: state.storeA._id,
    enabled: true,
    method: "flat_annual",
    annualRatePct: 12,
    minDownPaymentPercent: 10,
  });
  await InstallmentSettings.create({
    store: state.storeB._id,
    enabled: true,
    method: "flat_annual",
    annualRatePct: 12,
  });

  state.offerA = await InstallmentOffer.create({
    store: state.storeA._id,
    name: "৬ মাস",
    months: 6,
    downPaymentPercent: 10,
    sortOrder: 1,
  });
  await InstallmentOffer.create({
    store: state.storeB._id,
    name: "B plan",
    months: 12,
    sortOrder: 1,
  });

  state.productA = await Product.create({
    store: state.storeA._id,
    title: "EMI Laptop",
    name: "EMI Laptop",
    slug: "emi-laptop",
    regularPrice: 5000,
    price: 5000,
    stock: 30,
    status: "published",
  });
  state.productB = await Product.create({
    store: state.storeB._id,
    title: "B Laptop",
    name: "B Laptop",
    slug: "b-laptop",
    regularPrice: 4000,
    price: 4000,
    stock: 10,
    status: "published",
  });

  state.aToken = tokenFor(ownerA);
  state.bToken = tokenFor(ownerB);
  state.offToken = tokenFor(ownerOff);

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
  state.app.use("/api/retail-installments", require("../routes/retailInstallments"));
  state.app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("a store without the installments module gets a feature_locked 403", async () => {
  const res = await as("off", "get", "/api/retail-installments/config");
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "feature_locked");
  assert.equal(res.body.feature, "installments");
});

test("config returns normalized settings, methods and only this store's offers", async () => {
  const res = await api("get", "/api/retail-installments/config");
  assert.equal(res.status, 200);
  assert.equal(res.body.settings.enabled, true);
  assert.equal(res.body.settings.method, "flat_annual");
  assert.ok(Array.isArray(res.body.methods));
  assert.ok(Array.isArray(res.body.defaults.reminderDays));
  assert.equal(res.body.offers.length, 1);
  assert.equal(res.body.offers[0].name, "৬ মাস");
  assert.equal(res.body.offers[0].id, String(state.offerA._id));

  const other = await as("b", "get", "/api/retail-installments/config");
  assert.equal(other.body.offers.length, 1);
  assert.equal(other.body.offers[0].name, "B plan");
});

test("saving settings clamps ranges, drops empty rules and clears the cache", async () => {
  const category = new mongoose.Types.ObjectId();
  const saved = await settingsPatch({
    enabled: true,
    method: "reducing",
    annualRatePct: 15,
    maxMonths: 999,
    minDownPaymentPercent: 15,
    reminderDays: [5, 1, 1],
    applicant: { requireNid: false, requireAddress: true, requireDocuments: false },
    review: { approvalRequired: false, autoRejectDays: 99 },
    lateFee: { type: "percent", percent: 2, graceDays: -5 },
    categoryRules: [
      { category: String(category), allowed: false },
      { method: "flat_annual" },
    ],
    cardEmi: { enabled: true, note: "Card EMI partner banks" },
    terms: "Terms here",
  });

  assert.equal(saved.method, "reducing");
  assert.equal(saved.maxMonths, 60);
  assert.equal(saved.minDownPaymentPercent, 15);
  assert.deepEqual(saved.reminderDays, [1, 5]);
  assert.equal(saved.applicant.requireNid, false);
  assert.equal(saved.review.approvalRequired, false);
  assert.equal(saved.review.autoRejectDays, 30);
  assert.equal(saved.lateFee.type, "percent");
  assert.equal(saved.lateFee.percent, 2);
  assert.equal(saved.lateFee.graceDays, 0);
  assert.equal(saved.categoryRules.length, 1);
  assert.equal(saved.categoryRules[0].allowed, false);
  assert.equal(saved.cardEmi.enabled, true);

  clearInstallmentSettingsCache(state.storeA._id);
  const cached = await getInstallmentSettings(state.storeA._id);
  assert.equal(cached.method, "reducing");
  assert.equal(cached.maxMonths, 60);
});

test("offer CRUD validates months and never crosses stores", async () => {
  const created = await api("post", "/api/retail-installments/offers", {
    body: { name: "১২ মাস", months: 12, downPaymentPercent: 20, annualRatePct: 14, sortOrder: 2 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.offer.months, 12);
  assert.equal(created.body.offer.annualRatePct, 14);
  const id = String(created.body.offer._id);

  const bad = await api("post", "/api/retail-installments/offers", {
    body: { name: "ভুল", months: 1 },
  });
  assert.equal(bad.status, 400);

  const renamed = await api("put", `/api/retail-installments/offers/${id}`, {
    body: { name: "১ বছর", months: 12, downPaymentPercent: 20, isActive: false, sortOrder: 3 },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.offer.name, "১ বছর");
  assert.equal(renamed.body.offer.isActive, false);

  const crossStore = await as("b", "put", `/api/retail-installments/offers/${id}`, {
    body: { name: "Hack", months: 6 },
  });
  assert.equal(crossStore.status, 404);

  const removed = await api("delete", `/api/retail-installments/offers/${id}`);
  assert.equal(removed.status, 200);
  assert.equal(await InstallmentOffer.countDocuments({ _id: id }), 0);
});

test("application list filters by status and search, scoped to the store", async () => {
  state.appPending = await createApplication({ applicant: { name: "Rahim Uddin" } });
  state.appInfo = await createApplication({ status: "info_requested" });
  state.appOther = await createApplication({ store: state.storeB, product: state.productB });

  const pending = await api("get", "/api/retail-installments/applications?status=pending_review");
  assert.equal(pending.status, 200);
  assert.equal(pending.body.applications.length, 1);
  assert.equal(pending.body.applications[0].number, state.appPending.number);
  assert.equal(pending.body.applications[0].applicant.nidPresent, false);
  assert.equal(pending.body.applications[0].idempotencyKey.length > 0, true);
  assert.equal(pending.body.counts.pending_review, 1);
  assert.equal(pending.body.counts.info_requested, 1);

  const search = await api("get", "/api/retail-installments/applications?search=Rahim");
  assert.equal(search.status, 200);
  assert.equal(search.body.applications.length, 1);
  assert.equal(search.body.applications[0].number, state.appPending.number);

  const other = await as("b", "get", "/api/retail-installments/applications");
  assert.equal(other.body.applications.length, 1);
  assert.equal(other.body.applications[0].number, state.appOther.number);
});

test("approving an application creates the order and a schedule that sums to the quote", async () => {
  const app = await createApplication();
  const stockBefore = (await Product.findById(state.productA._id).lean()).stock;

  const res = await api("post", `/api/retail-installments/applications/${app._id}/approve`, {
    body: { note: "Verified over phone" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.application.status, "approved");
  assert.ok(res.body.application.order);
  assert.equal(res.body.order.installments, 7); // 10% down payment + 6 months

  const stored = await InstallmentApplication.findById(app._id).lean();
  assert.ok(stored.order);
  assert.equal(stored.stockReserved, false);
  assert.equal(stored.review.note, "Verified over phone");

  const order = await Order.findById(stored.order).lean();
  assert.equal(order.paymentMode, "installment");
  assert.equal(order.installmentPlan.source, "retail");
  assert.equal(order.installmentPlan.goodsReleaseRule, "after_advance");
  assert.equal(order.stockDeducted, true);
  assert.equal(order.totalAmount, fromPaisa(app.quote.totalPayablePaisa));
  assert.equal(order.dueAmount, app.quote.totalPayablePaisa);
  assert.equal(order.paidAmount, 0);

  const rows = await OrderInstallment.find({ order: order._id }).sort({ number: 1 }).lean();
  assert.equal(rows.length, 7);
  assert.deepEqual(rows.map((row) => row.number), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(rows[0].amountPaisa, app.quote.downPaymentPaisa);
  assert.equal(
    rows.reduce((sum, row) => sum + row.amountPaisa, 0),
    app.quote.totalPayablePaisa
  );
  // stock moved at application time; approval must not deduct again
  assert.equal((await Product.findById(state.productA._id).lean()).stock, stockBefore);

  const again = await api("post", `/api/retail-installments/applications/${app._id}/approve`);
  assert.equal(again.status, 409);

  state.approvedApp = app;
  state.approvedOrder = order;
});

test("admin order list shows totals and a manual payment updates the ledger", async () => {
  const list = await api("get", "/api/retail-installments/orders");
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const order = list.body.orders.find((row) => String(row._id) === String(state.approvedOrder._id));
  assert.ok(order);
  assert.equal(order.plan.source, "retail");
  assert.equal(order.installments.length, 7);
  assert.equal(list.body.stats.orders >= 1, true);

  const detail = await api("get", `/api/retail-installments/orders/${state.approvedOrder._id}`);
  assert.equal(detail.status, 200);
  const first = detail.body.order.installments[0];
  assert.equal(first.status, "pending");
  assert.equal(first.outstandingPaisa, first.amountPaisa);

  const pay = await api("post", `/api/retail-installments/orders/${state.approvedOrder._id}/payments`, {
    body: { installmentId: String(first._id), method: "mobile:bkash", trxId: "TRX12345" },
  });
  assert.equal(pay.status, 201, JSON.stringify(pay.body));
  assert.equal(pay.body.verified, true);
  assert.equal(pay.body.order.paidPaisa, first.amountPaisa);
  assert.equal(pay.body.order.duePaisa, state.approvedOrder.dueAmount - first.amountPaisa);
  assert.equal(pay.body.order.paymentStatus, "partially_paid");
  assert.equal(pay.body.order.status, "confirmed");

  const row = await OrderInstallment.findById(first._id).lean();
  assert.equal(row.status, "paid");
  assert.equal(row.paidPaisa, first.amountPaisa);

  const over = await api("post", `/api/retail-installments/orders/${state.approvedOrder._id}/payments`, {
    body: { installmentId: String(first._id), amountPaisa: 5000 },
  });
  assert.equal(over.status, 400);

  const second = detail.body.order.installments[1];
  const pending = await api("post", `/api/retail-installments/orders/${state.approvedOrder._id}/payments`, {
    body: { installmentId: String(second._id), method: "cash", verify: false },
  });
  assert.equal(pending.status, 201);
  assert.equal(pending.body.verified, false);
  assert.equal(pending.body.payment.status, "pending");

  const stats = await api("get", "/api/retail-installments/orders");
  assert.equal(stats.body.stats.pendingPayments >= 1, true);

  const verified = await verifyPendingPayment({ paymentId: pending.body.payment._id, source: "admin" });
  assert.equal(verified.payment.status, "verified");
});

test("rejecting an application releases reserved stock exactly once", async () => {
  const app = await createApplication();
  const stockBefore = (await Product.findById(state.productA._id).lean()).stock;

  const res = await api("post", `/api/retail-installments/applications/${app._id}/reject`, {
    body: { note: "NID mismatch" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.application.status, "rejected");
  assert.equal((await Product.findById(state.productA._id).lean()).stock, stockBefore + 1);
  assert.equal((await InstallmentApplication.findById(app._id).lean()).stockReleased, true);

  const again = await api("post", `/api/retail-installments/applications/${app._id}/reject`);
  assert.equal(again.status, 409);
  assert.equal((await Product.findById(state.productA._id).lean()).stock, stockBefore + 1);
});

test("request-info needs a message and approve still works from info_requested", async () => {
  const app = await createApplication();

  const empty = await api("post", `/api/retail-installments/applications/${app._id}/request-info`, {
    body: {},
  });
  assert.equal(empty.status, 400);

  const info = await api("post", `/api/retail-installments/applications/${app._id}/request-info`, {
    body: { infoRequest: "Bank statement lagbe" },
  });
  assert.equal(info.status, 200);
  assert.equal(info.body.application.status, "info_requested");
  assert.equal(info.body.application.review.infoRequest, "Bank statement lagbe");

  const approve = await api("post", `/api/retail-installments/applications/${app._id}/approve`);
  assert.equal(approve.status, 200);
  assert.equal(approve.body.application.status, "approved");
});

test("cancelling an application releases stock and blocks approval", async () => {
  const app = await createApplication();
  const stockBefore = (await Product.findById(state.productA._id).lean()).stock;

  const res = await api("post", `/api/retail-installments/applications/${app._id}/cancel`, {
    body: { note: "Customer withdrew" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.application.status, "cancelled");
  assert.equal((await Product.findById(state.productA._id).lean()).stock, stockBefore + 1);

  const approve = await api("post", `/api/retail-installments/applications/${app._id}/approve`);
  assert.equal(approve.status, 409);
});

test("the retail scheduler marks overdue rows, charges the late fee once and sends reminders", async () => {
  await settingsPatch({
    enabled: true,
    method: "flat_annual",
    annualRatePct: 12,
    review: { approvalRequired: true, autoRejectDays: 0 },
    lateFee: { type: "flat", amountPaisa: 10000, graceDays: 0 },
    reminderDays: [3],
  });

  const rows = await OrderInstallment.find({ order: state.approvedOrder._id }).sort({ number: 1 });
  const target = rows.find((row) => row.status === "pending");
  assert.ok(target);
  const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  await OrderInstallment.updateOne({ _id: target._id }, { $set: { dueDate: past } });

  const run = await api("post", "/api/retail-installments/run-scheduler");
  assert.equal(run.status, 200);
  assert.equal(run.body.summary.overdueMarked >= 1, true);
  assert.equal(run.body.summary.reminders >= 1, true);

  const updated = await OrderInstallment.findById(target._id).lean();
  assert.equal(updated.status, "overdue");
  assert.equal(updated.lateFeePaisa, 10000);
  assert.equal(updated.remindersSent.due, true);

  const again = await api("post", "/api/retail-installments/run-scheduler");
  assert.equal(again.body.summary.overdueMarked, 0);
  assert.equal(again.body.summary.reminders, 0);
});

test("the retail scheduler auto-expires stale applications and restores stock", async () => {
  const app = await createApplication();
  const stockBefore = (await Product.findById(state.productA._id).lean()).stock;
  const longAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  // createdAt is immutable in the schema; go through the raw collection
  await InstallmentApplication.collection.updateOne({ _id: app._id }, { $set: { createdAt: longAgo } });

  await settingsPatch({
    enabled: true,
    review: { approvalRequired: true, autoRejectDays: 2 },
    lateFee: { type: "flat", amountPaisa: 0, graceDays: 0 },
    reminderDays: [3],
  });

  const run = await api("post", "/api/retail-installments/run-scheduler");
  assert.equal(run.status, 200);
  assert.equal(run.body.summary.applicationsExpired >= 1, true);

  const stored = await InstallmentApplication.findById(app._id).lean();
  assert.equal(stored.status, "expired");
  assert.equal(stored.stockReleased, true);
  assert.equal((await Product.findById(state.productA._id).lean()).stock, stockBefore + 1);
});

test("product level EMI policy sanitizes to only the fields the admin filled", () => {
  assert.equal(sanitizeProductPolicy(null), null);
  assert.equal(sanitizeProductPolicy("inherit"), null);
  assert.equal(sanitizeProductPolicy({}), null);

  const policy = sanitizeProductPolicy({
    allowed: false,
    method: "nope",
    annualRatePct: "14.5",
    months: [12, 6, 6, 24],
    downPaymentPercent: 150,
    serviceChargePercent: 300,
    note: "  no emi  ",
  });
  assert.equal(policy.allowed, false);
  assert.equal(policy.method, null);
  assert.equal(policy.annualRatePct, 14.5);
  assert.deepEqual(policy.months, [6, 12, 24]);
  assert.equal(policy.downPaymentPercent, 99);
  assert.equal(policy.serviceChargePercent, 100);
  assert.equal(policy.note, "no emi");

  const inheritOnly = sanitizeProductPolicy({ allowed: null, months: [] });
  assert.equal(inheritOnly, null);
});
