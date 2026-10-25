/* one-off: remove test products/orders/tags created during development */
require("dotenv").config();
const mongoose = require("mongoose");

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const db = mongoose.connection.db;
  const titles = ["Browser Polo Shirt", "Cart Test P", "Embedded Dashboard Product"];
  const products = await db.collection("products").find({ title: { $in: titles } }).toArray();
  const ids = products.map((p) => p._id);

  if (ids.length) {
    await db.collection("productvariations").deleteMany({ product: { $in: ids } });
    await db.collection("productswatches").deleteMany({ product: { $in: ids } });
    await db.collection("producttags").deleteMany({ product: { $in: ids } });
    await db.collection("productcategories").deleteMany({ product: { $in: ids } });
    await db.collection("products").deleteMany({ _id: { $in: ids } });
  }
  console.log("test products removed:", ids.length);

  const ord = await db.collection("orders").deleteMany({ orderNumber: { $regex: "^ORD-" } });
  console.log("test orders removed:", ord.deletedCount);

  // orphan tags (kono product e reference nai)
  const used = new Set((await db.collection("producttags").find({}).toArray()).map((t) => String(t.tag)));
  const tags = await db.collection("tags").find({}).toArray();
  const orphan = tags.filter((t) => !used.has(String(t._id))).map((t) => t._id);
  if (orphan.length) await db.collection("tags").deleteMany({ _id: { $in: orphan } });
  console.log("orphan tags removed:", orphan.length);

  const carts = await db.collection("carts").deleteMany({});
  console.log("carts cleared:", carts.deletedCount);
  process.exit(0);
});
