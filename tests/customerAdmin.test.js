/* Customer admin validation / contact fallback tests.
   Run: node --test tests/ */
const test = require("node:test");
const assert = require("node:assert");
const {
  normalizeCustomerUpdate,
  normalizeNote,
  normalizePassword,
  resolveContact,
} = require("../lib/customerAdmin");

test("customer update trims values and normalizes email/phone/address", () => {
  const patch = normalizeCustomerUpdate(
    {
      name: "  Rahim   Uddin ",
      email: " RAHIM@Example.COM ",
      phone: "+8801712345678",
      address: "  12  Road ",
      district: "Dhaka",
      postCode: "1207",
      country: "Bangladesh",
      junk: "ignored",
    },
    { name: "Old", email: "", phone: "" }
  );
  assert.deepStrictEqual(patch, {
    name: "Rahim Uddin",
    email: "rahim@example.com",
    phone: "01712345678",
    shipping: {
      address: "12 Road",
      district: "Dhaka",
      postCode: "1207",
      country: "Bangladesh",
    },
  });
});

test("customer update keeps existing identifier when not supplied", () => {
  const patch = normalizeCustomerUpdate(
    { name: "New Name" },
    { name: "Old", email: "old@example.com", phone: "" }
  );
  assert.deepStrictEqual(patch, { name: "New Name" });
});

test("customer update rejects invalid values and removing both identifiers", () => {
  const current = { name: "Old", email: "old@example.com", phone: "" };
  assert.throws(() => normalizeCustomerUpdate({ name: "  " }, current), /name lagbe/);
  assert.throws(() => normalizeCustomerUpdate({ email: "not-an-email" }, current), /Email valid na/);
  assert.throws(() => normalizeCustomerUpdate({ phone: "12345" }, current), /Phone number valid na/);
  assert.throws(
    () => normalizeCustomerUpdate({ email: "", phone: "" }, current),
    /Email ba phone/
  );
  assert.throws(() => normalizeCustomerUpdate({}, current), /Update korar kichu nei/);
});

test("customer note is trimmed, required and capped at 1000 chars", () => {
  assert.strictEqual(normalizeNote("  Call after 5pm  "), "Call after 5pm");
  assert.throws(() => normalizeNote("   "), /Note likhun/);
  assert.throws(() => normalizeNote("x".repeat(1001)), /1000 character/);
});

test("password reset requires 6+ chars and max 72 bytes", () => {
  assert.throws(() => normalizePassword("12345"), /6 character/);
  assert.throws(() => normalizePassword("a".repeat(73)), /72 byte/);
  assert.strictEqual(normalizePassword("secret1"), "secret1");
});

test("resolveContact prefers account data and falls back to latest order", () => {
  const contact = resolveContact(
    {
      name: "Rahim",
      email: "",
      phone: "01712345678",
      shipping: { address: "", district: "Dhaka" },
    },
    {
      customerName: "Order Name",
      customerEmail: "order@example.com",
      address: "Order Road",
      thana: "Mirpur",
      postCode: "1216",
      country: "Bangladesh",
    }
  );
  assert.deepStrictEqual(contact, {
    name: "Rahim",
    email: "order@example.com",
    phone: "01712345678",
    address: "Order Road",
    thana: "Mirpur",
    district: "Dhaka",
    division: "",
    postCode: "1216",
    country: "Bangladesh",
  });
});
