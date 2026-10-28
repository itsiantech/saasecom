const mongoose = require("mongoose");
const Cart = require("../models/Cart");
const Order = require("../models/Order");
const Product = require("../models/Product");
const ProductVariation = require("../models/ProductVariation");
const ProductSwatch = require("../models/ProductSwatch");
const { getStoreId } = require("../lib/tenantContext");
const { randomBytes } = require("crypto");
const {
  getShippingConfig,
  quoteFromConfig,
  getSettingsMap,
  ensureCheckoutFields,
  allocateInvoiceNumber,
} = require("./settingsController");
const { CHECKOUT_FIELDS } = require("../lib/checkoutFields");
const PaymentMobileManual = require("../models/PaymentMobileManual");
const PaymentBankManual = require("../models/PaymentBankManual");
const PaymentGateway = require("../models/PaymentGateway");
const OrderInstallment = require("../models/OrderInstallment");
const Payment = require("../models/Payment");
const User = require("../models/User");
const { notifyOrderPlaced } = require("../lib/notify");
const { getWholesaleSettings } = require("../lib/wholesaleSettings");
const { toPaisa, fromPaisa } = require("../lib/money");
const { buildOrderMeta } = require("../lib/orderMeta");
const {
  loadLiveFlashSales,
  bestFlashSale,
  loadCoupon,
  evaluateCoupon,
  publicCoupon,
  normalizeCode,
  couponBenefitLabel,
} = require("../services/promotions");
const {
  WholesaleCartError,
  retailPricing,
  resolveWholesaleLine,
} = require("../services/cartPricing");
const {
  quoteWholesaleShipping,
  toShippingBreakdown,
} = require("../services/wholesaleShippingQuote");
const {
  prepareInstallmentCheckout,
  createInstallmentRecords,
} = require("../services/installmentCheckout");

const PHONE_RE = /^01[3-9]\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function boolOf(map, key) {
  return String(map[key]) === "true";
}

function normalizePhone(value) {
  let s = String(value || "").replace(/[^\d+]/g, "");
  if (s.startsWith("+880")) s = "0" + s.slice(4);
  return s;
}

function storeIdOf(req) {
  if (req.store && req.store._id) return req.store._id;
  return getStoreId();
}

// Cart identity: logged-in user, otherwise a guest session id.
function cartKey(req) {
  const userId = req.user && req.user.id ? String(req.user.id) : null;
  const sessionId = req.header("x-session-id") || (req.body && req.body.sessionId) || "guest";
  return { user: userId, sessionId: userId ? null : String(sessionId) };
}

async function getOrCreateCart(req) {
  const storeId = storeIdOf(req);
  const key = cartKey(req);
  const filter = { store: storeId, user: key.user || null, sessionId: key.sessionId || null };
  let cart = await Cart.findOne(filter);
  if (!cart) cart = await Cart.create({ ...filter, items: [] });
  return cart;
}

// Current retail price + stock for a cart line's product / variation / swatch.
async function loadLineContext(storeId, item) {
  const product = await Product.findOne({ _id: item.product, store: storeId });
  if (!product) throw new WholesaleCartError("Product pawa jayni");

  let retailPrice = product.salePrice || product.regularPrice || product.price || 0;
  let stock = Number(product.stock) || 0;

  if (item.variation) {
    const variation = await ProductVariation.findOne({
      _id: item.variation,
      product: product._id,
      store: storeId,
    });
    if (!variation) throw new WholesaleCartError("Variation pawa jayni");
    retailPrice = variation.salePrice || variation.regularPrice || retailPrice;
    stock = Number(variation.stock) || 0;
  } else if (item.swatch) {
    const swatch = await ProductSwatch.findOne({
      _id: item.swatch,
      product: product._id,
      store: storeId,
    });
    if (!swatch) throw new WholesaleCartError("Swatch pawa jayni");
    retailPrice = swatch.price || retailPrice;
    stock = Number(swatch.stock) || 0;
  }

  return { product, retailPrice: Number(retailPrice) || 0, stock };
}

function applyPricing(item, pricing) {
  item.unitPrice = pricing.unitPrice;
  item.unitPricePaisa = pricing.unitPricePaisa;
  item.retailUnitPricePaisa = pricing.retailUnitPricePaisa;
  item.pricingMode = pricing.pricingMode;
  item.tierMinQty = pricing.tierMinQty;
  item.tierMaxQty = pricing.tierMaxQty;
  item.flashSale = pricing.flashSale || null;
  item.flashSaleTitle = pricing.flashSaleTitle || "";
  item.flashPercent = Number(pricing.flashPercent) || 0;
}

// Wholesale mode e tier price; off hoile retail price. Flash sale live thakle
// tier/retail er cheye jodi kom hoy tobe flash price-e line chalbe.
async function quoteLine({
  storeId,
  userId,
  item,
  retailPrice,
  forceRetail,
  product = null,
  flashSales = null,
  legacyUnitPrice = null,
  now = new Date(),
}) {
  let wholesale = null;
  if (!forceRetail) {
    wholesale = await resolveWholesaleLine({
      storeId,
      productId: item.product,
      variationId: item.variation,
      quantity: item.quantity,
      retailPrice,
      userId,
    });
  }

  const basePaisa = toPaisa(retailPrice);
  let pricing;
  if (wholesale) {
    pricing = wholesale;
  } else {
    // Retail line er purono snapshot price thakle setai rakhi, kintu flash
    // price always current retail base theke hisheb kore.
    const reference =
      legacyUnitPrice != null && item.pricingMode === "retail" ? legacyUnitPrice : retailPrice;
    pricing = retailPricing(reference);
  }

  let best = null;
  if (flashSales && flashSales.length) {
    best = bestFlashSale({
      sales: flashSales,
      productId: item.product,
      categoryIds: (product && product.categories) || [],
      basePaisa,
      now,
    });
  }

  if (best && best.pricePaisa < toPaisa(pricing.unitPrice)) {
    return {
      unitPrice: fromPaisa(best.pricePaisa),
      unitPricePaisa: best.pricePaisa,
      retailUnitPricePaisa: basePaisa,
      pricingMode: "flash",
      tierMinQty: wholesale ? wholesale.tierMinQty : null,
      tierMaxQty: wholesale ? wholesale.tierMaxQty : null,
      minQty: wholesale ? wholesale.minQty : 1,
      settings: wholesale ? wholesale.settings : null,
      flashSale: best.sale._id,
      flashSaleTitle: best.sale.title,
      flashPercent: best.percent,
    };
  }

  return {
    ...pricing,
    // retailPricing()/resolveWholesaleLine() already return paisa — only the
    // bare retailPrice fallback (taka) needs converting.
    retailUnitPricePaisa:
      pricing.retailUnitPricePaisa != null ? pricing.retailUnitPricePaisa : toPaisa(retailPrice),
    flashSale: null,
    flashSaleTitle: "",
    flashPercent: 0,
  };
}

function lineCategories(product) {
  return (product && Array.isArray(product.categories) ? product.categories : []).map(String);
}

function couponLinesFromPricedItems(pricedItems) {
  return pricedItems.map(({ item, pricing, context }) => ({
    productId: item.product,
    categoryIds: lineCategories(context && context.product),
    amountPaisa: Math.round(Number(pricing.unitPricePaisa) || 0) * item.quantity,
  }));
}

function couponExtra(storeId, couponCode, lines, subtotalPaisa, shippingPaisa = 0) {
  return loadCoupon(storeId, couponCode).then((coupon) => {
    if (!coupon) {
      return {
        coupon: null,
        couponError: couponCode ? "Coupon code pawa jayni" : "",
        eligiblePaisa: 0,
        discountPaisa: 0,
        freeDelivery: false,
      };
    }
    if (!normalizeCode(couponCode) || coupon.code !== normalizeCode(couponCode)) {
      return {
        coupon: publicCoupon(coupon),
        couponError: "Coupon code valid na",
        eligiblePaisa: 0,
        discountPaisa: 0,
        freeDelivery: false,
      };
    }
    const result = evaluateCoupon({
      coupon,
      lines,
      subtotalPaisa,
      shippingPaisa,
    });
    if (!result.ok) {
      return {
        coupon: publicCoupon(coupon),
        couponError: result.message,
        eligiblePaisa: 0,
        discountPaisa: 0,
        freeDelivery: false,
      };
    }
    return {
      coupon: { ...publicCoupon(coupon), label: couponBenefitLabel(coupon) },
      couponError: "",
      eligiblePaisa: result.eligiblePaisa,
      discountPaisa: result.discountPaisa,
      freeDelivery: result.freeDelivery,
    };
  });
}

function couponPayload(info) {
  if (!info || !info.coupon) return null;
  return {
    ...info.coupon,
    discountPaisa: info.discountPaisa || 0,
    discount: fromPaisa(info.discountPaisa),
    eligiblePaisa: info.eligiblePaisa || 0,
    freeDelivery: info.freeDelivery === true,
    error: info.couponError || "",
  };
}

// Shared with installment preview so the schedule matches checkout.
async function cartCouponInfo(storeId, cart, shippingPaisa = 0) {
  const lines = await couponLinesForCart(storeId, cart);
  const subtotalPaisa = lines.reduce((sum, line) => sum + line.amountPaisa, 0);
  let info = { coupon: null, couponError: "", discountPaisa: 0, eligiblePaisa: 0, freeDelivery: false };
  if (cart.couponCode) {
    info = await couponExtra(storeId, cart.couponCode, lines, subtotalPaisa, shippingPaisa);
  }
  return { lines, subtotalPaisa, ...info };
}

function wholesalePublic(settings) {
  if (!settings || !settings.enabled) return { enabled: false };
  return {
    enabled: true,
    badgeText: settings.badgeText,
    moq: settings.moq,
    buyers: settings.buyers,
    showRetailPrice: settings.showRetailPrice,
  };
}

// Keeps long-lived carts correct after tier / mode / price changes.
async function couponLinesForCart(storeId, cart) {
  const ids = [...new Set(cart.items.map((item) => String(item.product)))];
  const products = await Product.find({ store: storeId, _id: { $in: ids } })
    .select("categories")
    .lean();
  const categoryMap = new Map(products.map((p) => [String(p._id), p.categories || []]));
  return cart.items.map((item) => ({
    productId: item.product,
    categoryIds: (categoryMap.get(String(item.product)) || []).map(String),
    amountPaisa: Math.round(Number(item.unitPricePaisa) || toPaisa(item.unitPrice)) * item.quantity,
  }));
}

async function refreshCartPricing(req, cart, storeId) {
  const [settings, flashSales] = await Promise.all([
    getWholesaleSettings(storeId),
    loadLiveFlashSales(storeId),
  ]);
  const pricingErrors = [];
  let changed = false;

  for (const item of cart.items) {
    let context;
    try {
      context = await loadLineContext(storeId, item);
    } catch (err) {
      pricingErrors.push({ itemId: String(item._id), message: err.message });
      continue;
    }

    try {
      const pricing = await quoteLine({
        storeId,
        userId: req.user && req.user.id,
        item,
        retailPrice: context.retailPrice,
        // Wholesale OFF hole purono wholesale line retail price-e fire jay.
        forceRetail: !settings.enabled,
        product: context.product,
        flashSales,
      });
      applyPricing(item, pricing);
      changed = true;
    } catch (err) {
      pricingErrors.push({ itemId: String(item._id), message: err.message });
    }
  }

  if (changed) await cart.save();
  return { settings, pricingErrors };
}

/* ------------------------------------------------------------------ *
 * GET /api/cart
 * ------------------------------------------------------------------ */
async function getCart(req, res) {
  const storeId = storeIdOf(req);
  const cart = await getOrCreateCart(req);
  const { settings, pricingErrors } = await refreshCartPricing(req, cart, storeId);
  // Checkout summary te product name/image dekhate populate kori
  const subtotalPaisa = cart.items.reduce(
    (sum, item) => sum + (Number(item.unitPricePaisa) || toPaisa(item.unitPrice)) * item.quantity,
    0
  );
  let coupon = null;
  let couponError = "";
  if (cart.couponCode) {
    const info = await couponExtra(
      storeId,
      cart.couponCode,
      await couponLinesForCart(storeId, cart),
      subtotalPaisa
    );
    coupon = couponPayload(info);
    couponError = info.couponError || "";
  }

  await cart.populate([
    { path: "items.product", select: "name images slug weightKg" },
    // ProductVariation stores the label in termName (swatches use name)
    { path: "items.variation", select: "termName attributeName image" },
    { path: "items.swatch", select: "name" },
  ]);
  res.json({
    items: cart.items,
    wholesale: wholesalePublic(settings),
    pricingErrors,
    coupon,
    couponError,
  });
}

/* ------------------------------------------------------------------ *
 * POST /api/cart/coupon   { code }
 * DELETE /api/cart/coupon
 * ------------------------------------------------------------------ */
async function applyCoupon(req, res) {
  const storeId = storeIdOf(req);
  const cart = await getOrCreateCart(req);
  if (!cart.items.length) return res.status(400).json({ message: "Cart faka" });

  const code = normalizeCode(req.body && req.body.code);
  if (!code) return res.status(400).json({ message: "Coupon code din" });

  await refreshCartPricing(req, cart, storeId);
  const lines = await couponLinesForCart(storeId, cart);
  const subtotalPaisa = lines.reduce((sum, line) => sum + line.amountPaisa, 0);
  const info = await couponExtra(storeId, code, lines, subtotalPaisa);
  if (info.couponError) return res.status(400).json({ message: info.couponError });

  cart.couponCode = info.coupon.code;
  await cart.save();
  res.json({ coupon: couponPayload(info) });
}

async function removeCoupon(req, res) {
  const cart = await getOrCreateCart(req);
  cart.couponCode = "";
  await cart.save();
  res.json({ coupon: null });
}

/* ------------------------------------------------------------------ *
 * GET /api/cart/shipping-quote?speedId=
 * Wholesale shipping: category + vehicle + delivery speed breakdown.
 * ------------------------------------------------------------------ */
async function shippingQuote(req, res) {
  const storeId = storeIdOf(req);
  const cart = await getOrCreateCart(req);
  try {
    const quote = await quoteWholesaleShipping({
      storeId,
      items: cart.items,
      speedId: req.query.speedId || (req.body && req.body.speedId) || "",
    });
    res.json(quote);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
}

/* ------------------------------------------------------------------ *
 * POST /api/cart/items   { productId, variationId?, swatchId?, quantity }
 * Each selected item becomes its own cart line with image + price.
 * ------------------------------------------------------------------ */
async function addItem(req, res) {
  const storeId = storeIdOf(req);
  const { productId, variationId, swatchId } = req.body || {};
  const quantity = Math.max(1, Number(req.body.quantity) || 1);

  if (!productId || !mongoose.isValidObjectId(productId)) {
    return res.status(400).json({ message: "Valid product id lagbe" });
  }

  const product = await Product.findOne({ _id: productId, store: storeId });
  if (!product) return res.status(404).json({ message: "Product pawa jayni" });

  let image = (product.images && product.images[0]) || "";
  let unitPrice = product.salePrice || product.regularPrice || product.price || 0;
  let stock = product.stock;

  if (variationId) {
    const v = await ProductVariation.findOne({ _id: variationId, product: product._id, store: storeId });
    if (!v) return res.status(404).json({ message: "Variation pawa jayni" });
    image = v.image || image;
    unitPrice = v.salePrice || v.regularPrice || unitPrice;
    stock = v.stock;
  } else if (swatchId) {
    const s = await ProductSwatch.findOne({ _id: swatchId, product: product._id, store: storeId });
    if (!s) return res.status(404).json({ message: "Swatch pawa jayni" });
    image = (s.images && s.images[0]) || image;
    unitPrice = s.price || unitPrice;
    stock = s.stock;
  }

  if (quantity > stock) {
    return res.status(400).json({ message: `Stock e sudhu ${stock} piece ache` });
  }

  let pricing;
  try {
    const flashSales = await loadLiveFlashSales(storeId);
    pricing = await quoteLine({
      storeId,
      userId: req.user && req.user.id,
      item: { product: product._id, variation: variationId || null, quantity },
      retailPrice: unitPrice,
      product,
      flashSales,
    });
  } catch (err) {
    return res.status(err.status || 400).json({ message: err.message });
  }

  const cart = await getOrCreateCart(req);
  cart.items.push({
    product: product._id,
    variation: variationId || null,
    swatch: swatchId || null,
    image,
    unitPrice: pricing.unitPrice,
    unitPricePaisa: pricing.unitPricePaisa,
    retailUnitPricePaisa: pricing.retailUnitPricePaisa,
    pricingMode: pricing.pricingMode,
    tierMinQty: pricing.tierMinQty,
    tierMaxQty: pricing.tierMaxQty,
    quantity,
  });
  await cart.save();
  res.status(201).json({ items: cart.items });
}

/* ------------------------------------------------------------------ *
 * PATCH /api/cart/items/:itemId   { quantity }
 * ------------------------------------------------------------------ */
async function updateItem(req, res) {
  const storeId = storeIdOf(req);
  const cart = await getOrCreateCart(req);
  const item = cart.items.id(req.params.itemId);
  if (!item) return res.status(404).json({ message: "Cart item pawa jayni" });

  item.quantity = Math.max(1, Number(req.body.quantity) || 1);

  let context;
  try {
    context = await loadLineContext(storeId, item);
  } catch (err) {
    return res.status(err.status || 400).json({ message: err.message });
  }
  if (item.quantity > context.stock) {
    return res.status(400).json({ message: `Stock e sudhu ${context.stock} piece ache` });
  }

  try {
    const settings = await getWholesaleSettings(storeId);
    const forceRetail = settings.enabled !== true;
    const retailPrice = forceRetail && item.pricingMode !== "wholesale"
      ? item.unitPrice
      : context.retailPrice;
    const pricing = await quoteLine({
      storeId,
      userId: req.user && req.user.id,
      item,
      retailPrice,
      forceRetail,
      product: context.product,
      flashSales: await loadLiveFlashSales(storeId),
    });
    applyPricing(item, pricing);
  } catch (err) {
    return res.status(err.status || 400).json({ message: err.message });
  }

  await cart.save();
  res.json({ items: cart.items });
}

/* ------------------------------------------------------------------ *
 * DELETE /api/cart/items/:itemId
 * ------------------------------------------------------------------ */
async function removeItem(req, res) {
  const cart = await getOrCreateCart(req);
  const item = cart.items.id(req.params.itemId);
  if (!item) return res.status(404).json({ message: "Cart item pawa jayni" });
  item.deleteOne();
  await cart.save();
  res.json({ items: cart.items });
}

/* ------------------------------------------------------------------ *
 * POST /api/orders — place the order and reduce per-variation/swatch stock
 * ------------------------------------------------------------------ */
async function createOrder(req, res) {
  const storeId = storeIdOf(req);
  const cart = await getOrCreateCart(req);
  if (!cart.items.length) return res.status(400).json({ message: "Cart faka" });

  const wholesaleSettings = await getWholesaleSettings(storeId);
  const wholesaleOn = wholesaleSettings.enabled === true;
  const [map, cfg, flashSales] = await Promise.all([
    getSettingsMap(),
    getShippingConfig(storeId),
    loadLiveFlashSales(storeId),
  ]);

  // Login/registration master switch
  if (boolOf(map, "login_registration_enabled") && !(req.user && req.user.id)) {
    return res.status(401).json({ message: "Checkout er age login ba register korun" });
  }

  const body = req.body || {};
  const requestedInstallment = String(body.paymentMode || "full") === "installment";
  const input = body.customer || {};
  const customer = {
    name: String(input.name || body.customerName || "").trim(),
    phone: normalizePhone(input.phone || body.customerPhone || ""),
    email: String(input.email || body.customerEmail || "").trim().toLowerCase(),
    address: String(input.address || "").trim(),
    thana: String(input.thana || "").trim(),
    district: String(input.district || "").trim(),
    division: String(input.division || "").trim(),
    postCode: String(input.postCode || "").trim(),
    country: String(input.country || "").trim(),
  };

  // ---- checkout field validation (settings onujayi) ----
  const fieldDocs = await ensureCheckoutFields();
  const fieldMap = new Map(fieldDocs.map((f) => [f.fieldKey, f]));
  for (const def of CHECKOUT_FIELDS) {
    const f = fieldMap.get(def.key);
    const shown = f ? f.isShown : def.shown;
    if (!shown) continue;
    const required = f ? !!(f.isShown && f.isRequired) : def.required;
    const label = (f && f.label) || def.label;
    const value = customer[def.key];
    if (required && !value) {
      return res.status(400).json({ message: `${label} lagbe` });
    }
    if (def.key === "phone" && value && !PHONE_RE.test(value)) {
      return res.status(400).json({ message: `${label} valid Bangladesh number hote hobe (01XXXXXXXXX)` });
    }
    if (def.key === "email" && value && !EMAIL_RE.test(value)) {
      return res.status(400).json({ message: `${label} valid email na` });
    }
  }

  // ---- payment method validation ----
  const payment = body.payment || {};
  const method = String(payment.method || body.paymentMethod || "").trim();
  if (!method) return res.status(400).json({ message: "Payment method select korun" });

  const [mobileRows, bankRows, gateways] = await Promise.all([
    PaymentMobileManual.find({}).lean(),
    PaymentBankManual.find({}).lean(),
    PaymentGateway.find({ active: true }).lean(),
  ]);

  let paymentLabel = "";
  let gatewayDoc = null;
  let senderNumber = "";
  let transactionId = "";

  const nameAfter = (prefix) => method.slice(prefix.length).trim().toLowerCase();

  if (method === "cod") {
    if (!boolOf(map, "cod_enabled")) return res.status(400).json({ message: "Cash on delivery enable nei" });
    paymentLabel = "Cash on delivery";
  } else if (method.startsWith("mobile:")) {
    if (!boolOf(map, "mobile_banking_enabled")) return res.status(400).json({ message: "Mobile banking enable nei" });
    const name = nameAfter("mobile:");
    const row = mobileRows.find((r) => String(r.name).toLowerCase() === name);
    if (!row) return res.status(400).json({ message: "Mobile banking option pawa jayni" });
    paymentLabel = `Mobile banking — ${row.name}`;

    if (boolOf(map, "mobile_banking_ask_sender")) {
      senderNumber = normalizePhone(payment.senderNumber);
      transactionId = String(payment.transactionId || "").trim();
      if (!senderNumber || !PHONE_RE.test(senderNumber)) {
        return res.status(400).json({ message: "Sender number valid Bangladesh number hote hobe (01XXXXXXXXX)" });
      }
      if (!transactionId) return res.status(400).json({ message: "Transaction ID lagbe" });
    }
  } else if (method.startsWith("bank:")) {
    if (!boolOf(map, "banking_enabled")) return res.status(400).json({ message: "Banking enable nei" });
    const name = nameAfter("bank:");
    const row = bankRows.find((r) => String(r.bankName).toLowerCase() === name);
    if (!row) return res.status(400).json({ message: "Bank option pawa jayni" });
    paymentLabel = `Bank transfer — ${row.bankName}`;
  } else if (method.startsWith("gateway:")) {
    const name = nameAfter("gateway:");
    const gw = gateways.find((g) => String(g.name).toLowerCase() === name);
    if (!gw) return res.status(400).json({ message: "Payment gateway active nei" });
    if (gw.type === "mobile" && !boolOf(map, "api_mobile_enabled")) {
      return res.status(400).json({ message: "Mobile banking API enable nei" });
    }
    if (gw.type === "bank" && !boolOf(map, "api_banking_enabled")) {
      return res.status(400).json({ message: "Banking API enable nei" });
    }
    gatewayDoc = gw;
    paymentLabel = `${gw.name} (${gw.mode})`;
  } else {
    return res.status(400).json({ message: "Payment method valid na" });
  }

  if (requestedInstallment && !/^(mobile|bank):/.test(method)) {
    return res.status(400).json({
      message: "Installment er first payment manual mobile/bank method diye dite hobe",
    });
  }

  // Fresh server-side price snapshot — tier price is never trusted from the client.
  const pricedItems = [];
  for (const item of cart.items) {
    let context;
    try {
      context = await loadLineContext(storeId, item);
    } catch (err) {
      return res.status(err.status || 400).json({ message: err.message });
    }
    if (item.quantity > context.stock) {
      return res.status(400).json({ message: "Stock shed sathe somoy emon hoye geche" });
    }

    let pricing;
    try {
      // Wholesale OFF hole purono wholesale line current retail price-e fire jay;
      // retail line er purono snapshot price-i thake (flash line current retail).
      // retailPricing() taka ney — item.unitPrice already BDT, so no toPaisa() here.
      const legacyUnitPrice =
        !wholesaleOn && item.pricingMode === "retail" ? Number(item.unitPrice) || 0 : null;
      pricing = await quoteLine({
        storeId,
        userId: req.user && req.user.id,
        item,
        retailPrice: context.retailPrice,
        forceRetail: !wholesaleOn,
        product: context.product,
        flashSales,
        legacyUnitPrice,
      });
    } catch (err) {
      return res.status(err.status || 400).json({ message: err.message });
    }
    pricedItems.push({ item, pricing, context });
  }

  const itemsSubtotalPaisa = pricedItems.reduce(
    (sum, { item, pricing }) => sum + pricing.unitPricePaisa * item.quantity,
    0
  );
  let couponInfo = { coupon: null, couponError: "", discountPaisa: 0, freeDelivery: false };
  if (cart.couponCode) {
    couponInfo = await couponExtra(
      storeId,
      cart.couponCode,
      couponLinesFromPricedItems(pricedItems),
      itemsSubtotalPaisa
    );
    if (couponInfo.couponError) {
      return res.status(400).json({ message: couponInfo.couponError });
    }
  }
  const couponDiscountPaisa = couponInfo.discountPaisa || 0;
  const couponFreeDelivery = couponInfo.freeDelivery === true;
  const discountedItemsPaisa = Math.max(0, itemsSubtotalPaisa - couponDiscountPaisa);

  let wholesaleShipping = null;
  if (wholesaleOn) {
    try {
      wholesaleShipping = await quoteWholesaleShipping({
        storeId,
        items: pricedItems.map(({ item }) => ({
          product: item.product,
          quantity: item.quantity,
        })),
        speedId: body.shipping && body.shipping.speedId ? body.shipping.speedId : "",
      });
    } catch (err) {
      return res.status(err.status || 400).json({ message: err.message });
    }
  }

  let installmentCheckout = null;
  if (requestedInstallment) {
    try {
      installmentCheckout = await prepareInstallmentCheckout({
        storeId,
        user: req.user,
        settings: wholesaleSettings,
        planId: body.planId,
        itemsAmountPaisa: discountedItemsPaisa,
        shippingAmountPaisa:
          wholesaleShipping && !couponFreeDelivery ? wholesaleShipping.totalPaisa : 0,
      });
    } catch (err) {
      return res.status(err.status || 400).json({ message: err.message });
    }

    if (installmentCheckout.firstPaisa > 0) {
      if (!transactionId) transactionId = String(payment.transactionId || "").trim();
      if (!transactionId) {
        return res.status(400).json({ message: "First installment er transaction ID lagbe" });
      }
      if (method.startsWith("mobile:") && !senderNumber) {
        senderNumber = normalizePhone(payment.senderNumber);
        if (!PHONE_RE.test(senderNumber)) {
          return res.status(400).json({ message: "First installment er sender number lagbe" });
        }
      }
    }
  }

  // Stage 1 — pre-check every line against live stock
  for (const item of cart.items) {
    const isVar = item.variation, isSwat = item.swatch;
    if (!isVar && !isSwat) continue;
    const Model = isVar ? ProductVariation : ProductSwatch;
    const doc = await Model.findOne({ _id: isVar || isSwat, store: storeId }).select("stock");
    if (!doc || doc.stock < item.quantity) {
      return res.status(400).json({ message: "Stock shed sathe somoy emon hoye geche" });
    }
  }

  // Stage 2 — atomically decrement (guarded), with rollback if any line fails
  const decreased = [];
  for (const item of cart.items) {
    if (item.variation || item.swatch) {
      const Model = item.variation ? ProductVariation : ProductSwatch;
      const target = item.variation || item.swatch;
      const stockDoc = await Model.findOneAndUpdate(
        { _id: target, store: storeId, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } },
        { new: true }
      );
      if (!stockDoc) {
        for (const d of decreased) {
          await d.model.updateOne({ _id: d.id }, { $inc: { stock: d.qty } });
        }
        return res.status(400).json({ message: "Stock shed sathe somoy emon hoye geche" });
      }
      decreased.push({ model: Model, id: target, qty: item.quantity });
    } else if (wholesaleOn) {
      // Simple wholesale lines use the base Product stock.
      const stockDoc = await Product.findOneAndUpdate(
        { _id: item.product, store: storeId, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } },
        { new: true }
      );
      if (!stockDoc) {
        for (const d of decreased) {
          await d.model.updateOne({ _id: d.id }, { $inc: { stock: d.qty } });
        }
        return res.status(400).json({ message: "Stock shed sathe somoy emon hoye geche" });
      }
      decreased.push({ model: Product, id: item.product, qty: item.quantity });
    }
  }

  const lineItems = pricedItems.map(({ item, pricing }) => ({
    product: item.product,
    variation: item.variation,
    swatch: item.swatch,
    image: item.image,
    unitPrice: pricing.unitPrice,
    unitPricePaisa: pricing.unitPricePaisa,
    retailUnitPricePaisa: pricing.retailUnitPricePaisa,
    pricingMode: pricing.pricingMode,
    tierMinQty: pricing.tierMinQty,
    tierMaxQty: pricing.tierMaxQty,
    flashSale: pricing.flashSale || null,
    flashSaleTitle: pricing.flashSaleTitle || "",
    flashPercent: Number(pricing.flashPercent) || 0,
    quantity: item.quantity,
    price: fromPaisa(pricing.unitPricePaisa * item.quantity),
  }));

  // ---- shipping ----
  const shipping = body.shipping || {};
  const shippingContext = { ...(shipping.context || {}) };
  if (!shippingContext.district && customer.district) shippingContext.district = customer.district;
  const quotes = quoteFromConfig(cfg, {
    ...shippingContext,
    orderTotal: fromPaisa(discountedItemsPaisa),
  });
  let shippingAmount = 0;
  let shippingLabel = "";
  let shippingBreakdown = null;
  let deliverySpeed = "";

  if (wholesaleOn) {
    shippingAmount = fromPaisa(wholesaleShipping.totalPaisa);
    deliverySpeed = wholesaleShipping.speed ? wholesaleShipping.speed.name : "";
    shippingLabel = deliverySpeed ? `Wholesale shipping — ${deliverySpeed}` : "Wholesale shipping";
    shippingBreakdown = toShippingBreakdown(wholesaleShipping);
  } else if (shipping.label) {
    const match = quotes.find((q) => q.label === shipping.label);
    if (!match) return res.status(400).json({ message: "Shipping option valid na" });
    shippingAmount = Number(match.amount) || 0;
    shippingLabel = match.label;
  } else if (cfg.enabled.area) {
    // District field diye automatically area shipping price
    const auto = quotes.find((q) => q.type === "area");
    if (auto) {
      shippingAmount = Number(auto.amount) || 0;
      shippingLabel = auto.label;
    }
  }

  if (couponFreeDelivery) {
    shippingAmount = 0;
    shippingLabel = shippingLabel ? `${shippingLabel} (free delivery)` : "Free delivery";
  }

  if (installmentCheckout && !customer.phone) {
    customer.phone = installmentCheckout.buyerPhone;
  }

  const invoiceNumber = await allocateInvoiceNumber(storeId).catch(() => "");
  const meta = buildOrderMeta(req, body.meta || {});
  const contactAddress = [
    customer.address, customer.thana, customer.district,
    customer.division, customer.postCode, customer.country,
  ].filter(Boolean).join(", ");
  const contact = {
    name: customer.name || "Guest",
    address: contactAddress,
    email: customer.email,
    phone: customer.phone,
  };

  let order;
  let installmentRecords = null;
  try {
    order = await Order.create({
      store: storeId,
      orderNumber: "ORD-" + Date.now().toString(36).toUpperCase() + "-" + randomBytes(2).toString("hex").toUpperCase(),
      invoiceNumber,
      customer: req.user && req.user.id ? req.user.id : null,
      customerName: customer.name || "Guest",
      customerEmail: customer.email,
      customerPhone: customer.phone,
      address: customer.address,
      thana: customer.thana,
      district: customer.district,
      division: customer.division,
      postCode: customer.postCode,
      country: customer.country,
      orderNote: meta.orderNote,
      orderSource: meta.orderSource,
      deviceType: meta.deviceType,
      billing: contact,
      shipping: contact,
      items: lineItems,
      shippingLabel,
      shippingAmount,
      shippingBreakdown,
      deliverySpeed,
      paymentMethod: method,
      paymentLabel,
      paymentDetails: {
        senderNumber,
        transactionId,
        gateway: gatewayDoc ? gatewayDoc.name : "",
        mode: gatewayDoc ? gatewayDoc.mode : "",
      },
      couponCode: couponInfo.coupon ? couponInfo.coupon.code : "",
      couponType: couponInfo.coupon ? couponInfo.coupon.discountType : "",
      couponValue: couponInfo.coupon ? Number(couponInfo.coupon.discountValue) || 0 : 0,
      couponLabel: couponInfo.coupon ? couponBenefitLabel(couponInfo.coupon) : "",
      couponDiscountPaisa,
      couponDiscount: fromPaisa(couponDiscountPaisa),
      couponFreeDelivery,
      totalAmount: fromPaisa(discountedItemsPaisa) + shippingAmount,
      status: "pending",
      paymentStatus: "pending",
    });

    if (installmentCheckout) {
      order.paymentMode = "installment";
      order.totalAmount = fromPaisa(installmentCheckout.totalPaisa);
      order.dueAmount = installmentCheckout.totalPaisa;
      order.installmentPlan = installmentCheckout.planSnapshot;
      await order.save();

      installmentRecords = await createInstallmentRecords({
        storeId,
        order,
        checkout: installmentCheckout,
        payment: { method, methodLabel: paymentLabel, senderNumber, transactionId },
      });
    }
  } catch (err) {
    if (order) {
      await Payment.deleteMany({ order: order._id }).catch(() => null);
      await OrderInstallment.deleteMany({ order: order._id }).catch(() => null);
      await Order.deleteOne({ _id: order._id }).catch(() => null);
    }
    for (const d of decreased) {
      await d.model.updateOne({ _id: d.id }, { $inc: { stock: d.qty } });
    }
    return res.status(400).json({ message: err.message });
  }

  // Logged-in customer er details porer bar pre-fill er jonno save
  if (req.user && req.user.id) {
    const upd = {};
    ["name", "phone", "email", "address", "thana", "district", "division", "postCode", "country"].forEach((k) => {
      if (customer[k]) upd["shipping." + k] = customer[k];
    });
    if (Object.keys(upd).length) {
      await User.updateOne({ _id: req.user.id }, { $set: upd }).catch(() => null);
    }
  }

  cart.items = [];
  cart.couponCode = "";
  await cart.save();

  // Email + SMS best-effort — fail korle order response block korbe na
  notifyOrderPlaced(order).catch(() => {});

  res.status(201).json(
    installmentRecords
      ? {
          ok: true,
          order,
          installments: installmentRecords.installments,
          initialPayment: installmentRecords.payment,
        }
      : { ok: true, order }
  );
}

module.exports = {
  getCart,
  getOrCreateCart,
  refreshCartPricing,
  shippingQuote,
  addItem,
  updateItem,
  removeItem,
  applyCoupon,
  removeCoupon,
  cartCouponInfo,
  createOrder,
};
