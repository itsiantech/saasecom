// Installment ledger math. Amounts are integer paisa; nothing here touches Mongo.

class InstallmentLedgerError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "InstallmentLedgerError";
    this.status = status;
  }
}

function outstandingPaisa(installment) {
  const amount = Number(installment && installment.amountPaisa) || 0;
  const lateFee = Number(installment && installment.lateFeePaisa) || 0;
  const paid = Number(installment && installment.paidPaisa) || 0;
  return Math.max(0, amount + lateFee - paid);
}

// Mutates the installment. Partial payments stay open; overpayment is refused.
function applyPaymentToInstallment(installment, amountPaisa, now = new Date()) {
  const amount = Number(amountPaisa);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new InstallmentLedgerError("Payment amount valid paisa hote hobe");
  }
  const due = outstandingPaisa(installment);
  if (due === 0) throw new InstallmentLedgerError("Ei installment age theke porishodh hoye geche");
  if (amount > due) {
    throw new InstallmentLedgerError("Payment amount installment er baki taka er cheye beshi");
  }

  installment.paidPaisa = (Number(installment.paidPaisa) || 0) + amount;
  const remaining = due - amount;

  if (remaining === 0) {
    installment.status = "paid";
    installment.paidAt = now;
  } else {
    installment.status = installment.status === "overdue" ? "overdue" : "pending";
  }

  return { paidPaisa: installment.paidPaisa, remainingPaisa: remaining, settled: remaining === 0 };
}

function orderPaymentState({ totalPaisa, paidPaisa }) {
  const total = Math.max(0, Number(totalPaisa) || 0);
  const paid = Math.max(0, Number(paidPaisa) || 0);
  if (total === 0) return paid > 0 ? "paid" : "pending";
  if (paid >= total) return "paid";
  return paid > 0 ? "partially_paid" : "pending";
}

function goodsReleaseReached(rule, { totalPaisa, paidPaisa }) {
  const total = Math.max(0, Number(totalPaisa) || 0);
  const paid = Math.max(0, Number(paidPaisa) || 0);
  if (rule === "after_full") return total > 0 && paid >= total;
  if (rule === "after_half") return total > 0 && paid * 2 >= total;
  return paid > 0;
}

// Oldest open installment first — used when a payment has no explicit link.
function nextOpenInstallment(installments) {
  return (installments || [])
    .filter((row) => row.status !== "paid" && row.status !== "cancelled")
    .filter((row) => outstandingPaisa(row) > 0)
    .sort((a, b) => Number(a.number) - Number(b.number))[0] || null;
}

module.exports = {
  InstallmentLedgerError,
  outstandingPaisa,
  applyPaymentToInstallment,
  orderPaymentState,
  goodsReleaseReached,
  nextOpenInstallment,
};
