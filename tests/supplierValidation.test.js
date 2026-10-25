/* Supplier validators — whitelisted fields, integer paisa, quantities, reasons.
   Run: node --test tests/*.test.js */
const test = require("node:test");
const assert = require("node:assert");
const {
  normalizeSupplierInput,
  normalizeOrderInput,
  normalizePaymentInput,
  normalizeIdempotencyKey,
  normalizeHoldInput,
  normalizeStockAdjustment,
  normalizeSettingsInput,
} = require("../lib/supplierValidation");

const PID = "6ad7e35031924d04bd57cbc3";

test("supplier input trims and normalizes but ignores junk fields", () => {
  const value = normalizeSupplierInput({
    name: "  Rahim Traders ",
    companyName: " Rahim & Sons ",
    address: " 12 Road ",
    phone: "+880 171-234-5678",
    email: " SALES@EXAMPLE.COM ",
    note: "  Weekly supply ",
    state: "trashed",
    junk: "ignored",
  });
  assert.deepStrictEqual(value, {
    name: "Rahim Traders",
    phone: "+8801712345678",
    companyName: "Rahim & Sons",
    address: "12 Road",
    email: "sales@example.com",
    note: "Weekly supply",
  });
});

test("supplier partial update only touches supplied fields", () => {
  assert.deepStrictEqual(normalizeSupplierInput({ name: "New name" }, { partial: true }), {
    name: "New name",
  });
  assert.throws(() => normalizeSupplierInput({}, { partial: true }), /kono field/i);
});

test("supplier validation rejects empty name and malformed contact", () => {
  assert.throws(() => normalizeSupplierInput({ name: " ", phone: "01712345678" }), /Supplier name lagbe/);
  assert.throws(() => normalizeSupplierInput({ name: "A", phone: "123" }), /Phone number valid na/);
  assert.throws(
    () => normalizeSupplierInput({ name: "A", phone: "01712345678", email: "bad" }),
    /Email valid na/
  );
});

test("order input requires unique products and safe integer paisa", () => {
  const value = normalizeOrderInput(
    { items: [{ productId: PID, quantity: 2, unitCostPaisa: 150000 }], note: " ok " },
    { maxOrderQty: 10 }
  );
  assert.equal(value.items[0].quantity, 2);
  assert.equal(value.items[0].unitCostPaisa, 150000);
  assert.equal(value.note, "ok");

  assert.throws(
    () => normalizeOrderInput({ items: [{ productId: PID, quantity: 1.5, unitCostPaisa: 10 }] }),
    /positive integer/
  );
  assert.throws(
    () => normalizeOrderInput({ items: [{ productId: PID, quantity: 11, unitCostPaisa: 10 }] }, { maxOrderQty: 10 }),
    /er beshi/
  );
  assert.throws(
    () =>
      normalizeOrderInput({
        items: [
          { productId: PID, quantity: 1, unitCostPaisa: 10 },
          { productId: PID, quantity: 2, unitCostPaisa: 10 },
        ],
      }),
    /duibar/
  );
  assert.throws(
    () => normalizeOrderInput({ items: [{ productId: PID, quantity: 1, unitCostPaisa: 10.5 }] }),
    /unit cost paisa integer/
  );
  assert.throws(() => normalizeOrderInput({ items: [] }), /ontoto ekta product/);
});

test("idempotency key is required and shape-limited", () => {
  const key = "9b2f5ee8-3d7d-4a4f-a5a5-1a2b3c4d5e6f";
  assert.equal(normalizeIdempotencyKey(key), key);
  assert.throws(() => normalizeIdempotencyKey(""), /header lagbe/);
  assert.throws(() => normalizeIdempotencyKey("short"), /8-128/);
  assert.throws(() => normalizeIdempotencyKey("bad key with spaces"), /8-128/);
});

test("payment input defaults to cash and keeps paisa integer", () => {
  const value = normalizePaymentInput({ amountPaisa: 25000, method: "BKASH", reference: " TRX1 " });
  assert.equal(value.amountPaisa, 25000);
  assert.equal(value.method, "bkash");
  assert.equal(value.reference, "TRX1");
  assert.throws(() => normalizePaymentInput({ amountPaisa: 0 }), /positive paisa/);
  assert.throws(() => normalizePaymentInput({ amountPaisa: 100, method: "crypto" }), /method valid na/);
});

test("hold requires a reason and stock changes must be non-zero", () => {
  assert.deepStrictEqual(normalizeHoldInput({ holdFlag: false }), { holdFlag: false, holdReason: "" });
  assert.throws(() => normalizeHoldInput({ holdFlag: true }), /Hold reason lagbe/);
  assert.equal(normalizeHoldInput({ holdFlag: true, reason: "Price mismatch" }).holdReason, "Price mismatch");

  const adj = normalizeStockAdjustment({ productId: PID, change: -3, reason: "Damaged goods" });
  assert.equal(adj.change, -3);
  assert.throws(() => normalizeStockAdjustment({ productId: PID, change: 0, reason: "x" }), /non-zero/);
});

test("settings input only allows known keys and bounded quantity", () => {
  assert.deepStrictEqual(normalizeSettingsInput({ autoAdjustStock: true, maxOrderQty: 500 }), {
    autoAdjustStock: true,
    maxOrderQty: 500,
  });
  assert.throws(() => normalizeSettingsInput({ autoAdjustStock: "yes" }), /boolean/);
  assert.throws(() => normalizeSettingsInput({ maxOrderQty: 0 }), /1-1000000/);
  assert.throws(() => normalizeSettingsInput({ unknown: 1 }), /Kono setting/);
});
