/* ==========================================================================
   Suppliers module — migration UP
   Run:  node scripts/suppliers-migrate-up.js
   Idempotent. Creates only new collections/indexes + per-store defaults.
   Existing suppliers rows/settings are never overwritten (autoAdjustStock stays OFF
   for new stores and untouched for existing ones).
   ========================================================================== */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");

const Store = require("../models/Store");
const Supplier = require("../models/Supplier");
const SupplierOrder = require("../models/SupplierOrder");
const SupplierInvoice = require("../models/SupplierInvoice");
const SupplierPayment = require("../models/SupplierPayment");
const SupplierSettings = require("../models/SupplierSettings");
const SupplierAuditLog = require("../models/SupplierAuditLog");
const SupplierIdempotency = require("../models/SupplierIdempotency");
const SupplierCounter = require("../models/SupplierCounter");
const StockMovement = require("../models/StockMovement");

const MODELS = [
  Supplier,
  SupplierOrder,
  SupplierInvoice,
  SupplierPayment,
  SupplierSettings,
  SupplierAuditLog,
  SupplierIdempotency,
  SupplierCounter,
  StockMovement,
];

async function collectionExists(name) {
  const found = await mongoose.connection.db.listCollections({ name }).toArray();
  return found.length > 0;
}

async function ensureCollection(Model) {
  const name = Model.collection.name;
  if (await collectionExists(name)) return { name, created: false };
  await Model.createCollection();
  return { name, created: true };
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const collections = [];
  for (const Model of MODELS) collections.push(await ensureCollection(Model));

  for (const Model of MODELS) await Model.createIndexes();

  const stores = await Store.find({}).select("_id").lean();
  let settingsSeeded = 0;
  for (const store of stores) {
    const res = await SupplierSettings.updateOne(
      { _id: store._id },
      {
        $setOnInsert: {
          store: store._id,
          autoAdjustStock: false,
          maxOrderQty: 10000,
          timezone: "Asia/Dhaka",
        },
      },
      { upsert: true }
    );
    if (res.upsertedCount) settingsSeeded += 1;
  }

  console.log(
    JSON.stringify(
      {
        collections: collections.map((c) => `${c.name}${c.created ? " (created)" : ""}`),
        indexesEnsured: MODELS.map((m) => m.collection.name),
        stores: stores.length,
        settingsSeeded,
        note: "Product.supplierId needs no backfill; existing docs read as null.",
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error("supplier migration up failed:", err.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exitCode = 1;
});
