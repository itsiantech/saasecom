/* Order catalog service tests — tab logic (All excludes incomplete, Unpaid
   excludes cancelled), advanced search filters, payment badges.
   Run: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert");
const {
  ORDER_TABS,
  buildOrderQuery,
  applyOrderTab,
  applyOrderAdvanced,
  applyOrderSearch,
  paymentBadge,
} = require("../services/orderCatalog");

test("order tabs include every required tab", () => {
  assert.deepEqual(ORDER_TABS, [
    "all", "incomplete", "pending", "processing", "on_the_way",
    "in_courier", "call_not_received", "completed", "unpaid", "cancelled",
  ]);
});

test("All orders excludes incomplete", () => {
  const q = applyOrderTab({}, "all");
  assert.deepEqual(q.status, { $ne: "incomplete" });
});

test("Unpaid excludes cancelled and incomplete + matches unpaid payment statuses", () => {
  const q = applyOrderTab({}, "unpaid");
  assert.deepEqual(q.status, { $nin: ["cancelled", "incomplete"] });
  assert.ok(q.paymentStatus.$in.includes("pending"));
  assert.ok(!q.paymentStatus.$in.includes("paid"));
});

test("per-status tabs filter exactly", () => {
  assert.deepEqual(applyOrderTab({}, "in_courier"), { status: "in_courier" });
  assert.deepEqual(applyOrderTab({}, "call_not_received"), { status: "call_not_received" });
  assert.deepEqual(applyOrderTab({}, "cancelled"), { status: "cancelled" });
  assert.deepEqual(applyOrderTab({}, "incomplete"), { status: "incomplete" });
});

test("search maps to orderNumber/invoice/customer fields", () => {
  const q = applyOrderSearch({}, "Rahim");
  assert.ok(q.$or.some((o) => o.customerName));
  assert.ok(q.$or.some((o) => o.orderNumber));
});

test("advanced search: payment mapping", () => {
  const q = applyOrderAdvanced({}, { payment: "partial" }, null);
  assert.equal(q.paymentStatus, "partially_paid");

  const q2 = applyOrderAdvanced({}, { payment: "paid" }, null);
  assert.equal(q2.paymentStatus, "paid");

  const q3 = applyOrderAdvanced({}, { payment: "unpaid" }, null);
  assert.ok(q3.paymentStatus.$nin.includes("paid"));
  assert.ok(q3.paymentStatus.$nin.includes("partially_paid"));
});

test("advanced search: courier regex + inclusive date range", () => {
  const q = applyOrderAdvanced({}, { courier: "Steadfast" }, null);
  assert.ok(q.courierName instanceof RegExp);

  const d = applyOrderAdvanced({}, { from: "2026-01-01", to: "2026-01-02" }, null);
  assert.ok(d.createdAt.$gte <= d.createdAt.$lte);
  assert.equal(d.createdAt.$lte.getHours(), 23);
});

test("advanced search: product ids narrow items.product; empty list forces empty result", () => {
  const withIds = applyOrderAdvanced({}, {}, ["507f1f77bcf86cd799439011"]);
  assert.deepEqual(withIds["items.product"], { $in: ["507f1f77bcf86cd799439011"] });

  const emptyIds = applyOrderAdvanced({}, {}, []);
  assert.deepEqual(emptyIds["items.product"], { $in: [null] });
});

test("combined query: tab + search + advanced build together", () => {
  const q = buildOrderQuery({
    tab: "unpaid",
    search: "ORD-1",
    advanced: { courier: "Steadfast", payment: "" },
    productIds: null,
  });
  assert.deepEqual(q.status, { $nin: ["cancelled", "incomplete"] });
  assert.ok(Array.isArray(q.$or));
  assert.ok(q.courierName instanceof RegExp);
});

test("payment badge mapping", () => {
  assert.equal(paymentBadge("paid").label, "Paid");
  assert.equal(paymentBadge("partially_paid").label, "Partial");
  assert.equal(paymentBadge("pending").label, "Unpaid");
  assert.equal(paymentBadge("failed").label, "Unpaid");
});
