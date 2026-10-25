/* ==========================================================================
   Suppliers module — indexes only
   Run:  node scripts/suppliers-indexes.js
   Creates declared indexes if missing. Never drops or rebuilds existing ones.
   ========================================================================== */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");

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

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const summary = [];
  for (const Model of MODELS) {
    const name = Model.collection.name;
    const exists = (await mongoose.connection.db.listCollections({ name }).toArray()).length > 0;
    if (!exists) await Model.createCollection();
    const created = await Model.createIndexes();
    summary.push({ collection: name, indexes: created });
  }

  console.log(JSON.stringify({ ok: true, collections: summary }, null, 2));
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error("supplier index migration failed:", err.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exitCode = 1;
});
