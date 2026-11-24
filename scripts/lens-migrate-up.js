/* ==========================================================================
   Lens Selector — collections + indexes only (Phase 1).
   Adds five new collections; touches nothing that already exists.

   Run:  node scripts/lens-migrate-up.js
         node scripts/lens-migrate-up.js --seed=<store-slug>
   Safe to run twice; existing indexes are never dropped or rebuilt.
   ========================================================================== */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");

const LensType = require("../models/LensType");
const LensCategory = require("../models/LensCategory");
const LensPackage = require("../models/LensPackage");
const Prescription = require("../models/Prescription");
const OrderPrescription = require("../models/OrderPrescription");

const MODELS = [LensType, LensCategory, LensPackage, Prescription, OrderPrescription];

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((row) => row.startsWith(`--${name}`));
  if (!hit) return fallback;
  return hit.includes("=") ? hit.split("=").slice(1).join("=") : true;
};

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

  const seedArg = arg("seed", null);
  let seed = null;
  if (seedArg !== null) {
    const { seedLens, storeForSlug } = require("../seeds/lens-seed");
    const store = await storeForSlug(seedArg === true ? "" : String(seedArg));
    if (!store) throw new Error(`store pawa jayni: ${seedArg === true ? "(default)" : seedArg}`);
    seed = { store: store.slug, ...(await seedLens(store._id)) };
  }

  console.log(JSON.stringify({ ok: true, collections: summary, seed }, null, 2));
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error("lens migration failed:", err.message);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exitCode = 1;
});
