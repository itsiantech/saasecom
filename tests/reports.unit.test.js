const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolvePeriod,
  resolveCustomerRange,
  chartBuckets,
  addDaysKey,
  listDayKeys,
  isDayKey,
} = require("../lib/reportPeriods");
const {
  allocateProportionally,
  allocateOrderRevenue,
  orderTotalPaisa,
  orderCouponDiscountPaisa,
  refundPaisaOf,
  refundAtOf,
  averageDailyPaisa,
} = require("../lib/reportMath");
const {
  normalizePhone,
  normalizeEmail,
  customerKeyFor,
  customerDisplayName,
} = require("../lib/reportCustomer");

const NOW = new Date("2026-10-24T10:00:00.000Z"); // 24 Oct 2026, 16:00 Dhaka

function period(input, now = NOW) {
  return resolvePeriod(input, { now, timezone: "Asia/Dhaka" });
}

test("preset periods resolve on the server in Asia/Dhaka", () => {
  const yearly = period({ preset: "yearly" });
  assert.equal(yearly.from, "2026-01-01");
  assert.equal(yearly.to, "2026-10-24");
  assert.equal(yearly.days, 297);

  const lastMonth = period({ preset: "last_month" });
  assert.equal(lastMonth.from, "2026-09-01");
  assert.equal(lastMonth.to, "2026-09-30");
  assert.equal(lastMonth.days, 30);

  const thisMonth = period({ preset: "this_month" });
  assert.equal(thisMonth.from, "2026-10-01");
  assert.equal(thisMonth.to, "2026-10-24");
  assert.equal(thisMonth.days, 24);

  const last7 = period({ preset: "last_7_days" });
  assert.equal(last7.from, "2026-10-18");
  assert.equal(last7.to, "2026-10-24");
  assert.equal(last7.days, 7);
});

test("Dhaka midnight boundary changes the local day and presets", () => {
  const lateUtc = new Date("2026-10-24T18:30:00.000Z"); // 25 Oct, 00:30 Dhaka
  const thisMonth = period({ preset: "this_month" }, lateUtc);
  assert.equal(thisMonth.to, "2026-10-25");
  assert.equal(thisMonth.days, 25);

  const last7 = period({ preset: "last_7_days" }, lateUtc);
  assert.equal(last7.from, "2026-10-19");
  assert.equal(last7.to, "2026-10-25");
});

test("leap year February is handled", () => {
  const now = new Date("2028-03-01T10:00:00.000Z");
  const lastMonth = period({ preset: "last_month" }, now);
  assert.equal(lastMonth.from, "2028-02-01");
  assert.equal(lastMonth.to, "2028-02-29");
  assert.equal(lastMonth.days, 29);
});

test("custom periods validate format, order, future and 366-day limit", () => {
  const custom = period({ from: "2026-10-01", to: "2026-10-24" });
  assert.equal(custom.days, 24);
  assert.equal(custom.preset, null);

  for (const input of [
    { from: "2026-10-24", to: "2026-10-01" },
    { from: "2026-10-01", to: "2026-10-25" },
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-01-01", to: "2026-10-24", preset: "this_month" },
    { preset: "weekly" },
    {},
  ]) {
    assert.throws(() => period(input), (err) => err.status === 400, JSON.stringify(input));
  }

  const start = "2024-01-01";
  const tooLong = addDaysKey(start, 366);
  assert.throws(() => period({ from: start, to: tooLong }), /366/);

  const max = period({ from: start, to: addDaysKey(start, 365) });
  assert.equal(max.days, 366);
});

test("day key helpers are strict and inclusive", () => {
  assert.equal(isDayKey("2026-10-24"), true);
  assert.equal(isDayKey("2026-2-4"), false);
  assert.equal(isDayKey("2026-02-29"), false);
  assert.equal(addDaysKey("2026-12-31", 1), "2027-01-01");
  assert.deepEqual(listDayKeys("2026-02-27", "2026-03-01"), [
    "2026-02-27",
    "2026-02-28",
    "2026-03-01",
  ]);
});

test("chart buckets follow preset rules and fill the whole period", () => {
  const yearly = chartBuckets(period({ preset: "yearly" }));
  assert.equal(yearly.granularity, "month");
  assert.equal(yearly.buckets.length, 10);
  assert.equal(yearly.buckets[0].label, "Jan");
  assert.equal(yearly.buckets.at(-1).label, "Oct");

  const lastMonth = chartBuckets(period({ preset: "last_month" }));
  assert.equal(lastMonth.granularity, "week");
  assert.deepEqual(lastMonth.buckets.map((b) => b.label), [
    "1–7 Sep",
    "8–14 Sep",
    "15–21 Sep",
    "22–30 Sep",
  ]);

  const thisMonth = chartBuckets(period({ preset: "this_month" }));
  assert.equal(thisMonth.granularity, "week");
  assert.equal(thisMonth.buckets.at(-1).label, "22–24 Oct");
  assert.equal(thisMonth.buckets.at(-1).toKey, "2026-10-24");

  const last7 = chartBuckets(period({ preset: "last_7_days" }));
  assert.equal(last7.granularity, "day");
  assert.equal(last7.buckets.length, 7);
  assert.equal(last7.buckets.at(-1).label, "24 Oct");

  const weekly = chartBuckets(period({ from: "2026-01-01", to: "2026-03-31" }));
  assert.equal(weekly.granularity, "week");
  assert.equal(weekly.buckets.length, 13);

  const monthly = chartBuckets(period({ from: "2026-01-01", to: "2026-04-02" }));
  assert.equal(monthly.granularity, "month");
  assert.deepEqual(monthly.buckets.map((b) => b.label), ["Jan", "Feb", "Mar", "Apr"]);
});

test("customer ranges are current month, rolling six months and year to date", () => {
  const monthly = resolveCustomerRange("monthly", { now: NOW });
  assert.equal(monthly.from, "2026-10-01");
  assert.equal(monthly.to, "2026-10-24");

  const half = resolveCustomerRange("half_yearly", { now: NOW });
  assert.equal(half.from, "2026-05-01");
  assert.equal(half.to, "2026-10-24");

  const yearly = resolveCustomerRange("yearly", { now: NOW });
  assert.equal(yearly.from, "2026-01-01");
  assert.throws(() => resolveCustomerRange("weekly", { now: NOW }), (err) => err.status === 400);
});

test("paisa splits always add up to the exact order merchandise value", () => {
  const split = allocateProportionally(10001, [1, 1, 1]);
  assert.equal(split.reduce((a, b) => a + b, 0), 10001);
  assert.deepEqual(split, [3334, 3334, 3333]);

  assert.deepEqual(allocateProportionally(900, [0, 0]), [450, 450]);

  const order = {
    totalAmount: 1700,
    shippingAmount: 100,
    items: [
      { product: "p1", quantity: 2, unitPricePaisa: 50000, price: 1000 },
      { product: "p2", quantity: 1, unitPricePaisa: 100000, price: 1000 },
    ],
  };
  const lines = allocateOrderRevenue(order);
  assert.equal(lines.reduce((a, b) => a + b.revenuePaisa, 0), 160000);
  assert.deepEqual(lines.map((line) => line.revenuePaisa), [80000, 80000]);
  assert.equal(lines.reduce((a, b) => a + b.quantity, 0), 3);
});

test("money helpers prefer paisa snapshots and handle legacy floats", () => {
  assert.equal(orderTotalPaisa({ totalAmount: 152.35 }), 15235);
  assert.equal(orderCouponDiscountPaisa({ couponDiscountPaisa: 500, couponDiscount: 99 }), 500);
  assert.equal(orderCouponDiscountPaisa({ couponDiscountPaisa: 0, couponDiscount: 12.5 }), 1250);
  assert.equal(averageDailyPaisa(10000, 3), 3333);
  assert.equal(averageDailyPaisa(10000, 0), 10000);
});

test("refund helpers read the installment cancellation snapshot", () => {
  const at = new Date("2026-10-20T12:00:00.000Z");
  const order = { installmentPlan: { cancellation: { at, refundPaisa: 25000 } } };
  assert.equal(refundPaisaOf(order), 25000);
  assert.equal(refundAtOf(order).toISOString(), at.toISOString());
  assert.equal(refundPaisaOf({}), 0);
  assert.equal(refundAtOf({}), null);
});

test("guest normalization groups phone variants and falls back to email", () => {
  assert.equal(normalizePhone("+880 1712-345678"), "01712345678");
  assert.equal(normalizePhone("008801712345678"), "01712345678");
  assert.equal(normalizePhone("1712345678"), "01712345678");
  assert.equal(normalizeEmail("  A@Example.COM "), "a@example.com");

  const phoneKey = customerKeyFor({ customerPhone: "+8801712345678", customerEmail: "x@y.com" });
  assert.equal(phoneKey, "g:p:01712345678");
  assert.equal(customerKeyFor({ customerPhone: "", customerEmail: "A@B.com" }), "g:e:a@b.com");
  assert.equal(customerKeyFor({ customer: "user-1", customerPhone: "017" }), "u:user-1");
  assert.match(customerKeyFor({ _id: "order-1" }), /^g:o:order-1$/);

  assert.equal(customerDisplayName({ customerName: "Rahim", customerPhone: "017" }), "Rahim");
  assert.equal(customerDisplayName({ customerPhone: "+8801712345678" }), "01712345678");
  assert.equal(customerDisplayName({}), "Guest");
});
