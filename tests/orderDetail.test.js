/* Order detail shaping tests — legacy fallbacks + items/totals + labels.
   Run: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert");
const { shapeOrderDetail, SOURCE_LABELS, DEVICE_LABELS } = require("../services/orderDetail");

const legacyOrder = {
  _id: "o1",
  orderNumber: "ORD-1",
  invoiceNumber: "INV-1",
  createdAt: new Date("2026-10-24T10:30:00Z"),
  customerName: "Rahim",
  customerEmail: "rahim@example.com",
  customerPhone: "01712345678",
  address: "House 12, Road 5",
  thana: "Dhanmondi",
  district: "Dhaka",
  division: "Dhaka",
  postCode: "1209",
  country: "Bangladesh",
  items: [
    { unitPrice: 500, quantity: 2, price: 1000, product: { title: "Wallet", sku: "W-1", images: ["a.jpg"] } },
    { unitPrice: 250, quantity: 1 },
  ],
  shippingLabel: "Inside Dhaka",
  shippingAmount: 60,
  totalAmount: 1310,
  status: "pending",
  paymentStatus: "pending",
};

test("legacy order falls back to flat customer fields for billing and shipping", () => {
  const d = shapeOrderDetail(legacyOrder);
  const address = "House 12, Road 5, Dhanmondi, Dhaka, Dhaka, 1209, Bangladesh";
  assert.deepEqual(d.billing, {
    name: "Rahim",
    address,
    email: "rahim@example.com",
    phone: "01712345678",
  });
  assert.deepEqual(d.shipping, d.billing);
  assert.equal(d.origin.label, "—");
  assert.equal(d.device.label, "—");
});

test("explicit billing/shipping subdocs override the flat fields", () => {
  const d = shapeOrderDetail({
    ...legacyOrder,
    billing: { name: "Billing Person", address: "Billing Road", email: "b@example.com", phone: "01800000000" },
    shipping: { name: "", address: "Ship Road", email: "", phone: "01900000000" },
  });
  assert.equal(d.billing.name, "Billing Person");
  assert.equal(d.billing.address, "Billing Road");
  assert.equal(d.shipping.name, "Rahim"); // empty -> customer fallback
  assert.equal(d.shipping.address, "Ship Road");
  assert.equal(d.shipping.email, "rahim@example.com");
  assert.equal(d.shipping.phone, "01900000000");
});

test("items are shaped with name/sku/image/price/qty/total", () => {
  const d = shapeOrderDetail(legacyOrder);
  assert.equal(d.items.length, 2);
  assert.deepEqual(d.items[0], {
    productId: null,
    name: "Wallet",
    sku: "W-1",
    image: "a.jpg",
    unitPrice: 500,
    quantity: 2,
    total: 1000,
  });
  assert.equal(d.items[1].name, "Product");
  assert.equal(d.items[1].total, 250);
  assert.equal(d.itemsTotal, 1250);
  assert.equal(d.shippingAmount, 60);
  assert.equal(d.orderTotal, 1310);
});

test("itemsTotal falls back to line maths when order total is missing", () => {
  const d = shapeOrderDetail({ ...legacyOrder, totalAmount: undefined });
  assert.equal(d.orderTotal, 1310);
});

test("source/device labels come from the stored enums", () => {
  const d = shapeOrderDetail({ ...legacyOrder, orderSource: "facebook", deviceType: "mobile" });
  assert.deepEqual(d.origin, { value: "facebook", label: "Facebook" });
  assert.deepEqual(d.device, { value: "mobile", label: "Mobile" });
  assert.equal(SOURCE_LABELS.youtube, "YouTube");
  assert.equal(DEVICE_LABELS.tablet, "Tab");
});

test("installment summary + history note + order note pass through", () => {
  const d = shapeOrderDetail(
    {
      ...legacyOrder,
      orderNote: "Call before delivery",
      paymentMode: "installment",
      paidAmount: 50000,
      dueAmount: 150000,
      installmentPlan: { name: "3 part", installmentsCount: 3 },
    },
    { historyNote: "Customer confirmed" }
  );
  assert.equal(d.orderNote, "Call before delivery");
  assert.equal(d.historyNote, "Customer confirmed");
  assert.equal(d.paymentMode, "installment");
  assert.deepEqual(d.installment, { name: "3 part", installmentsCount: 3 });
  assert.equal(d.paidAmount, 50000);
  assert.equal(d.dueAmount, 150000);
});

test("null order shapes to null", () => {
  assert.equal(shapeOrderDetail(null), null);
});
