/* ==========================================================================
   Daily SaaS billing reminders — 09:00 Asia/Dhaka.
   The pass only *decides* and *enqueues*: no mail is sent from inside the
   loop. Every decision claims a BillingNotification row first, so two runs
   (or an overlapping deploy) can never mail one tenant twice per cycle.
   ========================================================================== */
const crypto = require("crypto");
const cron = require("node-cron");
const Subscription = require("../../models/Subscription");
const Store = require("../../models/Store");
// populate() needs these schemas registered even when the cron is required
// directly (standalone script / worker), not through the API routes.
require("../../models/Plan");
require("../../models/User");
const BillingNotification = require("../../models/BillingNotification");
const landingBranding = require("../../lib/landingBranding");
const { enqueueEmail, dhakaDayKey } = require("../queues/emailQueue");
const { renderEmail, money, formatDate } = require("../mail/templates");

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEZONE = "Asia/Dhaka";
const DEFAULT_CRON = "0 9 * * *";
const TRIAL_WARN_DAYS = [3, 1];
const OVERDUE_AFTER_DAYS = 3;

let started = false;
let task = null;

function suspendAfterDays() {
  const n = Number(process.env.BILLING_SUSPEND_AFTER_DAYS);
  return n >= OVERDUE_AFTER_DAYS ? n : 7;
}

function autoSuspendStores() {
  return process.env.BILLING_AUTO_SUSPEND === "true";
}

function appBaseUrl() {
  return String(process.env.APP_URL || process.env.PUBLIC_URL || "").replace(/\/+$/, "");
}

function isTrialing(sub) {
  return sub.status === "trial" || sub.status === "trialing";
}

// The date the next invoice is due. Falls back to period end for rows created
// before nextBillingDate existed.
function billingDateFor(sub) {
  if (sub.nextBillingDate) return new Date(sub.nextBillingDate);
  if (isTrialing(sub) && sub.trialEndsAt) return new Date(sub.trialEndsAt);
  return sub.endDate ? new Date(sub.endDate) : null;
}

// Calendar-day difference in Dhaka time (time-of-day must not skew it).
function dayNumber(date) {
  const [y, m, d] = dhakaDayKey(date).split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function calendarDaysBetween(from, to) {
  return dayNumber(to) - dayNumber(from);
}

function sameDhakaDay(a, b) {
  if (!a) return false;
  return dhakaDayKey(new Date(a)) === dhakaDayKey(new Date(b));
}

function cycleStamp(date) {
  return dhakaDayKey(date);
}

function billingReference(store, date) {
  const id = String(store._id || "").slice(-6).toUpperCase();
  return "BL-" + dhakaDayKey(date).replace(/-/g, "") + "-" + id;
}

function paymentUrl(store, plan) {
  const base = appBaseUrl();
  if (!base) return "";
  const planSlug = (plan && plan.slug) || "";
  return (
    base +
    "/plan-checkout.html?plan=" +
    encodeURIComponent(planSlug) +
    "&store=" +
    encodeURIComponent(String(store._id))
  );
}

function storeUrl(store) {
  const base = appBaseUrl();
  return base && store.slug ? base + "/" + encodeURIComponent(store.slug) : "";
}

// Pure decision function: (subscription, now) -> action | null.
function reminderFor(sub, now = new Date()) {
  if (!sub || !sub.store || sub.store.deletedAt) return null;
  if (["cancelled", "expired", "suspended"].includes(sub.status)) return null;
  if (sub.store.status === "suspended") return null;

  const store = sub.store;
  const plan = sub.plan && sub.plan.name ? sub.plan : null;
  const owner = store.owner && store.owner.email ? store.owner : null;
  if (!owner) return null;

  const planName = (plan && plan.name) || "";
  const common = {
    storeName: store.name,
    ownerName: owner.name || "ব্যবসার মালিক",
    planName,
    to: owner.email,
  };
  const cta = paymentUrl(store, plan || {});

  if (isTrialing(sub) && sub.trialEndsAt) {
    const trialEnd = new Date(sub.trialEndsAt);
    const daysLeft = calendarDaysBetween(now, trialEnd);
    if (TRIAL_WARN_DAYS.includes(daysLeft)) {
      const kind = daysLeft === 3 ? "trial_warning_3d" : "trial_warning_1d";
      return {
        kind,
        cycleKey: "trial:" + cycleStamp(trialEnd) + ":" + daysLeft + "d",
        ...common,
        heading: daysLeft === 3 ? "ট্রায়াল শেষ হচ্ছে" : "কালই ট্রায়াল শেষ",
        ctaUrl: cta,
        ctaLabel: "প্যাকেজ নিন",
        storeUrl: storeUrl(store),
        rows: [
          { label: "প্যাকেজ", value: planName || "—" },
          { label: "ট্রায়াল শেষ", value: formatDate(trialEnd) },
        ],
        paragraphs: [
          `আপনার ${store.name} দোকানের ${planName || "ট্রায়াল"} ট্রায়াল ${daysLeft === 3 ? "৩ দিন" : "১ দিন"} পরে শেষ হচ্ছে।`,
          "আপনার পণ্য, অর্ডার আর কাস্টমার — সব ঠিক থাকুক; ট্রায়াল শেষ হওয়ার আগে প্যাকেজ নিয়ে দোকান চালু রাখুন।",
        ],
        note: daysLeft === 1 ? "আজ রাতেই ট্রায়াল শেষ হবে — এখনই প্যাকেজ নিন।" : "",
        meta: { daysLeft, trialEndsAt: trialEnd },
      };
    }
  }

  const billingDate = billingDateFor(sub);
  if (!billingDate || Number.isNaN(billingDate.getTime())) return null;

  const todayKey = dhakaDayKey(now);
  const dueKey = dhakaDayKey(billingDate);

  if (todayKey === dueKey) {
    return {
      kind: "invoice",
      cycleKey: "invoice:" + dueKey,
      ...common,
      heading: "আপনার বিলিং ইনভয়েস",
      invoiceNo: billingReference(store, billingDate),
      amount: Number(plan ? plan.price : 0) || 0,
      cycleDays: Number(plan && plan.durationDays) || 30,
      ctaUrl: cta,
      ctaLabel: "পেমেন্ট করুন",
      storeUrl: storeUrl(store),
      rows: [
        { label: "ইনভয়েস", value: billingReference(store, billingDate) },
        { label: "প্যাকেজ", value: planName || "—" },
        { label: "বিলিং সময়কাল", value: (Number(plan && plan.durationDays) || 30) + " দিন" },
        { label: "পরিমাণ", value: money(plan ? plan.price : 0) },
        { label: "পরিশোধের তারিখ", value: formatDate(billingDate) },
      ],
      paragraphs: [
        `আপনার ${store.name} দোকানের ${planName || "প্যাকেজ"} এর নতুন বিলিং তারিখ আজ, ${formatDate(billingDate)}।`,
        "নিচের সারসংক্ষেপ দেখে পেমেন্ট করে দোকান চালু রাখুন। পেমেন্ট যাচাই হলেই মেয়াদ স্বয়ংক্রিয়ভাবে বাড়বে।",
      ],
      note: `পরিশোধ না হলে ${OVERDUE_AFTER_DAYS} দিন পর অ্যাকাউন্ট বকেয়া (past due) হিসেবে চিহ্নিত হবে।`,
      meta: { billingDate, amount: Number(plan ? plan.price : 0) || 0 },
    };
  }

  const overdueDays = calendarDaysBetween(billingDate, now);
  if (overdueDays < OVERDUE_AFTER_DAYS) return null;

  const suspendAt = suspendAfterDays();
  if (overdueDays < suspendAt) {
    return {
      kind: "overdue",
      cycleKey: "overdue:" + dueKey + ":" + OVERDUE_AFTER_DAYS + "d",
      ...common,
      heading: "পেমেন্ট বকেয়া আছে",
      amount: Number(plan ? plan.price : 0) || 0,
      ctaUrl: cta,
      ctaLabel: "এখনই পেমেন্ট করুন",
      storeUrl: storeUrl(store),
      rows: [
        { label: "বকেয়া পরিমাণ", value: money(plan ? plan.price : 0) },
        { label: "মূল পরিশোধের তারিখ", value: formatDate(billingDate) },
        { label: "বকেয়া", value: overdueDays + " দিন" },
      ],
      paragraphs: [
        `আপনার ${store.name} দোকানের পেমেন্ট ${overdueDays} দিন বকেয়া আছে।`,
        "পেমেন্ট সম্পন্ন করে দোকান সচল রাখুন।",
      ],
      note: `আর ${Math.max(0, suspendAt - overdueDays)} দিনের মধ্যে পেমেন্ট না হলে অ্যাকাউন্ট সাসপেন্ড করা হবে।`,
      meta: { billingDate, overdueDays },
    };
  }

  return {
    kind: "suspend",
    cycleKey: "suspend:" + dueKey,
    ...common,
    heading: "অ্যাকাউন্ট সাসপেন্ড করা হয়েছে",
    amount: Number(plan ? plan.price : 0) || 0,
    ctaUrl: cta,
    ctaLabel: "পেমেন্ট করে চালু করুন",
    storeUrl: storeUrl(store),
    rows: [
      { label: "বকেয়া পরিমাণ", value: money(plan ? plan.price : 0) },
      { label: "মূল পরিশোধের তারিখ", value: formatDate(billingDate) },
      { label: "বকেয়া", value: overdueDays + " দিন" },
    ],
    paragraphs: [
      `আপনার ${store.name} দোকানের পেমেন্ট ${suspendAt} দিনের বেশি বকেয়া থাকায় অ্যাকাউন্টটি সাসপেন্ড করা হয়েছে।`,
      "পেমেন্ট করে সাথে সাথে দোকান আবার চালু করতে পারবেন।",
    ],
    note: autoSuspendStores()
      ? "দোকানের ভিজিটরদের জন্য স্টোরফ্রন্টও বন্ধ করা হয়েছে — পেমেন্ট হলে আবার চালু হবে।"
      : "সাবস্ক্রিপশনটি সাসপেন্ড অবস্থায় আছে।",
    meta: { billingDate, overdueDays },
  };
}

function actionEmailData(action, brand) {
  return {
    brand,
    subject: action.subject || "",
    heading: action.heading || "",
    storeName: action.storeName,
    ownerName: action.ownerName,
    planName: action.planName,
    daysLeft: action.meta && action.meta.daysLeft,
    invoiceNo: action.invoiceNo || "",
    amount: action.amount ? money(action.amount) : "",
    paragraphs: action.paragraphs,
    rows: action.rows || [],
    note: action.note || "",
    ctaUrl: action.ctaUrl || "",
    ctaLabel: action.ctaLabel || "",
    storeUrl: action.storeUrl || "",
  };
}

async function loadSubscriptions() {
  return Subscription.find({ status: { $nin: ["cancelled", "expired", "suspended"] } })
    .populate({ path: "plan", select: "name slug price durationDays trialDays" })
    .populate({
      path: "store",
      select: "name slug status deletedAt owner",
      populate: { path: "owner", select: "name email" },
    });
}

async function applyBillingState(sub, action, now) {
  if (action.kind === "overdue") {
    sub.status = "past_due";
  } else if (action.kind === "suspend") {
    sub.status = "suspended";
    sub.billingSuspendedAt = now;
    if (autoSuspendStores()) {
      await Store.updateOne({ _id: sub.store._id, status: { $ne: "suspended" } }, { $set: { status: "suspended" } });
    }
  }
  await Subscription.updateOne(
    { _id: sub._id },
    {
      $set: {
        status: sub.status,
        lastNotifiedAt: now,
        ...(sub.billingSuspendedAt ? { billingSuspendedAt: sub.billingSuspendedAt } : {}),
      },
    }
  );
}

async function runBillingReminders({ now = new Date(), enqueue = enqueueEmail, dryRun = false } = {}) {
  const brandInfo = await landingBranding.getBranding();
  const brand = brandInfo.name || "LUXE";
  const subs = await loadSubscriptions();

  const summary = {
    scanned: subs.length,
    queued: 0,
    sent: 0,
    skipped: 0,
    deferred: 0,
    failed: 0,
    duplicates: 0,
    actions: [],
  };

  for (const sub of subs) {
    const action = reminderFor(sub, now);
    if (!action) continue;

    // hardened against a second pass on the same Dhaka day
    if (sameDhakaDay(sub.lastNotifiedAt, now)) {
      summary.duplicates += 1;
      continue;
    }

    const data = actionEmailData(action, brand);
    let subject;
    try {
      subject = renderEmail(action.kind, data).subject;
    } catch (err) {
      console.error("billing template render failed:", err.message);
      summary.failed += 1;
      continue;
    }

    if (dryRun) {
      summary.actions.push({ kind: action.kind, store: sub.store.slug, to: action.to, cycleKey: action.cycleKey });
      continue;
    }

    let row;
    try {
      row = await BillingNotification.create({
        store: sub.store._id,
        subscription: sub._id,
        kind: action.kind,
        cycleKey: action.cycleKey,
        to: action.to,
        subject,
        status: "queued",
        meta: { ...(action.meta || {}), invoiceNo: action.invoiceNo || "" },
      });
    } catch (err) {
      if (err && err.code === 11000) {
        summary.duplicates += 1;
        continue;
      }
      console.error("billing notification claim failed:", err.message);
      summary.failed += 1;
      continue;
    }

    try {
      const res = await enqueue({
        to: action.to,
        template: action.kind,
        data,
        subject,
        notificationId: row._id,
      });
      if (res && res.queued) {
        summary.queued += 1;
        if (res.jobId) await BillingNotification.updateOne({ _id: row._id }, { $set: { jobId: res.jobId } });
      } else if (res && res.deferred) {
        // inline mode has no queue: release the cycle row so tomorrow retries
        await row.deleteOne();
        summary.deferred += 1;
      } else if (res && res.skipped) {
        summary.skipped += 1;
      } else {
        summary.sent += 1;
      }
      await applyBillingState(sub, action, now);
      summary.actions.push({ kind: action.kind, store: sub.store.slug, to: action.to, cycleKey: action.cycleKey });
    } catch (err) {
      console.error("billing email enqueue failed:", String(sub.store && sub.store.slug), err.message);
      await row.deleteOne().catch(() => {});
      summary.failed += 1;
    }
  }

  return summary;
}

// Platform product update → every active tenant. Same queue, same cap, same
// dedupe (one broadcast per subject per Dhaka day).
async function broadcastToActiveTenants({ subject, title, body, ctaUrl, ctaLabel = "", now = new Date(), enqueue = enqueueEmail } = {}) {
  const text = String(subject || "").trim();
  if (!text) throw new Error("Broadcast subject lagbe");

  const brandInfo = await landingBranding.getBranding();
  const brand = brandInfo.name || "LUXE";
  const fingerprint = crypto.createHash("sha1").update(text).digest("hex").slice(0, 10);
  const cycleKey = "broadcast:" + dhakaDayKey(now) + ":" + fingerprint;

  const subs = await loadSubscriptions();
  const summary = { scanned: subs.length, queued: 0, sent: 0, duplicates: 0, failed: 0 };

  for (const sub of subs) {
    if (!sub.store || sub.store.deletedAt || sub.store.status === "suspended") continue;
    const owner = sub.store.owner;
    if (!owner || !owner.email) continue;

    const data = {
      brand,
      subject: text,
      heading: title || text,
      storeName: sub.store.name,
      ownerName: owner.name || "ব্যবসার মালিক",
      paragraphs: Array.isArray(body) ? body : [String(body || "")].filter(Boolean),
      rows: [],
      note: "",
      ctaUrl: ctaUrl || "",
      ctaLabel: ctaLabel,
    };

    let row;
    try {
      row = await BillingNotification.create({
        store: sub.store._id,
        subscription: sub._id,
        kind: "broadcast",
        cycleKey,
        to: owner.email,
        subject: text,
        status: "queued",
        meta: { fingerprint },
      });
    } catch (err) {
      if (err && err.code === 11000) {
        summary.duplicates += 1;
        continue;
      }
      throw err;
    }

    try {
      const res = await enqueue({ to: owner.email, template: "broadcast", data, subject: text, notificationId: row._id });
      if (res && res.queued) summary.queued += 1;
      else if (res && res.deferred) {
        await row.deleteOne();
        summary.queued += 0;
      } else summary.sent += 1;
    } catch (err) {
      console.error("broadcast enqueue failed:", sub.store.slug, err.message);
      await row.deleteOne().catch(() => {});
      summary.failed += 1;
    }
  }

  return summary;
}

function startBillingCron() {
  if (started) return task;
  const expression = process.env.BILLING_CRON || DEFAULT_CRON;
  if (expression === "off") return null;

  started = true;
  task = cron.schedule(
    expression,
    async () => {
      try {
        const summary = await runBillingReminders();
        console.log("billing reminders:", JSON.stringify(summary));
      } catch (err) {
        console.error("billing reminders failed:", err.message);
      }
    },
    { timezone: process.env.BILLING_TZ || TIMEZONE }
  );
  return task;
}

function stopBillingCron() {
  if (task) {
    task.stop();
    task.destroy && task.destroy();
  }
  task = null;
  started = false;
}

module.exports = {
  runBillingReminders,
  broadcastToActiveTenants,
  reminderFor,
  billingDateFor,
  paymentUrl,
  calendarDaysBetween,
  sameDhakaDay,
  startBillingCron,
  stopBillingCron,
  suspendAfterDays,
};
