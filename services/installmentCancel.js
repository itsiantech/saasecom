// Cancels an installment order: open installments close, pending payments are
// rejected, and verified payments follow the store's refund rule.
const WholesaleSettings = require("../models/WholesaleSettings");
const OrderInstallment = require("../models/OrderInstallment");
const Payment = require("../models/Payment");
const { refundableAmount } = require("./installmentSchedule");
const { writeAudit } = require("../lib/audit");

async function cancelInstallmentOrder({
  order,
  settings = null,
  actorUserId = null,
  reason = "",
  source = "admin",
  previous = null,
}) {
  if (!order) return { skipped: true, reason: "Order nei" };
  if (order.paymentMode !== "installment") return { skipped: true, reason: "Installment order na" };
  if (order.status === "cancelled" && order.paymentStatus === "cancelled") {
    return { skipped: true, reason: "Age theke cancelled" };
  }

  const storeId = order.store;
  const rule =
    settings ||
    (await WholesaleSettings.findOne({ store: storeId }).lean()) ||
    {};

  const paidPaisa = Math.max(0, Number(order.paidAmount) || 0);
  const refundPaisa = refundableAmount({
    paidPaisa,
    refundType: rule.refundType || "full",
    refundPercent: rule.refundPercent == null ? 100 : rule.refundPercent,
  });

  const oldStatus = previous || {
    status: order.status,
    paymentStatus: order.paymentStatus,
    dueAmount: order.dueAmount,
  };

  const cancelled = await OrderInstallment.updateMany(
    { order: order._id, status: { $in: ["pending", "overdue"] } },
    { $set: { status: "cancelled" } }
  );
  const rejected = await Payment.updateMany(
    { order: order._id, status: "pending" },
    { $set: { status: "rejected", note: "Order cancelled" } }
  );

  let refunded = { modifiedCount: 0 };
  if (refundPaisa > 0) {
    refunded = await Payment.updateMany(
      { order: order._id, status: "verified" },
      { $set: { status: "refunded", note: "Order cancelled — refund " + refundPaisa + " paisa" } }
    );
  }

  order.status = "cancelled";
  order.paymentStatus = "cancelled";
  order.dueAmount = 0;
  order.installmentPlan = {
    ...(order.installmentPlan || {}),
    cancellation: {
      at: new Date(),
      reason: String(reason || "Order cancelled").slice(0, 200),
      source,
      refundType: rule.refundType || "full",
      refundPercent: rule.refundPercent == null ? 100 : rule.refundPercent,
      refundPaisa,
    },
  };
  await order.save();

  // reports refresh in the background; refunds must never fail on it
  try {
    require("./reportHooks").refundRecorded(order);
  } catch (err) {
    console.error("report hook:", err.message);
  }

  await writeAudit({
    store: storeId,
    user: actorUserId,
    action: source === "scheduler" ? "installment.overdue_cancel" : "installment.order_cancel",
    entity: "Order",
    entityId: order._id,
    oldValue: oldStatus,
    newValue: {
      status: "cancelled",
      paymentStatus: "cancelled",
      cancelledInstallments: cancelled.modifiedCount,
      rejectedPayments: rejected.modifiedCount,
      refundedPayments: refunded.modifiedCount,
      refundPaisa,
    },
  });

  return {
    skipped: false,
    cancelledInstallments: cancelled.modifiedCount,
    rejectedPayments: rejected.modifiedCount,
    refundedPayments: refunded.modifiedCount,
    refundPaisa,
  };
}

module.exports = { cancelInstallmentOrder };
