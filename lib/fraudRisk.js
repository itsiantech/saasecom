/* Shared courier fraud-risk math — pure helpers, no I/O.
 * A courier result is either { success, cancel, total } counts or (Pathao)
 * a categorical { rating } when parcel counts are not provided. */

const BD_PHONE_RE = /^01[3-9]\d{8}$/;

/* +8801XXXXXXXXX / 8801XXXXXXXXX / spaces-dashes → 01XXXXXXXXX.
 * Returns "" for anything that is not a valid BD mobile number. */
function normalizeBdPhone(value) {
  let s = String(value == null ? "" : value).replace(/[^\d+]/g, "");
  if (s.startsWith("+880")) s = "0" + s.slice(4);
  else if (s.startsWith("880") && s.length === 13) s = "0" + s.slice(3);
  return BD_PHONE_RE.test(s) ? s : "";
}

function countsOf(result) {
  if (!result || result.error) return null;
  const total = Number(result.total);
  const success = Number(result.success);
  const cancel = Number(result.cancel);
  if (![total, success, cancel].every(Number.isFinite)) return null;
  if (total <= 0) return { success: 0, cancel: 0, total: 0 };
  return { success, cancel, total };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/* settings: { steadfastEnabled, pathaoEnabled, lowFrom, highBelow }.
 * Only enabled couriers that returned data take part. "new" (no history)
 * is a normal customer, never high. Rating-only results map categorically. */
function calculateRisk(steadfastResult, pathaoResult, settings = {}) {
  const lowFrom = Number(settings.lowFrom) > 0 ? Number(settings.lowFrom) : 80;
  const highBelow = Number(settings.highBelow) > 0 ? Number(settings.highBelow) : 50;
  const perCourier = {};
  let sumSuccess = 0;
  let sumTotal = 0;
  let zeroHistory = false;
  let rating = "";

  const inputs = [
    ["steadfast", settings.steadfastEnabled, steadfastResult],
    ["pathao", settings.pathaoEnabled, pathaoResult],
  ];
  for (const [key, enabled, result] of inputs) {
    if (!enabled || !result || result.error) continue;
    const counts = countsOf(result);
    if (counts) {
      perCourier[key] = {
        ...counts,
        percent: counts.total > 0 ? round1((counts.success / counts.total) * 100) : null,
      };
      sumSuccess += counts.success;
      sumTotal += counts.total;
      if (counts.total === 0) zeroHistory = true;
    } else if (result.rating) {
      perCourier[key] = { rating: String(result.rating) };
      if (!rating) rating = String(result.rating);
    }
  }

  if (sumTotal > 0) {
    const combinedPercent = round1((sumSuccess / sumTotal) * 100);
    const level = combinedPercent >= lowFrom ? "low" : combinedPercent < highBelow ? "high" : "medium";
    return { level, combinedPercent, perCourier };
  }

  const r = rating.toLowerCase();
  if (zeroHistory || /new/.test(r)) return { level: "new", combinedPercent: null, perCourier };
  if (/risky|bad/.test(r)) return { level: "high", combinedPercent: null, perCourier };
  if (/excellent|good/.test(r)) return { level: "low", combinedPercent: null, perCourier };
  return { level: "unavailable", combinedPercent: null, perCourier };
}

module.exports = { BD_PHONE_RE, normalizeBdPhone, calculateRisk };