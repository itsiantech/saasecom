const { test } = require("node:test");
const assert = require("node:assert/strict");

const billing = require("../lib/platformBilling");

test("defaults keep every manual method off until the admin configures it", () => {
  const settings = billing.normalizeSettings({});
  assert.equal(settings.manualEnabled, true);
  for (const id of billing.MANUAL_METHODS) assert.equal(settings[id].enabled, false, id);
  assert.equal(settings.api.enabled, false);
  assert.deepEqual(billing.publicMethods(settings), []);
});

test("normalizer trims values, drops unknown keys and unsafe QR urls", () => {
  const settings = billing.normalizeSettings({
    manualEnabled: false,
    bkash: { enabled: true, number: "  01711111111  ", accountName: "  LUXE ", evil: "<script>" },
    qr: { enabled: true, imageUrl: "javascript:alert(1)" },
    api: { enabled: true, secretKey: "  sk_live_1  " },
  });
  assert.equal(settings.manualEnabled, false);
  assert.equal(settings.bkash.number, "01711111111");
  assert.equal(settings.bkash.accountName, "LUXE");
  assert.equal(settings.bkash.evil, undefined);
  assert.equal(settings.qr.imageUrl, "");
  assert.equal(settings.api.secretKey, "sk_live_1");
});

test("public methods only expose configured manual methods and never API keys", () => {
  const settings = billing.normalizeSettings({
    bkash: { enabled: true, number: "01711111111", accountName: "LUXE" },
    nagad: { enabled: true, number: "" },
    bank: { enabled: true, accountNumber: "1234567890", bankName: "IBBL" },
    qr: { enabled: true, imageUrl: "/uploads/settings/qr.png", accountName: "LUXE" },
    api: { enabled: true, publicKey: "pk_1", secretKey: "sk_1" },
  });
  const rows = billing.publicMethods(settings);
  assert.deepEqual(rows.map((r) => r.id), ["bkash", "bank", "qr"]);

  const raw = JSON.stringify(rows);
  assert.ok(!raw.includes("sk_1"));
  assert.ok(!raw.includes("pk_1"));

  settings.manualEnabled = false;
  assert.deepEqual(billing.publicMethods(settings), []);
});

test("masked settings hide both API keys but keep the last 4", () => {
  const settings = billing.normalizeSettings({ api: { enabled: true, publicKey: "pk_live_abcd", secretKey: "sk_live_wxyz" } });
  const masked = billing.maskedSettings(settings);
  assert.equal(masked.api.publicKey, "••••abcd");
  assert.equal(masked.api.secretKey, "••••wxyz");
});

test("submission validation needs an enabled method, a TRXID and (except bank) a BD phone", () => {
  const settings = billing.normalizeSettings({
    bkash: { enabled: true, number: "01711111111" },
    bank: { enabled: true, accountNumber: "1234567890" },
  });

  assert.equal(billing.validateSubmission({ settings, method: "", trxid: "ABC12345" }).error, "পেমেন্ট মেথড বাছুন");
  assert.match(billing.validateSubmission({ settings, method: "nagad", trxid: "ABC12345" }).error, /চালু নেই/);
  assert.match(billing.validateSubmission({ settings, method: "bkash", senderNumber: "01711111111", trxid: "abc" }).error, /TRXID/);
  assert.match(billing.validateSubmission({ settings, method: "bkash", senderNumber: "017", trxid: "ABC12345" }).error, /১১ ডিজিটে/);

  const ok = billing.validateSubmission({ settings, method: "bkash", senderNumber: "017 1111-1111", trxid: "ABC12345" });
  assert.equal(ok.error, "");
  assert.equal(ok.senderNumber, "01711111111");
  assert.equal(ok.trxid, "ABC12345");

  const bank = billing.validateSubmission({ settings, method: "bank", senderNumber: "", trxid: "TRX-998877" });
  assert.equal(bank.error, "");
});

test("trx key dedupes case-insensitively per method", () => {
  assert.equal(billing.trxKey("bkash", " AbC123 "), "bkash:abc123");
  assert.notEqual(billing.trxKey("bkash", "ABC123"), billing.trxKey("nagad", "ABC123"));
});

test("payment view exposes an invoice link that matches its token", () => {
  const fake = {
    _id: "6650f0000000000000000001",
    invoiceNo: "INV-2026-0007",
    storeName: "Shop",
    storeSlug: "shop",
    planName: "Pro",
    amount: 990,
    method: "bkash",
    methodLabel: "বিকাশ",
    status: "pending",
  };
  const view = billing.paymentView(fake);
  assert.equal(view.invoiceNo, "INV-2026-0007");
  assert.equal(view.methodLabel, "বিকাশ");
  assert.ok(view.invoiceUrl.includes("/api/billing/payments/6650f0000000000000000001/invoice?token="));

  const token = view.invoiceUrl.split("token=")[1];
  assert.equal(billing.checkInvoiceToken(fake, token), true);
  assert.equal(billing.checkInvoiceToken(fake, "0".repeat(32)), false);
  assert.equal(billing.checkInvoiceToken(fake, ""), false);
});

test("due dates default to 30 days when a plan has no duration", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  assert.equal(billing.dueDateAfter(start, 0).toISOString(), "2026-01-31T00:00:00.000Z");
  assert.equal(billing.dueDateAfter(start, 7).toISOString(), "2026-01-08T00:00:00.000Z");
});
