process.env.JWT_SECRET = "supplier-integration-test-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const { tenantStorage } = require("../lib/tenantContext");
const { saveSupplierSettings } = require("../services/supplierSettings");
const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Product = require("../models/Product");
const Supplier = require("../models/Supplier");
const SupplierOrder = require("../models/SupplierOrder");
const SupplierInvoice = require("../models/SupplierInvoice");
const SupplierPayment = require("../models/SupplierPayment");
const SupplierAuditLog = require("../models/SupplierAuditLog");
const SupplierIdempotency = require("../models/SupplierIdempotency");
const StockMovement = require("../models/StockMovement");

const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}

function get(path, token = state.adminToken) {
  return request(state.app).get(path).set("Authorization", `Bearer ${token}`);
}
function post(path, body, token = state.adminToken) {
  return request(state.app).post(path).set("Authorization", `Bearer ${token}`).send(body);
}
function patch(path, body, token = state.adminToken) {
  return request(state.app).patch(path).set("Authorization", `Bearer ${token}`).send(body);
}
function del(path, token = state.adminToken) {
  return request(state.app).delete(path).set("Authorization", `Bearer ${token}`);
}

let phoneSeq = 1000000000;
function nextPhone() {
  phoneSeq += 1;
  return `+8801${phoneSeq}`;
}

async function makeSupplier(overrides = {}) {
  const res = await post("/api/suppliers", {
    name: "Test Supplier",
    phone: nextPhone(),
    companyName: "Test Co",
    address: "Dhaka",
    email: "",
    note: "",
    ...overrides,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.supplier;
}

async function makeProduct({ title, stock = 10 } = {}) {
  const n = ++state.productSeq;
  return Product.create({
    store: state.store._id,
    title: title || `Test Product ${n}`,
    name: title || `Test Product ${n}`,
    slug: `test-product-${n}-${Date.now()}`,
    sku: `SKU-TEST-${n}`,
    price: 100,
    stock,
    status: "published",
  });
}

function orderBody(product, quantity, unitCostPaisa) {
  return { items: [{ productId: String(product._id), quantity, unitCostPaisa }] };
}

async function createOrder(supplierId, product, quantity, unitCostPaisa, key = `key-${Date.now()}-${Math.random()}`) {
  return post(`/api/suppliers/${supplierId}/orders`, orderBody(product, quantity, unitCostPaisa)).set(
    "Idempotency-Key",
    key
  );
}

async function latestInvoice(supplierId) {
  return SupplierInvoice.findOne({ store: state.store._id, supplier: supplierId })
    .sort({ createdAt: -1 })
    .lean();
}

async function resetStock(product, stock) {
  await Product.updateOne({ _id: product._id }, { $set: { stock } });
}

async function rawInvoiceTotals(from, to) {
  const [row] = await SupplierInvoice.aggregate([
    {
      $match: {
        store: state.store._id,
        state: "active",
        issueDate: { $gte: new Date(from), $lte: new Date(to) },
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: "$totalAmountPaisa" },
        paid: { $sum: "$paidAmountPaisa" },
        count: { $sum: 1 },
      },
    },
  ]);
  return row || { total: 0, paid: 0, count: 0 };
}

before(async () => {
  state.replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ dbName: "supplier_integration" }],
  });
  await mongoose.connect(state.replSet.getUri("supplier_integration"));

  await Promise.all([
    Plan.init(),
    Store.init(),
    User.init(),
    Product.init(),
    Supplier.init(),
    SupplierOrder.init(),
    SupplierInvoice.init(),
    SupplierPayment.init(),
    SupplierAuditLog.init(),
    SupplierIdempotency.init(),
    StockMovement.init(),
  ]);

  state.plan = await Plan.create({
    name: "Test Plan",
    slug: `test-plan-${Date.now()}`,
    price: 0,
    limits: { products: 0, orders: 0, storageMB: 0, staffMembers: 0 },
  });
  state.admin = await User.create({
    name: "Admin",
    email: `admin-${Date.now()}@test.local`,
    phone: nextPhone(),
    role: "admin",
  });
  state.superadmin = await User.create({
    name: "Super Admin",
    email: `super-${Date.now()}@test.local`,
    phone: nextPhone(),
    role: "superadmin",
  });
  state.customer = await User.create({
    name: "Customer",
    email: `customer-${Date.now()}@test.local`,
    phone: nextPhone(),
    role: "customer",
  });
  state.store = await Store.create({
    name: "Integration Store",
    slug: `integration-store-${Date.now()}`,
    owner: state.admin._id,
    plan: state.plan._id,
  });

  state.adminToken = tokenFor(state.admin);
  state.superToken = tokenFor(state.superadmin);
  state.customerToken = tokenFor(state.customer);
  state.productSeq = 0;

  state.app = express();
  state.app.use(express.json());
  state.app.use((req, res, next) => {
    const requested = String(req.get("x-test-store") || "").trim();
    const storePromise = requested ? Store.findById(requested) : Promise.resolve(state.store);
    storePromise
      .then((store) => {
        const active = store || state.store;
        tenantStorage.run({ storeId: active._id }, () => {
          req.store = active;
          next();
        });
      })
      .catch(next);
  });
  state.app.use("/api/suppliers", require("../routes/suppliers"));
  state.app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.replSet) await state.replSet.stop();
});

/* ------------------------------- suppliers ------------------------------- */

test("supplier create/list/detail/search and tenant isolation", async () => {
  const supplier = await makeSupplier({
    name: "Alpha Traders",
    companyName: "Alpha Co",
    address: "Chattogram",
    email: "alpha@test.local",
    note: "regular",
  });

  const list = await get("/api/suppliers?limit=20&search=Alpha");
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 1);
  const row = list.body.suppliers[0];
  assert.equal(row.id, supplier._id);
  assert.equal(row.name, "Alpha Traders");
  assert.equal(row.companyName, "Alpha Co");
  assert.equal(row.address, "Chattogram");
  assert.equal(row.orderQty, 0);
  assert.equal(row.paymentStatus, "none");
  assert.equal(row.inStock, 0);

  const detail = await get(`/api/suppliers/${supplier._id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.supplier.phone, supplier.phone);
  assert.equal(detail.body.stats.paymentStatus, "none");

  const otherStore = await Store.create({
    name: "Other Store",
    slug: `other-store-${Date.now()}`,
    owner: state.admin._id,
    plan: state.plan._id,
  });
  const otherSupplier = await Supplier.create({
    store: otherStore._id,
    name: "Other Store Supplier",
    phone: nextPhone(),
    state: "active",
  });
  const isolated = await get("/api/suppliers?limit=50");
  assert.equal(isolated.body.suppliers.some((s) => s.id === String(otherSupplier._id)), false);
  const cross = await get(`/api/suppliers/${otherSupplier._id}`);
  assert.equal(cross.status, 404);

  const unauth = await request(state.app).get("/api/suppliers");
  assert.equal(unauth.status, 401);
});

test("active phone is unique, and can be reused after void", async () => {
  const phone = nextPhone();
  const first = await makeSupplier({ phone });
  const duplicate = await post("/api/suppliers", { name: "Duplicate", phone });
  assert.equal(duplicate.status, 409);

  const voided = await post(`/api/suppliers/${first._id}/void`, { reason: "Closed business" });
  assert.equal(voided.status, 200);
  const reuse = await post("/api/suppliers", { name: "Reopen", phone });
  assert.equal(reuse.status, 201, JSON.stringify(reuse.body));

  const shortReason = await post(`/api/suppliers/${reuse.body.supplier._id}/void`, { reason: "x" });
  assert.equal(shortReason.status, 400);
});

/* -------------------------------- orders --------------------------------- */

test("order creates exactly one invoice and replays with the same idempotency key", async () => {
  const supplier = await makeSupplier({ name: "Order Supplier" });
  const product = await makeProduct({ stock: 10 });
  const key = `idem-${Date.now()}`;

  const first = await createOrder(supplier._id, product, 2, 50000, key);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.match(first.body.orderNo, /^PO-\d{4}-\d{4}$/);
  assert.match(first.body.invoiceNo, /^INV-\d{4}-\d{4}$/);
  assert.equal(first.body.totalQty, 2);
  assert.equal(first.body.totalAmountPaisa, 100000);
  assert.equal(first.body.replayed, false);

  const second = await createOrder(supplier._id, product, 2, 50000, key);
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.replayed, true);
  assert.equal(second.body.orderId, first.body.orderId);
  assert.equal(second.body.invoiceId, first.body.invoiceId);

  assert.equal(await SupplierOrder.countDocuments({ store: state.store._id, supplier: supplier._id }), 1);
  assert.equal(await SupplierInvoice.countDocuments({ store: state.store._id, supplier: supplier._id }), 1);

  const list = await get("/api/suppliers?filter=due&limit=50");
  assert.equal(list.status, 200);
  const row = list.body.suppliers.find((s) => s.id === supplier._id);
  assert.ok(row, "due filter should include the supplier");
  assert.equal(row.orderQty, 2);
  assert.equal(row.orderCount, 1);
  assert.equal(row.paymentStatus, "due");
  assert.equal(row.totalPurchasePaisa, 100000);
  assert.equal(row.dueAmountPaisa, 100000);

  const missingKey = await post(`/api/suppliers/${supplier._id}/orders`, orderBody(product, 1, 50000));
  assert.equal(missingKey.status, 400);
});

test("order accepts a product without SKU using a stable fallback code", async () => {
  const supplier = await makeSupplier({ name: "No SKU Supplier" });
  const product = await makeProduct({ title: "No SKU Item" });
  await Product.updateOne({ _id: product._id }, { $set: { sku: "" } });

  const created = await createOrder(supplier._id, product, 1, 12345);
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const invoice = await latestInvoice(supplier._id);
  assert.equal(invoice.lines[0].productCode, `P-${String(product._id).slice(-6).toUpperCase()}`);
});

test("receive with auto stock OFF leaves stock untouched and returns exact message", async () => {
  await saveSupplierSettings(state.store._id, { autoAdjustStock: false }, state.superadmin._id);
  const supplier = await makeSupplier({ name: "Off Supplier" });
  const product = await makeProduct({ stock: 10 });
  const created = await createOrder(supplier._id, product, 2, 30000);
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const received = await post(`/api/suppliers/orders/${created.body.orderId}/receive`, {});
  assert.equal(received.status, 200, JSON.stringify(received.body));
  assert.equal(received.body.message, "Stock not changed. Adjust manually.");
  assert.equal(received.body.stockChanged, false);
  assert.equal(received.body.stockApplied, false);

  const after = await Product.findById(product._id).lean();
  assert.equal(after.stock, 10);
  assert.equal(
    await StockMovement.countDocuments({ store: state.store._id, supplier: supplier._id }),
    0
  );
});

test("receive with auto stock ON adds stock once and never double-adds", async () => {
  await saveSupplierSettings(state.store._id, { autoAdjustStock: true }, state.superadmin._id);
  const supplier = await makeSupplier({ name: "On Supplier" });
  const product = await makeProduct({ stock: 10 });
  const created = await createOrder(supplier._id, product, 3, 20000);
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const first = await post(`/api/suppliers/orders/${created.body.orderId}/receive`, {});
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.stockApplied, true);
  assert.equal(first.body.message, "Order received — product stock auto update hoyeche.");
  assert.equal((await Product.findById(product._id).lean()).stock, 13);

  const second = await post(`/api/suppliers/orders/${created.body.orderId}/receive`, {});
  assert.equal(second.status, 200);
  assert.equal(second.body.alreadyReceived, true);
  assert.equal(second.body.stockApplied, true);
  assert.equal((await Product.findById(product._id).lean()).stock, 13);

  const movements = await StockMovement.find({ store: state.store._id, supplier: supplier._id }).lean();
  assert.equal(movements.length, 1);
  assert.equal(movements[0].mode, "auto");
  assert.equal(movements[0].change, 3);
  assert.equal(movements[0].stockAfter, 13);

  const invoice = await latestInvoice(supplier._id);
  assert.equal(invoice.totalAmountPaisa, 60000);
  const detail = await get(`/api/suppliers/invoices/${invoice._id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.order.stockApplied, true);
  assert.equal(detail.body.order.status, "received");
  assert.equal(detail.body.invoice.lines.length, 1);
});

test("void received invoice reverses stock, and reversal is blocked if stock is insufficient", async () => {
  await saveSupplierSettings(state.store._id, { autoAdjustStock: true }, state.superadmin._id);
  const supplier = await makeSupplier({ name: "Reverse Supplier" });
  const product = await makeProduct({ stock: 10 });

  const created = await createOrder(supplier._id, product, 2, 10000);
  await post(`/api/suppliers/orders/${created.body.orderId}/receive`, {});
  assert.equal((await Product.findById(product._id).lean()).stock, 12);

  const voided = await post(`/api/suppliers/invoices/${created.body.invoiceId}/void`, {
    reason: "Wrong invoice",
  });
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  assert.equal(voided.body.stockReversed, true);
  assert.equal((await Product.findById(product._id).lean()).stock, 10);
  const voidedOrder = await SupplierOrder.findById(created.body.orderId).lean();
  assert.equal(voidedOrder.stockApplied, false);
  assert.equal(voidedOrder.stockMode, "reversed");

  const second = await createOrder(supplier._id, product, 4, 10000);
  await post(`/api/suppliers/orders/${second.body.orderId}/receive`, {});
  assert.equal((await Product.findById(product._id).lean()).stock, 14);

  await resetStock(product, 1);
  const blocked = await post(`/api/suppliers/invoices/${second.body.invoiceId}/void`, {
    reason: "Try reverse",
  });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.message, /Stock reverse kora jabe na/);
  const stillActive = await SupplierInvoice.findById(second.body.invoiceId).lean();
  assert.equal(stillActive.state, "active");
  const stillApplied = await SupplierOrder.findById(second.body.orderId).lean();
  assert.equal(stillApplied.stockApplied, true);
  assert.equal((await Product.findById(product._id).lean()).stock, 1);

  await resetStock(product, 14);
  const retry = await post(`/api/suppliers/invoices/${second.body.invoiceId}/void`, {
    reason: "Try reverse again",
  });
  assert.equal(retry.status, 200);
  assert.equal((await Product.findById(product._id).lean()).stock, 10);
});

/* ------------------------------- payments -------------------------------- */

test("overpayment rejected; partial payment moves due to paid and void moves it back", async () => {
  await saveSupplierSettings(state.store._id, { autoAdjustStock: false }, state.superadmin._id);
  const supplier = await makeSupplier({ name: "Payment Supplier" });
  const product = await makeProduct();
  const created = await createOrder(supplier._id, product, 2, 50000);
  const invoiceId = created.body.invoiceId;

  const tooMuch = await post(`/api/suppliers/invoices/${invoiceId}/payments`, {
    amountPaisa: 150000,
    method: "cash",
  });
  assert.equal(tooMuch.status, 409);

  const partial = await post(`/api/suppliers/invoices/${invoiceId}/payments`, {
    amountPaisa: 40000,
    method: "bkash",
    reference: "TRX-1",
  });
  assert.equal(partial.status, 201, JSON.stringify(partial.body));
  assert.equal(partial.body.invoice.paymentStatus, "due");
  assert.equal(partial.body.invoice.dueAmountPaisa, 60000);

  const dueFilter = await get("/api/suppliers?filter=due&limit=50");
  assert.equal(dueFilter.body.suppliers.some((s) => s.id === supplier._id), true);

  const final = await post(`/api/suppliers/invoices/${invoiceId}/payments`, {
    amountPaisa: 60000,
    method: "bank",
  });
  assert.equal(final.status, 201, JSON.stringify(final.body));
  assert.equal(final.body.invoice.paymentStatus, "paid");
  assert.equal(final.body.invoice.dueAmountPaisa, 0);

  const paidFilter = await get("/api/suppliers?filter=paid&limit=50");
  assert.equal(paidFilter.body.suppliers.some((s) => s.id === supplier._id), true);

  const overAgain = await post(`/api/suppliers/invoices/${invoiceId}/payments`, {
    amountPaisa: 1,
    method: "cash",
  });
  assert.equal(overAgain.status, 409);

  const detail = await get(`/api/suppliers/invoices/${invoiceId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.payments.length, 2);
  assert.equal(detail.body.payments[1].reference, "");

  const voided = await patch(`/api/suppliers/payments/${final.body.paymentId}/void`, {
    reason: "Bank bounce",
  });
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  assert.equal(voided.body.invoice.paymentStatus, "due");
  assert.equal(voided.body.invoice.paidAmountPaisa, 40000);

  const voidAgain = await patch(`/api/suppliers/payments/${final.body.paymentId}/void`, {
    reason: "Bank bounce",
  });
  assert.equal(voidAgain.status, 200);
  assert.equal(voidAgain.body.alreadyVoid, true);
  assert.equal((await SupplierInvoice.findById(invoiceId).lean()).paidAmountPaisa, 40000);

  const auditCount = await SupplierAuditLog.countDocuments({
    store: state.store._id,
    action: "supplier.payment.record",
  });
  assert.ok(auditCount >= 2);
});

test("two parallel payments cannot exceed the invoice due", async () => {
  const supplier = await makeSupplier({ name: "Parallel Supplier" });
  const product = await makeProduct();
  const created = await createOrder(supplier._id, product, 1, 100000);
  const invoiceId = created.body.invoiceId;

  const [a, b] = await Promise.all([
    post(`/api/suppliers/invoices/${invoiceId}/payments`, { amountPaisa: 60000, method: "cash" }),
    post(`/api/suppliers/invoices/${invoiceId}/payments`, { amountPaisa: 60000, method: "cash" }),
  ]);
  assert.deepEqual([a.status, b.status].sort((x, y) => x - y), [201, 409]);

  const invoice = await SupplierInvoice.findById(invoiceId).lean();
  assert.equal(invoice.paidAmountPaisa, 60000);
  const activePayments = await SupplierPayment.countDocuments({
    store: state.store._id,
    invoice: invoiceId,
    state: "active",
  });
  assert.equal(activePayments, 1);
});

test("hold flag drives hold status until cleared", async () => {
  const supplier = await makeSupplier({ name: "Hold Supplier" });
  const product = await makeProduct();
  const created = await createOrder(supplier._id, product, 1, 80000);
  const invoiceId = created.body.invoiceId;

  const held = await patch(`/api/suppliers/invoices/${invoiceId}/hold`, {
    holdFlag: true,
    reason: "Waiting for verification",
  });
  assert.equal(held.status, 200, JSON.stringify(held.body));
  assert.equal(held.body.invoice.paymentStatus, "hold");
  assert.equal(held.body.invoice.holdFlag, true);

  const holdFilter = await get("/api/suppliers?filter=hold&limit=50");
  assert.equal(holdFilter.body.suppliers.some((s) => s.id === supplier._id), true);

  const detail = await get(`/api/suppliers/${supplier._id}`);
  assert.equal(detail.body.stats.paymentStatus, "hold");

  const cleared = await patch(`/api/suppliers/invoices/${invoiceId}/hold`, { holdFlag: false });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.invoice.paymentStatus, "due");
  assert.equal(cleared.body.invoice.holdFlag, false);

  const holdWithoutReason = await patch(`/api/suppliers/invoices/${invoiceId}/hold`, { holdFlag: true });
  assert.equal(holdWithoutReason.status, 400);
});

/* ------------------------- stock adjustments ----------------------------- */

test("manual stock adjustment writes ledger, links product, and guards negative stock", async () => {
  const supplier = await makeSupplier({ name: "Stock Supplier" });
  const product = await makeProduct({ stock: 10 });

  const added = await post(`/api/suppliers/${supplier._id}/stock-adjustments`, {
    productId: String(product._id),
    change: 5,
    reason: "Physical count",
  });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.stockAfter, 15);
  assert.equal((await Product.findById(product._id).lean()).stock, 15);
  assert.equal(String((await Product.findById(product._id).lean()).supplierId), supplier._id);

  const negative = await post(`/api/suppliers/${supplier._id}/stock-adjustments`, {
    productId: String(product._id),
    change: -100,
    reason: "Damage",
  });
  assert.equal(negative.status, 409);
  assert.equal((await Product.findById(product._id).lean()).stock, 15);

  const log = await get(`/api/suppliers/${supplier._id}/stock-log`);
  assert.equal(log.status, 200);
  assert.equal(log.body.total, 1);
  assert.equal(log.body.movements[0].mode, "manual");
  assert.equal(log.body.movements[0].change, 5);
  assert.equal(log.body.movements[0].reason, "Physical count");
});

/* --------------------------------- reports -------------------------------- */

test("daily/monthly/yearly reports match raw active invoices and exclude voided ones", async () => {
  await saveSupplierSettings(state.store._id, { autoAdjustStock: false }, state.superadmin._id);
  const supplier = await makeSupplier({ name: "Report Supplier" });
  const product = await makeProduct();

  const paidOrder = await createOrder(supplier._id, product, 1, 70000);
  await post(`/api/suppliers/invoices/${paidOrder.body.invoiceId}/payments`, {
    amountPaisa: 70000,
    method: "cash",
  });
  const dueOrder = await createOrder(supplier._id, product, 1, 30000);
  const voidOrder = await createOrder(supplier._id, product, 1, 50000);
  const voidRes = await post(`/api/suppliers/invoices/${voidOrder.body.invoiceId}/void`, {
    reason: "Report exclusion",
  });
  assert.equal(voidRes.status, 200);

  for (const period of ["daily", "monthly", "yearly"]) {
    const report = await get(`/api/suppliers/reports?period=${period}&buckets=30&limit=50`);
    assert.equal(report.status, 200, JSON.stringify(report.body));
    assert.equal(report.body.period, period);
    assert.equal(report.body.timezone, "Asia/Dhaka");

    const raw = await rawInvoiceTotals(report.body.from, report.body.to);
    assert.equal(report.body.summary.totalAmountPaisa, raw.total, period);
    assert.equal(report.body.summary.paidAmountPaisa, raw.paid, period);
    assert.equal(report.body.summary.invoiceCount, raw.count, period);

    const bucketTotal = report.body.buckets.reduce((sum, b) => sum + b.totalAmountPaisa, 0);
    const bucketCount = report.body.buckets.reduce((sum, b) => sum + b.invoiceCount, 0);
    assert.equal(bucketTotal, report.body.summary.totalAmountPaisa, period);
    assert.equal(bucketCount, report.body.summary.invoiceCount, period);

    assert.equal(
      report.body.invoices.some((i) => i.id === voidOrder.body.invoiceId),
      false,
      `${period} must exclude voided invoices`
    );
    assert.equal(
      report.body.invoices.some((i) => i.id === dueOrder.body.invoiceId),
      true,
      `${period} must include active invoices`
    );
  }

  const csv = await get("/api/suppliers/reports/export?period=daily&buckets=30");
  assert.equal(csv.status, 200);
  assert.match(csv.headers["content-type"], /text\/csv/);
  assert.ok(csv.text.includes(paidOrder.body.invoiceNo));

  const print = await get(`/api/suppliers/invoices/${paidOrder.body.invoiceId}/print`);
  assert.equal(print.status, 200);
  assert.match(print.headers["content-type"], /text\/html/);
  assert.ok(print.text.includes(paidOrder.body.invoiceNo));
  assert.ok(print.text.includes("Report Supplier"));

  const badPeriod = await get("/api/suppliers/reports?period=hourly");
  assert.equal(badPeriod.status, 400);
});

/* -------------------------- trash / restore / purge ------------------------ */

test("due invoice blocks trash; trash filters correctly; purge is superadmin-only", async () => {
  const supplier = await makeSupplier({ name: "Trash Supplier" });
  const product = await makeProduct();
  const created = await createOrder(supplier._id, product, 1, 90000);

  const openOrderTrash = await post(`/api/suppliers/${supplier._id}/trash`, { reason: "Cleanup" });
  assert.equal(openOrderTrash.status, 409);
  assert.match(openOrderTrash.body.message, /open purchase order/);

  const received = await post(`/api/suppliers/orders/${created.body.orderId}/receive`, {});
  assert.equal(received.status, 200);

  const blockedTrash = await post(`/api/suppliers/${supplier._id}/trash`, { reason: "Cleanup" });
  assert.equal(blockedTrash.status, 409);
  assert.match(blockedTrash.body.message, /due ache/);

  await post(`/api/suppliers/invoices/${created.body.invoiceId}/void`, { reason: "No longer needed" });

  const trashed = await post(`/api/suppliers/${supplier._id}/trash`, { reason: "Cleanup" });
  assert.equal(trashed.status, 200, JSON.stringify(trashed.body));
  assert.equal(trashed.body.alreadyTrashed, false);

  const activeList = await get("/api/suppliers?limit=50");
  assert.equal(activeList.body.suppliers.some((s) => s.id === supplier._id), false);
  const trashList = await get("/api/suppliers?filter=trash&limit=50");
  assert.equal(trashList.body.suppliers.some((s) => s.id === supplier._id), true);

  const adminPurge = await del(`/api/suppliers/${supplier._id}/purge`);
  assert.equal(adminPurge.status, 403);

  const purged = await del(`/api/suppliers/${supplier._id}/purge`, state.superToken);
  assert.equal(purged.status, 200, JSON.stringify(purged.body));
  assert.ok(purged.body.deleted.orders >= 1);
  assert.ok(purged.body.deleted.invoices >= 1);
  assert.equal(await Supplier.countDocuments({ _id: supplier._id }), 0);
  assert.equal(await SupplierOrder.countDocuments({ store: state.store._id, supplier: supplier._id }), 0);
  assert.equal(await SupplierInvoice.countDocuments({ store: state.store._id, supplier: supplier._id }), 0);

  const productAfter = await Product.findById(product._id).lean();
  assert.equal(productAfter.supplierId, null);

  const gone = await get(`/api/suppliers/${supplier._id}`);
  assert.equal(gone.status, 404);
});

test("restore brings a trashed supplier back to active", async () => {
  const supplier = await makeSupplier({ name: "Restore Supplier" });
  const trashed = await post(`/api/suppliers/${supplier._id}/trash`, {});
  assert.equal(trashed.status, 200);
  const restored = await post(`/api/suppliers/${supplier._id}/restore`, {});
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.supplier.state, "active");
  const detail = await get(`/api/suppliers/${supplier._id}`);
  assert.equal(detail.status, 200);
});

/* ------------------------------- permissions ------------------------------ */

test("permissions: customer denied, admin cannot change settings, superadmin can", async () => {
  const asCustomer = await get("/api/suppliers", state.customerToken);
  assert.equal(asCustomer.status, 403);

  const adminSettings = await get("/api/suppliers/settings");
  assert.equal(adminSettings.status, 200);
  assert.equal(adminSettings.body.canManageSettings, false);
  assert.equal(adminSettings.body.canPurge, false);

  const adminPatch = await patch("/api/suppliers/settings", { autoAdjustStock: true });
  assert.equal(adminPatch.status, 403);

  const superSettings = await get("/api/suppliers/settings", state.superToken);
  assert.equal(superSettings.body.canManageSettings, true);
  assert.equal(superSettings.body.canPurge, true);

  const superPatch = await patch(
    "/api/suppliers/settings",
    { autoAdjustStock: true, maxOrderQty: 25 },
    state.superToken
  );
  assert.equal(superPatch.status, 200, JSON.stringify(superPatch.body));
  assert.equal(superPatch.body.settings.autoAdjustStock, true);
  assert.equal(superPatch.body.settings.maxOrderQty, 25);

  const invalid = await patch("/api/suppliers/settings", { maxOrderQty: 0 }, state.superToken);
  assert.equal(invalid.status, 400);

  await saveSupplierSettings(state.store._id, { autoAdjustStock: false, maxOrderQty: 10000 }, state.superadmin._id);
});
