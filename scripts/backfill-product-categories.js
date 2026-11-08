#!/usr/bin/env node
// Products saved by the product form before the category fix have their category
// links only in productcategories, while the admin list, storefront and category
// pages read Product.categories. Copies the links into the legacy array and fills
// missing links from it. Idempotent; never touches price/stock/status.
require("dotenv").config();
const mongoose = require("mongoose");
const Store = require("../models/Store");
const Product = require("../models/Product");
const Category = require("../models/Category");
const ProductCategory = require("../models/ProductCategory");

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function repairStore(store, dryRun) {
  const storeId = store._id;
  const uncat = await Category.findOne({ store: storeId, slug: "uncategorized" }).select("_id").lean();
  const uncatId = uncat ? String(uncat._id) : "";

  const links = await ProductCategory.find({ store: storeId }).select("_id product category").lean();
  const linkMap = new Map();
  const staleLinkIds = [];
  const seen = new Set();
  let duplicates = 0;
  for (const link of links) {
    const productKey = String(link.product);
    const categoryKey = String(link.category);
    const key = productKey + ":" + categoryKey;
    if (seen.has(key)) {
      duplicates += 1;
      staleLinkIds.push(link._id);
      continue;
    }
    seen.add(key);
    if (!linkMap.has(productKey)) linkMap.set(productKey, []);
    linkMap.get(productKey).push({ id: link._id, category: categoryKey });
  }

  const products = await Product.find({ store: storeId }).select("categories").lean();
  const productOps = [];
  const linkOps = [];
  let productsFixed = 0;

  for (const product of products) {
    const productId = String(product._id);
    const current = linkMap.get(productId) || [];
    const legacy = (product.categories || []).map(String);
    let merged = [...new Set([...current.map((row) => row.category), ...legacy])];
    if (uncatId && merged.length > 1) merged = merged.filter((c) => c !== uncatId);

    const currentSet = new Set(current.map((row) => row.category));
    const mergedSet = new Set(merged);
    const legacyMatches = legacy.length === merged.length && legacy.every((c) => mergedSet.has(c));

    if (!legacyMatches) {
      productsFixed += 1;
      productOps.push({
        updateOne: { filter: { _id: product._id, store: storeId }, update: { $set: { categories: merged } } },
      });
    }
    for (const category of merged) {
      if (currentSet.has(category)) continue;
      linkOps.push({
        insertOne: { document: { store: storeId, product: product._id, category } },
      });
    }
    if (uncatId && !mergedSet.has(uncatId)) {
      current.filter((row) => row.category === uncatId).forEach((row) => staleLinkIds.push(row.id));
    }
  }

  console.log(
    `store=${storeId} "${store.name}": products=${products.length} fixed=${productsFixed} ` +
      `links_to_add=${linkOps.length} duplicate_links=${duplicates} stale_links_to_drop=${staleLinkIds.length}` +
      (dryRun ? " (dry run)" : "")
  );
  if (dryRun) return;

  if (productOps.length) await Product.bulkWrite(productOps);
  if (linkOps.length) await ProductCategory.bulkWrite(linkOps);
  if (staleLinkIds.length) await ProductCategory.deleteMany({ _id: { $in: staleLinkIds } });
}

async function main() {
  const storeArg = arg("store");
  const dryRun = process.argv.includes("--dry-run");
  if (storeArg && !mongoose.isValidObjectId(storeArg)) throw new Error("Store id valid na");
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI nei — .env check korun");

  await mongoose.connect(process.env.MONGO_URI);
  const stores = await Store.find(storeArg ? { _id: storeArg } : {}).select("name").lean();
  if (!stores.length) throw new Error("Store pawa jayni");

  for (const store of stores) await repairStore(store, dryRun);
  console.log("product category backfill complete");
}

main()
  .catch((err) => {
    console.error("product category backfill failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
