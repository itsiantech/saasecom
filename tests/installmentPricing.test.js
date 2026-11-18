const test = require("node:test");
const assert = require("node:assert/strict");
const {
  roundTaka,
  buildEmiSchedule,
  computeQuote,
  validateTerms,
  downPaymentFor,
} = require("../services/installmentPricing");

const BASE = 10_000_000; // ৳1,00,000 in paisa

function sum(schedule) {
  return schedule.reduce((total, row) => total + row.amountPaisa, 0);
}

test("installments round to the nearest taka and the remainder lands on the last row", () => {
  assert.equal(roundTaka(746666.67), 746700);
  assert.equal(roundTaka(746640), 746600);

  const { monthlyPaisa, lastPaisa, schedule } = buildEmiSchedule(8_960_000, 12);
  assert.equal(schedule.length, 12);
  assert.equal(monthlyPaisa, 746700);
  assert.equal(lastPaisa, 746300);
  assert.equal(sum(schedule), 8_960_000);
  assert.equal(schedule[0].amountPaisa, 746700);
  assert.equal(schedule[11].amountPaisa, 746300);
});

test("a tiny total never produces a negative installment", () => {
  const { schedule } = buildEmiSchedule(1040, 12);
  assert.equal(schedule.length, 12);
  assert.equal(sum(schedule), 1040);
  assert.ok(schedule.every((row) => row.amountPaisa >= 0));
});

test("flat annual rate: profit = financed × rate × months/12", () => {
  const quote = computeQuote({
    basePaisa: BASE,
    downPaymentPaisa: 2_000_000, // 20%
    months: 12,
    method: "flat_annual",
    annualRatePct: 12,
    markupPct: 0,
    serviceChargePercent: 0,
    serviceChargeFlatPaisa: 0,
    cashPaisa: 9_000_000,
  });
  assert.equal(quote.financedPaisa, 8_000_000);
  assert.equal(quote.profitPaisa, 960_000);
  assert.equal(quote.installmentTotalPaisa, 8_960_000);
  assert.equal(quote.totalPayablePaisa, 10_960_000);
  assert.equal(quote.downPaymentPercent, 20);
  assert.equal(quote.monthlyPaisa, 746_700);
  assert.equal(quote.lastPaisa, 746_300);
  assert.equal(sum(quote.schedule), 8_960_000);
  assert.ok(quote.effectiveAnnualRatePct > 12);
});

test("total markup: profit = financed × markup/100", () => {
  const quote = computeQuote({
    basePaisa: BASE,
    downPaymentPaisa: 0,
    months: 6,
    method: "total_markup",
    annualRatePct: 0,
    markupPct: 10,
    serviceChargePercent: 0,
    serviceChargeFlatPaisa: 0,
  });
  assert.equal(quote.profitPaisa, 1_000_000);
  assert.equal(quote.installmentTotalPaisa, 11_000_000);
  assert.equal(quote.totalPayablePaisa, 11_000_000);
  assert.equal(sum(quote.schedule), 11_000_000);
  assert.equal(quote.monthlyPaisa, 1_833_300);
});

test("reducing balance: amortized payment, effective rate close to nominal", () => {
  const quote = computeQuote({
    basePaisa: BASE,
    downPaymentPaisa: 0,
    months: 12,
    method: "reducing",
    annualRatePct: 12,
    markupPct: 0,
  });
  assert.ok(Math.abs(quote.profitPaisa - 661_855) <= 200, String(quote.profitPaisa));
  assert.equal(quote.totalPayablePaisa, BASE + quote.profitPaisa);
  assert.equal(sum(quote.schedule), quote.installmentTotalPaisa);
  assert.ok(quote.effectiveAnnualRatePct > 12 && quote.effectiveAnnualRatePct < 13.5, String(quote.effectiveAnnualRatePct));
});

test("reducing balance with zero rate has no profit", () => {
  const quote = computeQuote({
    basePaisa: BASE,
    downPaymentPaisa: 0,
    months: 12,
    method: "reducing",
    annualRatePct: 0,
    markupPct: 0,
  });
  assert.equal(quote.profitPaisa, 0);
  assert.equal(quote.totalPayablePaisa, BASE);
  assert.equal(quote.effectiveAnnualRatePct, 0);
  assert.equal(sum(quote.schedule), BASE);
});

test("service charge percent applies to the financed amount plus the flat fee", () => {
  const quote = computeQuote({
    basePaisa: 1_000_000,
    downPaymentPaisa: 0,
    months: 4,
    method: "total_markup",
    annualRatePct: 0,
    markupPct: 0,
    serviceChargePercent: 2,
    serviceChargeFlatPaisa: 5000,
  });
  assert.equal(quote.serviceChargePaisa, 25_000);
  assert.equal(quote.installmentTotalPaisa, 1_025_000);
  assert.equal(quote.totalPayablePaisa, 1_025_000);
  assert.ok(quote.effectiveAnnualRatePct > 0);
});

test("down payment is clamped and rounded to the nearest taka", () => {
  assert.equal(downPaymentFor(10_000_000, 20), 2_000_000);
  assert.equal(downPaymentFor(10_000_001, 20), 2_000_000);
  assert.equal(downPaymentFor(10_000_000, 120), 9_900_000); // hard cap at 99%
});

test("quote input is validated", () => {
  const base = {
    basePaisa: 1000,
    downPaymentPaisa: 0,
    months: 3,
    method: "flat_annual",
    annualRatePct: 0,
    markupPct: 0,
  };
  assert.throws(() => computeQuote({ ...base, downPaymentPaisa: 1000 }), /কিছু বাকি/);
  assert.throws(() => computeQuote({ ...base, months: 1 }), /কিস্তির সংখ্যা/);
  assert.throws(() => computeQuote({ ...base, months: 61 }), /কিস্তির সংখ্যা/);
  assert.throws(() => computeQuote({ ...base, method: "bogus" }), /পদ্ধতি/);
  assert.throws(() => computeQuote({ ...base, annualRatePct: -1 }), /সুদ হার/);
  assert.throws(() => computeQuote({ ...base, basePaisa: 0 }), /দাম/);
});

test("terms are validated against the store caps", () => {
  const terms = { method: "flat_annual", annualRatePct: 12, markupPct: 0, serviceChargePercent: 0, months: 6 };
  assert.equal(validateTerms(terms, { maxMonths: 12, maxAnnualRatePct: 36 }), null);
  assert.match(validateTerms({ ...terms, annualRatePct: 40 }, { maxMonths: 12, maxAnnualRatePct: 36 }), /সুদ হার/);
  assert.match(validateTerms({ ...terms, months: 24 }, { maxMonths: 12 }), /কিস্তির সংখ্যা/);
  assert.match(validateTerms({ ...terms, serviceChargePercent: 120 }), /সার্ভিস চার্জ/);
  assert.match(
    validateTerms({ ...terms, method: "total_markup", markupPct: 80 }, { maxAnnualRatePct: 36 }),
    /মার্কআপ/
  );
});
