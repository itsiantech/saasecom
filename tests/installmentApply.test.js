process.env.JWT_SECRET = "installment-apply-secret";

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
const InstallmentSettings = require("../models/InstallmentSettings");
const InstallmentOffer = require("../models/InstallmentOffer");
const InstallmentApplication = require("../models/InstallmentApplication");
const { clearInstallmentSettingsCache } = require("../lib/installmentSettings");
const { resetRateLimits } = require("../lib/rateLimit");

const state = {};

async function updateSettings(patch) {
  await InstallmentSettings.updateOne({ store: state.storeA._id }, { $set: patch });
  clearInstallmentSettingsCache(state.storeA._id);
}

function apply(body) {
  return request(state.app)
    .post("/api/public/installments/apply")
    .query({ store: "emi-a" })
    .send(body);
}

// Each test gets its own phone so the rate-limit bucket is never shared by
// accident; the limiter has one dedicated test that reuses a single number.
let phoneSeq = 0;
function applicant(overrides = {}) {
  phoneSeq += 1;
  return {
    name: "Rahim Uddin",
    phone: "017" + String(10000000 + phoneSeq),
    nid: "1234567890123",
    address: "House 12, Road 5, Dhanmondi, Dhaka",
    ...overrides,
  };
}

function body(overrides = {}) {
  return {
    productId: String(state.productA._id),
    months: 12,
    termsAccepted: true,
    idempotencyKey: "apply-key-" + Math.random().toString(36).slice(2, 12),
    applicant: applicant(),
    ...overrides,
  };
}

before(async () => {
  resetRateLimits();
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("installment-apply"));
  await Promise.all([
    Plan.init(),
    Store.init(),
    User.init(),
    Product.init(),
    ProductVariation.init(),
    InstallmentSettings.init(),
    InstallmentOffer.init(),
    InstallmentApplication.init(),
  ]);

  state.owner = await User.create({ name: "Owner", email: "owner@emi-apply.test" });
  state.planOn = await Plan.create({ name: "EMI", slug: "emi-apply-on", features: { installments: true } });
  state.planOff = await Plan.create({ name: "Basic", slug: "emi-apply-off", features: {} });

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
    stock: 40,
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
    installment: { allowed: false },
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

test("a plan without installments cannot apply at all", async () => {
  const res = await request(state.app)
    .post("/api/public/installments/apply")
    .query({ store: "emi-off" })
    .send(body());
  assert.equal(res.status, 404);
});

test("a valid application reserves stock, encrypts NID and returns its number", async () => {
  const before = await Product.findById(state.productA._id).lean();
  const key = "happy-path-key-1";
  const res = await apply(
    body({
      idempotencyKey: key,
      basePaisa: 1,
      cashPaisa: 1,
      downPaymentPaisa: 0,
      totalPayablePaisa: 1,
    })
  );

  assert.equal(res.status, 201);
  assert.equal(res.body.ok, true);
  assert.match(res.body.application.number, /^EMI-[0-9A-F]{8}$/);
  assert.equal(res.body.application.status, "pending_review");
  // server-side math wins over the tampered client amounts
  assert.equal(res.body.application.basePaisa, 100_000);
  assert.equal(res.body.application.cashPaisa, 90_000);
  assert.equal(res.body.application.downPaymentPaisa, 10_000);
  assert.equal(res.body.application.totalPayablePaisa, 110_800);
  assert.equal(res.body.application.months, 12);
  assert.equal(res.body.application.nid, undefined);

  const afterRow = await Product.findById(state.productA._id).lean();
  assert.equal(afterRow.stock, before.stock - 1);

  const doc = await InstallmentApplication.findOne({ store: state.storeA._id, idempotencyKey: key }).lean();
  assert.equal(doc.number, res.body.application.number);
  assert.match(doc.applicant.nidEnc, /^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
  assert.ok(!JSON.stringify(doc).includes("1234567890123"));
  assert.equal(doc.stockReserved, true);
  assert.ok(doc.termsAcceptedAt instanceof Date);
  assert.equal(doc.user, null);
});

test("a retried submit with the same key returns the first application", async () => {
  const key = "happy-path-key-1";
  const stock = (await Product.findById(state.productA._id).lean()).stock;
  const res = await apply(body({ idempotencyKey: key }));
  assert.equal(res.status, 200);
  assert.equal(res.body.duplicate, true);

  const again = await Product.findById(state.productA._id).lean();
  assert.equal(again.stock, stock);
  const count = await InstallmentApplication.countDocuments({ store: state.storeA._id, idempotencyKey: key });
  assert.equal(count, 1);
});

test("an invalid phone number is refused before stock moves", async () => {
  const before = await Product.findById(state.productA._id).lean();
  const res = await apply(body({ applicant: applicant({ phone: "01234" }) }));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "invalid_applicant");
  assert.match(res.body.message, /মোবাইল/);

  const afterRow = await Product.findById(state.productA._id).lean();
  assert.equal(afterRow.stock, before.stock);
});

test("a missing NID is refused when the store requires it", async () => {
  const res = await apply(body({ applicant: applicant({ nid: "" }) }));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "invalid_applicant");
  assert.match(res.body.message, /NID/);
});

test("consent is mandatory", async () => {
  const before = await Product.findById(state.productA._id).lean();
  const res = await apply(body({ termsAccepted: false }));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "terms_required");

  const afterRow = await Product.findById(state.productA._id).lean();
  assert.equal(afterRow.stock, before.stock);
});

test("an application without a chosen plan is refused", async () => {
  const res = await apply(body({ months: undefined }));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "plan_required");
});

test("out of stock is refused before the application row exists", async () => {
  const res = await apply(body({ quantity: 999 }));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "out_of_stock");
});

test("a blocked product cannot be applied for", async () => {
  const res = await apply(body({ productId: String(state.productBlocked._id) }));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "product_blocked");
});

test("another store's product is a 404", async () => {
  const res = await apply(body({ productId: String(state.productB._id) }));
  assert.equal(res.status, 404);
});

test("variation applications reserve the variation, not the parent product", async () => {
  const parentBefore = (await Product.findById(state.variationProduct._id).lean()).stock;
  const variationBefore = (await ProductVariation.findById(state.variationIn._id).lean()).stock;

  const res = await apply(
    body({
      productId: String(state.variationProduct._id),
      variationId: String(state.variationIn._id),
      months: 6,
    })
  );
  assert.equal(res.status, 201);
  assert.equal(res.body.application.basePaisa, 200_000);

  assert.equal((await ProductVariation.findById(state.variationIn._id).lean()).stock, variationBefore - 1);
  assert.equal((await Product.findById(state.variationProduct._id).lean()).stock, parentBefore);

  const doc = await InstallmentApplication.findOne({ store: state.storeA._id, number: res.body.application.number }).lean();
  assert.equal(String(doc.items[0].variation), String(state.variationIn._id));
});

test("a short request key is rejected", async () => {
  const res = await apply(body({ idempotencyKey: "short" }));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "idempotency_required");
});

test("a store that requires documents refuses until uploads ship", async () => {
  await updateSettings({ applicant: { requireDocuments: true } });
  const res = await apply(body());
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "documents_required");
  await updateSettings({ applicant: { requireDocuments: false } });
});

test("a disabled store cannot accept applications", async () => {
  await updateSettings({ enabled: false });
  const res = await apply(body());
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "store_disabled");
  await updateSettings({ enabled: true });
});

test("sixth application from one phone inside the window is rate limited", async () => {
  resetRateLimits();
  const phone = "01812345678";
  for (let i = 0; i < 5; i += 1) {
    const ok = await apply(body({ applicant: applicant({ phone }) }));
    assert.equal(ok.status, 201, `attempt ${i + 1}: ${JSON.stringify(ok.body)}`);
  }
  const limited = await apply(body({ applicant: applicant({ phone }) }));
  assert.equal(limited.status, 429);
  assert.ok(limited.headers["retry-after"]);
  resetRateLimits();
});
