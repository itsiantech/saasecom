process.env.JWT_SECRET = "storefront-url-secret";
process.env.STOREFRONT_URL = "http://localhost:3000";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Settings = require("../models/Settings");
const { storefrontUrl } = require("../lib/storefrontUrl");

let mongo;

before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri("storefront_url"));
  await Settings.init();
  await Settings.create({ key: "platformDomain", value: "localtest.me" });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test("a verified custom domain is the store's own site", async () => {
  const url = await storefrontUrl({
    slug: "shop-x", customDomain: "dukan.com", customDomainStatus: "verified",
  });
  assert.equal(url, "https://dukan.com/");
});

test("a claimed subdomain keeps the Next port from STOREFRONT_URL", async () => {
  const url = await storefrontUrl({ slug: "shop-x", subdomain: "amar-dokan" });
  assert.equal(url, "http://amar-dokan.localtest.me:3000/");
});

test("without a domain the folder address points at the themed site, not the legacy page", async () => {
  const url = await storefrontUrl({ slug: "rashanest" });
  assert.equal(url, "http://localhost:3000/?store=rashanest");
});
