require("dotenv").config();
const mongoose = require("mongoose");
const Store = require("../models/Store");
const { applyStarterPack, listPacks } = require("../services/starterPack");

// Parse command line arguments
const args = process.argv.slice(2);
const storeSlug = args.find((arg) => arg.startsWith("--store="))?.split("=")[1];
const packName = args.find((arg) => arg.startsWith("--pack="))?.split("=")[1];
const listPacksFlag = args.includes("--list");

async function main() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✓ Connected to MongoDB");

    // List packs if requested
    if (listPacksFlag) {
      const packs = listPacks();
      console.log("\nAvailable Starter Packs:");
      packs.forEach((pack) => {
        console.log(`  - ${pack.name}: ${pack.displayName}`);
        console.log(`    ${pack.description}`);
        console.log(`    Version: ${pack.version}`);
      });
      process.exit(0);
    }

    // Validate arguments
    if (!storeSlug) {
      console.error("Error: --store=<slug> is required");
      console.log("\nUsage:");
      console.log("  npm run seed:pack -- --store=<slug> --pack=<pack>");
      console.log("  npm run seed:pack -- --list");
      console.log("\nExamples:");
      console.log("  npm run seed:pack -- --store=myshop --pack=fashion");
      console.log("  npm run seed:pack -- --list");
      process.exit(1);
    }

    if (!packName) {
      console.error("Error: --pack=<pack> is required");
      console.log("\nAvailable packs:");
      const packs = listPacks();
      packs.forEach((pack) => {
        console.log(`  - ${pack.name}`);
      });
      process.exit(1);
    }

    // Find store by slug
    const store = await Store.findOne({ slug: storeSlug.toLowerCase() });
    if (!store) {
      console.error(`Error: Store "${storeSlug}" not found`);
      process.exit(1);
    }

    console.log(`\nApplying starter pack "${packName}" to store "${store.name}" (${store.slug})...`);

    // Apply starter pack
    const result = await applyStarterPack(store._id, packName, { skipPlanLimits: true });

    if (result.success) {
      console.log("\n✓ Starter pack applied successfully!");
      console.log("\nCreated items:");
      console.log(`  - Categories: ${result.counts.categories}`);
      console.log(`  - Products: ${result.counts.products}`);
      console.log(`  - Hero Slides: ${result.counts.heroSlides}`);
      console.log(`  - Brands: ${result.counts.brands}`);
      if (result.skipped) {
        console.log("\nNote: Demo data already existed for this store (idempotent)");
      }
      process.exit(0);
    } else {
      console.error("\n✗ Failed to apply starter pack:");
      console.error(`  ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error("\n✗ Error:", error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();
