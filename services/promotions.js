const FlashSale = require("../models/FlashSale");
const Coupon = require("../models/Coupon");
const { toPaisa } = require("../lib/money");

/* ------------------------------------------------------------------ *
 * Pure helpers (no DB — easy to unit test)
 * ------------------------------------------------------------------ */

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function timeOf(value) {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

function inWindow(doc, now = new Date()) {
  if (!doc) return false;
  const current = new Date(now).getTime();
  const start = timeOf(doc.startAt);
  const end = timeOf(doc.endAt);
  if (start === null || end === null) return false;
  return current >= start && current <= end;
}

function windowStatus(doc, now = new Date()) {
  const current = new Date(now).getTime();
  const start = timeOf(doc && doc.startAt);
  const end = timeOf(doc && doc.endAt);
  if (start === null || end === null) return "draft";
  if (end < current) return "ended";
  if (start > current) return "upcoming";
  return "live";
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function flashDiscountPaisa(basePaisa, discountPercent) {
  const base = Math.max(0, Math.round(Number(basePaisa) || 0));
  const pct = clampPercent(discountPercent);
  return Math.round((base * pct) / 100);
}

function flashPricePaisa(basePaisa, discountPercent) {
  const base = Math.max(0, Math.round(Number(basePaisa) || 0));
  return Math.max(0, base - flashDiscountPaisa(base, discountPercent));
}

function sameId(a, b) {
  return String(a || "") === String(b || "");
}

function targetCategoryIds(doc) {
  const expanded = Array.isArray(doc && doc.categoryIds) ? doc.categoryIds : [];
  return expanded.length ? expanded : Array.isArray(doc && doc.categories) ? doc.categories : [];
}

function saleMatchesProduct(sale, productId, categoryIds = []) {
  if (!sale) return false;
  if (sale.targetType === "category") {
    const targets = targetCategoryIds(sale);
    return categoryIds.some((id) => targets.some((target) => sameId(target, id)));
  }
  const products = Array.isArray(sale.products) ? sale.products : [];
  return products.some((id) => sameId(id, productId));
}

// Lowest live flash price for one cart line. Returns null when no percentage
// discount applies (a 0% campaign is a highlight only, not a price change).
function bestFlashSale({ sales, productId, categoryIds = [], basePaisa, now = new Date() }) {
  let best = null;
  for (const sale of sales || []) {
    if (!sale || !inWindow(sale, now)) continue;
    if (!saleMatchesProduct(sale, productId, categoryIds)) continue;
    const percent = clampPercent(sale.discountPercent);
    if (percent <= 0) continue;
    const pricePaisa = flashPricePaisa(basePaisa, percent);
    if (!best || pricePaisa < best.pricePaisa) {
      best = {
        sale,
        percent,
        pricePaisa,
        discountPaisa: Math.max(0, Math.round(Number(basePaisa) || 0) - pricePaisa),
      };
    }
  }
  return best;
}

function couponHasTargets(coupon) {
  const products = Array.isArray(coupon && coupon.products) ? coupon.products : [];
  const categories = targetCategoryIds(coupon);
  return products.length > 0 || categories.length > 0;
}

function couponAppliesToLine(coupon, productId, categoryIds = []) {
  if (!coupon) return false;
  if (!couponHasTargets(coupon)) return true;

  const products = Array.isArray(coupon.products) ? coupon.products : [];
  if (products.some((id) => sameId(id, productId))) return true;

  const categories = targetCategoryIds(coupon);
  return categoryIds.some((id) => categories.some((target) => sameId(target, id)));
}

function couponBenefitLabel(coupon) {
  if (!coupon) return "";
  const bits = [];
  if (coupon.discountType === "fixed" && Number(coupon.discountValue) > 0) {
    bits.push("৳" + Number(coupon.discountValue).toLocaleString("en-US") + " off");
  } else if (Number(coupon.discountValue) > 0) {
    bits.push(clampPercent(coupon.discountValue) + "% off");
  }
  if (coupon.freeDelivery) bits.push("free delivery");
  return bits.join(" + ");
}

/*
 * lines: [{ productId, categoryIds: [], amountPaisa }]
 * subtotalPaisa: full cart items subtotal (used for min order)
 * shippingPaisa: current shipping amount (used to value free delivery)
 */
function evaluateCoupon({ coupon, lines, subtotalPaisa, shippingPaisa = 0, now = new Date() }) {
  if (!coupon) return { ok: false, message: "Coupon code valid na" };
  if (!inWindow(coupon, now)) {
    return { ok: false, message: "Coupon er time shuru hoyni ba sesh hoye geche" };
  }

  const subtotal = Math.max(0, Math.round(Number(subtotalPaisa) || 0));
  const minOrderPaisa = toPaisa(coupon.minOrderAmount);
  if (subtotal < minOrderPaisa) {
    return {
      ok: false,
      message:
        "Minimum order ৳" +
        Number(coupon.minOrderAmount).toLocaleString("en-US") +
        " — cart ekhono chhoto",
    };
  }

  let eligiblePaisa = 0;
  for (const line of lines || []) {
    if (!couponAppliesToLine(coupon, line.productId, line.categoryIds || [])) continue;
    eligiblePaisa += Math.max(0, Math.round(Number(line.amountPaisa) || 0));
  }
  if (eligiblePaisa <= 0) {
    return { ok: false, message: "Ei coupon ei cart er kono product e apply hoy na" };
  }

  const percent = coupon.discountType === "percent" ? clampPercent(coupon.discountValue) : 0;
  let discountPaisa = 0;
  if (percent > 0) {
    discountPaisa = Math.round((eligiblePaisa * percent) / 100);
  } else if (coupon.discountType === "fixed") {
    discountPaisa = Math.min(eligiblePaisa, toPaisa(coupon.discountValue));
  }
  discountPaisa = Math.min(eligiblePaisa, Math.max(0, discountPaisa));

  const shipping = Math.max(0, Math.round(Number(shippingPaisa) || 0));
  const freeDelivery = coupon.freeDelivery === true;
  const shippingDiscountPaisa = freeDelivery ? shipping : 0;

  if (discountPaisa <= 0 && !freeDelivery) {
    return { ok: false, message: "Coupon er kono benefit set kora nei" };
  }

  return {
    ok: true,
    coupon,
    eligiblePaisa,
    discountPaisa,
    freeDelivery,
    shippingDiscountPaisa,
    shippingPaisa: Math.max(0, shipping - shippingDiscountPaisa),
  };
}

/* ------------------------------------------------------------------ *
 * DB helpers
 * ------------------------------------------------------------------ */

async function loadLiveFlashSales(storeId, now = new Date()) {
  if (!storeId) return [];
  return FlashSale.find({
    store: storeId,
    startAt: { $lte: now },
    endAt: { $gte: now },
  })
    .select("title description startAt endAt targetType products categories categoryIds discountPercent")
    .lean();
}

async function loadCoupon(storeId, code) {
  const normalized = normalizeCode(code);
  if (!storeId || !normalized) return null;
  return Coupon.findOne({ store: storeId, code: normalized }).lean();
}

function publicFlashSale(sale, now = new Date()) {
  if (!sale) return null;
  return {
    id: sale._id,
    title: sale.title,
    description: sale.description,
    startAt: sale.startAt,
    endAt: sale.endAt,
    discountPercent: clampPercent(sale.discountPercent),
    status: windowStatus(sale, now),
  };
}

function publicCoupon(coupon, now = new Date()) {
  if (!coupon) return null;
  return {
    id: coupon._id,
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: Number(coupon.discountValue) || 0,
    minOrderAmount: Number(coupon.minOrderAmount) || 0,
    freeDelivery: coupon.freeDelivery === true,
    startAt: coupon.startAt,
    endAt: coupon.endAt,
    status: windowStatus(coupon, now),
    label: couponBenefitLabel(coupon),
  };
}

module.exports = {
  normalizeCode,
  inWindow,
  windowStatus,
  clampPercent,
  flashDiscountPaisa,
  flashPricePaisa,
  saleMatchesProduct,
  bestFlashSale,
  couponHasTargets,
  couponAppliesToLine,
  couponBenefitLabel,
  evaluateCoupon,
  loadLiveFlashSales,
  loadCoupon,
  publicFlashSale,
  publicCoupon,
};
