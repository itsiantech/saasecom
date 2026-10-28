const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Order = require("../models/Order");
const Store = require("../models/Store");
const SiteSetting = require("../models/SiteSetting");
const InvoiceSetting = require("../models/InvoiceSetting");
const { buildInvoiceHtml } = require("../lib/invoice");
const { buildPackingSlipHtml } = require("../lib/packingSlip");
const { auth, requireAdmin } = require("../middleware/auth");
const requireTenant = require("../middleware/requireTenant");
const ctrl = require("../controllers/orderCatalogController");
const { changeOrderStatus, OrderStatusError } = require("../services/orderStatusChange");

// tenant context chara Query gulo filter-hinno hoye sob dokan er order fenle
const guard = [requireTenant, auth, requireAdmin];

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

// Invoice — order id ba orderNumber diye. Public link (random id/number).
router.get("/:id/invoice", async (req, res) => {
  try {
    const ref = String(req.params.id || "");
    const order = mongoose.isValidObjectId(ref)
      ? await Order.findById(ref).populate("items.product").lean()
      : await Order.findOne({ orderNumber: ref }).populate("items.product").lean();

    if (!order) return res.status(404).json({ message: "Order pawa jayni" });

    const [setting, store, site] = await Promise.all([
      InvoiceSetting.findOne({ store: order.store }).lean(),
      Store.findById(order.store).select("name").lean(),
      SiteSetting.findOne({ store: order.store }).lean(),
    ]);

    const html = buildInvoiceHtml({
      order,
      setting: setting || {},
      storeName: (store && store.name) || "Store",
      logo: (site && site.logo) || "",
    });
    res.type("html").send(html);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Packaging slip — warehouse copy (no prices). Public link like the invoice.
router.get("/:id/packing-slip", async (req, res) => {
  try {
    const ref = String(req.params.id || "");
    const order = mongoose.isValidObjectId(ref)
      ? await Order.findById(ref).populate("items.product").lean()
      : await Order.findOne({ orderNumber: ref }).populate("items.product").lean();

    if (!order) return res.status(404).json({ message: "Order pawa jayni" });

    const [setting, store, site] = await Promise.all([
      InvoiceSetting.findOne({ store: order.store }).lean(),
      Store.findById(order.store).select("name").lean(),
      SiteSetting.findOne({ store: order.store }).lean(),
    ]);

    const html = buildPackingSlipHtml({
      order,
      setting: setting || {},
      storeName: (store && store.name) || "Store",
      logo: (site && site.logo) || "",
    });
    res.type("html").send(html);
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
    const order = await Order.create(req.body);
    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// full order update kora (admin only)
router.put("/:id", guard, async (req, res) => {
  try {
    const before = await Order.findById(req.params.id).lean();
    if (!before) return res.status(404).json({ message: "Order pawa jayni" });

    const body = { ...(req.body || {}) };
    const nextStatus = body.status;
    delete body.status; // status goes through the shared change path

    const order = await Order.findByIdAndUpdate(req.params.id, body, {
      new: true,
      runValidators: true,
    });
    if (!order) return res.status(404).json({ message: "Order pawa jayni" });

    // Status change hole history + audit + notify (best-effort)
    if (nextStatus && nextStatus !== before.status) {
      try {
        await changeOrderStatus({
          orderId: order._id,
          toStatus: nextStatus,
          actor: { id: req.user.id, name: req.user.name || "" },
          note: body.note || "",
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
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ message: "Order pawa jayni" });
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
