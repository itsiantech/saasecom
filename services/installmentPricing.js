/* ==========================================================================
   Retail EMI pricing engine — pure functions, no DB access.
   Works on a generic order total so a Product Builder bundle can quote the
   same way a single product does.
   Money is integer paisa; rate fields are plain percentages (12.5 = 12.5%).
   Rounding rule: every installment is rounded to the nearest taka and the
   remainder lands on the LAST installment (never over-collect).
   ========================================================================== */

const METHODS = ["flat_annual", "total_markup", "reducing"];
const MIN_MONTHS = 2;
const MAX_MONTHS = 60;

function roundTaka(paisa) {
  return Math.round((Number(paisa) || 0) / 100) * 100;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function computeProfitPaisa({ financedPaisa, months, method, annualRatePct, markupPct }) {
  if (method === "total_markup") {
    return Math.round((financedPaisa * markupPct) / 100);
  }
  if (method === "reducing") {
    if (annualRatePct <= 0) return 0;
    const i = annualRatePct / 12 / 100;
    const payment = (financedPaisa * i) / (1 - Math.pow(1 + i, -months));
    return Math.round(payment * months - financedPaisa);
  }
  // flat_annual
  return Math.round((financedPaisa * annualRatePct * months) / (100 * 12));
}

function buildEmiSchedule(totalPaisa, months) {
  const total = Math.max(0, Math.round(Number(totalPaisa) || 0));
  const n = Math.max(MIN_MONTHS, Math.round(Number(months) || 0));
  let monthly = roundTaka(total / n);
  // Tiny totals could push the last row negative; fall back to flooring.
  if (monthly * (n - 1) > total) monthly = Math.floor(total / n / 100) * 100;
  const lastPaisa = total - monthly * (n - 1);
  const schedule = Array.from({ length: n }, (_, index) => ({
    number: index + 1,
    amountPaisa: index === n - 1 ? lastPaisa : monthly,
  }));
  return { monthlyPaisa: monthly, lastPaisa, schedule };
}

// Effective annual rate the customer actually pays (IRR of the financed
// amount against the schedule), as a percentage with 2 decimals.
function effectiveAnnualRate({ financedPaisa, schedule }) {
  const principal = Number(financedPaisa) || 0;
  const rows = Array.isArray(schedule) ? schedule : [];
  if (principal <= 0 || !rows.length) return 0;
  const payments = rows.map((row) => Number(row.amountPaisa) || 0);
  const total = payments.reduce((sum, amount) => sum + amount, 0);
  if (total <= principal) return 0;

  const presentValue = (rate) =>
    payments.reduce((sum, amount, index) => sum + amount / Math.pow(1 + rate, index + 1), 0);

  let low = 0;
  let high = 1; // 100% per month is far beyond any real offer
  for (let step = 0; step < 100; step += 1) {
    const mid = (low + high) / 2;
    if (presentValue(mid) > principal) low = mid;
    else high = mid;
  }
  const monthlyRate = (low + high) / 2;
  return round2((Math.pow(1 + monthlyRate, 12) - 1) * 100);
}

function validateTerms({ method, annualRatePct, markupPct, serviceChargePercent, months }, limits = {}) {
  if (!METHODS.includes(method)) return "গণনার পদ্ধতি সঠিক নয়";
  const n = Number(months);
  if (!Number.isInteger(n) || n < MIN_MONTHS || n > (Number(limits.maxMonths) || MAX_MONTHS)) {
    return `কিস্তির সংখ্যা ${MIN_MONTHS} থেকে ${Number(limits.maxMonths) || MAX_MONTHS} এর মধ্যে হতে হবে`;
  }
  const maxRate = Number.isFinite(Number(limits.maxAnnualRatePct)) ? Number(limits.maxAnnualRatePct) : 1000;
  if (!(Number(annualRatePct) >= 0) || Number(annualRatePct) > maxRate) {
    return `বার্ষিক সুদ হার ০ থেকে ${maxRate}% এর মধ্যে হতে হবে`;
  }
  if (method === "total_markup" && (!(Number(markupPct) >= 0) || Number(markupPct) > maxRate)) {
    return `মার্কআপ ০ থেকে ${maxRate}% এর মধ্যে হতে হবে`;
  }
  if (!(Number(serviceChargePercent) >= 0) || Number(serviceChargePercent) > 100) {
    return "সার্ভিস চার্জ ০ থেকে ১০০% এর মধ্যে হতে হবে";
  }
  return null;
}

function validateQuoteInput(input = {}) {
  const basePaisa = Number(input.basePaisa);
  if (!Number.isFinite(basePaisa) || basePaisa < 100) return "পণ্যের দাম সঠিক নয়";
  const months = Number(input.months);
  if (!Number.isInteger(months) || months < MIN_MONTHS || months > MAX_MONTHS) {
    return `কিস্তির সংখ্যা ${MIN_MONTHS} থেকে ${MAX_MONTHS} এর মধ্যে হতে হবে`;
  }
  const downPayment = Number(input.downPaymentPaisa || 0);
  if (!Number.isFinite(downPayment) || downPayment < 0) return "ডাউন পেমেন্ট সঠিক নয়";
  if (downPayment >= basePaisa) return "কিস্তির জন্য কিছু বাকি থাকতে হবে";
  if (!METHODS.includes(input.method)) return "গণনার পদ্ধতি সঠিক নয়";
  if (!(Number(input.annualRatePct) >= 0) || Number(input.annualRatePct) > 1000) {
    return "বার্ষিক সুদ হার সঠিক নয়";
  }
  if (!(Number(input.markupPct) >= 0) || Number(input.markupPct) > 1000) return "মার্কআপ সঠিক নয়";
  const servicePercent = Number(input.serviceChargePercent || 0);
  if (!(servicePercent >= 0) || servicePercent > 100) return "সার্ভিস চার্জ সঠিক নয়";
  return null;
}

function downPaymentFor(basePaisa, percent) {
  const base = Math.max(0, Math.round(Number(basePaisa) || 0));
  const pct = Math.min(99, Math.max(0, Number(percent) || 0));
  return Math.min(base, roundTaka((base * pct) / 100));
}

// The service charge is charged on the financed amount, one time, and is not
// itself financed.
function computeQuote(input = {}) {
  const error = validateQuoteInput(input);
  if (error) throw new Error(error);

  const basePaisa = Math.round(Number(input.basePaisa));
  const months = Number(input.months);
  const method = input.method;
  const annualRatePct = Number(input.annualRatePct) || 0;
  const markupPct = Number(input.markupPct) || 0;
  const serviceChargePercent = Number(input.serviceChargePercent) || 0;
  const serviceChargeFlatPaisa = Math.max(0, Math.round(Number(input.serviceChargeFlatPaisa) || 0));
  const downPaymentPaisa = Math.min(basePaisa - 1, Math.max(0, Math.round(Number(input.downPaymentPaisa) || 0)));
  const financedPaisa = basePaisa - downPaymentPaisa;

  const profitPaisa = computeProfitPaisa({ financedPaisa, months, method, annualRatePct, markupPct });
  const serviceChargePaisa = Math.round((financedPaisa * serviceChargePercent) / 100) + serviceChargeFlatPaisa;
  const installmentTotalPaisa = financedPaisa + profitPaisa + serviceChargePaisa;
  const totalPayablePaisa = downPaymentPaisa + installmentTotalPaisa;
  const { monthlyPaisa, lastPaisa, schedule } = buildEmiSchedule(installmentTotalPaisa, months);
  const effectiveAnnualRatePct = effectiveAnnualRate({ financedPaisa, schedule });

  return {
    method,
    months,
    annualRatePct,
    markupPct,
    serviceChargePercent,
    serviceChargeFlatPaisa,
    basePaisa,
    cashPaisa: Number(input.cashPaisa) > 0 ? Math.round(Number(input.cashPaisa)) : basePaisa,
    downPaymentPaisa,
    downPaymentPercent: basePaisa > 0 ? round2((downPaymentPaisa * 100) / basePaisa) : 0,
    financedPaisa,
    profitPaisa,
    serviceChargePaisa,
    installmentTotalPaisa,
    totalPayablePaisa,
    monthlyPaisa,
    lastPaisa,
    effectiveAnnualRatePct,
    schedule,
  };
}

module.exports = {
  METHODS,
  MIN_MONTHS,
  MAX_MONTHS,
  roundTaka,
  buildEmiSchedule,
  effectiveAnnualRate,
  computeProfitPaisa,
  computeQuote,
  validateTerms,
  downPaymentFor,
};
