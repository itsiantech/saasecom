const test = require("node:test");
const assert = require("node:assert/strict");
const {
  InstallmentLedgerError,
  outstandingPaisa,
  applyPaymentToInstallment,
  orderPaymentState,
  goodsReleaseReached,
  nextOpenInstallment,
} = require("../services/installmentLedger");

function row(overrides = {}) {
  return {
    number: 1,
    amountPaisa: 10000,
    paidPaisa: 0,
    lateFeePaisa: 0,
    status: "pending",
    ...overrides,
  };
}

test("outstanding includes late fee and already-paid amount", () => {
  assert.equal(outstandingPaisa(row()), 10000);
  assert.equal(outstandingPaisa(row({ paidPaisa: 4000 })), 6000);
  assert.equal(outstandingPaisa(row({ paidPaisa: 4000, lateFeePaisa: 500 })), 6500);
  assert.equal(outstandingPaisa(row({ paidPaisa: 12000 })), 0);
});

test("full installment payment settles the row", () => {
  const installment = row({ lateFeePaisa: 500 });
  const applied = applyPaymentToInstallment(installment, 10500, new Date("2026-01-10T00:00:00Z"));
  assert.equal(applied.settled, true);
  assert.equal(applied.remainingPaisa, 0);
  assert.equal(installment.paidPaisa, 10500);
  assert.equal(installment.status, "paid");
  assert.ok(installment.paidAt instanceof Date);
});

test("partial payment keeps the installment open", () => {
  const installment = row({ status: "overdue" });
  const applied = applyPaymentToInstallment(installment, 3000);
  assert.equal(applied.settled, false);
  assert.equal(applied.remainingPaisa, 7000);
  assert.equal(installment.status, "overdue");
  assert.equal(installment.paidAt, undefined);
});

test("overpayment and double payment are refused", () => {
  assert.throws(
    () => applyPaymentToInstallment(row(), 10001),
    (err) => err instanceof InstallmentLedgerError && /beshi/.test(err.message)
  );
  assert.throws(
    () => applyPaymentToInstallment(row({ paidPaisa: 10000, status: "paid" }), 100),
    (err) => err instanceof InstallmentLedgerError && /age theke/.test(err.message)
  );
});

test("order payment state follows paid / total amounts", () => {
  assert.equal(orderPaymentState({ totalPaisa: 90000, paidPaisa: 0 }), "pending");
  assert.equal(orderPaymentState({ totalPaisa: 90000, paidPaisa: 30000 }), "partially_paid");
  assert.equal(orderPaymentState({ totalPaisa: 90000, paidPaisa: 90000 }), "paid");
});

test("goods release rules trigger at advance, half or full", () => {
  const half = { totalPaisa: 90000, paidPaisa: 45000 };
  assert.equal(goodsReleaseReached("after_advance", { totalPaisa: 90000, paidPaisa: 1 }), true);
  assert.equal(goodsReleaseReached("after_half", { totalPaisa: 90000, paidPaisa: 44999 }), false);
  assert.equal(goodsReleaseReached("after_half", half), true);
  assert.equal(goodsReleaseReached("after_full", half), false);
  assert.equal(goodsReleaseReached("after_full", { totalPaisa: 90000, paidPaisa: 90000 }), true);
});

test("next open installment is the lowest unpaid row", () => {
  const rows = [
    row({ number: 3, status: "pending" }),
    row({ number: 1, status: "paid", paidPaisa: 10000 }),
    row({ number: 2, status: "overdue" }),
  ];
  assert.equal(nextOpenInstallment(rows).number, 2);
  assert.equal(nextOpenInstallment([row({ status: "paid", paidPaisa: 10000 })]), null);
});
