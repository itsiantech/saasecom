const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Order = require("../models/Order");
const Store = require("../models/Store");
const User = require("../models/User");
const SiteSetting = require("../models/SiteSetting");
const InvoiceSetting = require("../models/InvoiceSetting");
const { buildInvoiceHtml } = require("../lib/invoice");
const { buildPackingSlipHtml } = require("../lib/packingSlip");
const { makeOrderDocToken, verifyOrderDocToken } = require("../lib/orderDocToken");
const { auth, optionalAuth, requireAdmin } = require("../middleware/auth");
const requireTenant = require("../middleware/requireTenant");
const ctrl = require("../controllers/orderCatalogController");
const { changeOrderStatus, OrderStatusError } = require("../services/orderStatusChange");
const { restoreOrderStock } = require("../services/orderStock");
const { requireFeature } = require("../lib/features");

// tenant context chara Query gulo filter-hinno hoye sob dokan er order fenle
const guard = [requireTenant, auth, requireAdmin, requireFeature("orders")];

// Client ei field gulo set korte parbe. Payment/total/store client er kontrol e nei.
const ORDER_CREATE_FIELDS = [
  "orderNumber", "customer", "customerName", "customerEmail", "customerPhone",
  "address", "thana", "district", "division", "postCode", "country",
  "orderNote", "orderSource", "deviceType", "billing", "shipping",
  "shippingLabel", "paymentMethod", "paymentLabel", "paymentDetails", "courierName",
  "couponCode", "couponType", "couponValue", "couponLabel", "couponFreeDelivery",
];

const ORDER_UPDATE_FIELDS = [
  "customerName", "customerEmail", "customerPhone",
  "address", "thana", "district", "division", "postCode", "country",
  "orderNote", "orderSource", "deviceType", "billing", "shipping",
  "shippingLabel", "paymentMethod", "paymentLabel", "paymentDetails", "courierName",
  "couponCode", "couponType", "couponValue", "couponLabel", "couponFreeDelivery",
];

function pick(body = {}, fields) {
  const out = {};
  for (const key of fields) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  return out;
}

function money(value) {
  return Math.max(0, Number(value) || 0);
}

function orderItemsPayload(raw) {
  return (Array.isArray(raw) ? raw : []).map((item = {}) => {
    const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
    const unitPricePaisa = Math.round(money(item.unitPricePaisa));
    const unitPrice =
      item.unitPrice !== undefined ? money(item.unitPrice) : unitPricePaisa / 100;
    return {
      product: item.product,
      variation: item.variation || null,
      swatch: item.swatch || null,
      image: String(item.image || ""),
      unitPrice,
      unitPricePaisa,
      retailUnitPricePaisa: Math.round(money(item.retailUnitPricePaisa)),
      pricingMode: ["retail", "wholesale", "flash"].includes(item.pricingMode)
        ? item.pricingMode
        : "retail",
      tierMinQty: item.tierMinQty == null ? null : Number(item.tierMinQty),
      tierMaxQty: item.tierMaxQty == null ? null : Number(item.tierMaxQty),
      flashSale: item.flashSale || null,
      flashSaleTitle: String(item.flashSaleTitle || ""),
      flashPercent: Math.min(100, Math.max(0, Number(item.flashPercent) || 0)),
      quantity,
      price: unitPrice * quantity,
    };
  });
}

function itemsTotal(items) {
  return (items || []).reduce((sum, item) => sum + money(item.price), 0);
}

function paymentDetailsPayload(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    senderNumber: String(src.senderNumber || ""),
    transactionId: String(src.transactionId || ""),
    gateway: String(src.gateway || ""),
    mode: String(src.mode || ""),
  };
}

function orderCreatePayload(body = {}, storeId) {
  const out = pick(body, ORDER_CREATE_FIELDS);
  out.items = orderItemsPayload(body.items);
  out.shippingAmount = money(body.shippingAmount);
  out.couponDiscount = money(body.couponDiscount);
  out.couponDiscountPaisa = Math.round(out.couponDiscount * 100);
  out.paymentDetails = paymentDetailsPayload(body.paymentDetails);
  out.totalAmount =
    itemsTotal(out.items) + out.shippingAmount - out.couponDiscount;
  if (out.totalAmount < 0) out.totalAmount = 0;
  out.orderNumber = String(body.orderNumber || "").trim() ||
    "ORD-" + Date.now().toString(36).toUpperCase();
  out.store = storeId;
  out.status = "pending";
  out.paymentStatus = "pending";
  out.paymentMode = "full";
  return out;
}


/* =============================== ADMIN ORDER LIST =============================== */

// order list page — tabs, search, advanced search, pagination (admin only)
router.get("/list", guard, ctrl.list);
// per-tab counts that follow the current search / advanced filters
router.get("/counts", guard, ctrl.counts);
// bulk status change + delete
router.post("/bulk", guard, ctrl.bulk);

// old raw list — admin restricted as well (ekhane customer data o ache)
router.get("/", guard, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));

  const total = await Order.countDocuments({});
  const orders = await Order.find({})
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate("items.product");

  res.json({ orders, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
});

/* =============================== SINGLE ORDER =============================== */

function docPath(req, orderId, type, token) {
  const params = new URLSearchParams();
  if (req.store && req.store.slug) params.set("store", req.store.slug);
  params.set("token", token);
  return `/api/orders/${orderId}/${type}?${params.toString()}`;
}

// Doc links are printed on paper and shared by chat, so the URL itself must be
// the only credential. Dashboard users may still open them with a Bearer token.
async function docAccess(req, type) {
  const token = String(req.query.token || "");
  if (token) {
    const payload = verifyOrderDocToken(token, type);
    if (!payload) return { ok: false, status: 403, message: "লিংকটি মেয়াদোত্তীর্ণ বা বৈধ নয়" };
    if (!req.store || String(payload.s) !== String(req.store._id)) {
      return { ok: false, status: 403, message: "লিংকটি এই দোকানের নয়" };
    }
    return { ok: true, orderId: payload.o };
  }

  if (!req.user || !req.user.id) {
    return { ok: false, status: 401, message: "এই ডকুমেন্ট দেখতে বৈধ লিংক দরকার" };
  }
  if (!req.store || !req.store._id) {
    return { ok: false, status: 400, message: "Store resolve kora jayni" };
  }
  const user = await User.findById(req.user.id).select("role").lean();
  if (!user) return { ok: false, status: 403, message: "অনুমতি নেই" };
  if (user.role === "superadmin") return { ok: true };
  if (req.store.owner && String(req.store.owner) === String(req.user.id)) return { ok: true };
  return { ok: false, status: 403, message: "এই ডকুমেন্ট দেখার অনুমতি নেই" };
}

async function sendOrderDoc(req, res, type) {
  const access = await docAccess(req, type);
  if (!access.ok) return res.status(access.status).json({ message: access.message });

  const ref = String(access.orderId || req.params.id || "");
  const filter = { store: req.storeId };
  const order = mongoose.isValidObjectId(ref)
    ? await Order.findOne({ ...filter, _id: ref }).populate("items.product").lean()
    : await Order.findOne({ ...filter, orderNumber: ref }).populate("items.product").lean();
  if (!order) return res.status(404).json({ message: "Order pawa jayni" });

  const [setting, store, site] = await Promise.all([
    InvoiceSetting.findOne({ store: order.store }).lean(),
    Store.findById(order.store).select("name").lean(),
    SiteSetting.findOne({ store: order.store }).lean(),
  ]);

  const html =
    type === "invoice"
      ? buildInvoiceHtml({
          order,
          setting: setting || {},
          storeName: (store && store.name) || "Store",
          logo: (site && site.logo) || "",
        })
      : buildPackingSlipHtml({
          order,
          setting: setting || {},
          storeName: (store && store.name) || "Store",
          logo: (site && site.logo) || "",
        });
  res.type("html").send(html);
}

// Signed links for the dashboard (window.open cannot send an Authorization header).
router.get("/:id/doc-links", guard, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, store: req.storeId }).select("_id").lean();
    if (!order) return res.status(404).json({ message: "Order pawa jayni" });
    const invoice = makeOrderDocToken({ orderId: order._id, storeId: req.storeId, type: "invoice" });
    const packing = makeOrderDocToken({ orderId: order._id, storeId: req.storeId, type: "packing-slip" });
    res.json({
      invoice: docPath(req, order._id, "invoice", invoice),
      packingSlip: docPath(req, order._id, "packing-slip", packing),
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Invoice — signed link or an authorized dashboard session.
router.get("/:id/invoice", requireTenant, optionalAuth, async (req, res) => {
  try {
    await sendOrderDoc(req, res, "invoice");
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Packaging slip — warehouse copy (no prices); same access rules as the invoice.
router.get("/:id/packing-slip", requireTenant, optionalAuth, async (req, res) => {
  try {
    await sendOrderDoc(req, res, "packing-slip");
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// shaped order details (admin dashboard)
router.get("/:id/detail", guard, ctrl.detail);

// status history (admin)
router.get("/:id/status-history", guard, ctrl.history);

// quick edit — status / courier / note (admin)
router.patch("/:id", guard, ctrl.quickEdit);

// ekta order dekha (admin only — customer er naam/phone/thikan ache)
router.get("/:id", guard, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate("items.product");
    if (!order) return res.status(404).json({ message: "Order pawa jayni" });
    res.json(order);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// notun order create kora (admin er manual order; customer checkout /api/cart/checkout diye kore)
router.post("/", guard, async (req, res) => {
  try {
    const order = await Order.create(orderCreatePayload(req.body, req.storeId));
    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// full order update kora (admin only)
router.put("/:id", guard, async (req, res) => {
  try {
    const before = await Order.findOne({ _id: req.params.id, store: req.storeId }).lean();
    if (!before) return res.status(404).json({ message: "Order pawa jayni" });

    const raw = req.body || {};
    const body = pick(raw, ORDER_UPDATE_FIELDS);
    const nextStatus = raw.status;
    const hasItems = Array.isArray(raw.items);
    const hasShipping = raw.shippingAmount !== undefined;
    const hasCoupon = raw.couponDiscount !== undefined;

    // Installment schedule ei total er sathe bound — items/total alada update korle
    // schedule ar order mile na.
    if (before.paymentMode === "installment" && (hasItems || hasShipping || hasCoupon)) {
      return res.status(400).json({
        message: "Installment order er items/total ekhane poriborton kora jabe na",
      });
    }

    if (hasItems) body.items = orderItemsPayload(raw.items);
    if (hasShipping) body.shippingAmount = money(raw.shippingAmount);
    if (hasCoupon) {
      body.couponDiscount = money(raw.couponDiscount);
      body.couponDiscountPaisa = Math.round(body.couponDiscount * 100);
    }
    if (raw.paymentDetails !== undefined) {
      body.paymentDetails = paymentDetailsPayload(raw.paymentDetails);
    }

    // Total server-side recompute — client er pathano totalAmount kokhono use hoy na.
    if (before.paymentMode !== "installment") {
      const items = body.items !== undefined ? body.items : before.items;
      const shipping =
        body.shippingAmount !== undefined ? body.shippingAmount : money(before.shippingAmount);
      const discount =
        body.couponDiscount !== undefined ? body.couponDiscount : money(before.couponDiscount);
      body.totalAmount = Math.max(0, itemsTotal(items) + shipping - discount);
    }

    const order = await Order.findOneAndUpdate(
      { _id: req.params.id, store: req.storeId },
      body,
      { new: true, runValidators: true }
    );
    if (!order) return res.status(404).json({ message: "Order pawa jayni" });

    // Status change hole history + audit + notify (best-effort)
    if (nextStatus && nextStatus !== before.status) {
      try {
        await changeOrderStatus({
          orderId: order._id,
          toStatus: nextStatus,
          actor: { id: req.user.id, name: req.user.name || "" },
          note: String(raw.note || ""),
        });
      } catch (err) {
        if (err instanceof OrderStatusError) {
          return res.status(err.status).json({ message: err.message });
        }
        console.error("order status change:", err.message);
      }
    }

    const fresh = await Order.findById(order._id).lean();
    // totals/items may have changed, so refresh the affected report days too
    try {
      require("../services/reportHooks").orderChanged(fresh);
    } catch (err) {
      console.error("report hook:", err.message);
    }
    res.json(fresh);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// order delete kora (admin only)
router.delete("/:id", guard, async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id });
    if (!order) return res.status(404).json({ message: "Order pawa jayni" });
    // delete mane order ta ar kono din ship hobe na — reserved stock ferot jay
    try {
      await restoreOrderStock(order);
    } catch (err) {
      console.error("order restock:", err.message);
    }
    await Order.deleteOne({ _id: order._id });
    // related records bondho kore dei (history / payments / installment schedule)
    await Promise.all([
      require("../models/OrderStatusHistory").deleteMany({ order: order._id }),
      require("../models/Payment").deleteMany({ order: order._id }),
      require("../models/OrderInstallment").deleteMany({ order: order._id }),
    ]);
    try {
      require("../services/reportHooks").orderChanged(order);
    } catch (err) {
      console.error("report hook:", err.message);
    }
    res.json({ message: "Order delete hoyeche" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
