// Daily installment scheduler: 3-day/due reminders, overdue + late fee,
// then the store's overdue action (hold or cancel). All steps are idempotent.
const WholesaleSettings = require("../models/WholesaleSettings");
const OrderInstallment = require("../models/OrderInstallment");
const Order = require("../models/Order");
const Store = require("../models/Store");
const { sendTemplate } = require("../lib/mailer");
const { notifyOrderCancelled } = require("../lib/notify");
const { writeAudit } = require("../lib/audit");
const { esc } = require("../lib/emailTemplates");
const { fromPaisa } = require("../lib/money");
const { outstandingPaisa } = require("./installmentLedger");
const { lateFeeForInstallment } = require("./installmentSchedule");
const { cancelInstallmentOrder } = require("./installmentCancel");

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAYS = 3;

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function money(paisa) {
  return "৳" + fromPaisa(Math.max(0, Number(paisa) || 0)).toLocaleString("en-US");
}

// "before" inside the 3-day window, "due" on/after the due date; null when
// already paid/cancelled, nothing outstanding, or the reminder was sent.
function reminderKindFor(row, now = new Date()) {
  if (!row || row.status === "paid" || row.status === "cancelled") return null;
  if (outstandingPaisa(row) <= 0) return null;
  const due = new Date(row.dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const flags = row.remindersSent || {};
  if (now.getTime() >= due.getTime()) return flags.due ? null : "due";
  if (now.getTime() >= due.getTime() - REMINDER_DAYS * DAY_MS) {
    return flags.before ? null : "before";
  }
  return null;
}

// Late fee only starts after the grace period. The fee is absolute (never added
// on top of an existing fee), so running the scheduler twice is safe.
function lateStateFor(row, settings, now = new Date()) {
  const none = { overdue: false, lateFeePaisa: 0 };
  if (!row || !settings) return none;
  if (row.status === "paid" || row.status === "cancelled") return none;
  if (outstandingPaisa(row) <= 0) return none;
  const due = new Date(row.dueDate);
  if (Number.isNaN(due.getTime())) return none;
  const graceDays = Math.max(0, Number(settings.graceDays) || 0);
  if (now.getTime() <= addDays(due, graceDays).getTime()) return none;

  const lateFeePaisa = lateFeeForInstallment({
    amountPaisa: row.amountPaisa,
    lateFeeType: settings.lateFeeType || "flat",
    lateFeeValue: settings.lateFeePaisa || 0,
    graceDays,
    dueDate: due,
    now,
  });
  return { overdue: true, lateFeePaisa };
}

// Overdue action fires once the due date is more than `overdueDays` old.
function overdueActionDue({ dueDate, overdueDays, now = new Date() }) {
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const days = Math.max(0, Number(overdueDays) || 0);
  return now.getTime() >= addDays(due, days).getTime();
}

function accountUrlFor(store) {
  const base = String(process.env.APP_URL || "").replace(/\/+$/, "");
  if (!base || !store || !store.slug) return "";
  return base + "/account.html?store=" + encodeURIComponent(store.slug);
}

function reminderContext({ order, installment, store, accountUrl }) {
  const due = new Date(installment.dueDate);
  const link = accountUrl
    ? '<p style="margin:14px 0 0;"><a href="' +
      esc(accountUrl) +
      '" style="color:#c9a961;">Pay from your account</a></p>'
    : "";
  return {
    store_name: esc((store && store.name) || "Store"),
    customer_name: esc(order.customerName || "Customer"),
    order_number: esc(order.orderNumber || ""),
    installment_number: installment.number,
    amount: money(installment.amountPaisa),
    outstanding: money(outstandingPaisa(installment)),
    late_fee: money(installment.lateFeePaisa),
    due_date: due.toLocaleDateString("en-GB"),
    account_link: link,
  };
}

async function sendReminder(sendTemplateFn, storeId, order, ctx, kind) {
  if (!order.customerEmail) return { skipped: true, reason: "Customer email nei" };
  try {
    return await sendTemplateFn(storeId, "installment_reminder", ctx, order.customerEmail);
  } catch (err) {
    return { error: err.message };
  }
}

async function sendOverdueNotice(sendTemplateFn, storeId, order, ctx) {
  if (!order.customerEmail) return { skipped: true, reason: "Customer email nei" };
  try {
    return await sendTemplateFn(storeId, "installment_overdue", ctx, order.customerEmail);
  } catch (err) {
    return { error: err.message };
  }
}

async function runStore(settings, now, sendTemplateFn, summary) {
  const storeId = settings.store;
  if (!storeId) return;

  const [store, rows] = await Promise.all([
    Store.findById(storeId).select("name slug").lean(),
    OrderInstallment.find({
      store: storeId,
      status: { $in: ["pending", "overdue"] },
      dueDate: { $lte: addDays(now, REMINDER_DAYS) },
    }).sort({ dueDate: 1 }),
  ]);
  if (!rows.length) return;
  summary.scanned += rows.length;

  const orderIds = [...new Set(rows.map((row) => String(row.order)))];
  const orders = await Order.find({ _id: { $in: orderIds }, store: storeId }).lean();
  const orderMap = new Map(orders.map((order) => [String(order._id), order]));
  const accountUrl = accountUrlFor(store);

  for (const row of rows) {
    const order = orderMap.get(String(row.order));
    if (!order || order.paymentMode !== "installment" || order.status === "cancelled") continue;

    let changed = false;
    const kind = reminderKindFor(row, now);
    if (kind) {
      const ctx = reminderContext({ order, installment: row, store, accountUrl });
      const sent = await sendReminder(sendTemplateFn, storeId, order, ctx, kind);
      if (sent && sent.ok) summary.emails += 1;
      if (order.customerEmail) {
        if (kind === "before") row.remindersSent.before = true;
        else row.remindersSent.due = true;
        changed = true;
      }
      summary.reminders += 1;
    }

    const late = lateStateFor(row, settings, now);
    if (late.overdue) {
      const wasOverdue = row.status === "overdue";
      if (!wasOverdue) {
        const oldLateFee = Number(row.lateFeePaisa) || 0;
        row.status = "overdue";
        row.lateFeePaisa = late.lateFeePaisa;
        row.remindersSent.due = true;
        changed = true;
        summary.overdueMarked += 1;

        const ctx = reminderContext({ order, installment: row, store, accountUrl });
        const sent = await sendOverdueNotice(sendTemplateFn, storeId, order, ctx);
        if (sent && sent.ok) summary.emails += 1;

        await writeAudit({
          store: storeId,
          action: "installment.overdue",
          entity: "OrderInstallment",
          entityId: row._id,
          oldValue: { status: "pending", lateFeePaisa: oldLateFee },
          newValue: {
            status: "overdue",
            lateFeePaisa: late.lateFeePaisa,
            dueDate: row.dueDate,
            order: String(row.order),
          },
        });
      } else if (Number(row.lateFeePaisa) !== late.lateFeePaisa) {
        row.lateFeePaisa = late.lateFeePaisa;
        changed = true;
      }
    }

    if (changed) await row.save();
  }

  const actionRows = new Map();
  for (const row of rows) {
    if (row.status !== "overdue") continue;
    if (outstandingPaisa(row) <= 0) continue;
    if (!overdueActionDue({ dueDate: row.dueDate, overdueDays: settings.overdueDays, now })) continue;
    const key = String(row.order);
    if (!actionRows.has(key)) actionRows.set(key, []);
    actionRows.get(key).push(row);
  }

  for (const [orderId, overdueRows] of actionRows) {
    const order = await Order.findById(orderId);
    if (!order || order.status === "cancelled") continue;

    if (settings.overdueAction === "cancel") {
      const result = await cancelInstallmentOrder({
        order,
        settings,
        source: "scheduler",
        reason: "Overdue installments (" + overdueRows.length + ")",
      });
      if (!result.skipped) {
        summary.cancelled += 1;
        notifyOrderCancelled(order).catch(() => {});
      }
      continue;
    }

    if (order.paymentStatus !== "overdue") {
      const oldStatus = order.paymentStatus;
      order.paymentStatus = "overdue";
      await order.save();
      summary.held += 1;
      await writeAudit({
        store: storeId,
        action: "installment.overdue_hold",
        entity: "Order",
        entityId: order._id,
        oldValue: { paymentStatus: oldStatus },
        newValue: {
          paymentStatus: "overdue",
          overdueInstallments: overdueRows.map((row) => row.number),
        },
      });
    }
  }
}

async function runInstallmentScheduler({ now = new Date(), storeId = null, sendTemplateFn = sendTemplate } = {}) {
  const query = { enabled: true, partialPaymentEnabled: true };
  if (storeId) query.store = storeId;
  const settingsRows = await WholesaleSettings.find(query).lean();

  const summary = {
    stores: settingsRows.length,
    scanned: 0,
    reminders: 0,
    emails: 0,
    overdueMarked: 0,
    held: 0,
    cancelled: 0,
    errors: 0,
  };

  for (const settings of settingsRows) {
    try {
      await runStore(settings, now, sendTemplateFn, summary);
    } catch (err) {
      summary.errors += 1;
      console.error("installmentScheduler:", err.message);
    }
  }
  return summary;
}

function startInstallmentScheduler({ intervalMs = DAY_MS, initialDelayMs = 30000 } = {}) {
  const initial = setTimeout(() => {
    runInstallmentScheduler().catch((err) => console.error("installmentScheduler:", err.message));
  }, initialDelayMs);
  if (initial.unref) initial.unref();

  const timer = setInterval(() => {
    runInstallmentScheduler().catch((err) => console.error("installmentScheduler:", err.message));
  }, intervalMs);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  REMINDER_DAYS,
  reminderKindFor,
  lateStateFor,
  overdueActionDue,
  runInstallmentScheduler,
  startInstallmentScheduler,
};
