process.env.JWT_SECRET = "retail-emi-docs-reports-secret";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
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
const InstallmentDocument = require("../models/InstallmentDocument");
const Order = require("../models/Order");
const OrderInstallment = require("../models/OrderInstallment");
const Payment = require("../models/Payment");
const AuditLog = require("../models/AuditLog");
const { tenantStorage } = require("../lib/tenantContext");
const { clearInstallmentSettingsCache } = require("../lib/installmentSettings");
const { resetRateLimits } = require("../lib/rateLimit");
const documents = require("../services/installmentDocuments");

const state = {};
let phoneSeq = 0;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BYTES = Buffer.concat([PNG_SIGNATURE, Buffer.from("nid-scan-payload-".repeat(6))]);

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role || "admin" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}

function binaryParser(res, done) {
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.on("end", () => done(null, Buffer.concat(chunks)));
}

function publicReq(method, url, slug) {
  return request(state.app)[method](url).query({ store: slug });
}

function upload(slug, type, data = PNG_BYTES) {
  return publicReq("post", "/api/public/installments/documents", slug).send({
    type,
    filename: `${type}.png`,
    data: Buffer.from(data).toString("base64"),
  });
}

function adminReq(method, url, { slug = "docs-a", body } = {}) {
  const req = request(state.app)[method](url)
    .set("Content-Type", "application/json")
    .set("x-store-slug", slug)
    .set("Authorization", `Bearer ${state.adminToken}`);
  return body === undefined ? req : req.send(body);
}

function applyBody(overrides = {}) {
  phoneSeq += 1;
  return {
    productId: String(state.productA._id),
    months: 6,
    termsAccepted: true,
    idempotencyKey: `docs-apply-${phoneSeq}-${Date.now()}`,
    applicant: {
      name: "Karim Ahmed",
      phone: "017" + String(20000000 + phoneSeq),
      nid: "1234567890123",
      address: "House 9, Road 4, Dhanmondi, Dhaka",
    },
    ...overrides,
  };
}

function apply(slug, body) {
  return publicReq("post", "/api/public/installments/apply", slug).send(body);
}

async function setSettings(patch) {
  await InstallmentSettings.updateOne({ store: state.storeA._id }, { $set: patch }, { upsert: true });
  clearInstallmentSettingsCache(state.storeA._id);
}

async function createApplicationFixture(overrides = {}) {
  phoneSeq += 1;
  return InstallmentApplication.create({
    store: state.storeA._id,
    number: `EMI-RPT-${phoneSeq}`,
    applicant: { name: "Report Buyer", phone: "018" + String(30000000 + phoneSeq) },
    status: "pending_review",
    termsAcceptedAt: new Date(),
    idempotencyKey: `rpt-key-${phoneSeq}`,
    ...overrides,
  });
}

before(async () => {
  resetRateLimits();
  state.mongo = await MongoMemoryServer.create();
  await mongoose.connect(state.mongo.getUri("retail_emi_docs"));
  await Promise.all([
    Plan.init(),
    Store.init(),
    User.init(),
    Product.init(),
    InstallmentSettings.init(),
    InstallmentOffer.init(),
    InstallmentApplication.init(),
    InstallmentDocument.init(),
    Order.init(),
    OrderInstallment.init(),
    Payment.init(),
    AuditLog.init(),
  ]);

  state.ownerA = await User.create({ name: "Owner A", email: "owner-a@docs.test", role: "admin" });
  state.ownerB = await User.create({ name: "Owner B", email: "owner-b@docs.test", role: "admin" });

  state.planOn = await Plan.create({
    name: "EMI plan",
    slug: "docs-emi-on",
    features: { installments: true },
  });

  state.storeA = await Store.create({
    name: "Docs Store A",
    slug: "docs-a",
    owner: state.ownerA._id,
    plan: state.planOn._id,
  });
  state.storeB = await Store.create({
    name: "Docs Store B",
    slug: "docs-b",
    owner: state.ownerB._id,
    plan: state.planOn._id,
  });

  await InstallmentSettings.create({
    store: state.storeA._id,
    enabled: true,
    method: "flat_annual",
    annualRatePct: 12,
    minDownPaymentPercent: 0,
    cashPriceIsSalePrice: true,
    review: { approvalRequired: true, autoRejectDays: 3 },
  });
  await InstallmentSettings.create({
    store: state.storeB._id,
    enabled: true,
    method: "flat_annual",
    annualRatePct: 12,
    minDownPaymentPercent: 0,
    cashPriceIsSalePrice: true,
  });

  state.offerA = await InstallmentOffer.create({
    store: state.storeA._id,
    name: "৬ মাস",
    months: 6,
    downPaymentPercent: 10,
    sortOrder: 1,
  });

  state.productA = await Product.create({
    store: state.storeA._id,
    title: "EMI Laptop",
    name: "EMI Laptop",
    slug: "emi-laptop",
    regularPrice: 5000,
    salePrice: 0,
    price: 5000,
    stock: 25,
    status: "published",
  });

  state.adminToken = tokenFor(state.ownerA);
  state.adminBToken = tokenFor(state.ownerB);

  state.app = express();
  state.app.use(async (req, res, next) => {
    try {
      const slug = String(req.query.store || req.headers["x-store-slug"] || "").trim().toLowerCase();
      const store = slug ? await Store.findOne({ slug }) : null;
      if (!store) return res.status(400).json({ message: "Store pawa jayni" });
      tenantStorage.run({ storeId: store._id }, () => {
        req.store = store;
        req.publicStore = store;
        next();
      });
    } catch (err) {
      next(err);
    }
  });
  state.app.use(
    "/api/public/installments",
    express.json({ limit: "30mb" }),
    require("../routes/publicInstallments")
  );
  state.app.use("/api/retail-installments", express.json(), require("../routes/retailInstallments"));
  state.app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  });
}, { timeout: 300000 });

after(async () => {
  await fs.promises.rm(path.join(documents.ROOT, String(state.storeA._id)), { recursive: true, force: true });
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

test("a PNG upload returns a token and stores only encrypted bytes outside public/", async () => {
  const res = await upload("docs-a", "nid_front");
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.match(res.body.token, /^[0-9a-f]{48}$/);
  assert.equal(res.body.document.type, "nid_front");
  assert.equal(res.body.document.status, "pending");
  assert.equal(res.body.document.mime, "image/png");
  assert.equal(res.body.document.sizeBytes, PNG_BYTES.length);
  assert.equal(res.body.document.path, undefined);

  const row = await InstallmentDocument.findOne({ store: state.storeA._id, token: res.body.token }).lean();
  assert.ok(row);
  assert.equal(row.status, "pending");
  assert.ok(row.expiresAt instanceof Date);
  assert.match(row.sha256, /^[0-9a-f]{64}$/);

  const onDisk = await fs.promises.readFile(path.join(documents.ROOT, row.path));
  assert.equal(onDisk.subarray(0, 4).toString("ascii"), "EMI1");
  assert.equal(onDisk.includes(PNG_SIGNATURE), false);
  assert.equal(row.path.startsWith("public/") || row.path.startsWith("public\\"), false);

  state.firstToken = res.body.token;
  state.firstDocId = String(row._id);
});

test("uploads reject unknown types, broken base64 and non-image bytes", async () => {
  const badType = await upload("docs-a", "passport");
  assert.equal(badType.status, 400);
  assert.match(badType.body.message, /ডকুমেন্ট/);

  const broken = await publicReq("post", "/api/public/installments/documents", "docs-a").send({
    type: "nid_front",
    data: "not-base64!",
  });
  assert.equal(broken.status, 400);

  const notImage = await upload("docs-a", "nid_front", Buffer.from("plain text bytes here"));
  assert.equal(notImage.status, 400);
  assert.match(notImage.body.message, /JPG|PNG|WebP/);
});

test("a store that requires documents refuses an application until every type is uploaded", async () => {
  await setSettings({ "applicant.requireDocuments": true });

  const bare = await apply("docs-a", applyBody());
  assert.equal(bare.status, 400);
  assert.equal(bare.body.code, "documents_required");
  assert.match(bare.body.message, /nid_front/);
  assert.match(bare.body.message, /nid_back/);

  const front = await upload("docs-a", "nid_front");
  const onlyOne = await apply("docs-a", applyBody({ documents: [front.body.token] }));
  assert.equal(onlyOne.status, 400);
  assert.equal(onlyOne.body.code, "documents_required");
  assert.match(onlyOne.body.message, /nid_back/);
});

test("an application with both documents attaches them and reserves stock once", async () => {
  const front = await upload("docs-a", "nid_front");
  const back = await upload("docs-a", "nid_back");
  const stockBefore = (await Product.findById(state.productA._id).lean()).stock;

  const res = await apply(
    "docs-a",
    applyBody({ documents: [{ token: front.body.token }, { token: back.body.token }] })
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.application.status, "pending_review");
  assert.equal((await Product.findById(state.productA._id).lean()).stock, stockBefore - 1);

  const app = await InstallmentApplication.findById(res.body.application.id).lean();
  assert.equal(app.documents.length, 2);
  assert.deepEqual(app.documents.map((doc) => doc.type).sort(), ["nid_back", "nid_front"]);
  assert.equal(app.documents.every((doc) => doc.encrypted === true && doc.sizeBytes > 0), true);

  const rows = await InstallmentDocument.find({ store: state.storeA._id, application: app._id }).lean();
  assert.equal(rows.length, 2);
  assert.equal(rows.every((row) => row.status === "attached" && row.expiresAt === null), true);

  state.applicationId = String(app._id);
  state.attachedDocId = String(rows.find((row) => row.type === "nid_front")._id);
});

test("the admin detail lists vault documents with ids for authenticated download", async () => {
  const res = await adminReq("get", `/api/retail-installments/applications/${state.applicationId}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.application.documents.length, 2);
  const row = res.body.application.documents.find((doc) => doc.type === "nid_front");
  assert.equal(row.id, state.attachedDocId);
  assert.equal(row.status, "attached");
  assert.ok(row.uploadedAt);
});

test("download returns the exact bytes, private headers and an audit entry", async () => {
  const res = await adminReq(
    "get",
    `/api/retail-installments/applications/${state.applicationId}/documents/${state.attachedDocId}`
  )
    .buffer(true)
    .parse(binaryParser);

  assert.equal(res.status, 200);
  assert.equal(res.headers["content-type"], "image/png");
  assert.match(res.headers["content-disposition"], /nid_front\.png/);
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.match(res.headers["cache-control"], /no-store/);
  assert.equal(Buffer.compare(res.body, PNG_BYTES), 0);

  const audit = await AuditLog.findOne({
    store: state.storeA._id,
    action: "installment_document.view",
    entityId: state.attachedDocId,
  }).lean();
  assert.ok(audit);

  const crossStore = await adminReq(
    "get",
    `/api/retail-installments/applications/${state.applicationId}/documents/${state.attachedDocId}`,
    { slug: "docs-b" }
  ).set("Authorization", `Bearer ${state.adminBToken}`);
  assert.equal(crossStore.status, 404);
});

test("an expired upload token cannot be claimed by /apply", async () => {
  const uploaded = await upload("docs-a", "nid_front");
  await InstallmentDocument.updateOne(
    { store: state.storeA._id, token: uploaded.body.token },
    { $set: { expiresAt: new Date(Date.now() - 60_000) } }
  );

  const res = await apply("docs-a", applyBody({ documents: [uploaded.body.token] }));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "documents_required");
  assert.match(res.body.message, /মেয়াদ/);
});

test("saving settings clamps the retention window", async () => {
  const high = await adminReq("put", "/api/retail-installments/settings", {
    body: { settings: { enabled: true, documents: { retentionDays: 99999 } } },
  });
  assert.equal(high.status, 200);
  assert.equal(high.body.settings.documents.retentionDays, 3650);

  const low = await adminReq("put", "/api/retail-installments/settings", {
    body: { settings: { enabled: true, documents: { retentionDays: -30 } } },
  });
  assert.equal(low.status, 200);
  assert.equal(low.body.settings.documents.retentionDays, 0);

  // required documents were reset by the settings save; keep later tests simple
  await setSettings({ enabled: true, "applicant.requireDocuments": false });
});

test("the report overview matches the applications, portfolio, aging and collections", async () => {
  const approved = await createApplicationFixture({
    status: "approved",
    basePaisa: 400000,
    quote: { totalPayablePaisa: 450000 },
  });
  assert.ok(approved._id);

  const order = await Order.create({
    store: state.storeA._id,
    orderNumber: "EMI-RPT-ORDER-1",
    customerName: "Report Buyer",
    customerPhone: "01900000001",
    totalAmount: 4500,
    paymentMode: "installment",
    paidAmount: 100000,
    dueAmount: 350000,
    status: "confirmed",
    installmentPlan: { source: "retail", profitPaisa: 30000, serviceChargePaisa: 5000 },
  });

  const pastDue = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const futureDue = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  await OrderInstallment.create([
    { store: state.storeA._id, order: order._id, number: 1, amountPaisa: 50000, dueDate: pastDue },
    { store: state.storeA._id, order: order._id, number: 2, amountPaisa: 50000, dueDate: futureDue },
  ]);

  await Payment.create({
    store: state.storeA._id,
    order: order._id,
    method: "mobile:bkash",
    amountPaisa: 100000,
    status: "verified",
    verifiedAt: new Date(),
  });

  const res = await adminReq("get", "/api/retail-installments/reports/overview?preset=this_month");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const data = res.body;

  assert.equal(data.period.preset, "this_month");
  assert.equal(data.applications.approved >= 1, true);
  assert.equal(data.applications.avgBasePaisa, 400000);
  assert.equal(data.applications.avgTotalPayablePaisa, 450000);

  assert.equal(data.portfolio.orders, 1);
  assert.equal(data.portfolio.financedPaisa, 450000);
  assert.equal(data.portfolio.collectedPaisa, 100000);
  assert.equal(data.portfolio.outstandingPaisa, 350000);
  assert.equal(data.portfolio.openInstallments, 2);
  assert.equal(data.portfolio.overdueCount, 1);
  assert.equal(data.portfolio.overduePaisa, 50000);

  const aging = Object.fromEntries(data.aging.map((row) => [row.key, row]));
  assert.equal(aging["1_30"].count, 1);
  assert.equal(aging["1_30"].amountPaisa, 50000);
  assert.equal(aging.current.count, 1);

  assert.equal(data.collections.count, 1);
  assert.equal(data.collections.amountPaisa, 100000);
  assert.equal(data.collections.byMethod[0].method, "mobile");
  assert.equal(data.collections.byMethod[0].label, "Mobile banking");
  assert.equal(data.collections.byMonth.length, 1);

  assert.equal(data.earnings.profitPaisa, 30000);
  assert.equal(data.earnings.serviceChargePaisa, 5000);
  assert.equal(data.earnings.totalPaisa, 35000);

  assert.equal(data.topOverdue.length, 1);
  assert.equal(data.topOverdue[0].orderNumber, "EMI-RPT-ORDER-1");
  assert.equal(data.topOverdue[0].daysOverdue >= 10, true);
});

test("the report export streams a real XLSX workbook", async () => {
  const res = await adminReq("get", "/api/retail-installments/reports/export.xlsx?preset=this_month")
    .buffer(true)
    .parse(binaryParser);
  assert.equal(res.status, 200);
  assert.equal(
    res.headers["content-type"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  assert.match(res.headers["content-disposition"], /retail-emi-.*\.xlsx/);
  assert.equal(res.body.subarray(0, 2).toString("ascii"), "PK");
  assert.equal(res.body.length > 1000, true);
});

test("a custom from/to range works and never rides along with a preset", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const ok = await adminReq("get", `/api/retail-installments/reports/overview?from=${from}&to=${today}`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.period.preset, null);
  assert.equal(ok.body.period.from, from);
  assert.equal(ok.body.period.to, today);
  assert.equal(ok.body.portfolio.orders, 1);

  const file = await adminReq("get", `/api/retail-installments/reports/export.xlsx?from=${from}&to=${today}`)
    .buffer(true)
    .parse(binaryParser);
  assert.equal(file.status, 200);
  assert.equal(file.body.subarray(0, 2).toString("ascii"), "PK");

  const both = await adminReq(
    "get",
    `/api/retail-installments/reports/overview?preset=this_month&from=${from}&to=${today}`
  );
  assert.equal(both.status, 400);

  const half = await adminReq("get", `/api/retail-installments/reports/overview?from=${from}`);
  assert.equal(half.status, 400);
});

test("retention purge deletes files, keeps audit markers and clears stale pending uploads", async () => {
  await setSettings({ enabled: true, "documents.retentionDays": 1 });

  const closed = await createApplicationFixture({ status: "rejected" });
  const front = await upload("docs-a", "nid_front");
  const back = await upload("docs-a", "nid_back");
  const claimed = await documents.claimTokens({
    storeId: state.storeA._id,
    tokens: [front.body.token, back.body.token],
  });
  await documents.attachDocuments({
    storeId: state.storeA._id,
    applicationId: closed._id,
    rows: claimed,
  });

  const attachedRows = await InstallmentDocument.find({
    store: state.storeA._id,
    application: closed._id,
  }).lean();
  const keys = attachedRows.map((row) => row.path);
  assert.equal(keys.length, 2);
  for (const key of keys) assert.equal(fs.existsSync(path.join(documents.ROOT, key)), true);

  const longAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  await InstallmentApplication.collection.updateOne({ _id: closed._id }, { $set: { updatedAt: longAgo } });

  const stale = await upload("docs-a", "nid_back");
  await InstallmentDocument.updateOne(
    { store: state.storeA._id, token: stale.body.token },
    { $set: { expiresAt: new Date(Date.now() - 60_000) } }
  );

  const res = await adminReq("post", "/api/retail-installments/documents/purge");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.summary.expired >= 2, true);
  assert.equal(res.body.summary.pending >= 1, true);
  assert.equal(res.body.summary.files >= 3, true);

  const purged = await InstallmentDocument.find({ _id: { $in: attachedRows.map((row) => row._id) } }).lean();
  assert.equal(purged.every((row) => row.status === "purged" && row.path === "" && row.purgedAt), true);
  for (const key of keys) assert.equal(fs.existsSync(path.join(documents.ROOT, key)), false);

  const stored = await InstallmentApplication.findById(closed._id).lean();
  assert.equal(stored.documents.length, 2);
  assert.equal(stored.documents.every((doc) => doc.purgedAt && doc.mime === "" && doc.sizeBytes === 0), true);
  assert.equal(JSON.stringify(stored.documents).includes("installment-documents"), false);

  const audit = await AuditLog.findOne({
    store: state.storeA._id,
    action: "installment_document.purge",
  }).lean();
  assert.ok(audit);

  const downloadGone = await adminReq(
    "get",
    `/api/retail-installments/applications/${closed._id}/documents/${attachedRows[0]._id}`
  );
  assert.equal(downloadGone.status, 404);
});

test("the retail scheduler purges documents even when EMI is switched off", async () => {
  await setSettings({ enabled: false, "documents.retentionDays": 1 });

  const stale = await upload("docs-a", "nid_front");
  await InstallmentDocument.updateOne(
    { store: state.storeA._id, token: stale.body.token },
    { $set: { expiresAt: new Date(Date.now() - 60_000) } }
  );

  const res = await adminReq("post", "/api/retail-installments/run-scheduler");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.summary.documentsPurged >= 1, true);
  assert.equal(res.body.summary.documentFilesDeleted >= 1, true);
});
