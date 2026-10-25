#!/usr/bin/env node
// Removes ONLY report collections and the two report-owned orders indexes.
// Dry-run by default. Destructive only with --yes-drop-report-data.
require("dotenv").config();
const mongoose = require("mongoose");

const COLLECTIONS = [
  "report_daily",
  "report_daily_products",
  "report_daily_categories",
  "report_daily_coupons",
  "report_daily_customers",
];
const ORDER_INDEXES = ["report_valid_orders", "report_refund_dates"];

async function main() {
  const confirmed = process.argv.includes("--yes-drop-report-data");
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI nei — .env check korun");
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((row) => row.name));

  for (const name of COLLECTIONS) {
    if (!existing.has(name)) {
      console.log("collection absent:", name);
    } else if (!confirmed) {
      console.log("would drop collection:", name);
    } else {
      await db.dropCollection(name);
      console.log("dropped collection:", name);
    }
  }

  let names = new Set();
  try {
    names = new Set((await db.collection("orders").indexes()).map((row) => row.name));
  } catch {
    /* orders collection may not exist */
  }
  for (const name of ORDER_INDEXES) {
    if (!names.has(name)) {
      console.log("orders index absent:", name);
    } else if (!confirmed) {
      console.log("would drop orders index:", name);
    } else {
      await db.collection("orders").dropIndex(name);
      console.log("dropped orders index:", name);
    }
  }

  if (!confirmed) {
    console.log("dry run — kichu drop hoyni. Destructive rollback: --yes-drop-report-data");
  } else {
    console.log("reports migration down complete — existing orders untouched");
  }
}

main()
  .catch((err) => {
    console.error("reports migration down failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
