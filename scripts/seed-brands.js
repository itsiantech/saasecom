require("dotenv").config();
const mongoose = require("mongoose");
const Brand = require("../models/Brand");
const Store = require("../models/Store");
const { slugify, uniqueSlug } = require("../lib/categoryHelpers");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const store = await Store.findOne().sort({ createdAt: 1 });
  if (!store) {
    console.log("Kono store nei — age `node scripts/seed-demo.js` chalun.");
    process.exit(1);
  }
  const storeId = store._id;
  console.log("Store:", store.name, "|", store.slug);

  async function make(name, parent, order, status = "published") {
    const slug = slugify(name);
    const exists = await Brand.findOne({ store: storeId, slug, parent: parent || null });
    if (exists) {
      console.log("  skip (ache):", name);
      return exists;
    }
    const parentDoc = parent ? await Brand.findById(parent) : null;
    const ancestors = parentDoc ? [...(parentDoc.ancestors || []), parentDoc._id] : [];
    const doc = await Brand.create({
      store: storeId,
      name,
      slug: await uniqueSlug(Brand, slug, storeId, null),
      parent: parent || null,
      ancestors,
      level: ancestors.length,
      order,
      status,
    });
    console.log("  created:", "  ".repeat(ancestors.length) + name);
    return doc;
  }

  console.log("Brands:");
  const nike = await make("Nike", null, 0);
  const running = await make("Running", nike._id, 0);
  await make("Trail", running._id, 0);
  await make("Basketball", nike._id, 1);

  const adidas = await make("Adidas", null, 1);
  await make("Originals", adidas._id, 0);

  await make("Local Brands", null, 2);

  console.log("Brand seed complete.");
  await mongoose.disconnect();
})();
