const test = require("node:test");
const assert = require("node:assert/strict");
const {
  REMINDER_DAYS,
  reminderKindFor,
  lateStateFor,
  overdueActionDue,
} = require("../services/installmentScheduler");

const NOW = new Date("2026-02-10T12:00:00.000Z");

function row(overrides = {}) {
  return {
    number: 2,
    amountPaisa: 30000,
    paidPaisa: 0,
    lateFeePaisa: 0,
    status: "pending",
    dueDate: new Date("2026-02-12T12:00:00.000Z"),
    remindersSent: { before: false, due: false },
    ...overrides,
  };
}

const SETTINGS = {
  graceDays: 3,
  lateFeeType: "flat",
  lateFeePaisa: 5000,
  overdueDays: 7,
};

test("reminder window is 3 days before the due date", () => {
  assert.equal(REMINDER_DAYS, 3);
  const fourDaysOut = row({ dueDate: new Date("2026-02-14T12:00:00.001Z") });
  assert.equal(reminderKindFor(fourDaysOut, NOW), null);

  const threeDaysOut = row({ dueDate: new Date("2026-02-13T12:00:00.000Z") });
  assert.equal(reminderKindFor(threeDaysOut, NOW), "before");

  const dueNow = row({ dueDate: new Date("2026-02-10T12:00:00.000Z") });
  assert.equal(reminderKindFor(dueNow, NOW), "due");

  const pastDue = row({ dueDate: new Date("2026-02-01T12:00:00.000Z") });
  assert.equal(reminderKindFor(pastDue, NOW), "due");
});

test("reminders are not repeated and skip closed rows", () => {
  assert.equal(
    reminderKindFor(row({ remindersSent: { before: true, due: false } }), NOW),
    null
  );
  assert.equal(
    reminderKindFor(row({ remindersSent: { before: false, due: true }, dueDate: new Date("2026-02-01") }), NOW),
    null
  );
  assert.equal(reminderKindFor(row({ status: "paid", paidPaisa: 30000 }), NOW), null);
  assert.equal(reminderKindFor(row({ status: "cancelled" }), NOW), null);
  assert.equal(reminderKindFor(row({ paidPaisa: 30000 }), NOW), null);
});

test("late fee starts only after the grace period", () => {
  const inside = row({ dueDate: new Date("2026-02-01T00:00:00.000Z") });
  const exactlyGraceEnd = lateStateFor(inside, SETTINGS, new Date("2026-02-04T00:00:00.000Z"));
  assert.deepEqual(exactlyGraceEnd, { overdue: false, lateFeePaisa: 0 });

  const afterGrace = lateStateFor(inside, SETTINGS, new Date("2026-02-04T00:00:00.001Z"));
  assert.deepEqual(afterGrace, { overdue: true, lateFeePaisa: 5000 });
});

test("percent late fee is computed on the installment amount", () => {
  const state = lateStateFor(
    row({ dueDate: new Date("2026-02-01T00:00:00.000Z") }),
    { ...SETTINGS, graceDays: 0, lateFeeType: "percent", lateFeePaisa: 200 },
    new Date("2026-02-02T00:00:00.000Z")
  );
  assert.deepEqual(state, { overdue: true, lateFeePaisa: 600 });
});

test("paid and cancelled installments never get a late fee", () => {
  const dueDate = new Date("2026-02-01T00:00:00.000Z");
  assert.deepEqual(lateStateFor(row({ dueDate, status: "paid", paidPaisa: 30000 }), SETTINGS, NOW), {
    overdue: false,
    lateFeePaisa: 0,
  });
  assert.deepEqual(lateStateFor(row({ dueDate, status: "cancelled" }), SETTINGS, NOW), {
    overdue: false,
    lateFeePaisa: 0,
  });
  assert.deepEqual(lateStateFor(row({ dueDate, paidPaisa: 30000 }), SETTINGS, NOW), {
    overdue: false,
    lateFeePaisa: 0,
  });
});

test("late fee is absolute, so a second scheduler run does not stack fees", () => {
  const first = lateStateFor(row({ dueDate: new Date("2026-02-01T00:00:00.000Z") }), SETTINGS, NOW);
  const second = lateStateFor(
    row({ dueDate: new Date("2026-02-01T00:00:00.000Z"), status: "overdue", lateFeePaisa: first.lateFeePaisa }),
    SETTINGS,
    NOW
  );
  assert.equal(second.lateFeePaisa, first.lateFeePaisa);
});

test("overdue action fires after overdueDays from the due date", () => {
  const dueDate = new Date("2026-02-01T00:00:00.000Z");
  assert.equal(overdueActionDue({ dueDate, overdueDays: 7, now: new Date("2026-02-07T23:59:59.999Z") }), false);
  assert.equal(overdueActionDue({ dueDate, overdueDays: 7, now: new Date("2026-02-08T00:00:00.000Z") }), true);
  assert.equal(overdueActionDue({ dueDate, overdueDays: 0, now: dueDate }), true);
});

test("overpayment including late fee is still refused by the ledger", () => {
  const { applyPaymentToInstallment } = require("../services/installmentLedger");
  const installment = row({ status: "overdue", lateFeePaisa: 5000 });
  assert.throws(
    () => applyPaymentToInstallment(installment, 35001),
    /beshi/
  );
  const applied = applyPaymentToInstallment(installment, 35000);
  assert.equal(applied.settled, true);
  assert.equal(installment.status, "paid");
});
