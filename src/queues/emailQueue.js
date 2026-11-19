/* ==========================================================================
   SaaS billing email queue.
   - BullMQ queue "saas-billing-notifications" over REDIS_URL
   - worker: 10 mails/sec, 3 attempts, exponential backoff
   - daily send cap (Brevo free tier = 280) spread across days: once the cap
     is hit the job is re-queued for the next 09:00 Asia/Dhaka run
   - no REDIS_URL (local dev / tests) → inline send with an in-memory cap, so
     the app still boots and the cron still works
   ========================================================================== */
const { Queue, Worker } = require("bullmq");
const IORedis = require("ioredis");
const BillingNotification = require("../../models/BillingNotification");
const { sendPlatformMail } = require("../mail/platformMailer");
const { renderEmail } = require("../mail/templates");

const QUEUE_NAME = "saas-billing-notifications";
const DEFAULT_DAILY_CAP = 280;
const TIMEZONE = "Asia/Dhaka";
// Dhaka has no DST: a fixed +06:00 offset keeps the schedule arithmetic simple.
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
};

let queue = null;
let worker = null;
let connection = null;
const memoryUsage = new Map();

function redisUrl() {
  return String(process.env.REDIS_URL || "").trim();
}

function queueEnabled() {
  return Boolean(redisUrl());
}

function getConnection() {
  if (connection) return connection;
  connection = new IORedis(redisUrl(), {
    // BullMQ blocks on BRPOPLPUSH, so ioredis must not fail fast
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  connection.on("error", (err) => console.error("email queue redis:", err.message));
  return connection;
}

function getQueue() {
  if (!queueEnabled()) return null;
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: JOB_OPTIONS,
    });
  }
  return queue;
}

function dailyCap() {
  const n = Number(process.env.SAAS_EMAIL_DAILY_CAP);
  return n > 0 ? n : DEFAULT_DAILY_CAP;
}

// en-CA renders YYYY-MM-DD
function dhakaDayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function counterKey(date = new Date()) {
  return "saas-billing:cap:" + dhakaDayKey(date);
}

// Next 09:00 Asia/Dhaka strictly after `now` — where overflow jobs park.
function nextDailyRunAt(now = new Date(), hour = Number(process.env.BILLING_HOUR) || 9) {
  const local = new Date(now.getTime() + DHAKA_OFFSET_MS);
  let target =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, 0, 0) -
    DHAKA_OFFSET_MS;
  if (target <= now.getTime()) target += 24 * 60 * 60 * 1000;
  return new Date(target);
}

async function tryConsumeSlot(now = new Date()) {
  const cap = dailyCap();
  if (!queueEnabled()) {
    const key = counterKey(now);
    const used = memoryUsage.get(key) || 0;
    if (used >= cap) return { allowed: false, used, cap };
    memoryUsage.set(key, used + 1);
    return { allowed: true, used: used + 1, cap };
  }

  const redis = getConnection();
  const key = counterKey(now);
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, 3 * 24 * 60 * 60);
  return { allowed: used <= cap, used, cap };
}

async function markNotification(notificationId, result) {
  if (!notificationId) return;
  const skipped = Boolean(result && result.skipped);
  const patch = skipped
    ? { status: "skipped", lastError: (result && result.reason) || "skipped" }
    : { status: "sent", sentAt: new Date(), lastError: "" };
  await BillingNotification.updateOne(
    { _id: notificationId },
    { $set: patch, $inc: { attempts: 1 } }
  ).catch((err) => console.error("billing notification update:", err.message));
}

async function deliver({ to, template, data, subject, notificationId }) {
  const rendered = renderEmail(template, data || {});
  const result = await sendPlatformMail({
    to,
    subject: subject || rendered.subject,
    html: rendered.html,
  });
  await markNotification(notificationId, result);
  return result;
}

// No Redis: send straight away, still capped per day.
async function sendInline(payload, now = new Date()) {
  const slot = await tryConsumeSlot(now);
  if (!slot.allowed) return { deferred: true, reason: "daily-cap", cap: slot.cap };
  const result = await deliver(payload);
  return { inline: true, ...result };
}

async function enqueueEmail(payload) {
  if (!queueEnabled()) return sendInline(payload);
  const job = await getQueue().add(payload.template, payload, JOB_OPTIONS);
  return { queued: true, jobId: String(job.id) };
}

async function processJob(job) {
  const payload = job.data || {};
  const slot = await tryConsumeSlot(new Date());
  if (!slot.allowed) {
    const when = nextDailyRunAt(new Date());
    // re-queue for tomorrow instead of burning a retry attempt
    if (queueEnabled()) {
      await getQueue().add(job.name, payload, {
        ...JOB_OPTIONS,
        delay: Math.max(1000, when.getTime() - Date.now()),
      });
    }
    return { deferred: true, until: when.toISOString(), cap: slot.cap };
  }

  const result = await deliver(payload);
  if (result.skipped) console.warn("billing mail skipped:", result.reason, payload.to || "");
  return { ok: true, skipped: Boolean(result.skipped), messageId: result.messageId || null };
}

function startEmailWorker() {
  if (worker) return worker;
  if (!queueEnabled()) return null;

  worker = new Worker(QUEUE_NAME, processJob, {
    connection: getConnection(),
    concurrency: Number(process.env.SAAS_EMAIL_CONCURRENCY) || 4,
    limiter: { max: 10, duration: 1000 },
  });

  worker.on("error", (err) => console.error("email worker error:", err.message));
  worker.on("failed", async (job, err) => {
    console.error("billing email job failed:", job && job.id, err && err.message);
    const notificationId = job && job.data && job.data.notificationId;
    if (!notificationId) return;
    const attempts = (job.attemptsMade || 0) + 1;
    const max = (job.opts && job.opts.attempts) || 1;
    try {
      if (attempts >= max) {
        // release the cycle row so tomorrow's cron can retry this tenant
        await BillingNotification.deleteOne({ _id: notificationId });
      } else {
        await BillingNotification.updateOne(
          { _id: notificationId },
          { $set: { status: "queued", lastError: err.message }, $inc: { attempts: 1 } }
        );
      }
    } catch (e) {
      console.error("billing notification failure update:", e.message);
    }
  });

  return worker;
}

async function closeEmailQueue() {
  try {
    if (worker) await worker.close();
  } catch {
    /* already closed */
  }
  try {
    if (queue) await queue.close();
  } catch {
    /* already closed */
  }
  try {
    if (connection) await connection.quit();
  } catch {
    /* already closed */
  }
  worker = null;
  queue = null;
  connection = null;
}

// tests: in-memory cap reset
function resetInlineState() {
  memoryUsage.clear();
}

module.exports = {
  QUEUE_NAME,
  JOB_OPTIONS,
  queueEnabled,
  getQueue,
  getConnection,
  dailyCap,
  dhakaDayKey,
  counterKey,
  nextDailyRunAt,
  tryConsumeSlot,
  enqueueEmail,
  processJob,
  startEmailWorker,
  closeEmailQueue,
  resetInlineState,
};
