/* ==========================================================================
   Order catalog — list page query builders (tabs, search, advanced search)
   Pure logic; the controller feeds params and runs the Mongo queries.
   ========================================================================== */

// Tabs on the order list page. "all" never includes incomplete orders.
const ORDER_TABS = [
  "all",
  "incomplete",
  "pending",
  "processing",
  "on_the_way",
  "in_courier",
  "call_not_received",
  "completed",
  "unpaid",
  "cancelled",
];

// Legacy statuses (confirmed / shipped / delivered) stay visible in "All"
// and keep working through the status dropdown for backward compatibility.
const LEGACY_STATUSES = ["confirmed", "shipped", "delivered"];

const ALL_STATUSES = [
  "pending", "processing", "on_the_way", "in_courier",
  "call_not_received", "completed", "incomplete", "cancelled",
  ...LEGACY_STATUSES,
];

// paymentStatus values that read as "Unpaid" on the UI badge
const UNPAID_PAYMENT_STATUSES = ["pending", "failed", "overdue"];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ---- search: order number, customer name, phone ---- */
function applyOrderSearch(query, search) {
  const s = String(search || "").trim();
  if (!s) return query;
  const rx = new RegExp(escapeRegex(s), "i");
  const iLikeOrder = /^\d{7,}$/; // numeric-only search also hits the order/phone as text
  query.$or = [
    { orderNumber: rx },
    { invoiceNumber: rx },
    { customerName: rx },
    { customerPhone: rx },
    ...(iLikeOrder.test(s) ? [{ customerPhone: s }] : []),
  ];
  return query;
}

/* ---- advanced search params: category, sku, payment, courier, date range ---- */
// categoryProductIds / skuProductIds are resolved by the controller (needs Product).
function applyOrderAdvanced(query, advanced, productIds) {
  advanced = advanced || {};

  // Category and/or SKU narrow the order set to items containing such products.
  if (productIds && productIds.length) {
    query["items.product"] = { $in: productIds };
  } else if (productIds && productIds.length === 0) {
    // filter present but no product matched — force an empty result
    query["items.product"] = { $in: [null] };
  }

  // Payment tab mapping: paid | partial | unpaid
  if (advanced.payment === "paid") query.paymentStatus = "paid";
  else if (advanced.payment === "partial") query.paymentStatus = "partially_paid";
  else if (advanced.payment === "unpaid") {
    query.status = query.status || {}; // avoid clashing with the status filter below
    query.paymentStatus = { $nin: ["paid", "partially_paid", "refunded", "cancelled"] };
  }

  if (advanced.courier) query.courierName = new RegExp(escapeRegex(advanced.courier), "i");

  const range = {};
  if (advanced.from) {
    const d = new Date(advanced.from);
    if (!Number.isNaN(d.getTime())) range.$gte = d;
  }
  if (advanced.to) {
    const d = new Date(advanced.to);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999); // "to date" is inclusive
      range.$lte = d;
    }
  }
  if (range.$gte || range.$lte) query.createdAt = range;
  return query;
}

/* ---- tab filter on top of search/advanced ---- */
function applyOrderTab(query, tab) {
  switch (tab) {
    case "all":
      query.status = { $ne: "incomplete" }; // All orders excludes incomplete
      break;
    case "incomplete":
      query.status = "incomplete";
      break;
    case "pending":
      query.status = "pending";
      break;
    case "processing":
      query.status = "processing";
      break;
    case "on_the_way":
      query.status = "on_the_way";
      break;
    case "in_courier":
      query.status = "in_courier";
      break;
    case "call_not_received":
      query.status = "call_not_received";
      break;
    case "completed":
      query.status = "completed";
      break;
    case "cancelled":
      query.status = "cancelled";
      break;
    case "unpaid":
      // Unpaid = payment unpaid AND order not cancelled / incomplete
      query.status = { $nin: ["cancelled", "incomplete"] };
      query.paymentStatus = { $in: UNPAID_PAYMENT_STATUSES };
      break;
    default:
      query.status = { $ne: "incomplete" };
  }
  return query;
}

function buildOrderQuery({ tab = "all", search = "", advanced = {}, productIds = null } = {}) {
  const query = {};
  applyOrderAdvanced(query, advanced, productIds);
  applyOrderTab(query, tab);
  applyOrderSearch(query, search);
  return query;
}

/* ---- payment badge ui mapping ---- */
function paymentBadge(paymentStatus) {
  if (paymentStatus === "paid") return { label: "Paid", kind: "paid" };
  if (paymentStatus === "partially_paid") return { label: "Partial", kind: "partial" };
  if (paymentStatus === "refunded") return { label: "Refunded", kind: "partial" };
  return { label: "Unpaid", kind: "unpaid" };
}

module.exports = {
  ORDER_TABS,
  ALL_STATUSES,
  LEGACY_STATUSES,
  UNPAID_PAYMENT_STATUSES,
  escapeRegex,
  applyOrderSearch,
  applyOrderAdvanced,
  applyOrderTab,
  buildOrderQuery,
  paymentBadge,
};
