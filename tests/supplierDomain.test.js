/* Supplier domain helpers — derived payment state, invoice numbers, report windows.
   Run: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const {
  invoiceDuePaisa,
  invoicePaymentStatus,
  supplierPaymentStatus,
  formatSequence,
  bucketKeys,
  bucketLabel,
  reportWindow,
  zonedDateKey,
} = require("../lib/supplierDomain");

test("invoice payment status is derived: paid > hold > due and void wins", () => {
  assert.equal(invoicePaymentStatus({ state: "active", totalAmountPaisa: 1000, paidAmountPaisa: 1000 }), "paid");
  assert.equal(invoicePaymentStatus({ state: "active", totalAmountPaisa: 1000, paidAmountPaisa: 1200 }), "paid");
  assert.equal(
    invoicePaymentStatus({ state: "active", totalAmountPaisa: 1000, paidAmountPaisa: 200, holdFlag: true }),
    "hold"
  );
  assert.equal(invoicePaymentStatus({ state: "active", totalAmountPaisa: 1000, paidAmountPaisa: 200 }), "due");
  assert.equal(
    invoicePaymentStatus({ state: "void", totalAmountPaisa: 1000, paidAmountPaisa: 1000, holdFlag: true }),
    "void"
  );
});

test("invoice due never goes below zero", () => {
  assert.equal(invoiceDuePaisa({ totalAmountPaisa: 500, paidAmountPaisa: 200 }), 300);
  assert.equal(invoiceDuePaisa({ totalAmountPaisa: 500, paidAmountPaisa: 700 }), 0);
  assert.equal(invoiceDuePaisa({}), 0);
});

test("supplier payment status uses worst active invoice status", () => {
  assert.equal(supplierPaymentStatus([]), "none");
  assert.equal(supplierPaymentStatus(["void"]), "none");
  assert.equal(supplierPaymentStatus(["paid", "paid"]), "paid");
  assert.equal(supplierPaymentStatus(["paid", "due"]), "due");
  assert.equal(supplierPaymentStatus(["paid", "due", "hold"]), "hold");
});

test("atomic counter numbers use INV/PO prefix and four digit padding", () => {
  assert.equal(formatSequence("invoice", 2026, 1), "INV-2026-0001");
  assert.equal(formatSequence("order", 2026, 42), "PO-2026-0042");
  assert.equal(formatSequence("invoice", 2026, 12345), "INV-2026-12345");
});

test("daily report keys follow Asia/Dhaka across the new year", () => {
  const now = new Date("2025-12-31T18:30:00.000Z"); // 2026-01-01 00:30 in Dhaka
  assert.equal(zonedDateKey(now, "Asia/Dhaka"), "2026-01-01");
  assert.deepEqual(bucketKeys("daily", 3, now, "Asia/Dhaka"), [
    "2025-12-30",
    "2025-12-31",
    "2026-01-01",
  ]);
  const win = reportWindow("daily", 3, now, "Asia/Dhaka");
  assert.equal(win.start.toISOString(), "2025-12-29T18:00:00.000Z");
  assert.equal(win.keys.length, 3);
});

test("monthly and yearly report keys roll over correctly", () => {
  const now = new Date("2026-01-15T12:00:00.000Z");
  assert.deepEqual(bucketKeys("monthly", 3, now, "Asia/Dhaka"), [
    "2025-11",
    "2025-12",
    "2026-01",
  ]);
  assert.deepEqual(bucketKeys("yearly", 3, now, "Asia/Dhaka"), ["2024", "2025", "2026"]);
  assert.equal(bucketLabel("2026-01", "monthly"), "Jan 2026");
  assert.equal(bucketLabel("2026-01-15", "daily"), "15 Jan 2026");

  // window start must be the first day of the first bucket at Dhaka midnight
  const monthWin = reportWindow("monthly", 3, now, "Asia/Dhaka");
  assert.equal(monthWin.start.toISOString(), "2025-10-31T18:00:00.000Z");
  const yearWin = reportWindow("yearly", 3, now, "Asia/Dhaka");
  assert.equal(yearWin.start.toISOString(), "2023-12-31T18:00:00.000Z");
});

test("report bucket count is capped per period", () => {
  const now = new Date("2026-10-24T12:00:00.000Z");
  assert.equal(bucketKeys("daily", 999, now, "Asia/Dhaka").length, 60);
  assert.equal(bucketKeys("monthly", 999, now, "Asia/Dhaka").length, 36);
  assert.equal(bucketKeys("yearly", 999, now, "Asia/Dhaka").length, 10);
});
