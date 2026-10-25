const Order = require("../models/Order");
const OrderStatusHistory = require("../models/OrderStatusHistory");
const { writeAudit } = require("../lib/audit");
const { notifyOrderCancelled, notifyOrderStatus } = require("../lib/notify");
const { cancelInstallmentOrder } = require("./installmentCancel");

class OrderStatusError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Shared order status change — every path (single PATCH, bulk apply, PUT edit)
 * goes through here so history + audit + notifications behave the same.
 * Returns the updated (fresh) order document.
 */
async function changeOrderStatus({ orderId, toStatus, actor = {}, note = "" }) {
  if (!Order.schema.path("status").enumValues.includes(toStatus)) {
    throw new OrderStatusError("Status valid na");
  }

  const order = await Order.findById(orderId);
  if (!order) throw new OrderStatusError("Order pawa jayni", 404);
  const fromStatus = order.status;
  if (fromStatus === toStatus) return order; // no-op change

  order.status = toStatus;
  await order.save();

  // history entry (who, from, to, when) — best effort
  try {
    await OrderStatusHistory.create({
      order: order._id,
      store: order.store, // background writes have no tenant context — set explicitly
      fromStatus,
      toStatus,
      by: actor.id || null,
      byName: actor.name || "",
      note: note || "",
    });
  } catch {
    /* history failure must not block the status change */
  }

  await writeAudit({
    store: order.store,
    user: actor.id,
    action: "order.status_change",
    entity: "Order",
    entityId: order._id,
    oldValue: { status: fromStatus },
    newValue: { status: toStatus },
  });

  // notifications (best-effort, never block)
  if (toStatus === "cancelled") {
    notifyOrderCancelled(order).catch(() => {});
  } else {
    notifyOrderStatus(order).catch(() => {});
  }

  // installment orders: cancelling stops the remaining schedule + dues refund rules
  if (order.paymentMode === "installment" && toStatus === "cancelled") {
    try {
      await cancelInstallmentOrder({
        order,
        actorUserId: actor.id,
        reason: note || "Order cancelled by admin",
        previous: { status: fromStatus, paymentStatus: order.paymentStatus, dueAmount: order.dueAmount },
      });
    } catch (err) {
      console.error("installment cancel:", err.message);
    }
  }

  // reports refresh in the background; order flow must never wait on it
  try {
    require("./reportHooks").orderChanged(order);
  } catch (err) {
    console.error("report hook:", err.message);
  }

  return order;
}

module.exports = { changeOrderStatus, OrderStatusError };
