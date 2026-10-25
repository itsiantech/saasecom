#!/usr/bin/env node
// Backfills report_daily* from raw orders for a date range. Run off-peak and in
// chunks. Never changes orders/products/coupons/customers.
require("dotenv").config();
const mongoose = require("mongoose");
const Store = require("../models/Store");
const { resolvePeriod, listDayKeys } = require("../lib/reportPeriods");
const { rebuildRange } = require("../services/reportRollups");
const { REPORT_TIMEZONE, MAX_REBUILD_DAYS } = require("../lib/reportConstants");

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const from = arg("from");
  const to = arg("to");
  const storeArg = arg("store");
  const delayMs = Math.max(0, parseInt(arg("delay", "250"), 10) || 0);
  const dryRun = process.argv.includes("--dry-run");

  if (!from || !to) {
    console.log("Usage: node scripts/reports-backfill.js --from=YYYY-MM-DD --to=YYYY-MM-DD [--store=<id>] [--delay=250] [--dry-run]");
    process.exitCode = 1;
    return;
  }

  const period = resolvePeriod({ from, to });
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI nei — .env check korun");
  await mongoose.connect(process.env.MONGO_URI);

  let storeId = storeArg;
  if (!storeId) {
    const stores = await Store.find({}).select("name").lean();
    if (stores.length !== 1) {
      console.log("Store specify korun — available stores:");
      for (const store of stores) console.log(String(store._id), "|", store.name);
      process.exitCode = 1;
      return;
    }
    storeId = stores[0]._id;
  }
  if (!mongoose.isValidObjectId(storeId)) throw new Error("Store id valid na");
  const store = await Store.findById(storeId).select("name").lean();
  if (!store) throw new Error("Store pawa jayni");

  const days = period.days;
  console.log(`backfill store=${storeId} from=${period.from} to=${period.to} days=${days} tz=${REPORT_TIMEZONE}`);
  if (dryRun) {
    console.log("dry run — kichu lekha hoyni");
    return;
  }
  if (days > MAX_REBUILD_DAYS && delayMs === 0) {
    console.log("batching er jonno delay use korun (--delay=250)");
  }

  const all = listDayKeys(period.from, period.to);
  let done = 0;
  await rebuildRange(storeId, period.from, period.to, {
    delayMs,
    onProgress: (row) => {
      done += 1;
      if (done === 1 || done % 10 === 0 || done === all.length) {
        console.log(`rebuilt ${done}/${days} (${row.date})`);
      }
    },
  });
  console.log(`backfill complete: ${days} days`);
}

main()
  .catch((err) => {
    console.error("reports backfill failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
