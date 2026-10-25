const Payment = require("../models/Payment");
const Order = require("../models/Order");
const OrderInstallment = require("../models/OrderInstallment");
const { toPaisa } = require("../lib/money");
const { writeAudit } = require("../lib/audit");
const {
  InstallmentLedgerError,
  applyPaymentToInstallment,
  orderPaymentState,
  goodsReleaseReached,
  nextOpenInstallment,
} = require("./installmentLedger");

class InstallmentPaymentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "InstallmentPaymentError";
    this.status = status;
  }
}

function paymentOldValue(payment) {
  return {
    status: payment.status,
    installment: payment.installment ? String(payment.installment) : null,
    amountPaisa: payment.amountPaisa,
  };
}

// Marks a pending payment verified, applies it to its installment, and refreshes order totals.
async function verifyPendingPayment({
  paymentId,
  actorUserId = null,
  source = "admin",
  expectedAmountPaisa = null,
}) {
  const payment = await Payment.findOne({ _id: paymentId, status: "pending" });
  if (!payment) throw new InstallmentPaymentError("Pending payment pawa jayni");

  if (expectedAmountPaisa != null && Number(expectedAmountPaisa) !== Number(payment.amountPaisa)) {
    throw new InstallmentPaymentError("Payment amount milche na");
  }

  const order = await Order.findById(payment.order);
  if (!order) throw new InstallmentPaymentError("Order pawa jayni");
  if (order.paymentMode !== "installment") {
    throw new InstallmentPaymentError("Ei payment installment order er na");
  }
  if (order.status === "cancelled" || order.paymentStatus === "cancelled") {
    throw new InstallmentPaymentError("Cancelled order er payment verify kora jay na");
  }

  let installment = payment.installment
    ? await OrderInstallment.findOne({ _id: payment.installment, order: order._id })
    : null;
  if (!installment) {
    const rows = await OrderInstallment.find({ order: order._id }).sort({ number: 1 });
    installment = nextOpenInstallment(rows);
  }
  if (!installment) throw new InstallmentPaymentError("Order e kono due installment nei");

  const before = paymentOldValue(payment);
  const beforeInstallment = {
    paidPaisa: installment.paidPaisa,
    status: installment.status,
  };

  let applied;
  try {
    applied = applyPaymentToInstallment(installment, payment.amountPaisa);
  } catch (err) {
    if (err instanceof InstallmentLedgerError) {
      throw new InstallmentPaymentError(err.message, err.status || 400);
    }
    throw err;
  }

  if (!payment.installment) payment.installment = installment._id;
  payment.status = "verified";
  payment.verifiedBy = actorUserId || null;
  payment.verifiedAt = new Date();

  const totalPaisa = toPaisa(order.totalAmount);
  const paidPaisa = (Number(order.paidAmount) || 0) + Number(payment.amountPaisa);
  order.paidAmount = paidPaisa;
  order.dueAmount = Math.max(0, totalPaisa - paidPaisa);
  order.paymentStatus = orderPaymentState({ totalPaisa, paidPaisa });

  const releaseRule =
    (order.installmentPlan && order.installmentPlan.goodsReleaseRule) || "after_advance";
  const released =
    order.status === "pending" && goodsReleaseReached(releaseRule, { totalPaisa, paidPaisa });
  if (released) order.status = "confirmed";

  await installment.save();
  await payment.save();
  await order.save();

  await writeAudit({
    store: order.store,
    user: actorUserId,
    action: source === "webhook" ? "installment.payment_webhook_verify" : "installment.payment_verify",
    entity: "Payment",
    entityId: payment._id,
    oldValue: { ...before, installment: beforeInstallment },
    newValue: {
      status: "verified",
      amountPaisa: payment.amountPaisa,
      installment: String(installment._id),
      installmentPaidPaisa: installment.paidPaisa,
      installmentStatus: installment.status,
      orderPaidPaisa: order.paidAmount,
      orderDuePaisa: order.dueAmount,
      orderPaymentStatus: order.paymentStatus,
      orderStatus: order.status,
    },
  });

  return { payment, order, installment, applied, released };
}

async function rejectPendingPayment({ paymentId, actorUserId = null, note = "" }) {
  const payment = await Payment.findOne({ _id: paymentId, status: "pending" });
  if (!payment) throw new InstallmentPaymentError("Pending payment pawa jayni");

  payment.status = "rejected";
  payment.note = String(note || "Admin rejected").slice(0, 300);
  await payment.save();

  await writeAudit({
    store: payment.store,
    user: actorUserId,
    action: "installment.payment_reject",
    entity: "Payment",
    entityId: payment._id,
    oldValue: { status: "pending" },
    newValue: { status: "rejected", note: payment.note },
  });

  return payment;
}

module.exports = {
  InstallmentPaymentError,
  verifyPendingPayment,
  rejectPendingPayment,
};
