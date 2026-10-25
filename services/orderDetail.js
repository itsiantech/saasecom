/* ==========================================================================
   Order detail shaping — turns an Order document into the JSON the
   dashboard details page renders. Legacy orders (no billing/shipping
   subdocs, no source/device) fall back to flat customer fields.
   ========================================================================== */

const SOURCE_LABELS = {
  google: "Google",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  direct: "Direct",
  other: "Other",
};

const DEVICE_LABELS = {
  mobile: "Mobile",
  tablet: "Tab",
  desktop: "Desktop",
};

function fullAddress(o) {
  return [o.address, o.thana, o.district, o.division, o.postCode, o.country]
    .filter(Boolean)
    .join(", ");
}

function lineTotal(it) {
  const unit = Number(it.unitPrice) || 0;
  const qty = Number(it.quantity) || 0;
  const price = Number(it.price);
  return Number.isFinite(price) && price > 0 ? price : unit * qty;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function contactBlock(order, sub, legacyAddress) {
  const s = sub || {};
  return {
    name: s.name || order.customerName || "",
    address: s.address || legacyAddress,
    email: s.email || order.customerEmail || "",
    phone: s.phone || order.customerPhone || "",
  };
}

function shapeOrderDetail(order, opts = {}) {
  if (!order) return null;
  const legacyAddress = fullAddress(order);
  const items = (order.items || []).map((it) => {
    const p = it.product || {};
    return {
      productId: p._id || null,
      name: p.title || p.name || it.name || "Product",
      sku: p.sku || it.sku || "",
      image: it.image || (Array.isArray(p.images) && p.images[0]) || "",
      unitPrice: Number(it.unitPrice) || 0,
      quantity: Number(it.quantity) || 0,
      total: lineTotal(it),
    };
  });
  const itemsTotal = round2(items.reduce((sum, it) => sum + it.total, 0));
  const shippingAmount = Number(order.shippingAmount) || 0;
  const orderTotal = Number(order.totalAmount) || round2(itemsTotal + shippingAmount);
  const source = order.orderSource || "";
  const device = order.deviceType || "";

  return {
    id: order._id,
    orderNumber: order.orderNumber || "",
    invoiceNumber: order.invoiceNumber || "",
    createdAt: order.createdAt,
    status: order.status || "pending",
    paymentStatus: order.paymentStatus || "pending",
    paymentMode: order.paymentMode || "full",
    paymentMethod: order.paymentMethod || "",
    paymentLabel: order.paymentLabel || order.paymentMethod || "",
    courierName: order.courierName || "",
    customer: {
      id: order.customer || null,
      name: order.customerName || "",
      email: order.customerEmail || "",
      phone: order.customerPhone || "",
    },
    billing: contactBlock(order, order.billing, legacyAddress),
    shipping: contactBlock(order, order.shipping, legacyAddress),
    origin: {
      value: source,
      label: SOURCE_LABELS[source] || "—",
    },
    device: {
      value: device,
      label: DEVICE_LABELS[device] || "—",
    },
    items,
    itemsTotal,
    shippingLabel: order.shippingLabel || "",
    shippingAmount,
    orderTotal,
    paidAmount: Number(order.paidAmount) || 0,
    dueAmount: Number(order.dueAmount) || 0,
    orderNote: order.orderNote || "",
    historyNote: String(opts.historyNote || ""),
    installment: order.installmentPlan
      ? {
          name: order.installmentPlan.name || "Installment",
          installmentsCount: order.installmentPlan.installmentsCount || 0,
        }
      : null,
  };
}

module.exports = { shapeOrderDetail, SOURCE_LABELS, DEVICE_LABELS };
