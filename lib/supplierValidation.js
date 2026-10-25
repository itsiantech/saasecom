const { fail } = require("./supplierErrors");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const PAYMENT_METHODS = ["cash", "bank", "bkash", "nagad", "other"];

function text(value, { field = "Field", max = 300, required = false } = {}) {
  const s = String(value == null ? "" : value).trim();
  if (required && !s) fail(`${field} lagbe`);
  if (s.length > max) fail(`${field} ${max} character er beshi hote parbe na`);
  return s;
}

function optionalText(value, options) {
  if (value === undefined) return undefined;
  return text(value, options);
}

function normalizePhone(value) {
  let s = String(value == null ? "" : value).trim().replace(/[^\d+]/g, "");
  if (s.startsWith("+")) s = "+" + s.slice(1).replace(/\+/g, "");
  else s = s.replace(/\+/g, "");
  return s;
}

function validatePhone(value) {
  const phone = normalizePhone(value);
  if (!phone) fail("Phone number lagbe");
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 20) fail("Phone number valid na");
  return phone;
}

function validateEmail(value) {
  const email = String(value == null ? "" : value).trim().toLowerCase();
  if (!email) return "";
  if (!EMAIL_RE.test(email)) fail("Email valid na");
  if (email.length > 160) fail("Email 160 character er beshi hote parbe na");
  return email;
}

function validateObjectId(value, field = "ID") {
  const id = String(value == null ? "" : value).trim();
  if (!OBJECT_ID_RE.test(id)) fail(`${field} valid na`);
  return id;
}

function normalizeSupplierInput(body, { partial = false } = {}) {
  const source = body && typeof body === "object" ? body : {};
  const out = {};
  let touched = 0;

  if (!partial || Object.prototype.hasOwnProperty.call(source, "name")) {
    out.name = text(source.name, { field: "Supplier name", max: 120, required: true });
    touched += 1;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(source, "phone")) {
    out.phone = validatePhone(source.phone);
    touched += 1;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(source, "companyName")) {
    out.companyName = text(source.companyName, { field: "Company name", max: 160 });
    touched += 1;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(source, "address")) {
    out.address = text(source.address, { field: "Address", max: 300 });
    touched += 1;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(source, "email")) {
    out.email = validateEmail(source.email);
    touched += 1;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(source, "note")) {
    out.note = text(source.note, { field: "Note", max: 500 });
    touched += 1;
  }

  if (partial && !touched) fail("Update korar jonno kono field din");
  return out;
}

function normalizeIdempotencyKey(value) {
  const key = String(value == null ? "" : value).trim();
  if (!key) fail("Idempotency-Key header lagbe");
  if (!IDEMPOTENCY_RE.test(key)) {
    fail("Idempotency-Key 8-128 character er hote hobe (letter, number, . _ : -)");
  }
  return key;
}

function normalizeOrderInput(body, { maxOrderQty = 10000 } = {}) {
  const source = body && typeof body === "object" ? body : {};
  const rows = Array.isArray(source.items) ? source.items : [];
  if (!rows.length) fail("Order e ontoto ekta product lagbe");
  if (rows.length > 50) fail("Ek order e 50 er beshi product line chole na");

  const maxQty = Math.max(1, Math.trunc(Number(maxOrderQty) || 10000));
  const seen = new Set();
  const items = rows.map((row, index) => {
    const productId = validateObjectId(row && row.productId, `Item ${index + 1} product`);
    if (seen.has(productId)) fail("Ek product ek order e duibar deya jabe na");
    seen.add(productId);

    const quantity = Number(row && row.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      fail(`Item ${index + 1}: quantity positive integer hote hobe`);
    }
    if (quantity > maxQty) fail(`Item ${index + 1}: quantity ${maxQty} er beshi hote parbe na`);

    const unitCostPaisa = Number(row && row.unitCostPaisa);
    if (!Number.isInteger(unitCostPaisa) || unitCostPaisa < 0) {
      fail(`Item ${index + 1}: unit cost paisa integer hote hobe`);
    }
    if (unitCostPaisa > 1000000000000) fail(`Item ${index + 1}: unit cost beshi hoye geche`);

    return { productId, quantity, unitCostPaisa };
  });

  let orderDate = new Date();
  if (source.orderDate !== undefined && source.orderDate !== "") {
    const parsed = new Date(source.orderDate);
    if (Number.isNaN(parsed.getTime())) fail("Order date valid na");
    orderDate = parsed;
  }

  return {
    items,
    orderDate,
    note: text(source.note, { field: "Order note", max: 500 }),
  };
}

function normalizePaymentInput(body) {
  const source = body && typeof body === "object" ? body : {};
  const amountPaisa = Number(source.amountPaisa);
  if (!Number.isInteger(amountPaisa) || amountPaisa < 1) {
    fail("Payment amount positive paisa integer hote hobe");
  }
  if (amountPaisa > 1000000000000) fail("Payment amount beshi hoye geche");

  const method = String(source.method || "cash").toLowerCase();
  if (!PAYMENT_METHODS.includes(method)) fail("Payment method valid na");

  let paidAt = new Date();
  if (source.paidAt !== undefined && source.paidAt !== "") {
    const parsed = new Date(source.paidAt);
    if (Number.isNaN(parsed.getTime())) fail("Payment date valid na");
    paidAt = parsed;
  }

  return {
    amountPaisa,
    method,
    reference: text(source.reference, { field: "Reference", max: 120 }),
    paidAt,
    note: text(source.note, { field: "Payment note", max: 300 }),
  };
}

function normalizeReason(value, { field = "Reason", required = true, max = 300 } = {}) {
  const s = text(value, { field, max, required });
  if (required && s.length < 3) fail(`${field} ontoto 3 character hote hobe`);
  return s;
}

function normalizeHoldInput(body) {
  const source = body && typeof body === "object" ? body : {};
  const holdFlag = source.holdFlag === true;
  if (holdFlag) {
    return {
      holdFlag: true,
      holdReason: normalizeReason(source.reason || source.holdReason, { field: "Hold reason" }),
    };
  }
  return { holdFlag: false, holdReason: "" };
}

function normalizeStockAdjustment(body) {
  const source = body && typeof body === "object" ? body : {};
  const productId = validateObjectId(source.productId, "Product");
  const change = Number(source.change);
  if (!Number.isInteger(change) || change === 0) fail("Stock change non-zero integer hote hobe");
  if (Math.abs(change) > 1000000) fail("Stock change beshi hoye geche");
  return {
    productId,
    change,
    reason: normalizeReason(source.reason, { field: "Stock adjustment reason" }),
  };
}

function normalizeSettingsInput(body) {
  const source = body && typeof body === "object" ? body : {};
  const out = {};
  if (Object.prototype.hasOwnProperty.call(source, "autoAdjustStock")) {
    if (typeof source.autoAdjustStock !== "boolean") fail("autoAdjustStock boolean hote hobe");
    out.autoAdjustStock = source.autoAdjustStock;
  }
  if (Object.prototype.hasOwnProperty.call(source, "maxOrderQty")) {
    const max = Number(source.maxOrderQty);
    if (!Number.isInteger(max) || max < 1 || max > 1000000) {
      fail("maxOrderQty 1-1000000 er modhye integer hote hobe");
    }
    out.maxOrderQty = max;
  }
  if (!Object.keys(out).length) fail("Kono setting din ni");
  return out;
}

module.exports = {
  EMAIL_RE,
  OBJECT_ID_RE,
  PAYMENT_METHODS,
  normalizePhone,
  validatePhone,
  validateEmail,
  validateObjectId,
  normalizeSupplierInput,
  normalizeIdempotencyKey,
  normalizeOrderInput,
  normalizePaymentInput,
  normalizeReason,
  normalizeHoldInput,
  normalizeStockAdjustment,
  normalizeSettingsInput,
};
