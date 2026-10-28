const mongoose = require("mongoose");
const Order = require("../models/Order");
const OrderStatusHistory = require("../models/OrderStatusHistory");
const Product = require("../models/Product");
const Review = require("../models/Review");
const Wishlist = require("../models/Wishlist");
const { toCard, loadSettings } = require("./storefrontController");

/* ------------------------------------------------------------------ *
 * Public storefront writes/reads that need a store context but no admin
 * session: order tracking, reviews, wishlist. Mounted under /api/public
 * behind middleware/publicStore (tenantStorage is set there, so
 * tenantPlugin filters every query below).
 * ------------------------------------------------------------------ */

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

// Tracking needs both the order number and the phone the order was placed with —
// a number alone would leak someone else's order.
async function trackOrder(req, res, next) {
  try {
    const number = String(req.query.number || "").trim();
    const phone = digitsOnly(req.query.phone);
    if (!number || phone.length < 6) {
      return res.status(400).json({ message: "Order number ar puro lagbe" });
    }

    const storeId = req.publicStore._id;
    // $match on orderNumber uses the global unique index, then store + phone narrow it
    const order = await Order.findOne({ orderNumber: number, store: storeId, customerPhone: { $regex: phone + "$" } })
      .populate({ path: "items.product", select: "name slug status" })
      .lean();
    if (!order) return res.status(404).json({ message: "Ei number e order pawa jayni" });

    const history = await OrderStatusHistory.find({ order: order._id })
      .select("fromStatus toStatus note createdAt")
      .sort({ createdAt: 1 })
      .lean();

    res.json({
      order: {
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        placedAt: order.createdAt,
        totalAmount: order.totalAmount,
        shippingAmount: order.shippingAmount,
        courierName: order.courierName,
        deliverySpeed: order.deliverySpeed,
        items: (order.items || []).map(publicOrderItem),
      },
      timeline: history.map((row) => ({
        status: row.toStatus,
        note: row.note || "",
        at: row.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

// product can be addressed by slug or id — same rule as the catalog detail route
async function findPublicProduct(storeId, key) {
  const filter = { store: storeId, status: "published" };
  if (mongoose.isValidObjectId(String(key || "").trim())) filter._id = String(key).trim();
  else filter.slug = String(key || "").trim().toLowerCase();
  return Product.findOne(filter).select("_id").lean();
}

async function listReviews(req, res, next) {
  try {
    const product = await findPublicProduct(req.publicStore._id, req.params.slug);
    if (!product) return res.status(404).json({ message: "Product pawa jayni" });
    const page = Math.min(50, Math.max(1, parseInt(req.query.page, 10) || 1));
    const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const [rows, total] = await Promise.all([
      Review.find({ store: req.publicStore._id, product: product._id, status: "published" })
        .select("rating title body customerName images createdAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Review.countDocuments({ store: req.publicStore._id, product: product._id, status: "published" }),
    ]);
    res.json({ reviews: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 } });
  } catch (err) {
    next(err);
  }
}

// optionalAuth: login kora customer er name snapshot hoy, guest naam nije dey
async function createReview(req, res, next) {
  try {
    const storeId = req.publicStore._id;
    const product = await findPublicProduct(storeId, req.params.slug);
    if (!product) return res.status(404).json({ message: "Product pawa jayni" });

    const rating = Number(req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Rating 1 theke 5 er moddhe hote hobe" });
    }
    const body = String(req.body.body || "").trim().slice(0, 2000);
    const customerName = String(req.body.customerName || "").trim().slice(0, 120);
    const name = (req.user && req.user.name) || customerName;
    if (!name) return res.status(400).json({ message: "Naam daw" });

    // ekjon customer ekta product e ek-i review rakhe — pore ta update hoy
    const existing = req.user
      ? await Review.findOne({ store: storeId, product: product._id, customer: req.user.id })
      : null;
    if (existing) {
      existing.rating = rating;
      existing.title = String(req.body.title || "").trim().slice(0, 120);
      existing.body = body;
      await existing.save();
      return res.json({ review: { id: existing._id, rating: existing.rating, title: existing.title, body: existing.body }, updated: true });
    }

    const review = await Review.create({
      product: product._id,
      customer: req.user ? req.user.id : null,
      customerName: name,
      rating,
      title: String(req.body.title || "").trim().slice(0, 120),
      body,
    });
    res.status(201).json({ review: { id: review._id, rating: review.rating, title: review.title, body: review.body } });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Account: the logged-in customer's own orders.
 * Identity is the JWT's user id — never a phone/email from the query —
 * so a shopper only ever sees the orders placed under their account.
 * ------------------------------------------------------------------ */

// A bought product may since have been unpublished or trashed; the shopper still
// sees what they bought, but the link back to the catalog only exists while it
// is published. Cost/supplier fields are never selected.
function publicOrderItem(item) {
  const product = item.product && typeof item.product === "object" ? item.product : null;
  return {
    product: product ? product._id : item.product,
    name: (product && product.name) || "",
    slug: product && product.status === "published" ? product.slug || "" : "",
    image: item.image || "",
    quantity: item.quantity,
    price: item.price,
  };
}

const ORDER_LIST_FIELDS =
  "orderNumber status paymentStatus paymentMethod paymentLabel totalAmount " +
  "shippingAmount shippingLabel courierName deliverySpeed items createdAt";

function orderSummary(row) {
  return {
    orderNumber: row.orderNumber,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    paymentLabel: row.paymentLabel,
    placedAt: row.createdAt,
    totalAmount: row.totalAmount,
    shippingAmount: row.shippingAmount,
    shippingLabel: row.shippingLabel,
    courierName: row.courierName,
    deliverySpeed: row.deliverySpeed,
    itemCount: (row.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
    items: (row.items || []).map(publicOrderItem),
  };
}

async function listMyOrders(req, res, next) {
  try {
    const storeId = req.publicStore._id;
    const page = Math.min(50, Math.max(1, parseInt(req.query.page, 10) || 1));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const filter = { store: storeId, customer: req.user.id };
    const [rows, total] = await Promise.all([
      Order.find(filter)
        .select(ORDER_LIST_FIELDS)
        .populate({ path: "items.product", select: "name slug status" })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);
    res.json({
      orders: rows.map(orderSummary),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (err) {
    next(err);
  }
}

async function getMyOrder(req, res, next) {
  try {
    const storeId = req.publicStore._id;
    const number = String(req.params.number || "").trim();
    const order = await Order.findOne({ orderNumber: number, store: storeId, customer: req.user.id })
      .select(`${ORDER_LIST_FIELDS} customerName address thana district division postCode country`)
      .populate({ path: "items.product", select: "name slug status" })
      .lean();
    if (!order) return res.status(404).json({ message: "Ei order pawa jayni" });

    const history = await OrderStatusHistory.find({ order: order._id })
      .select("toStatus note createdAt")
      .sort({ createdAt: 1 })
      .lean();

    res.json({
      order: orderSummary(order),
      // the shopper's own delivery address, nothing cost/supplier related
      delivery: {
        name: order.customerName || "",
        address: [order.address, order.thana, order.district, order.division, order.postCode, order.country]
          .filter(Boolean)
          .join(", "),
      },
      timeline: history.map((row) => ({ status: row.toStatus, note: row.note || "", at: row.createdAt })),
    });
  } catch (err) {
    next(err);
  }
}

async function getWishlist(req, res, next) {
  try {
    const storeId = req.publicStore._id;
    const rows = await Wishlist.find({ store: storeId, customer: req.user.id })
      .select("product createdAt")
      .sort({ createdAt: -1 })
      .lean();
    const ids = rows.map((row) => row.product);
    const [products, international] = await Promise.all([
      Product.find({ _id: { $in: ids }, store: storeId, status: "published" })
        .select("name title slug images price regularPrice salePrice stock categories internationalConfig.sizes")
        .lean(),
      loadSettings(storeId),
    ]);
    const byId = new Map(products.map((row) => [String(row._id), row]));
    res.json({ items: rows.map((row) => byId.get(String(row.product))).filter(Boolean).map((p) => toCard(p, international.enabled)) });
  } catch (err) {
    next(err);
  }
}

// add na thakle add, thakle remove — frontend e ek-i button theke call hobe
async function toggleWishlist(req, res, next) {
  try {
    const storeId = req.publicStore._id;
    const key = String(req.body.product || "").trim();
    if (!mongoose.isValidObjectId(key)) return res.status(400).json({ message: "Product id lagbe" });
    const product = await Product.findOne({ _id: key, store: storeId, status: "published" }).select("_id").lean();
    if (!product) return res.status(404).json({ message: "Product pawa jayni" });

    const existing = await Wishlist.findOne({ store: storeId, customer: req.user.id, product: key });
    if (existing) {
      await Wishlist.deleteOne({ _id: existing._id });
      return res.json({ saved: false });
    }
    await Wishlist.create({ store: storeId, customer: req.user.id, product: key });
    res.json({ saved: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { trackOrder, listReviews, createReview, getWishlist, toggleWishlist, listMyOrders, getMyOrder };
