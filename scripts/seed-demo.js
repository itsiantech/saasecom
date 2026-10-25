require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Store = require("../models/Store");
const Product = require("../models/Product");
const Plan = require("../models/Plan");
const Subscription = require("../models/Subscription");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const hash = await bcrypt.hash("demo1234", 10);
  const user = await User.findOneAndUpdate(
    { email: "admin@test.com" },
    { $set: { name: "Demo Admin", password: hash, role: "admin" } },
    { returnDocument: "after", upsert: true }
  );
  console.log("DEMO USER:", user.name, "|", user.email, "|", user.role);

  // super admin — platform er malik (shob store/plan manage kore)
  const superHash = await bcrypt.hash("super1234", 10);
  const superAdmin = await User.findOneAndUpdate(
    { email: "superadmin@test.com" },
    { $set: { name: "Super Admin", password: superHash, role: "superadmin" } },
    { returnDocument: "after", upsert: true }
  );
  console.log("SUPER ADMIN:", superAdmin.name, "|", superAdmin.email, "|", superAdmin.role);

  // Create plans if not exist
  const freePlan = await Plan.findOneAndUpdate(
    { slug: "free" },
    {
      $set: {
        name: "Free",
        slug: "free",
        price: 0,
        durationDays: 30,
        trialDays: 0,
        limits: { products: 10, orders: 50, storageMB: 100, staffMembers: 1 },
        features: { customDomain: false, analytics: false, apiAccess: false, prioritySupport: false },
        active: true,
        order: 1,
      },
    },
    { returnDocument: "after", upsert: true }
  );
  console.log("FREE PLAN:", freePlan.name);

  const proPlan = await Plan.findOneAndUpdate(
    { slug: "pro" },
    {
      $set: {
        name: "Pro",
        slug: "pro",
        price: 29,
        durationDays: 30,
        trialDays: 14,
        limits: { products: 100, orders: 1000, storageMB: 1000, staffMembers: 5 },
        features: { customDomain: true, analytics: true, apiAccess: true, prioritySupport: false },
        active: true,
        order: 2,
      },
    },
    { returnDocument: "after", upsert: true }
  );
  console.log("PRO PLAN:", proPlan.name);

  let store = await Store.findOne({ slug: "demo-store" }).populate("plan");
  if (!store) {
    store = await Store.create({
      name: "Demo Store",
      slug: "demo-store",
      owner: user._id,
      plan: proPlan._id,
    });

    // Create subscription
    const now = new Date();
    const startDate = now;
    const endDate = new Date(now.getTime() + proPlan.durationDays * 24 * 60 * 60 * 1000);
    const trialEndsAt = proPlan.trialDays > 0
      ? new Date(now.getTime() + proPlan.trialDays * 24 * 60 * 60 * 1000)
      : null;

    const subscription = await Subscription.create({
      store: store._id,
      plan: proPlan._id,
      status: proPlan.trialDays > 0 ? "trial" : "active",
      startDate,
      endDate,
      trialEndsAt,
    });
    console.log("SUBSCRIPTION:", subscription.status);
  } else {
    // Update existing store plan reference
    if (!store.plan || String(store.plan._id) !== String(proPlan._id)) {
      await Store.findByIdAndUpdate(store._id, { plan: proPlan._id });
      console.log("STORE PLAN UPDATED");
    }
  }
  console.log("DEMO STORE:", store.name, "|", store.slug);

  // store jukto na emon product gulo demo store e dhukay deya
  const res = await Product.updateMany(
    { store: { $exists: false } },
    { $set: { store: store._id } }
  );
  console.log("PRODUCTS LINKED:", res.modifiedCount);

  await mongoose.disconnect();
})();
