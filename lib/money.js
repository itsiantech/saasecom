// New wholesale/installment amounts are integer paisa. Existing retail fields stay in BDT.
function toPaisa(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function fromPaisa(paisa) {
  return Math.round(Number(paisa) || 0) / 100;
}

// basisPoints: 3000 = 30%
function percentOf(amountPaisa, basisPoints) {
  return Math.round((Number(amountPaisa) || 0) * (Number(basisPoints) || 0) / 10000);
}

function formatPaisa(paisa) {
  return "৳ " + fromPaisa(paisa).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

module.exports = { toPaisa, fromPaisa, percentOf, formatPaisa };
