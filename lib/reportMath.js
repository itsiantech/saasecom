const { toPaisa, fromPaisa } = require("./money");

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function orderTotalPaisa(order) {
  return Math.max(0, toPaisa(order && order.totalAmount));
}

function orderShippingPaisa(order) {
  return Math.max(0, toPaisa(order && order.shippingAmount));
}

function orderCouponDiscountPaisa(order) {
  if (!order) return 0;
  const stored = Math.round(num(order.couponDiscountPaisa));
  if (stored > 0) return stored;
  return Math.max(0, toPaisa(order.couponDiscount));
}

function itemQuantity(item) {
  return Math.max(0, Math.trunc(num(item && item.quantity)));
}

function itemGrossPaisa(item) {
  if (!item) return 0;
  const qty = itemQuantity(item);
  const unitPaisa = Math.round(num(item.unitPricePaisa));
  if (unitPaisa > 0) return Math.max(0, unitPaisa * qty);
  const unitBdt = num(item.unitPrice);
  if (unitBdt > 0) return Math.max(0, toPaisa(unitBdt) * qty);
  return Math.max(0, toPaisa(item.price));
}

// Largest-remainder split so the parts always add up to the exact total.
function allocateProportionally(totalPaisa, weights) {
  const total = Math.max(0, Math.round(num(totalPaisa)));
  const list = (weights || []).map((weight) => Math.max(0, Math.round(num(weight))));
  if (!list.length) return [];
  if (total === 0) return list.map(() => 0);

  const sum = list.reduce((acc, value) => acc + value, 0);
  if (sum === 0) {
    const base = Math.floor(total / list.length);
    const remainder = total - base * list.length;
    return list.map((_, index) => base + (index < remainder ? 1 : 0));
  }

  const raw = list.map((weight) => (total * weight) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((acc, value) => acc + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  let cursor = 0;
  while (left > 0) {
    out[order[cursor % order.length].index] += 1;
    left -= 1;
    cursor += 1;
  }
  return out;
}

// Product/category revenue excludes shipping and follows the order's actual
// merchandise value (so coupon and installment adjustments are included).
function allocateOrderRevenue(order) {
  const items = Array.isArray(order && order.items) ? order.items : [];
  const merchandise = Math.max(0, orderTotalPaisa(order) - orderShippingPaisa(order));
  const weights = items.map(itemGrossPaisa);
  const revenue = allocateProportionally(merchandise, weights);
  return items.map((item, index) => ({
    productId: item.product,
    quantity: itemQuantity(item),
    grossPaisa: weights[index],
    revenuePaisa: revenue[index] || 0,
  }));
}

function refundAtOf(order) {
  const at = order && order.installmentPlan && order.installmentPlan.cancellation
    ? order.installmentPlan.cancellation.at
    : null;
  if (!at) return null;
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? null : date;
}

function refundPaisaOf(order) {
  const raw = order && order.installmentPlan && order.installmentPlan.cancellation
    ? order.installmentPlan.cancellation.refundPaisa
    : 0;
  return Math.max(0, Math.round(num(raw)));
}

function averageDailyPaisa(salesPaisa, days) {
  const count = Math.max(1, Math.trunc(num(days)));
  return Math.round(Math.max(0, num(salesPaisa)) / count);
}

function netSalesPaisa({ salesPaisa, refundsPaisa, shippingPaisa, taxPaisa }) {
  return Math.round(num(salesPaisa) - num(refundsPaisa) - num(shippingPaisa) - num(taxPaisa));
}

function bdtOf(paisa) {
  return fromPaisa(paisa);
}

module.exports = {
  orderTotalPaisa,
  orderShippingPaisa,
  orderCouponDiscountPaisa,
  itemQuantity,
  itemGrossPaisa,
  allocateProportionally,
  allocateOrderRevenue,
  refundAtOf,
  refundPaisaOf,
  averageDailyPaisa,
  netSalesPaisa,
  bdtOf,
};
