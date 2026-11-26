/* ==========================================================================
   PayGate settlement — turns a signature-verified PayGate event (or a poll of
   the hosted payment) into an approved PlatformPayment. Approval always goes
   through lib/billingApproval.approvePayment, so an auto-approved store is
   created by exactly the same code path a superadmin click uses.
   ========================================================================== */
const PlatformPayment = require("../models/PlatformPayment");
const billing = require("./platformBilling");
const { approvePayment } = require("./billingApproval");

// PayGate reports Taka (amount_poisha / 100 on its side); compare whole poisha
// so a 990 vs 990.00 float never blocks a real payment.
function amountPoisha(value) {
  return Math.round((Number(value) || 0) * 100);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function cleanPhone(value) {
  return String(value || "").replace(/[\s-]/g, "").slice(0, 20);
}

/* Only rows created through the hosted checkout may be auto-approved — a
 * manual bKash claim still waits for a human to match the TRXID. */
async function findPaygateRow(platformPaymentId) {
  const payment = await PlatformPayment.findById(platformPaymentId);
  if (!payment) throw httpError(404, "পেমেন্ট খুঁজে পাওয়া যায়নি");
  if (payment.gateway !== "paygate") throw httpError(400, "এই পেমেন্ট PayGate দিয়ে হয়নি");
  return payment;
}

function applyPaygateFields(payment, pg, eventId) {
  const device = String(pg.device_type || "").toLowerCase();
  payment.paygateId = String(pg.id || payment.paygateId || "");
  payment.paygateStatus = String(pg.status || "");
  if (device === "bkash" || device === "nagad") payment.paygateDeviceType = device;
  payment.paygatePaidAt = pg.paid_at ? new Date(pg.paid_at) : new Date();
  if (eventId) payment.paygateEventId = String(eventId);
  const sender = cleanPhone(pg.sender_number);
  if (sender) payment.senderNumber = sender;
  const trx = String(pg.trx_id || "").trim().slice(0, 40);
  if (trx) {
    payment.trxid = trx;
    payment.trxKey = billing.trxKey(payment.paygateDeviceType || payment.method || "bkash", trx);
  }
}

/* Signed success -> approved. Idempotent: PayGate retries the same event and a
 * duplicate must be acknowledged, not applied twice. */
async function settlePayment({ platformPaymentId, paygatePayment, eventId }) {
  const payment = await findPaygateRow(platformPaymentId);
  if (payment.status === "approved") return { payment, already: true };
  if (payment.status !== "pending") return { payment, skipped: true };
  if (!paygatePayment || paygatePayment.status !== "success") {
    throw httpError(409, "PayGate পেমেন্ট এখনো সফল হয়নি");
  }
  if (amountPoisha(paygatePayment.amount) !== amountPoisha(payment.amount)) {
    throw httpError(400, "PayGate-এর অঙ্ক ইনভয়েসের সাথে মিলছে না");
  }
  const meta = paygatePayment.metadata || {};
  if (meta.platformPaymentId && String(meta.platformPaymentId) !== String(payment._id)) {
    throw httpError(400, "PayGate metadata অন্য পেমেন্টের সাথে মিশেছে");
  }

  applyPaygateFields(payment, paygatePayment, eventId);
  if (payment.paygateDeviceType) {
    payment.method = payment.paygateDeviceType;
    payment.methodLabel = billing.METHOD_LABELS[payment.paygateDeviceType] || payment.paygateDeviceType;
  } else if (payment.method === "paygate") {
    payment.methodLabel = billing.METHOD_LABELS.paygate;
  }

  try {
    await payment.save();
  } catch (err) {
    // This TrxID was already claimed by hand. Money stays visible as a rejected
    // row instead of quietly buying a second subscription.
    if (err && err.code === 11000) {
      payment.trxid = "";
      payment.trxKey = undefined;
      payment.status = "rejected";
      payment.rejectReason = "এই TrxID আগেই অন্য পেমেন্টে দাবি করা হয়েছে — PayGate অটো-অনুমোদন বন্ধ রাখা হয়েছে।";
      payment.decidedAt = new Date();
      await payment.save();
      return { payment, rejected: true };
    }
    throw err;
  }

  try {
    const out = await approvePayment({ paymentId: payment._id, adminId: null });
    return { payment: out.payment, store: out.store, subscription: out.subscription };
  } catch (err) {
    // A parallel poll/webhook won the race — treat it as settled.
    if (err && (err.status === 409 || err.code === 11000)) {
      return { payment: (await PlatformPayment.findById(payment._id)) || payment, already: true };
    }
    throw err;
  }
}

/* Hosted payment expired or the buyer cancelled — close the row so the user
 * can start a fresh checkout instead of being stuck on "যাচাইয়ের অপেক্ষায়". */
async function rejectUnpaidPayment({ platformPaymentId, paygatePayment, reason }) {
  const payment = await findPaygateRow(platformPaymentId);
  if (payment.status === "approved") return { payment, already: true };
  if (payment.status !== "pending") return { payment, skipped: true };

  const status = String((paygatePayment && paygatePayment.status) || "");
  const text =
    String(reason || "").trim() ||
    (status === "cancelled"
      ? "চেকআউট বাতিল করা হয়েছে — আবার পেমেন্ট করুন।"
      : "PayGate-এর সময় শেষ, পেমেন্ট পাওয়া যায়নি — আবার পেমেন্ট করুন।");

  payment.paygateStatus = status || payment.paygateStatus;
  if (paygatePayment && paygatePayment.id) payment.paygateId = String(paygatePayment.id);
  payment.status = "rejected";
  payment.rejectReason = text.slice(0, 300);
  payment.decidedAt = new Date();
  await payment.save();
  return { payment, rejected: true };
}

module.exports = { settlePayment, rejectUnpaidPayment, amountPoisha, applyPaygateFields };
