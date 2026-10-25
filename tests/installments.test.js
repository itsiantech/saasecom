const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSchedule,
  splitAmount,
  lateFeeForInstallment,
  refundableAmount,
} = require("../services/installmentSchedule");

const PLAN_B = {
  installmentsCount: 3,
  advanceType: "percent",
  advanceValue: 4000, // 40%
  gapDays: 10,
  feeType: "none",
  feeValue: 0,
};

test("100000 paisa split in 3: leftover goes to the last installment", () => {
  assert.deepEqual(splitAmount(100000, 3), [33333, 33333, 33334]);
});

test("Plan B: 40% advance then 30% + 30%", () => {
  const schedule = buildSchedule({ itemsAmountPaisa: 100000, plan: PLAN_B });
  assert.deepEqual(
    schedule.map((row) => row.amountPaisa),
    [40000, 30000, 30000]
  );
  assert.equal(
    schedule.reduce((sum, row) => sum + row.amountPaisa, 0),
    100000
  );
});

test("rest split leftover goes to the last installment", () => {
  const schedule = buildSchedule({
    itemsAmountPaisa: 100001,
    plan: { ...PLAN_B, gapDays: 0 },
  });
  assert.deepEqual(
    schedule.map((row) => row.amountPaisa),
    [40000, 30000, 30001]
  );
});

test("shipping can be charged in the first installment", () => {
  const withShippingFirst = buildSchedule({
    itemsAmountPaisa: 100000,
    shippingAmountPaisa: 5000,
    plan: PLAN_B,
    chargeShippingInFirst: true,
  });
  assert.deepEqual(
    withShippingFirst.map((row) => row.amountPaisa),
    [45000, 30000, 30000]
  );

  const shippingLater = buildSchedule({
    itemsAmountPaisa: 100000,
    shippingAmountPaisa: 5000,
    plan: PLAN_B,
    chargeShippingInFirst: false,
  });
  assert.deepEqual(
    shippingLater.map((row) => row.amountPaisa),
    [40000, 32500, 32500]
  );
});

test("installment fee percent is added to the financed remainder", () => {
  const schedule = buildSchedule({
    itemsAmountPaisa: 100000,
    plan: { ...PLAN_B, feeType: "percent", feeValue: 500 }, // 5% of 60,000
  });
  assert.deepEqual(
    schedule.map((row) => row.amountPaisa),
    [40000, 31500, 31500]
  );
  assert.equal(
    schedule.reduce((sum, row) => sum + row.amountPaisa, 0),
    103000
  );
});

test("due dates follow the configured gap", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const schedule = buildSchedule({ itemsAmountPaisa: 100000, plan: PLAN_B, startDate: start });
  assert.deepEqual(
    schedule.map((row) => row.dueDate.toISOString().slice(0, 10)),
    ["2026-01-01", "2026-01-11", "2026-01-21"]
  );
});

test("rejects advance greater than the order amount", () => {
  assert.throws(
    () =>
      buildSchedule({
        itemsAmountPaisa: 10000,
        plan: { ...PLAN_B, advanceType: "fixed", advanceValue: 20000 },
      }),
    /Advance/
  );
});

test("late fee after grace period (flat and percent)", () => {
  const now = new Date("2026-02-01T00:00:00.000Z");
  const overdueDue = new Date("2026-01-20T00:00:00.000Z");

  assert.equal(
    lateFeeForInstallment({
      amountPaisa: 30000,
      lateFeeType: "flat",
      lateFeeValue: 500,
      graceDays: 3,
      dueDate: overdueDue,
      now,
    }),
    500
  );

  assert.equal(
    lateFeeForInstallment({
      amountPaisa: 30000,
      lateFeeType: "percent",
      lateFeeValue: 200, // 2%
      graceDays: 3,
      dueDate: overdueDue,
      now,
    }),
    600
  );
});

test("no late fee inside the grace period", () => {
  const now = new Date("2026-02-01T00:00:00.000Z");
  assert.equal(
    lateFeeForInstallment({
      amountPaisa: 30000,
      lateFeeType: "flat",
      lateFeeValue: 500,
      graceDays: 3,
      dueDate: new Date("2026-01-31T00:00:00.000Z"),
      now,
    }),
    0
  );
});

test("cancel refund follows admin rule", () => {
  assert.equal(refundableAmount({ paidPaisa: 45000, refundType: "full" }), 45000);
  assert.equal(
    refundableAmount({ paidPaisa: 45000, refundType: "percent", refundPercent: 50 }),
    22500
  );
  assert.equal(refundableAmount({ paidPaisa: 45000, refundType: "none" }), 0);
});

test("deactivating a plan later does not change an existing schedule snapshot", () => {
  const snapshot = { ...PLAN_B, isActive: false };
  const schedule = buildSchedule({ itemsAmountPaisa: 100000, plan: snapshot });
  assert.deepEqual(
    schedule.map((row) => row.amountPaisa),
    [40000, 30000, 30000]
  );
});
