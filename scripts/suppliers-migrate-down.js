/* ==========================================================================
   Suppliers module — migration DOWN (destructive)
   Run:  node scripts/suppliers-migrate-down.js --yes-drop-supplier-data
   Removes ONLY the new supplier collections and clears Product.supplierId.
   Without the explicit flag it prints what would happen and exits.
   This destroys supplier orders/invoices/payments/ledger data. Back up first.
   ========================================================================== */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");

const Product = require("../models/Product");
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

const CONFIRM_FLAG = "--yes-drop-supplier-data";

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const plan = [];
  for (const Model of MODELS) {
    const name = Model.collection.name;
    const exists = (await mongoose.connection.db.listCollections({ name }).toArray()).length > 0;
    const docs = exists ? await Model.estimatedDocumentCount() : 0;
    plan.push({ collection: name, exists, docs });
  }

  if (!process.argv.includes(CONFIRM_FLAG)) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          plan,
          productField: "Product.supplierId would be set to null",
          confirmWith: `node scripts/suppliers-migrate-down.js ${CONFIRM_FLAG}`,
        },
        null,
        2
      )
    );
    await mongoose.disconnect();
    return;
  }

  const productReset = await Product.updateMany(
    { supplierId: { $type: "objectId" } },
    { $set: { supplierId: null } }
  );

  const dropped = [];
  for (const item of plan) {
    if (!item.exists) continue;
    await mongoose.connection.db.dropCollection(item.collection);
    dropped.push(item.collection);
  }

  console.log(
    JSON.stringify(
      {
        mode: "applied",
        productSupplierIdCleared: productReset.modifiedCount,
        droppedCollections: dropped,
        note: "Existing Product documents keep all other fields. supplierId can be re-added by the up migration.",
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error("supplier migration down failed:", err.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exitCode = 1;
});
