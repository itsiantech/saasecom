process.env.JWT_SECRET = "inventory-test-secret";

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
const ProductVariation = require("../models/ProductVariation");
const ProductSwatch = require("../models/ProductSwatch");
const Order = require("../models/Order");
const Supplier = require("../models/Supplier");
const SupplierOrder = require("../models/SupplierOrder");
const StockMovement = require("../models/StockMovement");
const Warehouse = require("../models/Warehouse");
const WarehouseStock = require("../models/WarehouseStock");
const InventoryMovement = require("../models/InventoryMovement");

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

function stockOf(doc) {
  return Number(doc.stock) || 0;
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("inventory"));
  await Promise.all([
    Plan.init(),
    Store.init(),
    User.init(),
    Category.init(),
    Product.init(),
    ProductVariation.init(),
    ProductSwatch.init(),
    Order.init(),
    Supplier.init(),
    SupplierOrder.init(),
    StockMovement.init(),
    Warehouse.init(),
    WarehouseStock.init(),
    InventoryMovement.init(),
  ]);

  const plan = await Plan.create({ name: "Free", slug: "free", price: 0, limits: { products: 0, orders: 0 } });
  const ownerA = await User.create({ name: "Owner A", email: "owner-a@example.com", role: "customer" });
  const ownerB = await User.create({ name: "Owner B", email: "owner-b@example.com", role: "customer" });
  state.storeA = await Store.create({ name: "Inventory A", slug: "inv-a", owner: ownerA._id, plan: plan._id });
  state.storeB = await Store.create({ name: "Inventory B", slug: "inv-b", owner: ownerB._id, plan: plan._id });
  state.ownerA = ownerA;
  state.ownerB = ownerB;
  state.tokenA = tokenFor(ownerA);
  state.tokenB = tokenFor(ownerB);

  const storeA = state.storeA._id;
  const category = await Category.create({ store: storeA, name: "Shoes", slug: "shoes" });
  state.category = category;

  state.p1 = await Product.create({
    store: storeA,
    title: "Sneaker",
    sku: "SNK-1",
    stock: 10,
    regularPrice: 100,
    status: "published",
    categories: [category._id],
  });
  state.p2 = await Product.create({ store: storeA, title: "Sock", sku: "SOCK-1", stock: 0, price: 5 });
  state.pAdj = await Product.create({ store: storeA, title: "Adjustable", sku: "ADJ-1", stock: 50, price: 10 });
  state.pDam = await Product.create({ store: storeA, title: "Damageable", sku: "DMG-1", stock: 20, price: 20 });
  state.pTr = await Product.create({ store: storeA, title: "Transferable", sku: "TRF-1", stock: 10, price: 30 });
  state.pImp = await Product.create({ store: storeA, title: "Importable", sku: "IMP-1", stock: 5, price: 40 });
  state.pB = await Product.create({ store: state.storeB._id, title: "Other Store", sku: "OTH-1", stock: 999, price: 1 });

  state.varM = await ProductVariation.create({
    store: storeA,
    product: state.p1._id,
    attributeName: "Size",
    termName: "M",
    stock: 3,
  });
  state.varL = await ProductVariation.create({
    store: storeA,
    product: state.p1._id,
    attributeName: "Size",
    termName: "L",
    stock: 0,
  });
  state.varSmall = await ProductVariation.create({
    store: storeA,
    product: state.pImp._id,
    attributeName: "Size",
    termName: "Small",
    stock: 0,
  });
  state.swatchRed = await ProductSwatch.create({
    store: storeA,
    product: state.p1._id,
    name: "Red",
    price: 120,
    stock: 2,
  });

  state.supplier = await Supplier.create({ store: storeA, name: "Supplier One", phone: "01700000001" });
  const supplierOrder = await SupplierOrder.create({
    store: storeA,
    supplier: state.supplier._id,
    orderNo: "PO-1",
    orderDate: new Date(),
    items: [
      {
        product: state.p1._id,
        productCode: "SNK-1",
        name: "Sneaker",
        quantity: 5,
        unitCostPaisa: 5000,
        lineTotalPaisa: 25000,
      },
    ],
    totalQty: 5,
    totalAmountPaisa: 25000,
    status: "received",
    stockApplied: true,
  });
  state.supplierOrder = supplierOrder;
  await StockMovement.create({
    store: storeA,
    supplier: state.supplier._id,
    order: supplierOrder._id,
    product: state.p1._id,
    change: 5,
    stockAfter: 10,
    mode: "auto",
    reason: "Received PO-1",
  });

  await Order.create({
    store: storeA,
    orderNumber: "ORD-1",
    customerName: "Buyer",
    items: [{ product: state.p1._id, quantity: 2, unitPrice: 100, price: 100 }],
    totalAmount: 200,
    status: "processing",
    stockDeducted: true,
  });
  await Order.create({
    store: storeA,
    orderNumber: "ORD-CANCELLED",
    customerName: "Buyer",
    items: [{ product: state.p1._id, quantity: 1, unitPrice: 100, price: 100 }],
    totalAmount: 100,
    status: "cancelled",
    stockDeducted: true,
    stockRestored: true,
  });

  state.app = express();
  state.app.use(express.text({ type: ["text/csv", "text/plain"], limit: "2mb" }));
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
  state.app.use("/api/admin/inventory", require("../routes/inventory"));
  state.app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("overview adds base, variant and swatch stock per store", async () => {
  const access = await as("inv-a", "get", "/api/admin/inventory/access");
  assert.equal(access.status, 200, JSON.stringify(access.body));
  assert.equal(access.body.canView, true);

  const res = await as("inv-a", "get", "/api/admin/inventory/overview");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.totals.products, 6);
  assert.equal(res.body.totals.published, 1);
  assert.equal(res.body.totals.base, 95);
  assert.equal(res.body.totals.variantUnits, 3);
  assert.equal(res.body.totals.swatchUnits, 2);
  assert.equal(res.body.totals.units, 100);
  assert.equal(res.body.totals.value, 2940);
  assert.equal(res.body.totals.outOfStock, 1);
  assert.equal(res.body.totals.lowStock, 1, "Importable has exactly 5 units");

  const alerts = res.body.alerts.map((row) => row.sku);
  assert.deepEqual(alerts, ["SOCK-1", "IMP-1"]);

  const other = await as("inv-b", "get", "/api/admin/inventory/overview", undefined, state.tokenB);
  assert.equal(other.status, 200, JSON.stringify(other.body));
  assert.equal(other.body.totals.products, 1);
  assert.equal(other.body.totals.units, 999);
  assert.equal(other.body.totals.value, 999);
});

test("category and variant reports attribute stock the same way the storefront does", async () => {
  const categories = await as("inv-a", "get", "/api/admin/inventory/categories");
  assert.equal(categories.status, 200, JSON.stringify(categories.body));
  const shoes = categories.body.rows.find((row) => row.category === "Shoes");
  assert.equal(shoes.products, 1);
  assert.equal(shoes.units, 15);
  assert.equal(shoes.value, 1540);
  const uncategorized = categories.body.rows.find((row) => row.category === "Uncategorized");
  assert.equal(uncategorized.products, 5);
  assert.equal(categories.body.totals.units, 100);

  const variants = await as("inv-a", "get", "/api/admin/inventory/variants");
  assert.equal(variants.status, 200, JSON.stringify(variants.body));
  const medium = variants.body.rows.find((row) => row.attribute === "Size" && row.term === "M");
  assert.equal(medium.units, 3);
  assert.equal(medium.value, 300);
  const small = variants.body.rows.find((row) => row.attribute === "Size" && row.term === "Small");
  assert.equal(small.units, 0);
  const red = variants.body.rows.find((row) => row.attribute === "Swatch" && row.term === "Red");
  assert.equal(red.units, 2);
  assert.equal(red.value, 240);
  assert.equal(variants.body.totals.units, 5);
});

test("adjustments validate input, write one ledger row and stay inside the store", async () => {
  const res = await as("inv-a", "post", "/api/admin/inventory/adjust", {
    productId: String(state.pAdj._id),
    mode: "set",
    quantity: 12,
    reason: "Cycle count",
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.changed, true);
  assert.equal(res.body.before, 50);
  assert.equal(res.body.after, 12);
  assert.match(res.body.reference, /^ADJ-/);

  let product = await Product.findById(state.pAdj._id).lean();
  assert.equal(stockOf(product), 12);

  const rows = await InventoryMovement.find({ store: state.storeA._id, type: "adjustment" }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].change, -38);
  assert.equal(rows[0].before, 50);
  assert.equal(rows[0].after, 12);

  const decrease = await as("inv-a", "post", "/api/admin/inventory/adjust", {
    productId: String(state.pAdj._id),
    mode: "decrease",
    quantity: 100,
  });
  assert.equal(decrease.status, 400);
  product = await Product.findById(state.pAdj._id).lean();
  assert.equal(stockOf(product), 12, "a rejected decrease leaves stock untouched");

  const variant = await as("inv-a", "post", "/api/admin/inventory/adjust", {
    productId: String(state.p1._id),
    variationId: String(state.varM._id),
    mode: "increase",
    quantity: 2,
    reason: "Restock",
  });
  assert.equal(variant.status, 200, JSON.stringify(variant.body));
  const variation = await ProductVariation.findById(state.varM._id).lean();
  assert.equal(stockOf(variation), 5);
  const variantRow = await InventoryMovement.findOne({
    store: state.storeA._id,
    variation: state.varM._id,
    type: "adjustment",
  }).lean();
  assert.equal(variantRow.variantLabel, "Size: M");

  const foreign = await as("inv-a", "post", "/api/admin/inventory/adjust", {
    productId: String(state.pB._id),
    mode: "set",
    quantity: 1,
  });
  assert.equal(foreign.status, 404, "another store's product is invisible");

  const list = await as("inv-a", "get", "/api/admin/inventory/adjustments");
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.total, 2);
});

test("damage takes stock out and returns optionally restock it", async () => {
  const damage = await as("inv-a", "post", "/api/admin/inventory/damage", {
    mode: "damage",
    productId: String(state.pDam._id),
    quantity: 3,
    note: "Broken in transit",
  });
  assert.equal(damage.status, 200, JSON.stringify(damage.body));
  assert.equal(damage.body.change, -3);
  assert.equal(damage.body.before, 20);
  assert.equal(damage.body.after, 17);

  const tooMuch = await as("inv-a", "post", "/api/admin/inventory/damage", {
    mode: "damage",
    productId: String(state.pDam._id),
    quantity: 100,
  });
  assert.equal(tooMuch.status, 400);
  assert.match(tooMuch.body.message, /piece/);

  const restocked = await as("inv-a", "post", "/api/admin/inventory/damage", {
    mode: "return",
    productId: String(state.pDam._id),
    quantity: 2,
    restock: true,
    reference: "ORD-1",
  });
  assert.equal(restocked.status, 200, JSON.stringify(restocked.body));
  assert.equal(restocked.body.change, 2);
  assert.equal(restocked.body.after, 19);

  const notRestocked = await as("inv-a", "post", "/api/admin/inventory/damage", {
    mode: "return",
    productId: String(state.pDam._id),
    quantity: 1,
    restock: false,
  });
  assert.equal(notRestocked.status, 200, JSON.stringify(notRestocked.body));
  assert.equal(notRestocked.body.change, 0);
  assert.equal(notRestocked.body.after, 19);

  const product = await Product.findById(state.pDam._id).lean();
  assert.equal(stockOf(product), 19);

  const list = await as("inv-a", "get", "/api/admin/inventory/damage");
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.total, 3);
  assert.deepEqual(list.body.summary, { damaged: 3, returned: 3, restocked: 2 });
});

test("warehouse transfers move allocations but never change product stock", async () => {
  const before = await as("inv-a", "get", "/api/admin/inventory/overview");
  const totalUnits = before.body.totals.units;

  const created = await as("inv-a", "post", "/api/admin/inventory/warehouses", {
    name: "Dhaka Hub",
    address: "Mirpur",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const hubId = created.body.id;

  let list = await as("inv-a", "get", "/api/admin/inventory/warehouses");
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const main = list.body.rows.find((row) => row.isDefault);
  assert.equal(main.name, "Main Warehouse");
  assert.equal(main.units, totalUnits);
  const hub = list.body.rows.find((row) => row.id === hubId);
  assert.equal(hub.units, 0);

  const move = await as("inv-a", "post", "/api/admin/inventory/transfers", {
    fromWarehouseId: main.id,
    toWarehouseId: hubId,
    productId: String(state.pTr._id),
    quantity: 4,
    note: "Send to hub",
  });
  assert.equal(move.status, 200, JSON.stringify(move.body));
  assert.match(move.body.reference, /^TRF-/);
  assert.equal(move.body.from.after, 6, "the item keeps 6 of its 10 units in the main warehouse");

  let product = await Product.findById(state.pTr._id).lean();
  assert.equal(stockOf(product), 10, "transfer leaves product stock alone");

  list = await as("inv-a", "get", "/api/admin/inventory/warehouses");
  assert.equal(list.body.rows.find((row) => row.isDefault).units, totalUnits - 4);
  assert.equal(list.body.rows.find((row) => row.id === hubId).units, 4);

  const tooFar = await as("inv-a", "post", "/api/admin/inventory/transfers", {
    fromWarehouseId: hubId,
    toWarehouseId: main.id,
    productId: String(state.pTr._id),
    quantity: 5,
  });
  assert.equal(tooFar.status, 400, "source warehouse only holds 4");

  const belowAllocated = await as("inv-a", "post", "/api/admin/inventory/adjust", {
    productId: String(state.pTr._id),
    mode: "set",
    quantity: 3,
    reason: "Cycle count",
  });
  assert.equal(belowAllocated.status, 400);
  assert.match(belowAllocated.body.message, /allocate/);

  const back = await as("inv-a", "post", "/api/admin/inventory/transfers", {
    fromWarehouseId: hubId,
    toWarehouseId: main.id,
    productId: String(state.pTr._id),
    quantity: 4,
  });
  assert.equal(back.status, 200, JSON.stringify(back.body));

  const variationMove = await as("inv-a", "post", "/api/admin/inventory/transfers", {
    fromWarehouseId: main.id,
    toWarehouseId: hubId,
    productId: String(state.p1._id),
    variationId: String(state.varM._id),
    quantity: 1,
  });
  assert.equal(variationMove.status, 200, JSON.stringify(variationMove.body));
  const variation = await ProductVariation.findById(state.varM._id).lean();
  assert.equal(stockOf(variation), 5, "variant stock unchanged by transfer");

  const two = await as("inv-a", "post", "/api/admin/inventory/transfers", {
    fromWarehouseId: main.id,
    toWarehouseId: hubId,
    productId: String(state.pTr._id),
    quantity: 2,
  });
  assert.equal(two.status, 200, JSON.stringify(two.body));

  const blockedDelete = await as("inv-a", "delete", `/api/admin/inventory/warehouses/${hubId}`);
  assert.equal(blockedDelete.status, 409, "a warehouse holding stock cannot be deleted");

  await as("inv-a", "post", "/api/admin/inventory/transfers", {
    fromWarehouseId: hubId,
    toWarehouseId: main.id,
    productId: String(state.p1._id),
    variationId: String(state.varM._id),
    quantity: 1,
  });
  await as("inv-a", "post", "/api/admin/inventory/transfers", {
    fromWarehouseId: hubId,
    toWarehouseId: main.id,
    productId: String(state.pTr._id),
    quantity: 2,
  });
  const removed = await as("inv-a", "delete", `/api/admin/inventory/warehouses/${hubId}`);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));

  const defaultDelete = await as("inv-a", "delete", `/api/admin/inventory/warehouses/${main.id}`);
  assert.equal(defaultDelete.status, 400);

  const transfers = await as("inv-a", "get", "/api/admin/inventory/transfers");
  assert.equal(transfers.status, 200, JSON.stringify(transfers.body));
  assert.ok(transfers.body.total >= 6);
});

test("CSV import previews, then applies absolute stock by SKU", async () => {
  const csv = [
    "sku,variant,stock,note",
    "ADJ-1,,60,counted",
    "IMP-1,Small,4,counted",
    "NOPE-1,,1,unknown",
  ].join("\n");

  const preview = await request(state.app)
    .post("/api/admin/inventory/import?dryRun=1")
    .set("x-store-slug", "inv-a")
    .set("Authorization", `Bearer ${state.tokenA}`)
    .set("Content-Type", "text/csv")
    .send(csv);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.dryRun, true);
  assert.equal(preview.body.changed, 2);
  assert.equal(preview.body.errors.length, 1);
  assert.match(preview.body.errors[0].message, /SKU/);

  let product = await Product.findById(state.pAdj._id).lean();
  assert.equal(stockOf(product), 12, "preview does not write");

  const apply = await request(state.app)
    .post("/api/admin/inventory/import?dryRun=0")
    .set("x-store-slug", "inv-a")
    .set("Authorization", `Bearer ${state.tokenA}`)
    .set("Content-Type", "text/csv")
    .send(csv);
  assert.equal(apply.status, 200, JSON.stringify(apply.body));
  assert.equal(apply.body.applied, 2);
  assert.equal(apply.body.skipped, 0);

  product = await Product.findById(state.pAdj._id).lean();
  assert.equal(stockOf(product), 60);
  const variation = await ProductVariation.findById(state.varSmall._id).lean();
  assert.equal(stockOf(variation), 4);

  const again = await request(state.app)
    .post("/api/admin/inventory/import?dryRun=0")
    .set("x-store-slug", "inv-a")
    .set("Authorization", `Bearer ${state.tokenA}`)
    .set("Content-Type", "text/csv")
    .send(csv);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.applied, 0);
  assert.equal(again.body.skipped, 2, "an already-correct row is a no-op");

  const badHeader = await request(state.app)
    .post("/api/admin/inventory/import")
    .set("x-store-slug", "inv-a")
    .set("Authorization", `Bearer ${state.tokenA}`)
    .set("Content-Type", "text/csv")
    .send("name,qty\nA,1");
  assert.equal(badHeader.status, 400);
  assert.match(badHeader.body.message, /sku/);
});

test("movements merge sales, purchases, damage, adjustments and transfers", async () => {
  const all = await as("inv-a", "get", "/api/admin/inventory/movements?days=30&limit=200");
  assert.equal(all.status, 200, JSON.stringify(all.body));
  const types = new Set(all.body.rows.map((row) => row.type));
  for (const type of ["sale", "purchase", "damage", "return", "adjustment", "transfer"]) {
    assert.ok(types.has(type), `missing ${type} movement`);
  }
  assert.ok(!all.body.rows.some((row) => row.reference === "ORD-CANCELLED"), "cancelled order is not a sale");

  const sale = all.body.rows.find((row) => row.type === "sale");
  assert.equal(sale.reference, "ORD-1");
  assert.equal(sale.change, -2);
  assert.equal(sale.sku, "SNK-1");

  const purchase = all.body.rows.find((row) => row.type === "purchase");
  assert.equal(purchase.reference, "PO-1");
  assert.equal(purchase.change, 5);
  assert.equal(purchase.before, 5);
  assert.equal(purchase.after, 10);

  const salesOnly = await as("inv-a", "get", "/api/admin/inventory/movements?type=sale&days=30");
  assert.equal(salesOnly.status, 200);
  assert.ok(salesOnly.body.rows.every((row) => row.type === "sale"));

  const transfers = await as("inv-a", "get", "/api/admin/inventory/movements?type=transfer&days=30");
  assert.equal(transfers.status, 200);
  assert.ok(transfers.body.rows.length >= 4);
  assert.ok(transfers.body.rows.every((row) => row.type === "transfer"));

  const search = await as("inv-a", "get", "/api/admin/inventory/movements?days=30&q=snk-1&limit=200");
  assert.equal(search.status, 200);
  assert.ok(search.body.rows.length >= 2);
  assert.ok(search.body.rows.every((row) => row.sku === "SNK-1"));
});

test("supplier, damage and export views produce report rows", async () => {
  const suppliers = await as("inv-a", "get", "/api/admin/inventory/suppliers?status=received");
  assert.equal(suppliers.status, 200, JSON.stringify(suppliers.body));
  assert.equal(suppliers.body.totals.orders, 1);
  assert.equal(suppliers.body.totals.units, 5);
  assert.equal(suppliers.body.rows[0].supplier, "Supplier One");
  assert.equal(suppliers.body.rows[0].lineTotal, 250);

  const overviewCsv = await as("inv-a", "get", "/api/admin/inventory/export?view=overview");
  assert.equal(overviewCsv.status, 200);
  assert.match(overviewCsv.headers["content-type"], /text\/csv/);
  assert.match(overviewCsv.headers["content-disposition"], /inventory-overview-/);
  assert.ok(overviewCsv.text.startsWith("\uFEFF"));
  assert.match(overviewCsv.text, /Product,SKU,Status/);

  const adjustCsv = await as("inv-a", "get", "/api/admin/inventory/export?view=adjustment");
  assert.equal(adjustCsv.status, 200);
  assert.match(adjustCsv.text, /Date,Product,SKU,Variant/);
  assert.match(adjustCsv.text, /ADJ-|IMP-/);

  const transferCsv = await as("inv-a", "get", "/api/admin/inventory/export?view=transfer");
  assert.equal(transferCsv.status, 200);
  assert.match(transferCsv.text, /TRF-/);

  const unknown = await as("inv-a", "get", "/api/admin/inventory/export?view=nope");
  assert.equal(unknown.status, 400);
});

test("a stranger store and an anonymous caller are refused", async () => {
  const probe = await as("inv-a", "get", "/api/admin/inventory/access", undefined, state.tokenB);
  assert.equal(probe.status, 200, "probe stays fail-closed instead of 403");
  assert.equal(probe.body.canView, false);

  const foreign = await as("inv-a", "get", "/api/admin/inventory/overview", undefined, state.tokenB);
  assert.equal(foreign.status, 403);

  const foreignWrite = await as(
    "inv-a",
    "post",
    "/api/admin/inventory/adjust",
    { productId: String(state.pTr._id), mode: "set", quantity: 1 },
    state.tokenB
  );
  assert.equal(foreignWrite.status, 403);

  const anonymous = await request(state.app)
    .get("/api/admin/inventory/overview")
    .set("x-store-slug", "inv-a");
  assert.equal(anonymous.status, 401);
});
