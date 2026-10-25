const InstallmentPlan = require("../models/InstallmentPlan");
const Order = require("../models/Order");
const OrderInstallment = require("../models/OrderInstallment");
const Payment = require("../models/Payment");
const User = require("../models/User");
const { buildSchedule } = require("./installmentSchedule");
const { fromPaisa } = require("../lib/money");

class InstallmentCheckoutError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "InstallmentCheckoutError";
    this.status = status;
  }
}

function snapshotPlan(plan, settings) {
  return {
    plan: plan._id,
    name: plan.name,
    installmentsCount: plan.installmentsCount,
    advanceType: plan.advanceType,
    advanceValue: plan.advanceValue,
    gapDays: plan.gapDays,
    minOrderAmountPaisa: plan.minOrderAmountPaisa,
    feeType: plan.feeType,
    feeValue: plan.feeValue,
    shippingInFirstInstallment: settings.shippingInFirstInstallment !== false,
    goodsReleaseRule: settings.goodsReleaseRule,
  };
}

// Validates buyer + plan rules and builds the immutable schedule snapshot.
async function prepareInstallmentCheckout({
  storeId,
  user,
  settings,
  planId,
  itemsAmountPaisa,
  shippingAmountPaisa = 0,
  startDate = new Date(),
}) {
  if (!settings || settings.enabled !== true || settings.partialPaymentEnabled !== true) {
    throw new InstallmentCheckoutError("Partial payment ekhon active nei");
  }
  if (!user || !user.id) {
    throw new InstallmentCheckoutError("Installment order dite age login korun", 401);
  }

  const buyer = await User.findById(user.id).select("phone wholesaleApproved");
  if (!buyer) throw new InstallmentCheckoutError("Buyer account pawa jayni", 401);
  if (!buyer.phone) {
    throw new InstallmentCheckoutError("Installment order er jonno account e phone number lagbe");
  }
  if (settings.installmentBuyers === "approved" && buyer.wholesaleApproved !== true) {
    throw new InstallmentCheckoutError("Approved wholesale buyer holei installment order dite parben", 403);
  }

  if (!planId) throw new InstallmentCheckoutError("Installment plan select korun");
  const plan = await InstallmentPlan.findOne({ _id: planId, store: storeId, isActive: true });
  if (!plan) throw new InstallmentCheckoutError("Installment plan pawa jayni ba active nei");

  const items = Number(itemsAmountPaisa);
  if (!Number.isInteger(items) || items <= 0) {
    throw new InstallmentCheckoutError("Order amount valid na");
  }
  const minOrder = Number(plan.minOrderAmountPaisa) || 0;
  if (items < minOrder) {
    throw new InstallmentCheckoutError(
      `Ei plan er minimum order ${fromPaisa(minOrder).toLocaleString("en-US")} taka`
    );
  }

  const maxOpen = Number(settings.maxOpenInstallmentOrders) || 0;
  if (maxOpen > 0) {
    const openOrders = await Order.countDocuments({
      customer: user.id,
      paymentMode: "installment",
      status: { $nin: ["cancelled", "delivered"] },
      dueAmount: { $gt: 0 },
    });
    if (openOrders >= maxOpen) {
      throw new InstallmentCheckoutError(
        `Ekjon buyer er ek sathe ${maxOpen} ti installment order cholte pare`
      );
    }
  }

  const schedule = buildSchedule({
    itemsAmountPaisa: items,
    shippingAmountPaisa,
    plan,
    chargeShippingInFirst: settings.shippingInFirstInstallment !== false,
    startDate,
  });
  const totalPaisa = schedule.reduce((sum, row) => sum + row.amountPaisa, 0);
  const feePaisa = totalPaisa - items - (Number(shippingAmountPaisa) || 0);
  const planSnapshot = snapshotPlan(plan, settings);
  planSnapshot.totalPaisa = totalPaisa;
  planSnapshot.firstPaisa = schedule[0].amountPaisa;
  planSnapshot.feePaisa = feePaisa;

  return {
    plan,
    planSnapshot,
    schedule,
    totalPaisa,
    firstPaisa: schedule[0].amountPaisa,
    remainingPaisa: totalPaisa - schedule[0].amountPaisa,
    feePaisa,
    buyerPhone: buyer.phone,
  };
}

// Schedule rows + the first-installment payment row (still pending admin verification).
async function createInstallmentRecords({ storeId, order, checkout, payment }) {
  const installments = await OrderInstallment.insertMany(
    checkout.schedule.map((row) => ({
      store: storeId,
      order: order._id,
      plan: checkout.plan._id,
      planName: checkout.plan.name,
      number: row.number,
      amountPaisa: row.amountPaisa,
      dueDate: row.dueDate,
      status: "pending",
    }))
  );

  let initialPayment = null;
  if (checkout.firstPaisa > 0) {
    initialPayment = await Payment.create({
      store: storeId,
      order: order._id,
      installment: installments[0]._id,
      method: payment.method,
      methodLabel: payment.methodLabel || payment.method,
      senderNumber: payment.senderNumber || "",
      trxId: payment.transactionId || "",
      amountPaisa: checkout.firstPaisa,
      status: "pending",
      note: "First installment",
    });
  }

  return { installments, payment: initialPayment };
}

module.exports = {
  InstallmentCheckoutError,
  snapshotPlan,
  prepareInstallmentCheckout,
  createInstallmentRecords,
};
