process.env.JWT_SECRET = "installment-quote-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Product = require("../models/Product");
const ProductVariation = require("../models/ProductVariation");
const Category = require("../models/Category");
const InstallmentSettings = require("../models/InstallmentSettings");
const InstallmentOffer = require("../models/InstallmentOffer");
const { clearInstallmentSettingsCache } = require("../lib/installmentSettings");

const state = {};

async function updateSettings(patch) {
  await InstallmentSettings.updateOne({ store: state.storeA._id }, { $set: patch });
  clearInstallmentSettingsCache(state.storeA._id);
}

function quote(body) {
  return request(state.app)
    .post("/api/public/installments/quote")
    .query({ store: "emi-a" })
    .send(body);
}

before(async () => {
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("installment-quote"));
  await Promise.all([
    Plan.init(),
    Store.init(),
    User.init(),
    Product.init(),
    ProductVariation.init(),
    Category.init(),
    InstallmentSettings.init(),
    InstallmentOffer.init(),
  ]);

  state.owner = await User.create({ name: "Owner", email: "owner@emi.test" });
  state.planOn = await Plan.create({ name: "EMI", slug: "emi-on", features: { installments: true } });
  state.planOff = await Plan.create({ name: "Basic", slug: "emi-off", features: {} });

  state.storeA = await Store.create({
    name: "EMI Shop",
    slug: "emi-a",
    owner: state.owner._id,
    plan: state.planOn._id,
  });
  state.storeB = await Store.create({
    name: "Other Shop",
    slug: "emi-b",
    owner: state.owner._id,
    plan: state.planOn._id,
  });
  state.storeOff = await Store.create({
    name: "No EMI Shop",
    slug: "emi-off",
    owner: state.owner._id,
    plan: state.planOff._id,
  });

  await InstallmentSettings.create({
    store: state.storeA._id,
    enabled: true,
    method: "flat_annual",
    annualRatePct: 12,
    minDownPaymentPercent: 10,
    cashPriceIsSalePrice: true,
  });
  await InstallmentSettings.create({
    store: state.storeB._id,
    enabled: true,
    method: "flat_annual",
    annualRatePct: 12,
    cashPriceIsSalePrice: true,
  });
  await InstallmentOffer.create([
    { store: state.storeA._id, name: "৬ মাস", months: 6, downPaymentPercent: 10, sortOrder: 1 },
    { store: state.storeA._id, name: "১২ মাস", months: 12, downPaymentPercent: 10, sortOrder: 2 },
    { store: state.storeB._id, name: "১২ মাস", months: 12, downPaymentPercent: 0, sortOrder: 1 },
  ]);

  state.productA = await Product.create({
    store: state.storeA._id,
    title: "EMI Phone",
    name: "EMI Phone",
    slug: "emi-phone",
    regularPrice: 1000,
    salePrice: 900,
    price: 1000,
    stock: 10,
    status: "published",
  });
  state.productB = await Product.create({
    store: state.storeB._id,
    title: "Other Phone",
    name: "Other Phone",
    slug: "other-phone",
    regularPrice: 1000,
    salePrice: 0,
    price: 1000,
    stock: 5,
    status: "published",
  });
  state.productBlocked = await Product.create({
    store: state.storeA._id,
    title: "Cash Only",
    name: "Cash Only",
    slug: "cash-only",
    regularPrice: 2000,
    salePrice: 0,
    price: 2000,
    stock: 5,
    status: "published",
    installment: { allowed: false, note: "এই পণ্যে কিস্তি নেই" },
  });
  state.productMonths = await Product.create({
    store: state.storeA._id,
    title: "Six Month Special",
    name: "Six Month Special",
    slug: "six-month-special",
    regularPrice: 1200,
    salePrice: 0,
    price: 1200,
    stock: 5,
    status: "published",
    installment: { months: [6] },
  });
  state.category = await Category.create({ store: state.storeA._id, name: "Blocked Cat", slug: "blocked-cat" });
  state.productCategory = await Product.create({
    store: state.storeA._id,
    title: "Category Item",
    name: "Category Item",
    slug: "category-item",
    regularPrice: 1500,
    salePrice: 0,
    price: 1500,
    stock: 5,
    status: "published",
    categories: [state.category._id],
  });

  state.variationProduct = await Product.create({
    store: state.storeA._id,
    title: "Variant Phone",
    name: "Variant Phone",
    slug: "variant-phone",
    regularPrice: 2000,
    salePrice: 1800,
    price: 2000,
    stock: 0,
    hasVariations: true,
    status: "published",
  });
  state.variationIn = await ProductVariation.create({
    store: state.storeA._id,
    product: state.variationProduct._id,
    attributeName: "Storage",
    termName: "128GB",
    regularPrice: 2000,
    salePrice: 1800,
    stock: 4,
  });
  state.variationOut = await ProductVariation.create({
    store: state.storeA._id,
    product: state.variationProduct._id,
    attributeName: "Storage",
    termName: "256GB",
    regularPrice: 2500,
    salePrice: 2300,
    stock: 0,
  });

  state.variationInherit = await Product.create({
    store: state.storeA._id,
    title: "Inherit Phone",
    name: "Inherit Phone",
    slug: "inherit-phone",
    regularPrice: 3000,
    salePrice: 2700,
    price: 3000,
    stock: 0,
    hasVariations: true,
    status: "published",
  });
  await ProductVariation.create({
    store: state.storeA._id,
    product: state.variationInherit._id,
    attributeName: "Color",
    termName: "Silver",
    regularPrice: 0,
    salePrice: 0,
    stock: 2,
  });

  state.app = express();
  state.app.use(express.json());
  state.app.use("/api/public", require("../routes/publicApi"));
  state.app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("a store whose plan lacks installments answers 404", async () => {
  const res = await request(state.app)
    .get("/api/public/installments/config")
    .query({ store: "emi-off" });
  assert.equal(res.status, 404);
});

test("config exposes applicant rules, terms and the cash-price behaviour", async () => {
  const res = await request(state.app)
    .get("/api/public/installments/config")
    .query({ store: "emi-a" });
  assert.equal(res.status, 200);
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.cashPriceIsSalePrice, true);
  assert.equal(res.body.applicant.requireNid, true);
  assert.match(res.body.terms, /EMI Shop/);
  assert.match(res.body.terms, /প্ল্যাটফর্ম নয়/);
});

test("quote recomputes prices server-side: sale = cash, regular = installment base", async () => {
  const res = await quote({ productId: String(state.productA._id), months: 12 });
  assert.equal(res.status, 200);
  assert.equal(res.body.eligible, true);
  assert.equal(res.body.cash.totalPaisa, 90_000); // ৳900 sale × 1
  assert.equal(res.body.installment.basePaisa, 100_000); // ৳1000 regular × 1
  assert.equal(res.body.installment.maxMonths, 12);

  const selected = res.body.installment.selected;
  assert.equal(selected.months, 12);
  assert.equal(selected.downPaymentPaisa, 10_000); // min 10%
  assert.equal(selected.financedPaisa, 90_000);
  assert.equal(selected.profitPaisa, 10_800);
  assert.equal(selected.installmentTotalPaisa, 100_800);
  assert.equal(selected.totalPayablePaisa, 110_800);
  assert.equal(selected.monthlyPaisa, 8_400);
  assert.equal(selected.schedule.length, 12);
  assert.equal(
    selected.schedule.reduce((sum, row) => sum + row.amountPaisa, 0),
    selected.installmentTotalPaisa
  );
  assert.ok(selected.effectiveAnnualRatePct > 12);
});

test("client-sent prices are ignored", async () => {
  const tampered = await quote({
    productId: String(state.productA._id),
    months: 12,
    basePaisa: 1,
    cashPaisa: 1,
    downPaymentPaisa: 0,
    monthlyPaisa: 1,
  });
  assert.equal(tampered.body.installment.selected.totalPayablePaisa, 110_800);

  const clean = await quote({ productId: String(state.productA._id), months: 12 });
  assert.equal(tampered.body.installment.selected.totalPayablePaisa, clean.body.installment.selected.totalPayablePaisa);
});

test("quantity multiplies both the cash and installment totals", async () => {
  const res = await quote({ productId: String(state.productA._id), months: 12, quantity: 2 });
  assert.equal(res.body.cash.totalPaisa, 180_000);
  assert.equal(res.body.installment.basePaisa, 200_000);
  assert.equal(res.body.installment.selected.downPaymentPaisa, 20_000);
  assert.equal(res.body.installment.selected.installmentTotalPaisa, 201_600);
  assert.equal(res.body.installment.selected.monthlyPaisa, 16_800);
});

test("the store minimum down payment wins over a lower client choice", async () => {
  const res = await quote({
    productId: String(state.productA._id),
    months: 12,
    downPaymentPercent: 0,
  });
  assert.equal(res.body.installment.selected.downPaymentPercent, 10);
  assert.equal(res.body.installment.selected.downPaymentPaisa, 10_000);

  const higher = await quote({
    productId: String(state.productA._id),
    months: 12,
    downPaymentPercent: 50,
  });
  assert.equal(higher.body.installment.selected.downPaymentPaisa, 50_000);
  assert.equal(higher.body.installment.selected.financedPaisa, 50_000);
});

test("no months returns every viable plan and no selection", async () => {
  const res = await quote({ productId: String(state.productA._id) });
  assert.equal(res.body.eligible, true);
  assert.equal(res.body.installment.selected, null);
  assert.equal(res.body.installment.options.length, 2);
  assert.deepEqual(
    res.body.installment.options.map((option) => option.months),
    [6, 12]
  );
});

test("an unoffered plan length is refused", async () => {
  const res = await quote({ productId: String(state.productA._id), months: 9 });
  assert.equal(res.body.eligible, false);
  assert.equal(res.body.reason, "months_unavailable");
});

test("a disabled store answers enabled=false", async () => {
  await updateSettings({ enabled: false });
  const res = await quote({ productId: String(state.productA._id), months: 12 });
  assert.equal(res.body.enabled, false);
  assert.equal(res.body.eligible, false);
  assert.equal(res.body.reason, "store_disabled");
  await updateSettings({ enabled: true });
});

test("a product can opt out of installments", async () => {
  const res = await quote({ productId: String(state.productBlocked._id), months: 12 });
  assert.equal(res.body.eligible, false);
  assert.equal(res.body.reason, "product_blocked");
  assert.equal(res.body.policy.source, "product");
});

test("a category rule can block installments", async () => {
  await updateSettings({ categoryRules: [{ category: String(state.category._id), allowed: false }] });
  const res = await quote({ productId: String(state.productCategory._id), months: 12 });
  assert.equal(res.body.eligible, false);
  assert.equal(res.body.reason, "product_blocked");
  assert.equal(res.body.policy.source, "category");
  await updateSettings({ categoryRules: [] });
});

test("a per-plan minimum price excludes cheap products", async () => {
  const expensive = await InstallmentOffer.create({
    store: state.storeA._id,
    name: "২৪ মাস",
    months: 24,
    downPaymentPercent: 10,
    minProductPricePaisa: 50_000_000,
    sortOrder: 3,
  });
  const res = await quote({ productId: String(state.productA._id), months: 24 });
  assert.equal(res.body.eligible, false);
  assert.equal(res.body.reason, "below_min_price");
  await InstallmentOffer.deleteOne({ _id: expensive._id });
});

test("product-level month restriction applies", async () => {
  const six = await quote({ productId: String(state.productMonths._id), months: 6 });
  assert.equal(six.body.eligible, true);
  assert.equal(six.body.installment.options.length, 1);

  const twelve = await quote({ productId: String(state.productMonths._id), months: 12 });
  assert.equal(twelve.body.eligible, false);
  assert.equal(twelve.body.reason, "months_unavailable");
});

test("variation stock and price drive the quote", async () => {
  const auto = await quote({ productId: String(state.variationProduct._id), months: 6 });
  assert.equal(auto.body.eligible, true);
  assert.equal(auto.body.product.variation.id, String(state.variationIn._id));
  assert.equal(auto.body.cash.totalPaisa, 180_000);
  assert.equal(auto.body.installment.basePaisa, 200_000);

  const chosen = await quote({
    productId: String(state.variationProduct._id),
    variationId: String(state.variationIn._id),
    months: 6,
  });
  assert.equal(chosen.body.installment.basePaisa, 200_000);

  const soldOut = await quote({
    productId: String(state.variationProduct._id),
    variationId: String(state.variationOut._id),
    months: 6,
  });
  assert.equal(soldOut.body.eligible, false);
  assert.equal(soldOut.body.reason, "out_of_stock");
});

test("a variation without its own prices inherits the product price", async () => {
  const res = await quote({ productId: String(state.variationInherit._id), months: 6 });
  assert.equal(res.status, 200);
  assert.equal(res.body.eligible, true);
  assert.equal(res.body.cash.totalPaisa, 270_000); // product sale ৳2700
  assert.equal(res.body.installment.basePaisa, 300_000); // product regular ৳3000
});

test("another store cannot quote this store's product", async () => {
  const res = await request(state.app)
    .post("/api/public/installments/quote")
    .query({ store: "emi-b" })
    .send({ productId: String(state.productA._id), months: 12 });
  assert.equal(res.status, 404);

  const own = await request(state.app)
    .post("/api/public/installments/quote")
    .query({ store: "emi-b" })
    .send({ productId: String(state.productB._id), months: 12 });
  assert.equal(own.status, 200);
  assert.equal(own.body.eligible, true);
});

test("the x-store-slug header resolves the store too", async () => {
  const res = await request(state.app)
    .post("/api/public/installments/quote")
    .set("x-store-slug", "emi-a")
    .send({ productId: String(state.productA._id), months: 6 });
  assert.equal(res.status, 200);
  assert.equal(res.body.eligible, true);
  assert.equal(res.body.installment.selected.months, 6);
});
