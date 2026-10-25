/* ==========================================================================
   Migration / seed — Settings v2 (payment, login, checkout fields)
   Run once:  node scripts/migrate-settings-v2.js
   Idempotent: existing data ke overwrite kore na.
   ========================================================================== */
require("dotenv").config();
const mongoose = require("mongoose");

const Settings = require("../models/Settings");
const Store = require("../models/Store");
const ShippingManual = require("../models/ShippingManual");
const PaymentMobileManual = require("../models/PaymentMobileManual");
const PaymentGateway = require("../models/PaymentGateway");
const CheckoutField = require("../models/CheckoutField");
const { CHECKOUT_FIELDS, FIELD_KEYS } = require("../lib/checkoutFields");

// New setting keys — sudhu missing gulo insert hobe
const DEFAULTS = {
  cod_enabled: "true",
  cod_instruction: "Pay in cash when your order is delivered.",
  mobile_banking_enabled: "false",
  banking_enabled: "false",
  mobile_banking_ask_sender: "true",
  api_mobile_enabled: "false",
  api_banking_enabled: "false",
  login_registration_enabled: "false",
  login_email_enabled: "true",
  login_phone_enabled: "false",
};

async function migrateUserIndexes() {
  const users = mongoose.connection.db.collection("users");
  let indexes = [];
  try {
    indexes = await users.indexes();
  } catch {
    indexes = [];
  }

  const emailIdx = indexes.find((i) => i.name === "email_1");
  if (emailIdx && !emailIdx.sparse) {
    await users.dropIndex("email_1");
    console.log("· users.email_1 (old non-sparse) dropped");
  }

  await users.createIndex({ email: 1 }, { unique: true, sparse: true, name: "email_1" });
  await users.createIndex({ phone: 1 }, { unique: true, sparse: true, name: "phone_1" });
  console.log("✓ users indexes: email (sparse unique), phone (sparse unique)");
}

async function migrateSettings() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await Settings.updateOne(
      { key },
      { $setOnInsert: { key, value } },
      { upsert: true }
    );
  }
  console.log("✓ settings keys ensured (" + Object.keys(DEFAULTS).length + ")");
}

async function seedStore(store) {
  const storeId = store._id;

  if ((await ShippingManual.countDocuments({ store: storeId })) === 0) {
    await ShippingManual.insertMany([
      { store: storeId, areaName: "Inside Dhaka", amount: 60, sortOrder: 0 },
      { store: storeId, areaName: "Outside Dhaka", amount: 120, sortOrder: 1 },
    ]);
  }

  if ((await PaymentMobileManual.countDocuments({ store: storeId })) === 0) {
    await PaymentMobileManual.insertMany(
      ["bKash", "Nagad", "Upay"].map((name, i) => ({
        store: storeId,
        name,
        accountType: "Personal",
        number: "",
        instruction: "",
        sortOrder: i,
      }))
    );
  }

  if ((await PaymentGateway.countDocuments({ store: storeId })) === 0) {
    await PaymentGateway.insertMany([
      ...["bKash", "Nagad", "Upay"].map((name, i) => ({
        store: storeId, type: "mobile", name, mode: "sandbox", active: false, sortOrder: i,
      })),
      ...["SSLCommerz", "aamarPay"].map((name, i) => ({
        store: storeId, type: "bank", name, mode: "sandbox", active: false, sortOrder: i,
      })),
    ]);
  }

  if ((await CheckoutField.countDocuments({ store: storeId })) === 0) {
    await CheckoutField.insertMany(
      CHECKOUT_FIELDS.map((f, i) => ({
        store: storeId,
        fieldKey: f.key,
        isShown: f.shown,
        isRequired: f.required,
        label: f.label,
        sortOrder: FIELD_KEYS.indexOf(f.key),
      }))
    );
  }

  console.log("✓ store seeded:", store.name, "(" + store.slug + ")");
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI missing in .env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected:", mongoose.connection.name);

  await migrateUserIndexes();
  await migrateSettings();

  // model indexes (payment gateway / checkout field unique keys)
  await Promise.all([
    PaymentGateway.syncIndexes(),
    CheckoutField.syncIndexes(),
    PaymentMobileManual.syncIndexes(),
  ]);

  const stores = await Store.find().lean();
  for (const store of stores) await seedStore(store);

  console.log("\nMigration complete.");
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
