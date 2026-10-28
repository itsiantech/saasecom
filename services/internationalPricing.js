const MODES = ["air", "sea"];

class PricingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function resolveSize(config, sizeKey) {
  const sizes = Array.isArray(config && config.sizes) ? config.sizes : [];
  if (!sizes.length) throw new PricingError("Ei product e size price set kora nei");

  const wanted = sizeKey == null ? "" : String(sizeKey);
  let size = null;
  if (wanted) {
    size = sizes.find((row) => String(row.size) === wanted || String(row.label) === wanted);
  } else if (sizes.length === 1) {
    size = sizes[0];
  }
  if (!size) throw new PricingError("Size select kora hoyni");

  const price = Number(size.price);
  if (!Number.isFinite(price) || price < 0) throw new PricingError("Size price invalid");

  const stock = Math.max(0, Math.floor(Number(size.stock) || 0));
  return {
    key: String(size.size || size.label || ""),
    label: String(size.label || size.size || ""),
    price: round2(price),
    stock,
  };
}

function resolveShipping(config, settings, mode) {
  const selected = String(mode || "air").toLowerCase();
  if (!MODES.includes(selected)) throw new PricingError("Shipping mode air ba sea hote hobe");

  const productRule = (config && config.shipping && config.shipping[selected]) || {};
  const globalRule = (settings && settings[selected]) || {};

  let minDays = Math.max(0, Math.floor(Number(productRule.minDays) || 0));
  let maxDays = Math.max(0, Math.floor(Number(productRule.maxDays) || 0));
  if (!(minDays > 0 && maxDays >= minDays)) {
    minDays = Math.max(0, Math.floor(Number(globalRule.minDays) || 0));
    maxDays = Math.max(0, Math.floor(Number(globalRule.maxDays) || 0));
  }

  // per-kg rate: product override first, then the store-wide rate (0 = flat charge only)
  const productRate = Math.max(0, Number(productRule.ratePerKg) || 0);
  const ratePerKg = productRate > 0 ? productRate : Math.max(0, Number(globalRule.ratePerKg) || 0);

  return {
    mode: selected,
    label: globalRule.label || (selected === "air" ? "Air Shipping" : "Sea Shipping"),
    ratePerKg,
    minDays,
    maxDays,
  };
}

function splitPayment(total, settings) {
  const advancePercent = Number(settings && settings.advancePercent);
  const codPercent = Number(settings && settings.codPercent);
  if (!Number.isFinite(advancePercent) || !Number.isFinite(codPercent)) {
    throw new PricingError("Advance/COD percentage invalid");
  }
  if (round2(advancePercent + codPercent) !== 100) {
    throw new PricingError("Advance + COD percentage 100 hote hobe");
  }

  const safeTotal = round2(total);
  const advance = round2((safeTotal * advancePercent) / 100);
  return {
    advancePercent,
    codPercent,
    advance,
    cod: round2(safeTotal - advance),
  };
}

// All money math for one international line. Never trust client-sent prices.
function calculateLine({ product, sizeKey, quantity = 1, shippingMode = "air", settings }) {
  if (!settings || settings.enabled !== true) {
    throw new PricingError("International product mode bondho ache");
  }

  const config = product && product.internationalConfig;
  if (!config) throw new PricingError("Ei product e international config nei");

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 999) {
    throw new PricingError("Quantity 1 theke 999 er moddhe hote hobe");
  }

  const size = resolveSize(config, sizeKey);
  if (size.stock < qty) throw new PricingError(`Stock e shudhu ${size.stock} ache`);

  const shippingRule = resolveShipping(config, settings, shippingMode);
  const weightPerUnit = Math.max(0, Number(config.dimensions && config.dimensions.weight) || 0);
  const totalWeight = round2(weightPerUnit * qty);
  // China courier is one shipment per line, so it is not multiplied by quantity.
  const chinaCourier = Math.max(0, Number(config.chinaCourierCharge) || 0);
  const weightCharge = round2(totalWeight * shippingRule.ratePerKg);
  const shipping = round2(weightCharge + chinaCourier);
  const subtotal = round2(size.price * qty);
  const total = round2(subtotal + shipping);

  return {
    product: product._id ? String(product._id) : "",
    sizeKey: size.key,
    sizeLabel: size.label,
    unitPrice: size.price,
    quantity: qty,
    availableStock: size.stock,
    weightPerUnit,
    totalWeight,
    shippingMode: shippingRule.mode,
    shippingLabel: shippingRule.label,
    ratePerKg: shippingRule.ratePerKg,
    deliveryDays: { min: shippingRule.minDays, max: shippingRule.maxDays },
    weightCharge,
    chinaCourier,
    shipping,
    subtotal,
    total,
    payment: splitPayment(total, settings),
  };
}

module.exports = { PricingError, calculateLine, resolveSize, resolveShipping, splitPayment, round2 };
