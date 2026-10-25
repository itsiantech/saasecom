// Installment schedule math. Every amount is integer paisa and the leftover
// paisa from equal splitting always goes to the last installment.

class InstallmentError extends Error {
  constructor(message) {
    super(message);
    this.name = "InstallmentError";
    this.status = 400;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function readAmount(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new InstallmentError(`${label} valid paisa integer hote hobe`);
  }
  return n;
}

function readBasisPoints(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 10000) {
    throw new InstallmentError(`${label} 0 theke 100% er moddhe hote hobe`);
  }
  return n;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

// Splits an integer amount into equal parts; the leftover paisa goes to the last part.
function splitAmount(totalPaisa, parts) {
  const total = readAmount(totalPaisa, "Amount");
  const count = Number(parts);
  if (!Number.isInteger(count) || count < 1) {
    throw new InstallmentError("Installment count valid hote hobe");
  }
  const equalShare = Math.floor(total / count);
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? total - equalShare * (count - 1) : equalShare
  );
}

function buildSchedule({
  itemsAmountPaisa,
  shippingAmountPaisa = 0,
  plan,
  chargeShippingInFirst = true,
  startDate = new Date(),
}) {
  if (!plan || typeof plan !== "object") throw new InstallmentError("Installment plan lagbe");

  const items = readAmount(itemsAmountPaisa, "Order amount");
  const shipping = readAmount(shippingAmountPaisa, "Shipping amount");
  const count = Number(plan.installmentsCount);
  if (!Number.isInteger(count) || count < 2 || count > 60) {
    throw new InstallmentError("Installment count 2 theke 60 er moddhe hote hobe");
  }
  const gapDays = Number(plan.gapDays);
  if (!Number.isInteger(gapDays) || gapDays < 0 || gapDays > 365) {
    throw new InstallmentError("Gap days 0-365 er moddhe hote hobe");
  }

  let advance;
  if (plan.advanceType === "fixed") {
    advance = readAmount(plan.advanceValue, "Advance amount");
    if (advance > items) throw new InstallmentError("Advance order amount er cheye beshi hote parbe na");
  } else {
    const basisPoints = readBasisPoints(plan.advanceValue, "Advance percent");
    advance = Math.round((items * basisPoints) / 10000);
  }

  const feeType = plan.feeType || "none";
  const feeValue = readAmount(plan.feeValue || 0, "Fee");
  let fee = 0;
  if (feeType === "percent") {
    fee = Math.round(((items - advance) * readBasisPoints(feeValue, "Fee percent")) / 10000);
  } else if (feeType === "fixed") {
    fee = feeValue;
  }

  const first = advance + (chargeShippingInFirst ? shipping : 0);
  const restTotal = items - advance + fee + (chargeShippingInFirst ? 0 : shipping);
  const restCount = count - 1;
  const restAmounts = splitAmount(restTotal, restCount);
  const amounts = [first, ...restAmounts];

  const schedule = amounts.map((amountPaisa, index) => ({
    number: index + 1,
    amountPaisa,
    dueDate: addDays(startDate, index * gapDays),
    status: "pending",
  }));

  const expected = items + shipping + fee;
  const actual = schedule.reduce((sum, row) => sum + row.amountPaisa, 0);
  if (actual !== expected) throw new InstallmentError("Installment schedule total mismatch");

  return schedule;
}

function lateFeeForInstallment({
  amountPaisa,
  lateFeeType = "flat",
  lateFeeValue = 0,
  graceDays = 0,
  dueDate,
  now = new Date(),
}) {
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) throw new InstallmentError("Due date valid na");
  const graceEnd = new Date(due.getTime() + Math.max(0, Number(graceDays) || 0) * DAY_MS);
  if (now.getTime() <= graceEnd.getTime()) return 0;

  const amount = readAmount(amountPaisa, "Installment amount");
  const value = readAmount(lateFeeValue, "Late fee");
  if (lateFeeType === "percent") {
    const basisPoints = readBasisPoints(value, "Late fee percent");
    return Math.round((amount * basisPoints) / 10000);
  }
  return value;
}

function refundableAmount({ paidPaisa, refundType = "full", refundPercent = 100 }) {
  const paid = readAmount(paidPaisa, "Paid amount");
  if (refundType === "none") return 0;
  if (refundType === "percent") {
    const percent = Math.min(100, Math.max(0, Number(refundPercent) || 0));
    return Math.round((paid * percent) / 100);
  }
  return paid;
}

module.exports = {
  InstallmentError,
  buildSchedule,
  splitAmount,
  lateFeeForInstallment,
  refundableAmount,
};
