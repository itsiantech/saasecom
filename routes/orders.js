const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Order = require("../models/Order");
const Store = require("../models/Store");
const Settings = require("../models/Settings");
const InvoiceSetting = require("../models/InvoiceSetting");
const { buildInvoiceHtml } = require("../lib/invoice");
const { buildPackingSlipHtml } = require("../lib/packingSlip");
const { auth, requireAdmin } = require("../middleware/auth");
const ctrl = require("../controllers/orderCatalogController");
const { changeOrderStatus, OrderStatusError } = require("../services/orderStatusChange");

/* =============================== ADMIN ORDER LIST =============================== */

// order list page — tabs, search, advanced search, pagination (admin only)
router.get("/list", auth, requireAdmin, ctrl.list);
// per-tab counts that follow the current search / advanced filters
router.get("/counts", auth, requireAdmin, ctrl.counts);
// bulk status change + delete
router.post("/bulk", auth, requireAdmin, ctrl.bulk);

// old raw list — admin restricted as well (ekhane customer data o ache)
router.get("/", auth, requireAdmin, async (req, res) => {
  const orders = await Order.find().populate("items.product");
  res.json(orders);
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

    const [setting, store, logoDoc] = await Promise.all([
      InvoiceSetting.findOne({ store: order.store }).lean(),
      Store.findById(order.store).select("name").lean(),
      Settings.findOne({ key: "logo" }).lean(),
    ]);

    const html = buildInvoiceHtml({
      order,
      setting: setting || {},
      storeName: (store && store.name) || "Store",
      logo: (logoDoc && logoDoc.value) || "",
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

    const [setting, store, logoDoc] = await Promise.all([
      InvoiceSetting.findOne({ store: order.store }).lean(),
      Store.findById(order.store).select("name").lean(),
      Settings.findOne({ key: "logo" }).lean(),
    ]);

    const html = buildPackingSlipHtml({
      order,
      setting: setting || {},
      storeName: (store && store.name) || "Store",
      logo: (logoDoc && logoDoc.value) || "",
    });
    res.type("html").send(html);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// shaped order details (admin dashboard)
router.get("/:id/detail", auth, requireAdmin, ctrl.detail);

// status history (admin)
router.get("/:id/status-history", auth, requireAdmin, ctrl.history);

// quick edit — status / courier / note (admin)
router.patch("/:id", auth, requireAdmin, ctrl.quickEdit);

// ekta order dekha
router.get("/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate("items.product");
    if (!order) return res.status(404).json({ message: "Order pawa jayni" });
    res.json(order);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// notun order create kora
router.post("/", async (req, res) => {
  try {
    const order = await Order.create(req.body);
    res.status(201).json(order);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// full order update kora (admin only)
router.put("/:id", auth, requireAdmin, async (req, res) => {
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
router.delete("/:id", auth, requireAdmin, async (req, res) => {
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
