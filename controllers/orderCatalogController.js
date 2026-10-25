const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Payment = require("../models/Payment");
const OrderInstallment = require("../models/OrderInstallment");
const OrderStatusHistory = require("../models/OrderStatusHistory");
const { isWholesale, isPartialPaymentActive } = require("../lib/wholesaleSettings");
const { isInternational } = require("../lib/internationalSettings");
const { getStoreId } = require("../lib/tenantContext");
const { writeAudit } = require("../lib/audit");
const User = require("../models/User");
const {
  ORDER_TABS,
  ALL_STATUSES,
  buildOrderQuery,
  paymentBadge,
  escapeRegex,
} = require("../services/orderCatalog");
const { changeOrderStatus, OrderStatusError } = require("../services/orderStatusChange");
const { shapeOrderDetail } = require("../services/orderDetail");

function storeOf(req) {
  if (req.store && req.store._id) return req.store._id;
  return getStoreId();
}

function validIds(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id) => mongoose.Types.ObjectId.isValid(id)).map(String);
}

// COD / bKash / Nagad / Card / Bank style label for the payment column
function paymentMethodLabel(order) {
  const known = {
    cod: "COD",
    mobile: /bkash|bKash/i.test(order.paymentDetails && order.paymentDetails.gateway ? order.paymentDetails.gateway : "")
      ? "bKash"
      : "Mobile banking",
    bank: "Bank",
    card: "Card",
    gateway: order.paymentDetails && order.paymentDetails.gateway ? order.paymentDetails.gateway : "Card",
  };
  if (order.paymentLabel) return order.paymentLabel; // checkout theke prepended label ache
  return known[order.paymentMethod] || order.paymentMethod || "—";
}

function readAdvanced(req) {
  const q = req.query || {};
  return {
    category: String(q.category || "").trim(),
    sku: String(q.sku || "").trim(),
    payment: ["paid", "partial", "unpaid"].includes(q.payment) ? q.payment : "",
    courier: String(q.courier || "").trim(),
    from: String(q.from || "").trim(),
    to: String(q.to || "").trim(),
  };
}

// category id / SKU text → product ids (items.product filter er jonno)
async function resolveProductIds(storeId, advanced) {
  const useCategory = advanced.category && mongoose.Types.ObjectId.isValid(advanced.category);
  const useSku = !!advanced.sku;
  if (!useCategory && !useSku) return null;

  const query = { store: storeId };
  if (useCategory) query.categories = advanced.category;
  if (useSku) query.sku = new RegExp(escapeRegex(advanced.sku), "i");
  return Product.find(query).select("_id").lean().then((rows) => rows.map((r) => String(r._id)));
}

// installment orders er jonno "Installment N of M" label banay
async function installmentProgress(orderIds) {
  if (!orderIds.length) return {};
  const rows = await OrderInstallment.find({ order: { $in: orderIds } }).select("order number status").lean();
  const map = {};
  for (const r of rows) {
    const key = String(r.order);
    const cur = map[key] || { total: 0, paid: 0 };
    cur.total = Math.max(cur.total, Number(r.number) || 0);
    if (r.status === "paid") cur.paid += 1;
    map[key] = cur;
  }
  return map;
}

/* GET /api/orders/list?tab=&search=&category=&sku=&payment=&courier=&from=&to=&page=&limit= */
async function list(req, res, next) {
  try {
    const storeId = storeOf(req);
    const [wholesale, partialActive, international] = await Promise.all([
      isWholesale(storeId),
      isPartialPaymentActive(storeId),
      isInternational(storeId),
    ]);

    const tab = ORDER_TABS.includes(req.query.tab) ? req.query.tab : "all";
    const search = String(req.query.search || "").trim();
    const advanced = readAdvanced(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const sortBy = req.query.sort === "oldest" ? 1 : -1;

    const productIds = await resolveProductIds(storeId, advanced);
    const query = buildOrderQuery({ tab, search, advanced, productIds });

    const total = await Order.countDocuments(query);
    const rawOrders = await Order.find(query)
      .sort({ createdAt: sortBy })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("items.product", "title name sku images price")
      .lean();
    const ids = rawOrders.map((o) => String(o._id));

    // installment progress only when wholesale + partial payment are on
    const installmentMap = partialActive
      ? await installmentProgress(ids)
      : {};

    const orders = rawOrders.map((o, i) => {
      const items = (o.items || []).map((it) => {
        const p = it.product || {};
        return {
          productId: p._id || null,
          name: p.title || p.name || "Product",
          sku: p.sku || "",
          image: it.image || (p.images && p.images[0]) || "",
          quantity: it.quantity || 0,
          unitPrice: it.unitPrice || it.price || 0,
          linePrice: it.price || ((it.unitPrice || 0) * (it.quantity || 0)),
        };
      });
      const badge = paymentBadge(o.paymentStatus);
      const inst = installmentMap[String(o._id)];
      const methodLabel = paymentMethodLabel(o);
      return {
        id: o._id,
        sl: (page - 1) * limit + i + 1,
        orderNumber: o.orderNumber || "",
        invoiceNumber: o.invoiceNumber || "",
        createdAt: o.createdAt,
        customerName: o.customerName || "",
        customerPhone: o.customerPhone || "",
        address: [o.address, o.thana, o.district, o.division, o.country].filter(Boolean).join(", "),
        country: o.country || "",
        items,
        itemCount: items.length,
        moreCount: Math.max(0, items.length - 1),
        totalAmount: o.totalAmount || 0,
        paidAmount: o.paidAmount || 0,
        dueAmount: o.dueAmount || 0,
        paymentMode: o.paymentMode || "full",
        paymentStatus: o.paymentStatus || "pending",
        paymentBadge: badge,
        paymentMethod: o.paymentMethod || "",
        paymentLabel: o.paymentLabel || methodLabel,
        paymentMethodLabel: methodLabel,
        status: o.status,
        courierName: o.courierName || "",
        installment: partialActive && o.paymentMode === "installment" && inst && inst.total
          ? { current: Math.min(inst.paid + 1, inst.total), total: inst.total }
          : null,
      };
    });

    res.json({
      orders,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      modes: { wholesale, partialPayment: partialActive, international },
    });
  } catch (err) {
    next(err);
  }
}

/* GET /api/orders/counts?tab=&search=... — tab counts follow search + advanced filters */
async function counts(req, res, next) {
  try {
    const storeId = storeOf(req);
    const tab = ORDER_TABS.includes(req.query.tab) ? req.query.tab : "all";
    const search = String(req.query.search || "").trim();
    const advanced = readAdvanced(req);
    const productIds = await resolveProductIds(storeId, advanced);

    const entries = await Promise.all(
      ORDER_TABS.map(async (t) => {
        const count = await Order.countDocuments(buildOrderQuery({ tab: t, search, advanced, productIds }));
        return [t, count];
      })
    );
    res.json({ counts: Object.fromEntries(entries) });
  } catch (err) {
    next(err);
  }
}

/* GET /api/orders/:id/detail — shaped payload for the order details page */
async function detail(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const order = await Order.findById(req.params.id)
      .populate("items.product", "title name sku images price")
      .lean();
    if (!order) return res.status(404).json({ message: "Order pawa jayni" });

    const latest = await OrderStatusHistory.findOne({ order: order._id })
      .sort({ createdAt: -1 })
      .select("note")
      .lean();

    res.json({
      order: {
        ...shapeOrderDetail(order, {
          historyNote: latest && latest.note ? latest.note : "",
        }),
        // invoice / packing-slip public links need the store slug for tenant resolution
        storeSlug: req.store && req.store.slug ? req.store.slug : "",
      },
    });
  } catch (err) {
    next(err);
  }
}

/* GET /api/orders/:id/status-history */
async function history(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const rows = await OrderStatusHistory.find({ order: req.params.id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({
      history: rows.map((h) => ({
        id: h._id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        by: h.by,
        byName: h.byName,
        note: h.note,
        at: h.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/* PATCH /api/orders/:id  { status?, courierName?, note? } — quick edit from the list */
async function quickEdit(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid order id" });
    }
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order pawa jayni" });

    const actor = { id: req.user && req.user.id, name: await userName(req) };

    // status change goes through the shared service (history + notify + audit)
    if (req.body && req.body.status && req.body.status !== order.status) {
      await changeOrderStatus({ orderId: order._id, toStatus: req.body.status, actor, note: req.body.note });
    }

    // courier / note are plain admin fields
    const patch = {};
    if (req.body && typeof req.body.courierName === "string") patch.courierName = req.body.courierName.trim();
    if (req.body && typeof req.body.orderNote === "string") patch.orderNote = req.body.orderNote.trim().slice(0, 2000);
    if (Object.keys(patch).length) {
      await Order.updateOne({ _id: order._id }, { $set: patch });
    }

    const fresh = await Order.findById(order._id).lean();
    res.json({ ok: true, order: fresh });
  } catch (err) {
    if (err instanceof OrderStatusError) return res.status(err.status).json({ message: err.message });
    next(err);
  }
}

async function userName(req) {
  try {
    const u = await User.findById(req.user.id).select("name").lean();
    return (u && u.name) || "";
  } catch {
    return "";
  }
}

/* POST /api/orders/bulk  { ids, action: set_status|delete, status? } */
async function bulk(req, res, next) {
  try {
    const body = req.body || {};
    const ids = validIds(body.ids);
    if (!ids.length || ids.length > 300) {
      return res.status(400).json({ message: "Ids valid na" });
    }

    if (body.action === "set_status") {
      if (!ALL_STATUSES.includes(body.status)) {
        return res.status(400).json({ message: "Status valid na" });
      }
      const actor = { id: req.user && req.user.id, name: await userName(req) };
      let changed = 0;
      for (const id of ids) {
        try {
          await changeOrderStatus({ orderId: id, toStatus: body.status, actor, note: body.note || "Bulk status change" });
          changed += 1;
        } catch {
          /* single order already missing/invalid — keep going */
        }
      }
      await writeAudit({
        store: storeOf(req),
        user: req.user && req.user.id,
        action: "order.bulk_set_status",
        entity: "Order",
        entityId: ids.join(","),
        newValue: { status: body.status, count: changed },
      });
      return res.json({ ok: true, modified: changed, status: body.status });
    }

    if (body.action === "delete") {
      const del = await Promise.all([
        Order.deleteMany({ _id: { $in: ids } }),
        OrderStatusHistory.deleteMany({ order: { $in: ids } }),
        Payment.deleteMany({ order: { $in: ids } }),
        OrderInstallment.deleteMany({ order: { $in: ids } }),
      ]);
      await writeAudit({
        store: storeOf(req),
        user: req.user && req.user.id,
        action: "order.bulk_delete",
        entity: "Order",
        entityId: ids.join(","),
        newValue: { count: del[0].deletedCount },
      });
      return res.json({ ok: true, modified: del[0].deletedCount });
    }

    return res.status(400).json({ message: "Bulk action valid na" });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, counts, history, quickEdit, bulk, detail };
