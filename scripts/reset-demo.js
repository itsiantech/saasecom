/* one-off cleanup: clear carts + restore demo stocks */
require("dotenv").config();
const mongoose = require("mongoose");
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const r = await mongoose.connection.db.collection("carts").deleteMany({});
  console.log("carts cleared:", r.deletedCount);
  const V = mongoose.connection.collection("productvariations");
  const S = mongoose.connection.collection("productswatches");
  await V.updateMany({}, { $set: { stock: 20 } });
  await S.updateMany({}, { $set: { stock: 10 } });
  console.log("stocks reset (variations=20, swatches=10)");
  process.exit(0);
});
