/* ==========================================================================
   Retail EMI daily job — reminder emails, overdue + late fee, and expiry of
   stale applications. Retail settings live in InstallmentSettings (not the
   wholesale WholesaleSettings the shipped scheduler reads), so this runs the
   same ideas over retail orders tagged installmentPlan.source === "retail".
   Every step is idempotent.
   ========================================================================== */
const InstallmentSettings = require("../models/InstallmentSettings");
const InstallmentApplication = require("../models/InstallmentApplication");
const OrderInstallment = require("../models/OrderInstallment");
const Order = require("../models/Order");
const Store = require("../models/Store");
const { sendTemplate } = require("../lib/mailer");
const { writeAudit } = require("../lib/audit");
const { esc } = require("../lib/emailTemplates");
const { fromPaisa } = require("../lib/money");
const { outstandingPaisa } = require("./installmentLedger");
const { lateFeeForInstallment } = require("./installmentSchedule");
const { releaseApplicationStock } = require("./retailInstallmentOrders");
const { purgeStoreDocuments } = require("./installmentDocuments");

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function money(paisa) {
  return "৳" + fromPaisa(Math.max(0, Number(paisa) || 0)).toLocaleString("en-US");
}

function reminderKindFor(row, reminderDays, now) {
  if (!row || row.status === "paid" || row.status === "cancelled") return null;
  if (outstandingPaisa(row) <= 0) return null;
  const due = new Date(row.dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const flags = row.remindersSent || {};
  if (now.getTime() >= due.getTime()) return flags.due ? null : "due";
  const days = (Array.isArray(reminderDays) ? reminderDays : []).filter((d) => Number.isFinite(Number(d)));
  const window = days.length ? Math.max(...days.map(Number)) : 0;
  if (window > 0 && now.getTime() >= addDays(due, -window).getTime()) {
    return flags.before ? null : "before";
  }
  return null;
}

function lateFor(row, lateFee, now) {
  if (!row || row.status === "paid" || row.status === "cancelled") return null;
  if (outstandingPaisa(row) <= 0) return null;
  const due = new Date(row.dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const graceDays = Math.max(0, Number(lateFee && lateFee.graceDays) || 0);
  if (now.getTime() <= addDays(due, graceDays).getTime()) return null;
  const feePaisa = lateFeeForInstallment({
    amountPaisa: row.amountPaisa,
    lateFeeType: (lateFee && lateFee.type) || "flat",
    // settings store plain percent; the schedule helper reads basis points
    lateFeeValue:
      (lateFee && lateFee.type) === "percent"
        ? Math.round((Number(lateFee && lateFee.percent) || 0) * 100)
        : Number(lateFee && lateFee.amountPaisa) || 0,
    graceDays,
    dueDate: due,
    now,
  });
  return { feePaisa };
}

function reminderContext({ order, installment, store }) {
  const due = new Date(installment.dueDate);
  return {
    store_name: esc((store && store.name) || "Store"),
    customer_name: esc(order.customerName || "Customer"),
    order_number: esc(order.orderNumber || ""),
    installment_number: installment.number,
    amount: money(installment.amountPaisa),
    outstanding: money(outstandingPaisa(installment)),
    late_fee: money(installment.lateFeePaisa),
    due_date: due.toLocaleDateString("en-GB"),
    account_link: "",
  };
}

async function sendNotice(sendTemplateFn, storeId, order, ctx, template) {
  if (!order.customerEmail) return { skipped: true };
  try {
    return await sendTemplateFn(storeId, template, ctx, order.customerEmail);
  } catch (err) {
    return { error: err.message };
  }
}

async function expireStaleApplications(storeId, settings, now, summary) {
  const days = Math.max(0, Number(settings.review && settings.review.autoRejectDays) || 0);
  if (days <= 0) return;
  const stale = await InstallmentApplication.find({
    store: storeId,
    order: null,
    status: { $in: ["pending_review", "info_requested"] },
    createdAt: { $lte: addDays(now, -days) },
  })
    .select("_id status stockReserved")
    .limit(100)
    .lean();

  for (const app of stale) {
    const updated = await InstallmentApplication.findOneAndUpdate(
      { _id: app._id, store: storeId, order: null, status: app.status },
      {
        $set: {
          status: "expired",
          "review.reviewedAt": now,
          "review.note": `Auto-expired after ${days} days`,
        },
      },
      { new: true }
    );
    if (!updated) continue;
    await releaseApplicationStock(app._id, storeId, "auto-expire");
    summary.applicationsExpired += 1;
    await writeAudit({
      store: storeId,
      action: "installment_application.expire",
      entity: "InstallmentApplication",
      entityId: app._id,
      oldValue: { status: app.status },
      newValue: { status: "expired", stockReleased: true },
    });
  }
}

async function runStore(settingsDoc, now, sendTemplateFn, summary) {
  const storeId = settingsDoc.store;
  if (!storeId) return;
  const settings = typeof settingsDoc.toObject === "function" ? settingsDoc.toObject() : settingsDoc;

  await expireStaleApplications(storeId, settings, now, summary);

  const orders = await Order.find({
    store: storeId,
    paymentMode: "installment",
    "installmentPlan.source": "retail",
    status: { $ne: "cancelled" },
  })
    .select("_id orderNumber customerName customerEmail")
    .lean();
  if (!orders.length) return;

  const orderMap = new Map(orders.map((order) => [String(order._id), order]));
  const store = await Store.findById(storeId).select("name slug").lean();
  const days = (Array.isArray(settings.reminderDays) ? settings.reminderDays : []).map(Number);
  const window = days.length ? Math.max(...days.filter((d) => Number.isFinite(d) && d >= 0), 0) : 0;

  const rows = await OrderInstallment.find({
    store: storeId,
    order: { $in: orders.map((order) => order._id) },
    status: { $in: ["pending", "overdue"] },
    dueDate: { $lte: addDays(now, window) },
  }).sort({ dueDate: 1 });

  if (rows.length) summary.scanned += rows.length;

  for (const row of rows) {
    const order = orderMap.get(String(row.order));
    if (!order) continue;
    let changed = false;

    const kind = reminderKindFor(row, days, now);
    if (kind) {
      const ctx = reminderContext({ order, installment: row, store });
      const sent = await sendNotice(sendTemplateFn, storeId, order, ctx, "installment_reminder");
      if (sent && sent.ok) summary.emails += 1;
      row.remindersSent = row.remindersSent || {};
      if (kind === "before") row.remindersSent.before = true;
      else row.remindersSent.due = true;
      changed = true;
      summary.reminders += 1;
    }

    const late = lateFor(row, settings.lateFee, now);
    if (late) {
      if (row.status !== "overdue" || Number(row.lateFeePaisa) !== late.feePaisa) {
        const wasOverdue = row.status === "overdue";
        const oldFee = Number(row.lateFeePaisa) || 0;
        row.status = "overdue";
        row.lateFeePaisa = late.feePaisa;
        changed = true;
        if (!wasOverdue) {
          summary.overdueMarked += 1;
          const ctx = reminderContext({ order, installment: row, store });
          const sent = await sendNotice(sendTemplateFn, storeId, order, ctx, "installment_overdue");
          if (sent && sent.ok) summary.emails += 1;
          await writeAudit({
            store: storeId,
            action: "installment.overdue",
            entity: "OrderInstallment",
            entityId: row._id,
            oldValue: { status: "pending", lateFeePaisa: oldFee },
            newValue: { status: "overdue", lateFeePaisa: late.feePaisa, order: String(row.order) },
          });
        }
      }
    }

    if (changed) await row.save();
  }
}

async function runRetailInstallmentScheduler({ now = new Date(), storeId = null, sendTemplateFn = sendTemplate } = {}) {
  // Document retention also applies to stores that switched EMI off later.
  const query = {};
  if (storeId) query.store = storeId;
  const settingsRows = await InstallmentSettings.find(query).lean();

  const summary = {
    stores: settingsRows.length,
    scanned: 0,
    reminders: 0,
    emails: 0,
    overdueMarked: 0,
    applicationsExpired: 0,
    documentsPurged: 0,
    documentFilesDeleted: 0,
    errors: 0,
  };

  for (const settings of settingsRows) {
    try {
      // Retention runs even when the module is switched off later — old
      // applications still must not keep scans forever.
      const purged = await purgeStoreDocuments(settings.store, { now });
      summary.documentsPurged += purged.pending + purged.expired;
      summary.documentFilesDeleted += purged.files;
      if (settings.enabled !== true) continue;
      await runStore(settings, now, sendTemplateFn, summary);
    } catch (err) {
      summary.errors += 1;
      console.error("retailInstallmentScheduler:", err.message);
    }
  }
  return summary;
}

module.exports = {
  reminderKindFor,
  runRetailInstallmentScheduler,
};
