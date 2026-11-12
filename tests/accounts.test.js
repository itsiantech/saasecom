process.env.JWT_SECRET = "accounts-test-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { tenantStorage } = require("../lib/tenantContext");
const { crc32 } = require("../lib/xlsx");
const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const OrderStatusHistory = require("../models/OrderStatusHistory");
const Supplier = require("../models/Supplier");
const SupplierOrder = require("../models/SupplierOrder");
const SupplierInvoice = require("../models/SupplierInvoice");
const SupplierPayment = require("../models/SupplierPayment");
const FinanceEntry = require("../models/FinanceEntry");

const state = {};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });
}

function as(slug, method, url, body, token = state.tokenA) {
  const req = request(state.app)[method](url)
    .set("x-store-slug", slug)
    .set("Authorization", `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}

function unzip(buffer) {
  const eocd = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(eocd), 0x06054b50, "EOCD signature");
  const count = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  const files = new Map();
  let cursor = cdOffset;
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50, "central directory signature");
    const crc = buffer.readUInt32LE(cursor + 16);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.slice(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, "local header signature");
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buffer.slice(dataStart, dataStart + size);
    assert.equal(crc32(data), crc, `CRC for ${name}`);
    files.set(name, data.toString("utf8"));
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("accounts"));
  await Promise.all([
    Plan.init(),
    Store.init(),
    User.init(),
    Product.init(),
    Order.init(),
    OrderStatusHistory.init(),
    Supplier.init(),
    SupplierOrder.init(),
    SupplierInvoice.init(),
    SupplierPayment.init(),
    FinanceEntry.init(),
  ]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const ownerA = await User.create({ name: "Owner A", email: "acc-a@example.com", role: "customer" });
  const ownerB = await User.create({ name: "Owner B", email: "acc-b@example.com", role: "customer" });
  state.storeA = await Store.create({ name: "Accounts A", slug: "acc-a", owner: ownerA._id, plan: plan._id });
  state.storeB = await Store.create({ name: "Accounts B", slug: "acc-b", owner: ownerB._id, plan: plan._id });
  state.tokenA = tokenFor(ownerA);
  state.tokenB = tokenFor(ownerB);
  const store = state.storeA._id;

  const product = await Product.create({ store, title: "Item", sku: "ACC-1", stock: 10, price: 100 });
  state.product = product;
  const item = { product: product._id, quantity: 1, price: 100, unitPricePaisa: 10000 };

  state.orderPaid = await Order.create({
    store,
    orderNumber: "ACC-ORD-1",
    customerName: "Paid Buyer",
    items: [item],
    totalAmount: 1210,
    shippingAmount: 100,
    couponDiscount: 90,
    couponDiscountPaisa: 9000,
    status: "processing",
    paymentStatus: "paid",
  });
  state.orderInstallment = await Order.create({
    store,
    orderNumber: "ACC-ORD-2",
    customerName: "Installment Buyer",
    items: [item],
    totalAmount: 5000,
    status: "processing",
    paymentStatus: "partially_paid",
    paymentMode: "installment",
    paidAmount: 200000,
  });
  state.orderCancelled = await Order.create({
    store,
    orderNumber: "ACC-ORD-3",
    customerName: "Cancelled Buyer",
    items: [item],
    totalAmount: 700,
    status: "cancelled",
    paymentStatus: "refunded",
    stockDeducted: true,
    stockRestored: true,
  });
  state.orderCancelledInstallment = await Order.create({
    store,
    orderNumber: "ACC-ORD-4",
    customerName: "Refund Buyer",
    items: [item],
    totalAmount: 3000,
    status: "cancelled",
    paymentStatus: "cancelled",
    paymentMode: "installment",
    paidAmount: 200000,
    installmentPlan: { cancellation: { at: new Date(), refundPaisa: 100000 } },
  });
  await OrderStatusHistory.create({
    store,
    order: state.orderCancelled._id,
    fromStatus: "processing",
    toStatus: "cancelled",
    byName: "Admin A",
    note: "Customer cancelled",
  });

  state.supplier = await Supplier.create({
    store,
    name: "Supplier One",
    companyName: "One Trading",
    phone: "01700000001",
  });
  state.supplierOrder = await SupplierOrder.create({
    store,
    supplier: state.supplier._id,
    orderNo: "ACC-PO-1",
    orderDate: new Date(),
    items: [{ product: product._id, productCode: "ACC-1", name: "Item", quantity: 5, unitCostPaisa: 20000, lineTotalPaisa: 100000 }],
    totalQty: 5,
    totalAmountPaisa: 100000,
    status: "received",
  });
  const supplierOrder2 = await SupplierOrder.create({
    store,
    supplier: state.supplier._id,
    orderNo: "ACC-PO-2",
    orderDate: new Date(),
    items: [{ product: product._id, productCode: "ACC-1", name: "Item", quantity: 2, unitCostPaisa: 25000, lineTotalPaisa: 50000 }],
    totalQty: 2,
    totalAmountPaisa: 50000,
    status: "ordered",
  });
  state.invoice1 = await SupplierInvoice.create({
    store,
    supplier: state.supplier._id,
    order: state.supplierOrder._id,
    invoiceNo: "ACC-INV-1",
    issueDate: new Date(),
    totalAmountPaisa: 100000,
    paidAmountPaisa: 40000,
  });
  state.invoice2 = await SupplierInvoice.create({
    store,
    supplier: state.supplier._id,
    order: supplierOrder2._id,
    invoiceNo: "ACC-INV-2",
    issueDate: new Date(),
    totalAmountPaisa: 50000,
    paidAmountPaisa: 0,
    holdFlag: true,
    holdReason: "Price check",
  });
  await SupplierPayment.create({
    store,
    supplier: state.supplier._id,
    invoice: state.invoice1._id,
    order: state.supplierOrder._id,
    amountPaisa: 40000,
    method: "bank",
    paidAt: new Date(),
  });
  await SupplierPayment.create({
    store,
    supplier: state.supplier._id,
    invoice: state.invoice1._id,
    order: state.supplierOrder._id,
    amountPaisa: 5000,
    method: "cash",
    paidAt: new Date(),
    state: "void",
    voidReason: "Duplicate entry",
    voidedAt: new Date(),
  });
  const supplierOrder3 = await SupplierOrder.create({
    store,
    supplier: state.supplier._id,
    orderNo: "ACC-PO-3",
    orderDate: new Date(),
    items: [{ product: product._id, productCode: "ACC-1", name: "Item", quantity: 1, unitCostPaisa: 9000, lineTotalPaisa: 9000 }],
    totalQty: 1,
    totalAmountPaisa: 9000,
    status: "ordered",
  });
  await SupplierInvoice.create({
    store,
    supplier: state.supplier._id,
    order: supplierOrder3._id,
    invoiceNo: "ACC-INV-VOID",
    issueDate: new Date(),
    totalAmountPaisa: 9000,
    state: "void",
    voidReason: "Wrong invoice",
    voidedAt: new Date(),
  });
  const cancelledOrder = await SupplierOrder.create({
    store,
    supplier: state.supplier._id,
    orderNo: "ACC-PO-CANCELLED",
    orderDate: new Date(),
    items: [{ product: product._id, productCode: "ACC-1", name: "Item", quantity: 3, unitCostPaisa: 10000, lineTotalPaisa: 30000 }],
    totalQty: 3,
    totalAmountPaisa: 30000,
    status: "cancelled",
    cancelledAt: new Date(),
    cancelReason: "Supplier out of stock",
  });
  void cancelledOrder;

  state.office = await FinanceEntry.create({
    store,
    kind: "office",
    title: "Rent",
    amountPaisa: 500000,
    entryDate: new Date(),
    method: "bank",
  });
  await FinanceEntry.create({ store, kind: "tech", title: "Server", amountPaisa: 200000, entryDate: new Date() });
  await FinanceEntry.create({ store, kind: "marketing", title: "Ads", amountPaisa: 100000, entryDate: new Date() });
  await FinanceEntry.create({ store, kind: "salary", title: "Staff", amountPaisa: 300000, entryDate: new Date() });
  await FinanceEntry.create({ store, kind: "investment", title: "Capital", amountPaisa: 1000000, entryDate: new Date() });
  state.voidExpense = await FinanceEntry.create({
    store,
    kind: "marketing",
    title: "Old boost",
    amountPaisa: 50000,
    entryDate: new Date(),
    state: "void",
    voidReason: "Cancelled campaign",
    voidedAt: new Date(),
  });

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
  state.app.use("/api/admin/accounts", require("../routes/accounts"));
  state.app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("dashboard totals reconcile sales, refunds, purchases, expenses, profit and cash", async () => {
  const res = await as("acc-a", "get", "/api/admin/accounts/dashboard");
  assert.equal(res.status, 200);
  const body = res.body;
  assert.equal(body.sales.orders, 2);
  assert.equal(body.sales.netSalesPaisa, 621000, "1210 + 5000 BDT");
  assert.equal(body.sales.grossPaisa, 620000);
  assert.equal(body.sales.discountPaisa, 9000);
  assert.equal(body.sales.shippingPaisa, 10000);
  assert.equal(body.sales.refundsPaisa, 170000, "700 refunded + 1000 installment refund");
  assert.equal(body.sales.refundedOrders, 2);
  assert.equal(body.sales.cancelledOrders, 2);
  assert.equal(body.sales.cancelledValuePaisa, 370000);
  assert.equal(body.sales.collectedPaisa, 421000, "1210 + 2000 + 1000 retained");
  assert.equal(body.purchases.totalPaisa, 150000);
  assert.equal(body.purchases.invoices, 2);
  assert.equal(body.supplierPayments.totalPaisa, 40000);
  assert.equal(body.expenses.costPaisa, 1100000, "office + tech + marketing + salary");
  assert.equal(body.expenses.investmentPaisa, 1000000);
  assert.equal(body.profit.netPaisa, -799000);
  assert.equal(body.cash.balancePaisa, 281000);
  const marketing = body.expenses.byKind.find((row) => row.kind === "marketing");
  assert.equal(marketing.amountPaisa, 100000, "voided expense is excluded");
});

test("sales report lists orders and daily buckets with cancellation and refunds", async () => {
  const res = await as("acc-a", "get", "/api/admin/accounts/sales?preset=this_month");
  assert.equal(res.status, 200);
  assert.equal(res.body.totalRows, 4);
  assert.equal(res.body.daily.length, 1, "all fixtures share today");
  const day = res.body.daily[0];
  assert.equal(day.orders, 2);
  assert.equal(day.cancelledOrders, 2);
  assert.equal(day.refundsPaisa, 170000);
  const paid = res.body.rows.find((row) => row.orderNumber === "ACC-ORD-1");
  assert.equal(paid.grossPaisa, 120000);
  assert.equal(paid.netPaisa, 121000);
  assert.equal(paid.refundPaisa, 0);
  const cancelled = res.body.rows.find((row) => row.orderNumber === "ACC-ORD-3");
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.netPaisa, 0);
  assert.equal(cancelled.refundPaisa, 70000);
});

test("supplier ledger reports purchases, payments, outstanding and search", async () => {
  const res = await as("acc-a", "get", "/api/admin/accounts/suppliers?preset=this_month");
  assert.equal(res.status, 200);
  assert.equal(res.body.rows.length, 1);
  const row = res.body.rows[0];
  assert.equal(row.name, "Supplier One");
  assert.equal(row.company, "One Trading");
  assert.equal(row.purchasesPaisa, 150000);
  assert.equal(row.paidPaisa, 40000);
  assert.equal(row.outstandingPaisa, 110000);
  assert.equal(row.invoices, 2);
  assert.equal(row.holds, 1);
  assert.equal(res.body.totals.outstandingPaisa, 110000);
  assert.ok(res.body.recent.some((entry) => entry.type === "payment" && entry.amountPaisa === 40000));

  const filtered = await as("acc-a", "get", "/api/admin/accounts/suppliers?preset=this_month&q=One");
  assert.equal(filtered.body.rows.length, 1);
  const none = await as("acc-a", "get", "/api/admin/accounts/suppliers?preset=this_month&q=zzz");
  assert.equal(none.body.rows.length, 0);
});

test("expense entries validate, list by kind, and void with a reason", async () => {
  const office = await as("acc-a", "get", "/api/admin/accounts/entries?preset=this_month&kind=office");
  assert.equal(office.status, 200);
  assert.equal(office.body.rows.length, 1);
  assert.equal(office.body.rows[0].title, "Rent");
  assert.equal(office.body.costPaisa, 500000);

  const salary = await as("acc-a", "get", "/api/admin/accounts/entries?preset=this_month&kind=salary,investment");
  assert.equal(salary.body.investmentPaisa, 1000000);
  assert.equal(salary.body.costPaisa, 300000);

  const created = await as("acc-a", "post", "/api/admin/accounts/entries", {
    kind: "office",
    title: "Internet",
    amount: "1,250.50",
    entryDate: "2026-11-11",
    method: "bkash",
    reference: "NET-1",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.amountPaisa, 125050);

  const badAmount = await as("acc-a", "post", "/api/admin/accounts/entries", {
    kind: "office",
    title: "Zero",
    amount: "0",
  });
  assert.equal(badAmount.status, 400);

  const badKind = await as("acc-a", "post", "/api/admin/accounts/entries", {
    kind: "travel",
    title: "Bus",
    amount: "10",
  });
  assert.equal(badKind.status, 400);

  const noReason = await as("acc-a", "post", `/api/admin/accounts/entries/${created.body.id}/void`, {});
  assert.equal(noReason.status, 400);
  const voided = await as("acc-a", "post", `/api/admin/accounts/entries/${created.body.id}/void`, {
    reason: "Wrong amount",
  });
  assert.equal(voided.status, 200);
  assert.equal(voided.body.state, "void");
  const again = await as("acc-a", "post", `/api/admin/accounts/entries/${created.body.id}/void`, {
    reason: "Again",
  });
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyVoid, true);
});

test("void and cancel logs union orders, suppliers and expenses with filters", async () => {
  const all = await as("acc-a", "get", "/api/admin/accounts/voids?preset=this_month");
  assert.equal(all.status, 200);
  assert.equal(all.body.totals.order_cancel.count, 2, "history row + legacy cancelled order");
  assert.equal(all.body.totals.supplier_order_cancel.count, 1);
  assert.equal(all.body.totals.supplier_invoice_void.count, 1);
  assert.equal(all.body.totals.supplier_payment_void.count, 1);
  assert.equal(all.body.totals.expense_void.count, 2, "old boost + internet voided in the prior test");
  assert.ok(all.body.rows.some((row) => row.type === "order_cancel" && row.party === "Cancelled Buyer"));
  assert.ok(all.body.rows.some((row) => row.reason === "Wrong invoice"));

  const filtered = await as("acc-a", "get", "/api/admin/accounts/voids?preset=this_month&type=expense_void");
  assert.equal(filtered.status, 200, JSON.stringify(filtered.body));
  assert.equal(filtered.body.rows.length, 2);
  assert.ok(filtered.body.rows.some((row) => row.party === "Marketing & ads cost"));

  const bad = await as("acc-a", "get", "/api/admin/accounts/voids?preset=this_month&type=nope");
  assert.equal(bad.status, 400);
});

test("Excel export is a valid stored ZIP workbook with every sheet", async () => {
  const res = await as("acc-a", "get", "/api/admin/accounts/export.xlsx")
    .buffer(true)
    .parse((response, done) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => done(null, Buffer.concat(chunks)));
    });
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /spreadsheetml/);
  assert.match(res.headers["content-disposition"], /accounts-.*\.xlsx/);
  assert.equal(res.body.slice(0, 2).toString(), "PK", "ZIP signature");

  const files = unzip(res.body);
  assert.equal(files.size, 11, "6 sheets + workbook, rels, styles, content types");
  assert.ok(files.get("xl/worksheets/sheet1.xml").includes("Net sales"));
  assert.ok(files.get("xl/worksheets/sheet2.xml").includes("ACC-ORD-1"));
  assert.ok(files.get("xl/worksheets/sheet4.xml").includes("Supplier One"));
  assert.ok(files.get("xl/worksheets/sheet6.xml").includes("Wrong invoice"));
  assert.ok(files.get("xl/workbook.xml").includes('name="Supplier Ledger"'));

  const anonymous = await request(state.app).get("/api/admin/accounts/export.xlsx").set("x-store-slug", "acc-a");
  assert.equal(anonymous.status, 401);
});

test("another store sees none of the ledger and anonymous callers are refused", async () => {
  const dashboard = await as("acc-b", "get", "/api/admin/accounts/dashboard", undefined, state.tokenB);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.sales.netSalesPaisa, 0);
  assert.equal(dashboard.body.expenses.costPaisa, 0);
  assert.equal(dashboard.body.purchases.totalPaisa, 0);

  const entries = await as("acc-b", "get", "/api/admin/accounts/entries?preset=this_month", undefined, state.tokenB);
  assert.equal(entries.body.rows.length, 0);

  const foreign = await as("acc-b", "get", "/api/admin/accounts/dashboard", undefined, state.tokenA);
  assert.equal(foreign.status, 403, "owner A token on store B is refused");

  const foreignVoid = await as(
    "acc-b",
    "post",
    `/api/admin/accounts/entries/${state.voidExpense._id}/void`,
    { reason: "cross store" },
    state.tokenB
  );
  assert.equal(foreignVoid.status, 404, "another store's entry cannot be voided");

  const anonymous = await request(state.app).get("/api/admin/accounts/dashboard").set("x-store-slug", "acc-a");
  assert.equal(anonymous.status, 401);

  const probe = await request(state.app)
    .get("/api/admin/accounts/access")
    .set("x-store-slug", "acc-b")
    .set("Authorization", `Bearer ${state.tokenB}`);
  assert.equal(probe.status, 200);
  assert.equal(probe.body.canView, true);
});
