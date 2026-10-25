require("dotenv").config();
const mongoose = require("mongoose");
const Category = require("../models/Category");
const Store = require("../models/Store");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // Get first store (demo store)
  const store = await Store.findOne().sort({ createdAt: 1 });
  if (!store) {
    console.log("No store found. Please create a store first.");
    process.exit(1);
  }

  console.log("Seeding categories for store:", store.name);

  // Clear existing categories for this store
  await Category.deleteMany({ store: store._id });
  console.log("Cleared existing categories");

  // Create sample category tree
  const menCat = await Category.create({
    store: store._id,
    name: "Men",
    slug: "men",
    parent: null,
    ancestors: [],
    level: 0,
    order: 0,
    icon: { type: "library", value: "fa-user" },
    status: "published",
  });

  const menShoes = await Category.create({
    store: store._id,
    name: "Shoes",
    slug: "men-shoes",
    parent: menCat._id,
    ancestors: [menCat._id],
    level: 1,
    order: 0,
    icon: { type: "library", value: "fa-shoe-prints" },
    status: "published",
  });

  await Category.create({
    store: store._id,
    name: "Sneakers",
    slug: "men-sneakers",
    parent: menShoes._id,
    ancestors: [menCat._id, menShoes._id],
    level: 2,
    order: 0,
    status: "published",
  });

  await Category.create({
    store: store._id,
    name: "Formal",
    slug: "men-formal-shoes",
    parent: menShoes._id,
    ancestors: [menCat._id, menShoes._id],
    level: 2,
    order: 1,
    status: "published",
  });

  const menClothing = await Category.create({
    store: store._id,
    name: "Clothing",
    slug: "men-clothing",
    parent: menCat._id,
    ancestors: [menCat._id],
    level: 1,
    order: 1,
    icon: { type: "library", value: "fa-shirt" },
    status: "published",
  });

  await Category.create({
    store: store._id,
    name: "T-Shirts",
    slug: "men-tshirts",
    parent: menClothing._id,
    ancestors: [menCat._id, menClothing._id],
    level: 2,
    order: 0,
    status: "published",
  });

  const womenCat = await Category.create({
    store: store._id,
    name: "Women",
    slug: "women",
    parent: null,
    ancestors: [],
    level: 0,
    order: 1,
    icon: { type: "library", value: "fa-user" },
    status: "published",
  });

  const womenShoes = await Category.create({
    store: store._id,
    name: "Shoes",
    slug: "women-shoes",
    parent: womenCat._id,
    ancestors: [womenCat._id],
    level: 1,
    order: 0,
    icon: { type: "library", value: "fa-shoe-prints" },
    status: "published",
  });

  await Category.create({
    store: store._id,
    name: "Heels",
    slug: "women-heels",
    parent: womenShoes._id,
    ancestors: [womenCat._id, womenShoes._id],
    level: 2,
    order: 0,
    status: "published",
  });

  const accessoriesCat = await Category.create({
    store: store._id,
    name: "Accessories",
    slug: "accessories",
    parent: null,
    ancestors: [],
    level: 0,
    order: 2,
    icon: { type: "library", value: "fa-gem" },
    status: "published",
  });

  await Category.create({
    store: store._id,
    name: "Watches",
    slug: "watches",
    parent: accessoriesCat._id,
    ancestors: [accessoriesCat._id],
    level: 1,
    order: 0,
    icon: { type: "library", value: "fa-clock" },
    status: "published",
  });

  await Category.create({
    store: store._id,
    name: "Bags",
    slug: "bags",
    parent: accessoriesCat._id,
    ancestors: [accessoriesCat._id],
    level: 1,
    order: 1,
    icon: { type: "library", value: "fa-bag-shopping" },
    status: "published",
  });

  // Add a draft category
  await Category.create({
    store: store._id,
    name: "New Arrivals",
    slug: "new-arrivals",
    parent: null,
    ancestors: [],
    level: 0,
    order: 3,
    status: "draft",
  });

  const total = await Category.countDocuments({ store: store._id });
  console.log(`✅ Created ${total} categories`);

  await mongoose.disconnect();
})();
