/* ==========================================================================
   Shop-address migration check.

   node scripts/shop-address-migrate.js            # report only, never writes
   node scripts/shop-address-migrate.js --apply    # create the unique indexes

   The unique index on Store.slug / Store.subdomain cannot be built while two
   stores share an address, so this script lists every conflict first and
   refuses to apply until the list is empty.
   ========================================================================== */
require("dotenv").config();
const mongoose = require("mongoose");
const Store = require("../models/Store");
const SlugHistory = require("../models/SlugHistory");

const APPLY = process.argv.includes("--apply");

function label(store) {
  return `${store.name || "(no name)"} [${String(store._id).slice(-6)}]`;
}

function firstLabel(domain) {
  const value = String(domain || "").trim().toLowerCase();
  if (!value || value.indexOf(".") === -1) return "";
  return value.slice(0, value.indexOf("."));
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const stores = await Store.collection.find({}).toArray();
  const claims = new Map(); // address key -> [{ store, kind }]
  const claim = (key, store, kind) => {
    const value = String(key || "").trim().toLowerCase();
    if (!value) return;
    if (!claims.has(value)) claims.set(value, []);
    claims.get(value).push({ store, kind });
  };

  for (const store of stores) {
    claim(store.slug, store, "slug");
    claim(store.subdomain, store, "subdomain");
    if (store.customDomainStatus === "verified") {
      claim(firstLabel(store.customDomain), store, "custom domain " + store.customDomain);
    }
  }

  const conflicts = [];
  for (const [key, rows] of claims) {
    const ids = new Set(rows.map((row) => String(row.store._id)));
    if (ids.size < 2) continue;
    conflicts.push(
      `"${key}" claimed by: ` +
        rows
          .map((row) => `${label(row.store)} ${row.kind} (${String(row.store._id)})`)
          .join(", ")
    );
  }

  const now = new Date();
  const history = await SlugHistory.collection
    .find({ quarantineUntil: { $gt: now } })
    .toArray()
    .catch(() => []);
  const seen = new Set();
  for (const row of history) {
    const key = String(row.slug || "");
    const rows = claims.get(key) || [];
    if (!rows.length || seen.has(key)) continue;
    seen.add(key);
    conflicts.push(
      `quarantined slug "${key}" still claimed by: ` +
        rows.map((row) => `${label(row.store)} ${row.kind} (${String(row.store._id)})`).join(", ")
    );
  }

  const bySlug = new Set(stores.map((s) => String(s.slug || "").toLowerCase()).filter(Boolean));
  const bySubdomain = new Set(stores.map((s) => String(s.subdomain || "").toLowerCase()).filter(Boolean));
  const byDomainLabel = new Set(
    stores
      .filter((s) => s.customDomainStatus === "verified")
      .map((s) => firstLabel(s.customDomain))
      .filter(Boolean)
  );

  console.log("Shop address migration check");
  console.log("  stores        :", stores.length);
  console.log("  slugs         :", bySlug.size);
  console.log("  subdomains    :", bySubdomain.size);
  console.log("  verified hosts:", byDomainLabel.size);
  console.log(
    "  generated     :",
    stores.filter((s) => /^store-[0-9a-f]+$/.test(String(s.slug || ""))).length,
    "(kept as-is)"
  );

  let indexes = [];
  try {
    indexes = await Store.collection.indexes();
  } catch {
    indexes = [];
  }
  const named = (key) => indexes.find((idx) => idx.key && idx.key[key] === 1 && Object.keys(idx.key).length === 1);
  for (const [field, key] of [["slug", "slug"], ["subdomain", "subdomain"]]) {
    const idx = named(key);
    console.log(
      `  index ${field.padEnd(10)}:`,
      idx ? (idx.unique ? "unique ✔" : `present but NOT unique (${idx.name})`) : "MISSING"
    );
  }

  console.log("\nConflicts:", conflicts.length);
  conflicts.forEach((line) => console.log("  - " + line));

  if (conflicts.length) {
    console.log("\nResolve the conflicts above, then run again with --apply.");
    process.exitCode = 1;
    return;
  }

  if (!APPLY) {
    console.log("\nDry run — no index was created. Re-run with --apply to build the unique indexes.");
    return;
  }

  await Store.createIndexes();
  await SlugHistory.createIndexes();
  console.log("\nIndexes created:");
  for (const idx of await Store.collection.indexes()) console.log("  store:", idx.name, idx.unique ? "(unique)" : "");
  for (const idx of await SlugHistory.collection.indexes()) console.log("  slughistory:", idx.name);
}

main()
  .catch((err) => {
    console.error("Migration check failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
