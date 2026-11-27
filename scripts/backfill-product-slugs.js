#!/usr/bin/env node
// Products saved before the Bengali slug fix carry slugs with the vowel signs
// stripped ("হিমু মামা" -> "হম-মম"), so their storefront links are unreadable.
// Rebuilds the slug from the title only when the stored slug is exactly what
// the old lossy slugify produced — hand-written slugs are left alone.
// Idempotent; --dry-run prints the plan; never touches title, price or stock.
require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/Product");
const { slugify, uniqueSlug } = require("../lib/categoryHelpers");

// The regex used before 6775e69: no \p{M}, so Bengali vowel signs vanished.
function legacySlugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const storeArg = arg("store");
  const dryRun = process.argv.includes("--dry-run");
  if (storeArg && !mongoose.isValidObjectId(storeArg)) throw new Error("Store id valid na");
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI nei — .env check korun");

  await mongoose.connect(process.env.MONGO_URI);
  const filter = storeArg ? { store: storeArg } : {};
  const products = await Product.find(filter).select("store title slug").lean();

  const planned = [];
  for (const product of products) {
    const title = String(product.title || "").trim();
    const current = String(product.slug || "");
    if (!title || !current) continue;
    if (legacySlugify(title) !== current) continue;
    if (slugify(title) === current) continue;
    planned.push(product);
  }

  console.log(
    `products=${products.length} slug_fix=${planned.length}` + (dryRun ? " (dry run)" : "")
  );

  const seen = new Set();
  for (const product of planned) {
    const base = slugify(product.title);
    const slug = await uniqueSlug(Product, base, product.store, product._id, "product");
    const key = String(product.store) + ":" + slug;
    const clash = seen.has(key);
    seen.add(key);
    console.log(
      `  ${product._id} ${JSON.stringify(product.title)}: ${product.slug} -> ${slug}` +
        (clash ? " (duplicate slug in store!)" : "")
    );
    if (!dryRun && !clash) {
      await Product.updateOne({ _id: product._id }, { $set: { slug } });
    }
  }

  console.log("product slug backfill complete");
}

main()
  .catch((err) => {
    console.error("product slug backfill failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
