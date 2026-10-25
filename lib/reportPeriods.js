const { zonedDateKey, zonedMidnightUtc } = require("./supplierDomain");
const {
  PRESETS,
  CUSTOMER_RANGES,
  MAX_CUSTOM_RANGE_DAYS,
  REPORT_TIMEZONE,
} = require("./reportConstants");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function rangeError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function isDayKey(value) {
  const key = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function addDaysKey(dayKey, days) {
  const [y, m, d] = String(dayKey).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + Number(days || 0)));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function listDayKeys(from, to) {
  const keys = [];
  let cursor = from;
  while (cursor <= to && keys.length < MAX_CUSTOM_RANGE_DAYS + 2) {
    keys.push(cursor);
    cursor = addDaysKey(cursor, 1);
  }
  return keys;
}

function todayKey(now, timezone) {
  return zonedDateKey(now || new Date(), timezone || REPORT_TIMEZONE);
}

function firstOfMonth(dayKey) {
  return `${String(dayKey).slice(0, 7)}-01`;
}

function lastOfMonth(dayKey) {
  const [y, m] = String(dayKey).split("-").map(Number);
  return `${y}-${pad2(m)}-${pad2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

function shiftMonthFirst(dayKey, delta) {
  const [y, m] = String(dayKey).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + Number(delta || 0), 1));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-01`;
}

function makePeriod(from, to, { preset = null, timezone = REPORT_TIMEZONE, range = null } = {}) {
  return {
    from,
    to,
    days: listDayKeys(from, to).length,
    timezone,
    preset,
    range,
    startUtc: zonedMidnightUtc(from, timezone),
    endExclusiveUtc: zonedMidnightUtc(addDaysKey(to, 1), timezone),
  };
}

// Resolves presets and custom dates on the server. The client never decides a period.
function resolvePeriod(input = {}, { now = new Date(), timezone = REPORT_TIMEZONE } = {}) {
  const tz = timezone || REPORT_TIMEZONE;
  const current = todayKey(now, tz);
  const preset = String(input.preset || "").trim();
  const rawFrom = String(input.from || "").trim();
  const rawTo = String(input.to || "").trim();

  if (preset) {
    if (!PRESETS.includes(preset)) throw rangeError("Preset yearly, last_month, this_month ba last_7_days hote hobe");
    if (rawFrom || rawTo) throw rangeError("Preset ar custom date eksathe deya jabe na");

    let from;
    let to;
    if (preset === "yearly") {
      from = `${current.slice(0, 4)}-01-01`;
      to = current;
    } else if (preset === "last_month") {
      from = shiftMonthFirst(current, -1);
      to = lastOfMonth(from);
    } else if (preset === "this_month") {
      from = firstOfMonth(current);
      to = current;
    } else {
      from = addDaysKey(current, -6);
      to = current;
    }
    return makePeriod(from, to, { preset, timezone: tz });
  }

  if (!rawFrom || !rawTo) throw rangeError("Start date ar end date duitai lagbe");
  if (!isDayKey(rawFrom) || !isDayKey(rawTo)) throw rangeError("Date YYYY-MM-DD format e hote hobe");
  if (rawFrom > rawTo) throw rangeError("Start date end date er pore hote parbe na");
  if (rawTo > current) throw rangeError("Future date er report neya jay na");
  const days = listDayKeys(rawFrom, rawTo).length;
  if (days > MAX_CUSTOM_RANGE_DAYS) throw rangeError("Maximum report range 366 din");
  return makePeriod(rawFrom, rawTo, { preset: null, timezone: tz });
}

function resolveCustomerRange(range, { now = new Date(), timezone = REPORT_TIMEZONE } = {}) {
  const tz = timezone || REPORT_TIMEZONE;
  const value = String(range || "").trim();
  if (!CUSTOMER_RANGES.includes(value)) throw rangeError("Range monthly, half_yearly ba yearly hote hobe");
  const current = todayKey(now, tz);
  let from;
  if (value === "monthly") from = firstOfMonth(current);
  else if (value === "half_yearly") from = shiftMonthFirst(current, -5);
  else from = `${current.slice(0, 4)}-01-01`;
  return makePeriod(from, current, { preset: null, timezone: tz, range: value });
}

function monthLabel(monthKey, includeYear) {
  const month = Number(String(monthKey).slice(5, 7));
  return includeYear ? `${MONTHS[month - 1]} ${monthKey.slice(0, 4)}` : MONTHS[month - 1];
}

function dayLabel(dayKey, includeYear) {
  const [y, m, d] = String(dayKey).split("-").map(Number);
  return includeYear ? `${d} ${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
}

function weekLabel(fromKey, toKey, includeYear) {
  if (fromKey.slice(0, 7) === toKey.slice(0, 7)) {
    const [, m, d1] = fromKey.split("-").map(Number);
    const d2 = Number(toKey.slice(8, 10));
    return `${d1}–${d2} ${MONTHS[m - 1]}${includeYear ? ` ${fromKey.slice(0, 4)}` : ""}`;
  }
  return `${dayLabel(fromKey, includeYear)} – ${dayLabel(toKey, includeYear)}`;
}

function chartGranularity(period) {
  if (period.preset === "yearly") return "month";
  if (period.preset === "last_month" || period.preset === "this_month") return "week";
  if (period.preset === "last_7_days") return "day";
  if (period.days <= 14) return "day";
  if (period.days <= 91) return "week";
  return "month";
}

function chartBuckets(period) {
  const granularity = chartGranularity(period);
  const includeYear = period.from.slice(0, 4) !== period.to.slice(0, 4);
  const buckets = [];

  if (granularity === "day") {
    for (const key of listDayKeys(period.from, period.to)) {
      buckets.push({ key, label: dayLabel(key, includeYear), fromKey: key, toKey: key });
    }
    return { granularity, buckets };
  }

  if (granularity === "week") {
    if (period.preset === "last_month" || period.preset === "this_month") {
      const monthKey = period.from.slice(0, 7);
      const monthLast = lastOfMonth(period.from);
      for (const startDay of [1, 8, 15, 22]) {
        const fromKey = `${monthKey}-${pad2(startDay)}`;
        const toKey = startDay === 22 ? monthLast : `${monthKey}-${pad2(startDay + 6)}`;
        if (fromKey > period.to) continue;
        const clippedFrom = fromKey < period.from ? period.from : fromKey;
        const clippedTo = toKey > period.to ? period.to : toKey;
        if (clippedFrom > clippedTo) continue;
        buckets.push({
          key: clippedFrom,
          label: weekLabel(clippedFrom, clippedTo, includeYear),
          fromKey: clippedFrom,
          toKey: clippedTo,
        });
      }
      return { granularity, buckets };
    }

    let cursor = period.from;
    while (cursor <= period.to) {
      let end = addDaysKey(cursor, 6);
      if (end > period.to) end = period.to;
      buckets.push({ key: cursor, label: weekLabel(cursor, end, includeYear), fromKey: cursor, toKey: end });
      cursor = addDaysKey(end, 1);
    }
    return { granularity, buckets };
  }

  let monthKey = period.from.slice(0, 7);
  const lastMonthKey = period.to.slice(0, 7);
  while (monthKey <= lastMonthKey) {
    const monthFirst = `${monthKey}-01`;
    const monthLast = lastOfMonth(monthFirst);
    const fromKey = monthFirst < period.from ? period.from : monthFirst;
    const toKey = monthLast > period.to ? period.to : monthLast;
    buckets.push({
      key: monthKey,
      label: monthLabel(monthKey, includeYear),
      fromKey,
      toKey,
    });
    monthKey = shiftMonthFirst(monthFirst, 1).slice(0, 7);
  }
  return { granularity, buckets };
}

function periodLabel(period) {
  return `${period.from} – ${period.to}`;
}

module.exports = {
  MONTHS,
  DAY_MS,
  rangeError,
  isDayKey,
  addDaysKey,
  listDayKeys,
  todayKey,
  firstOfMonth,
  lastOfMonth,
  shiftMonthFirst,
  makePeriod,
  resolvePeriod,
  resolveCustomerRange,
  chartGranularity,
  chartBuckets,
  periodLabel,
  dayLabel,
  monthLabel,
};
