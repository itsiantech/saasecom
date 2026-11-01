/* ==========================================================================
   Approving / rejecting a platform payment. Approval is the only place a paid
   store gets created or upgraded, so the status flip is claimed atomically
   before any store work starts.
   ========================================================================== */
const Store = require("../models/Store");
const Plan = require("../models/Plan");
const PlatformPayment = require("../models/PlatformPayment");
const { createStoreWithSubscription, applyPlanToStore } = require("./storeProvisioning");

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function approvePayment({ paymentId, adminId }) {
  const payment = await PlatformPayment.findById(paymentId);
  if (!payment) throw httpError(404, "পেমেন্ট পাওয়া যায়নি");
  if (payment.status === "approved") throw httpError(409, "এই পেমেন্ট আগেই অনুমোদিত");
  if (payment.status !== "pending") throw httpError(409, "শুধু যাচাইয়ের অপেক্ষায় থাকা পেমেন্ট অনুমোদন করা যায়");

  const claimed = await PlatformPayment.findOneAndUpdate(
    { _id: payment._id, status: "pending" },
    { $set: { status: "approved", decidedBy: adminId, decidedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!claimed) throw httpError(409, "এই পেমেন্ট অন্য কেউ আগেই প্রসেস করেছেন");

  try {
    const plan = await Plan.findById(claimed.plan);
    if (!plan) throw httpError(400, "প্যাকেজটি আর নেই — পেমেন্ট বাতিল করুন");

    let store;
    let subscription;
    if (claimed.store) {
      store = await Store.findById(claimed.store);
      if (!store) throw httpError(404, "দোকানটি আর নেই — পেমেন্ট বাতিল করুন");
      subscription = await applyPlanToStore({ store, plan, startedAt: new Date(), extend: true });
    } else {
      ({ store, subscription } = await createStoreWithSubscription({
        ownerId: claimed.user,
        name: claimed.storeName,
        slug: claimed.storeSlug,
        plan,
        startedAt: new Date(),
      }));
      claimed.store = store._id;
      claimed.storeSlug = store.slug;
      claimed.slugAdjusted = store.slug !== payment.storeSlug;
    }

    claimed.nextDueDate = subscription.endDate;
    await claimed.save();
    return { payment: claimed, store, subscription };
  } catch (err) {
    // store create na hole row abar pending-e — double-approve bondho, retry kora jabe
    await PlatformPayment.updateOne(
      { _id: claimed._id, status: "approved", decidedBy: adminId },
      { $set: { status: "pending", decidedBy: null, decidedAt: null } }
    );
    throw err;
  }
}

async function rejectPayment({ paymentId, adminId, reason }) {
  const text = String(reason || "").trim().slice(0, 300);
  if (text.length < 3) throw httpError(400, "বাতিলের কারণ লিখুন");

  const row = await PlatformPayment.findOneAndUpdate(
    { _id: paymentId, status: "pending" },
    { $set: { status: "rejected", rejectReason: text, decidedBy: adminId, decidedAt: new Date() }, $unset: { trxKey: "" } },
    { returnDocument: "after" }
  );
  if (!row) throw httpError(409, "এই পেমেন্ট এখন যাচাইয়ের অপেক্ষায় নেই");
  return row;
}

module.exports = { approvePayment, rejectPayment };
