#!/usr/bin/env node
// Creates the report collections/indexes and the two additive orders indexes.
// Safe to run repeatedly. It never modifies existing documents or roles.
require("dotenv").config();
const mongoose = require("mongoose");
const ReportDaily = require("../models/ReportDaily");
const ReportDailyProduct = require("../models/ReportDailyProduct");
const ReportDailyCategory = require("../models/ReportDailyCategory");
const ReportDailyCoupon = require("../models/ReportDailyCoupon");
const ReportDailyCustomer = require("../models/ReportDailyCustomer");

const COLLECTIONS = [
  "report_daily",
  "report_daily_products",
  "report_daily_categories",
  "report_daily_coupons",
  "report_daily_customers",
];
const ORDER_INDEXES = [
  {
    name: "report_valid_orders",
    keys: { store: 1, status: 1, createdAt: 1 },
  },
  {
    name: "report_refund_dates",
    keys: { store: 1, "installmentPlan.cancellation.at": 1 },
  },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI nei — .env check korun");
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((row) => row.name));
  for (const name of COLLECTIONS) {
    if (existing.has(name)) {
      console.log("collection exists:", name);
    } else if (dryRun) {
      console.log("would create collection:", name);
    } else {
      await db.createCollection(name);
      console.log("created collection:", name);
    }
  }

  if (dryRun) {
    console.log("would create indexes for:", COLLECTIONS.join(", "));
  } else {
    for (const Model of [
      ReportDaily,
      ReportDailyProduct,
      ReportDailyCategory,
      ReportDailyCoupon,
      ReportDailyCustomer,
    ]) {
      await Model.createIndexes();
    }
    console.log("report indexes ready");
  }

  const orders = db.collection("orders");
  let orderIndexNames = new Set();
  try {
    orderIndexNames = new Set((await orders.indexes()).map((row) => row.name));
  } catch {
    /* collection may be empty/new */
  }
  for (const index of ORDER_INDEXES) {
    if (orderIndexNames.has(index.name)) {
      console.log("orders index exists:", index.name);
    } else if (dryRun) {
      console.log("would create orders index:", index.name, JSON.stringify(index.keys));
    } else {
      await orders.createIndex(index.keys, { name: index.name, background: true });
      console.log("created orders index:", index.name);
    }
  }

  if (dryRun) {
    console.log("dry run complete — no changes made");
  } else {
    console.log("reports migration up complete");
    console.log("next: run scripts/reports-backfill.js --from=YYYY-MM-DD --to=YYYY-MM-DD");
  }
}

main()
  .catch((err) => {
    console.error("reports migration up failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
