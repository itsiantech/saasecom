/* ==========================================================================
   Lens Selector starter data — 3 types, 3 categories, 6 packages.
   Idempotent: rows are matched by name (packages by name + brand) and
   updated in place, so running it twice never duplicates anything.

   Run:  node seeds/lens-seed.js --store=<slug>
   ========================================================================== */
const mongoose = require("mongoose");
const Store = require("../models/Store");
const LensType = require("../models/LensType");
const LensCategory = require("../models/LensCategory");
const LensPackage = require("../models/LensPackage");

const TYPES = [
  { name: "Single Vision", needsPrescription: true, note: "এক দূরত্বের পাওয়ার" },
  { name: "Progressive / Bifocal", needsPrescription: true, note: "দূর + নিকট দুই পাওয়ার" },
  { name: "Non-Prescription", needsPrescription: false, note: "পাওয়ার ছাড়া প্লেইন লেন্স" },
];

const CATEGORIES = [
  { name: "Blue Light", types: ["Single Vision", "Progressive / Bifocal", "Non-Prescription"] },
  { name: "Photochromic", types: ["Single Vision", "Progressive / Bifocal", "Non-Prescription"] },
  { name: "Driving", types: ["Single Vision", "Progressive / Bifocal"] },
];

// taka → paisa, matching every other money field in the app
const PACKAGES = [
  { name: "Clear Basic", brand: "OptiClear", lensIndex: "1.56", price: 650, types: ["Single Vision", "Non-Prescription"], categories: [] },
  { name: "Blue Shield", brand: "OptiClear", lensIndex: "1.56", price: 1250, badge: "Popular", types: ["Single Vision", "Non-Prescription"], categories: ["Blue Light"] },
  { name: "Photochromic Day", brand: "SunSwitch", lensIndex: "1.56", price: 2700, types: ["Single Vision"], categories: ["Photochromic"] },
  { name: "Progressive Comfort", brand: "OptiClear", lensIndex: "1.60", price: 6850, badge: "Bestseller", types: ["Progressive / Bifocal"], categories: [] },
  { name: "Drive Pro Polarized", brand: "RoadVision", lensIndex: "1.67", price: 9100, badge: "Premium", types: ["Single Vision", "Progressive / Bifocal"], categories: ["Driving"] },
  { name: "Freeform Elite 1.74", brand: "OptiClear", lensIndex: "1.74", price: 35000, badge: "Ultra", types: ["Progressive / Bifocal"], categories: [] },
];

async function seedLens(storeId) {
  const summary = { types: 0, categories: 0, packages: 0 };
  const typeByName = new Map();

  for (let i = 0; i < TYPES.length; i += 1) {
    const row = TYPES[i];
    const doc = await LensType.findOneAndUpdate(
      { store: storeId, name: row.name },
      { $set: { needsPrescription: row.needsPrescription, note: row.note, sortOrder: i, active: true } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    typeByName.set(row.name, doc._id);
    summary.types += 1;
  }

  const categoryByName = new Map();
  for (let i = 0; i < CATEGORIES.length; i += 1) {
    const row = CATEGORIES[i];
    const typeIds = row.types.map((name) => typeByName.get(name)).filter(Boolean);
    const doc = await LensCategory.findOneAndUpdate(
      { store: storeId, name: row.name },
      { $set: { typeIds, sortOrder: i, active: true } },
      { upsert: true, setDefaultsOnInsert: true }
    ).setOptions({ returnDocument: 'after' });
    categoryByName.set(row.name, doc._id);
    summary.categories += 1;
  }

  for (let i = 0; i < PACKAGES.length; i += 1) {
    const row = PACKAGES[i];
    await LensPackage.findOneAndUpdate(
      { store: storeId, name: row.name, brand: row.brand },
      {
        $set: {
          lensIndex: row.lensIndex,
          badge: row.badge || "",
          pricePaisa: Math.round(row.price * 100),
          typeIds: row.types.map((name) => typeByName.get(name)).filter(Boolean),
          categoryIds: row.categories.map((name) => categoryByName.get(name)).filter(Boolean),
          sortOrder: i,
          active: true,
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
    summary.packages += 1;
  }

  return summary;
}

async function storeForSlug(slug) {
  if (slug) return Store.findOne({ slug: String(slug).toLowerCase(), deletedAt: null });
  return Store.findOne({ deletedAt: null }).sort({ createdAt: 1 });
}

module.exports = { seedLens, storeForSlug, TYPES, CATEGORIES, PACKAGES };

if (require.main === module) {
  require("dotenv").config({ quiet: true });
  const arg = (name, fallback) => {
    const hit = process.argv.slice(2).find((row) => row.startsWith(`--${name}=`));
    return hit ? hit.split("=").slice(1).join("=") : fallback;
  };

  (async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const store = await storeForSlug(arg("store", ""));
    if (!store) {
      console.log("Kono store pawa jayni — --store=<slug> din.");
      process.exitCode = 1;
      return;
    }
    const summary = await seedLens(store._id);
    console.log(JSON.stringify({ ok: true, store: store.slug, ...summary }, null, 2));
    await mongoose.disconnect();
  })().catch(async (err) => {
    console.error("lens seed failed:", err.message);
    try {
      await mongoose.disconnect();
    } catch {}
    process.exitCode = 1;
  });
}
