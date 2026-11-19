/* ==========================================================================
   Standalone BullMQ worker for SaaS billing mail.
   Run it next to the API:  npm run worker   (pm2: rashacart-billing-worker)
   ========================================================================== */
require("dotenv").config();
const mongoose = require("mongoose");
const { startEmailWorker, closeEmailQueue, QUEUE_NAME } = require("./queues/emailQueue");

if (!process.env.REDIS_URL) {
  console.error("REDIS_URL nei — standalone billing worker cholbe na.");
  process.exit(1);
}
if (!process.env.MONGO_URI) {
  console.error("MONGO_URI nei — worker database e connect hote parbe na.");
  process.exit(1);
}

async function shutdown(signal) {
  console.log(`billing worker: ${signal} — bondho hocche...`);
  try {
    await closeEmailQueue();
  } finally {
    await mongoose.connection.close().catch(() => {});
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    startEmailWorker();
    console.log(`billing worker: queue "${QUEUE_NAME}" theke mail pathachhe`);
  })
  .catch((err) => {
    console.error("billing worker mongo error:", err.message);
    process.exit(1);
  });
