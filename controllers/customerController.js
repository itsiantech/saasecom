const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Order = require("../models/Order");
const CustomerProfile = require("../models/CustomerProfile");
const { getStoreId } = require("../lib/tenantContext");
const { writeAudit } = require("../lib/audit");
const {
  normalizeCustomerUpdate,
  normalizeNote,
  normalizePassword,
  resolveContact,
} = require("../lib/customerAdmin");

const PAGE_SIZES = [10, 20, 50];

function storeOf(req) {
  if (req.store && req.store._id) return req.store._id;
  return getStoreId();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fail(res, next, err) {
  if (err instanceof Error && !err.status) {
    return res.status(400).json({ message: err.message });
  }
  next(err);
}

async function loadCustomer(req, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  const storeId = storeOf(req);
  if (!storeId) return null;
  const user = await User.findOne({ _id: id, role: "customer" });
  if (!user) return null;
  const ordered = await Order.findOne({ customer: user._id, store: storeId }).select("_id").lean();
  if (!ordered) return null;
  return { user, storeId };
}

function noteView(note) {
  return {
    id: note && note._id ? String(note._id) : "",
    text: (note && note.text) || "",
    by: note && note.by ? String(note.by) : "",
    byName: (note && note.byName) || "",
    createdAt: note && note.createdAt,
  };
}

function orderView(order) {
  const items = (order.items || []).map((item) => ({
    name: (item.product && (item.product.title || item.product.name)) || "Product",
    quantity: Number(item.quantity) || 0,
    price: Number(item.price) || 0,
    image: item.image || (item.product && item.product.images && item.product.images[0]) || "",
  }));
  return {
    id: order._id,
    orderNumber: order.orderNumber || "",
    invoiceNumber: order.invoiceNumber || "",
    createdAt: order.createdAt,
    status: order.status || "pending",
    paymentStatus: order.paymentStatus || "pending",
    paymentMode: order.paymentMode || "full",
    totalAmount: Number(order.totalAmount) || 0,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    items,
  };
}

/* GET /api/customers?search=&page=&limit= — registered buyers of this store,
   default sort: postal code (numeric) descending. */
async function list(req, res, next) {
  try {
    const storeId = storeOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    const storeObjectId = new mongoose.Types.ObjectId(storeId);

    const search = String(req.query.search || "").trim().slice(0, 120);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const requestedLimit = parseInt(req.query.limit, 10) || 10;
    const limit = PAGE_SIZES.includes(requestedLimit) ? requestedLimit : 10;

    const nonEmpty = (path, fallback) => ({
      $cond: [{ $gt: [{ $strLenCP: { $ifNull: [path, ""] } }, 0] }, path, fallback],
    });

    const pipeline = [
      { $match: { store: storeObjectId, customer: { $ne: null } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$customer",
          orderName: { $first: "$customerName" },
          orderEmail: { $first: "$customerEmail" },
          orderPhone: { $first: "$customerPhone" },
          orderAddress: { $first: "$address" },
          orderThana: { $first: "$thana" },
          orderDistrict: { $first: "$district" },
          orderDivision: { $first: "$division" },
          orderPostCode: { $first: "$postCode" },
          orderCountry: { $first: "$country" },
          orderCount: { $sum: 1 },
          cancelledCount: {
            $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
          },
          totalSpend: {
            $sum: {
              $cond: [
                { $eq: ["$status", "cancelled"] },
                0,
                { $ifNull: ["$totalAmount", 0] },
              ],
            },
          },
          lastOrderAt: { $first: "$createdAt" },
        },
      },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
      { $unwind: "$user" },
      { $match: { "user.role": "customer" } },
      {
        $lookup: {
          from: "customerprofiles",
          let: { customerId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$customer", "$$customerId"] },
                    { $eq: ["$store", storeObjectId] },
                  ],
                },
              },
            },
          ],
          as: "profile",
        },
      },
      { $unwind: { path: "$profile", preserveNullAndEmptyArrays: true } },
      { $match: { "profile.hiddenAt": null } },
      {
        $addFields: {
          name: nonEmpty("$user.name", "$orderName"),
          email: nonEmpty("$user.email", "$orderEmail"),
          phone: nonEmpty("$user.phone", "$orderPhone"),
          address: nonEmpty("$user.shipping.address", "$orderAddress"),
          thana: nonEmpty("$user.shipping.thana", "$orderThana"),
          district: nonEmpty("$user.shipping.district", "$orderDistrict"),
          division: nonEmpty("$user.shipping.division", "$orderDivision"),
          postCode: nonEmpty("$user.shipping.postCode", "$orderPostCode"),
          country: nonEmpty("$user.shipping.country", "$orderCountry"),
          latestNote: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$profile.notes", []] } }, 0] },
              { $arrayElemAt: ["$profile.notes", -1] },
              null,
            ],
          },
          noteCount: { $size: { $ifNull: ["$profile.notes", []] } },
        },
      },
    ];

    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      pipeline.push({
        $match: {
          $expr: {
            $regexMatch: {
              input: {
                $concat: [
                  { $ifNull: ["$name", ""] }, " ",
                  { $ifNull: ["$phone", ""] }, " ",
                  { $ifNull: ["$email", ""] }, " ",
                  { $ifNull: ["$address", ""] }, " ",
                  { $ifNull: ["$thana", ""] }, " ",
                  { $ifNull: ["$district", ""] }, " ",
                  { $ifNull: ["$division", ""] }, " ",
                  { $ifNull: ["$postCode", ""] }, " ",
                  { $ifNull: ["$country", ""] },
                ],
              },
              regex: rx,
            },
          },
        },
      });
    }

    pipeline.push(
      {
        $addFields: {
          postCodeNumber: {
            $convert: { input: "$postCode", to: "long", onError: -1, onNull: -1 },
          },
        },
      },
      { $sort: { postCodeNumber: -1, postCode: -1, name: 1 } },
      {
        $facet: {
          rows: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                id: "$_id",
                name: 1,
                phone: 1,
                email: 1,
                address: 1,
                thana: 1,
                district: 1,
                division: 1,
                postCode: 1,
                country: 1,
                orders: "$orderCount",
                cancelled: "$cancelledCount",
                totalSpend: 1,
                lastOrderAt: 1,
                latestNote: 1,
                noteCount: 1,
                hasPassword: {
                  $gt: [{ $strLenCP: { $ifNull: ["$user.password", ""] } }, 0],
                },
                status: { $literal: "registered" },
              },
            },
          ],
          total: [{ $count: "count" }],
        },
      }
    );

    const [facet] = await Order.aggregate(pipeline);
    const rows = (facet.rows || []).map((row) => ({
      ...row,
      latestNote: row.latestNote ? noteView(row.latestNote) : null,
    }));
    const total = facet.total && facet.total[0] ? facet.total[0].count : 0;

    res.json({
      customers: rows,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      limit,
      sort: "postal_desc",
    });
  } catch (err) {
    next(err);
  }
}

/* GET /api/customers/:id — contact, notes and all store orders for one buyer */
async function detail(req, res, next) {
  try {
    const found = await loadCustomer(req, req.params.id);
    if (!found) return res.status(404).json({ message: "Customer pawa jayni" });

    const [orders, profile] = await Promise.all([
      Order.find({ customer: found.user._id, store: found.storeId })
        .sort({ createdAt: -1 })
        .populate("items.product", "title name images")
        .lean(),
      CustomerProfile.findOne({ customer: found.user._id, store: found.storeId }).lean(),
    ]);

    const contact = resolveContact(found.user, orders[0]);
    const cancelled = orders.filter((order) => order.status === "cancelled").length;
    const totalSpend = orders.reduce(
      (sum, order) => (order.status === "cancelled" ? sum : sum + (Number(order.totalAmount) || 0)),
      0
    );
    const notes = [...((profile && profile.notes) || [])]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .map(noteView);

    res.json({
      customer: {
        id: found.user._id,
        ...contact,
        status: "registered",
        hasPassword: !!found.user.password,
        hidden: !!(profile && profile.hiddenAt),
        createdAt: found.user.createdAt,
        orders: orders.length,
        cancelled,
        totalSpend,
        lastOrderAt: orders.length ? orders[0].createdAt : null,
        notes,
      },
      orders: orders.map(orderView),
    });
  } catch (err) {
    next(err);
  }
}

/* PATCH /api/customers/:id — account name / email / phone + saved address */
async function update(req, res, next) {
  try {
    const found = await loadCustomer(req, req.params.id);
    if (!found) return res.status(404).json({ message: "Customer pawa jayni" });

    const patch = normalizeCustomerUpdate(req.body, found.user);
    const or = [];
    if (patch.email) or.push({ email: patch.email });
    if (patch.phone) or.push({ phone: patch.phone });
    if (or.length) {
      const conflict = await User.findOne({
        _id: { $ne: found.user._id },
        $or: or,
      }).select("_id").lean();
      if (conflict) {
        return res.status(409).json({ message: "Ei email/phone onno account e already ache" });
      }
    }

    if (patch.name !== undefined) found.user.name = patch.name;
    if (patch.email !== undefined) found.user.email = patch.email;
    if (patch.phone !== undefined) found.user.phone = patch.phone;
    if (patch.shipping) {
      for (const [field, value] of Object.entries(patch.shipping)) {
        found.user.shipping[field] = value;
      }
    }
    await found.user.save();

    await writeAudit({
      store: found.storeId,
      user: req.user && req.user.id,
      action: "customer.update",
      entity: "User",
      entityId: found.user._id,
      newValue: {
        fields: Object.keys(patch),
        addressFields: patch.shipping ? Object.keys(patch.shipping) : [],
      },
    });

    const contact = resolveContact(found.user, null);
    res.json({ ok: true, customer: { id: found.user._id, ...contact } });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ message: "Ei email/phone onno account e already ache" });
    }
    fail(res, next, err);
  }
}

/* POST /api/customers/:id/reset-password { password } */
async function resetPassword(req, res, next) {
  try {
    const found = await loadCustomer(req, req.params.id);
    if (!found) return res.status(404).json({ message: "Customer pawa jayni" });

    const password = normalizePassword(req.body && req.body.password);
    found.user.password = await bcrypt.hash(password, 10);
    await found.user.save();

    await writeAudit({
      store: found.storeId,
      user: req.user && req.user.id,
      action: "customer.password_reset",
      entity: "User",
      entityId: found.user._id,
      newValue: { passwordReset: true },
    });

    res.json({ ok: true, message: "Password reset hoyeche" });
  } catch (err) {
    fail(res, next, err);
  }
}

/* POST /api/customers/:id/notes { text } */
async function addNote(req, res, next) {
  try {
    const found = await loadCustomer(req, req.params.id);
    if (!found) return res.status(404).json({ message: "Customer pawa jayni" });

    const text = normalizeNote(req.body && req.body.text);
    const admin = await User.findById(req.user.id).select("name").lean();
    const profile = await CustomerProfile.findOneAndUpdate(
      { customer: found.user._id, store: found.storeId },
      {
        $push: {
          notes: {
            text,
            by: req.user.id,
            byName: (admin && admin.name) || "Admin",
            createdAt: new Date(),
          },
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const note = profile.notes[profile.notes.length - 1];
    await writeAudit({
      store: found.storeId,
      user: req.user && req.user.id,
      action: "customer.note_add",
      entity: "CustomerProfile",
      entityId: profile._id,
      newValue: { customer: found.user._id, noteId: note._id },
    });

    res.status(201).json({ ok: true, note: noteView(note) });
  } catch (err) {
    fail(res, next, err);
  }
}

/* DELETE /api/customers/:id — soft hide; orders and the account stay intact */
async function hide(req, res, next) {
  try {
    const found = await loadCustomer(req, req.params.id);
    if (!found) return res.status(404).json({ message: "Customer pawa jayni" });

    const profile = await CustomerProfile.findOneAndUpdate(
      { customer: found.user._id, store: found.storeId },
      { $set: { hiddenAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    await writeAudit({
      store: found.storeId,
      user: req.user && req.user.id,
      action: "customer.hide",
      entity: "CustomerProfile",
      entityId: profile._id,
      newValue: { customer: found.user._id, hidden: true },
    });

    res.json({
      ok: true,
      message: "Customer list theke soriye deya hoyeche — orders intact ache",
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, detail, update, resetPassword, addNote, hide };
