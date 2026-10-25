const Order = require("../models/Order");
const Product = require("../models/Product");
const ProductCategory = require("../models/ProductCategory");
const Category = require("../models/Category");
const { VALID_ORDER_STATUSES, REPORT_MAX_TIME_MS, REPORT_TIMEZONE } = require("../lib/reportConstants");
const { zonedDateKey, zonedMidnightUtc } = require("../lib/supplierDomain");
const { addDaysKey } = require("../lib/reportPeriods");
const {
  orderTotalPaisa,
  orderShippingPaisa,
  orderCouponDiscountPaisa,
  allocateOrderRevenue,
  itemQuantity,
  refundPaisaOf,
} = require("../lib/reportMath");
const { customerKeyFor, customerIsGuest, customerDisplayName } = require("../lib/reportCustomer");

const ALL_DIMS = ["daily", "products", "categories", "coupons", "customers"];
const ORDER_SELECT =
  "_id createdAt totalAmount shippingAmount couponCode couponLabel couponDiscount couponDiscountPaisa " +
  "items customer customerName customerPhone customerEmail";

function normalizeDims(dims) {
  const set = new Set(Array.isArray(dims) && dims.length ? dims : ALL_DIMS);
  return set;
}

function emptyDaily() {
  return {
    salesPaisa: 0,
    ordersCount: 0,
    itemsCount: 0,
    shippingPaisa: 0,
    couponDiscountPaisa: 0,
    refundsCount: 0,
    refundsAmountPaisa: 0,
    taxPaisa: 0,
  };
}

function emptyDay() {
  return {
    daily: emptyDaily(),
    products: new Map(),
    categories: new Map(),
    coupons: new Map(),
    customers: new Map(),
  };
}

function productNameOf(product, id) {
  if (!product) return `Deleted product ${String(id).slice(-6)}`;
  return product.name || product.title || `Product ${String(id).slice(-6)}`;
}

async function resolveNames(storeId, productIds) {
  const productMap = new Map();
  const primaryCategory = new Map();
  const categoryName = new Map();
  if (!productIds.length) return { productMap, primaryCategory, categoryName };

  const [products, links] = await Promise.all([
    Product.find({ store: storeId, _id: { $in: productIds } }).select("name title").lean(),
    ProductCategory.find({ store: storeId, product: { $in: productIds } })
      .sort({ createdAt: 1, _id: 1 })
      .lean(),
  ]);
  for (const product of products) productMap.set(String(product._id), product);

  const categoryIds = [];
  for (const link of links) {
    const key = String(link.product);
    if (primaryCategory.has(key)) continue; // earliest mapping is the primary category
    primaryCategory.set(key, String(link.category));
    categoryIds.push(link.category);
  }

  if (categoryIds.length) {
    const categories = await Category.find({ store: storeId, _id: { $in: categoryIds } })
      .select("name")
      .lean();
    for (const category of categories) categoryName.set(String(category._id), category.name || "Untitled category");
  }
  return { productMap, primaryCategory, categoryName };
}

function addToMap(map, key, init, apply) {
  let row = map.get(key);
  if (!row) {
    row = init();
    map.set(key, row);
  }
  apply(row);
}

// Computes report rows for one or more local days from raw orders. It is used
// by rebuilds, backfills and the live "today" portion of every read.
async function buildDaysData(
  storeId,
  dayKeys,
  timezone = REPORT_TIMEZONE,
  { dims = ALL_DIMS, maxTimeMS = REPORT_MAX_TIME_MS } = {}
) {
  const keys = [...new Set((dayKeys || []).filter(Boolean))].sort();
  const byDay = new Map();
  if (!keys.length) return { byDay };
  for (const key of keys) byDay.set(key, emptyDay());

  const wanted = normalizeDims(dims);
  const fromKey = keys[0];
  const toKey = keys[keys.length - 1];
  const start = zonedMidnightUtc(fromKey, timezone);
  const end = zonedMidnightUtc(addDaysKey(toKey, 1), timezone);

  const orders = await Order.find({
    store: storeId,
    status: { $in: VALID_ORDER_STATUSES },
    createdAt: { $gte: start, $lt: end },
  })
    .select(ORDER_SELECT)
    .sort({ createdAt: 1 })
    .maxTimeMS(maxTimeMS)
    .lean();

  let refunds = [];
  if (wanted.has("daily")) {
    refunds = await Order.find({
      store: storeId,
      "installmentPlan.cancellation.at": { $gte: start, $lt: end },
      "installmentPlan.cancellation.refundPaisa": { $gt: 0 },
    })
      .select("_id installmentPlan.cancellation")
      .maxTimeMS(maxTimeMS)
      .lean();
    for (const order of refunds) {
      const at = order.installmentPlan && order.installmentPlan.cancellation
        ? new Date(order.installmentPlan.cancellation.at)
        : null;
      if (!at || Number.isNaN(at.getTime())) continue;
      const dayKey = zonedDateKey(at, timezone);
      const bucket = byDay.get(dayKey);
      if (!bucket) continue;
      bucket.daily.refundsCount += 1;
      bucket.daily.refundsAmountPaisa += refundPaisaOf(order);
    }
  }

  let names = null;
  if (wanted.has("products") || wanted.has("categories")) {
    const ids = [];
    const seen = new Set();
    for (const order of orders) {
      for (const item of order.items || []) {
        if (!item.product) continue;
        const id = String(item.product);
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(item.product);
      }
    }
    names = await resolveNames(storeId, ids);
  }

  for (const order of orders) {
    const dayKey = zonedDateKey(order.createdAt, timezone);
    const bucket = byDay.get(dayKey);
    if (!bucket) continue;

    const totalPaisa = orderTotalPaisa(order);
    const shippingPaisa = orderShippingPaisa(order);
    const couponPaisa = orderCouponDiscountPaisa(order);
    const items = order.items || [];

    bucket.daily.salesPaisa += totalPaisa;
    bucket.daily.ordersCount += 1;
    bucket.daily.shippingPaisa += shippingPaisa;
    bucket.daily.couponDiscountPaisa += couponPaisa;
    for (const item of items) bucket.daily.itemsCount += itemQuantity(item);

    if (wanted.has("coupons") && order.couponCode) {
      const code = String(order.couponCode).trim();
      if (code) {
        addToMap(
          bucket.coupons,
          code,
          () => ({ couponCode: code, label: order.couponLabel || "", discountPaisa: 0, ordersCount: 0 }),
          (row) => {
            row.discountPaisa += couponPaisa;
            row.ordersCount += 1;
            if (!row.label && order.couponLabel) row.label = order.couponLabel;
          }
        );
      }
    }

    if (wanted.has("customers")) {
      const key = customerKeyFor(order);
      addToMap(
        bucket.customers,
        key,
        () => ({
          customerKey: key,
          name: customerDisplayName(order),
          isGuest: customerIsGuest(order),
          ordersCount: 0,
          spentPaisa: 0,
        }),
        (row) => {
          row.ordersCount += 1;
          row.spentPaisa += totalPaisa;
          row.name = customerDisplayName(order); // orders are ascending, so this is the latest name
          row.isGuest = customerIsGuest(order);
        }
      );
    }

    if (!wanted.has("products") && !wanted.has("categories")) continue;

    const allocations = allocateOrderRevenue(order);
    const seenProducts = new Set();
    const seenCategories = new Set();
    for (const line of allocations) {
      if (!line.productId) continue;
      const productId = String(line.productId);
      const revenuePaisa = line.revenuePaisa;
      const quantity = line.quantity;

      if (wanted.has("products")) {
        const name = productNameOf(names.productMap.get(productId), productId);
        addToMap(
          bucket.products,
          productId,
          () => ({ productId, name, salesPaisa: 0, quantity: 0, ordersCount: 0 }),
          (row) => {
            row.salesPaisa += revenuePaisa;
            row.quantity += quantity;
            if (!seenProducts.has(productId)) {
              row.ordersCount += 1;
              seenProducts.add(productId);
            }
          }
        );
      }

      if (wanted.has("categories")) {
        const categoryId = names.primaryCategory.get(productId);
        const categoryKey = categoryId || "uncategorized";
        const name = categoryId
          ? names.categoryName.get(categoryId) || "Deleted category"
          : "Uncategorized";
        addToMap(
          bucket.categories,
          categoryKey,
          () => ({ categoryKey, name, salesPaisa: 0, quantity: 0, ordersCount: 0 }),
          (row) => {
            row.salesPaisa += revenuePaisa;
            row.quantity += quantity;
            if (!seenCategories.has(categoryKey)) {
              row.ordersCount += 1;
              seenCategories.add(categoryKey);
            }
          }
        );
      }
    }
  }

  const out = new Map();
  for (const key of keys) {
    const bucket = byDay.get(key);
    out.set(key, {
      date: key,
      daily: bucket.daily,
      products: [...bucket.products.values()],
      categories: [...bucket.categories.values()],
      coupons: [...bucket.coupons.values()],
      customers: [...bucket.customers.values()],
    });
  }
  return { byDay: out };
}

module.exports = {
  ALL_DIMS,
  buildDaysData,
  emptyDaily,
};
