const mongoose = require("mongoose");
const Supplier = require("../models/Supplier");
const SupplierOrder = require("../models/SupplierOrder");
const SupplierInvoice = require("../models/SupplierInvoice");
const SupplierPayment = require("../models/SupplierPayment");
const SupplierIdempotency = require("../models/SupplierIdempotency");
const StockMovement = require("../models/StockMovement");
const Product = require("../models/Product");
const { SupplierError } = require("../lib/supplierErrors");
const {
  invoiceDuePaisa,
  invoicePaymentStatus,
  zonedDateKey,
} = require("../lib/supplierDomain");
const {
  normalizeSupplierInput,
  normalizeOrderInput,
  normalizePaymentInput,
  normalizeReason,
  normalizeHoldInput,
  normalizeStockAdjustment,
  normalizeIdempotencyKey,
  validateObjectId,
} = require("../lib/supplierValidation");
const { getSupplierSettings } = require("./supplierSettings");
const { nextSupplierNumber } = require("./supplierCounters");
const { withSupplierTransaction } = require("./supplierTransactions");
const { auditSupplier } = require("../lib/supplierAudit");

function isDuplicateKey(err) {
  return !!err && (err.code === 11000 || err.code === 11001);
}

function isIdempotencyDuplicate(err) {
  if (!isDuplicateKey(err)) return false;
  const keys = Object.keys((err && err.keyPattern) || {});
  return keys.includes("key") || /scope.*key|key.*scope/.test(String(err.message || ""));
}

function userOf(ctx) {
  return ctx && ctx.req && ctx.req.user ? ctx.req.user.id : null;
}

function storeOf(ctx) {
  return ctx.store;
}

function querySession(query, session) {
  return session ? query.session(session) : query;
}

async function findSupplier(store, id, session) {
  if (!mongoose.isValidObjectId(id)) throw new SupplierError("Supplier pawa jayni", 404);
  const supplier = await querySession(Supplier.findOne({ _id: id, store }), session);
  if (!supplier) throw new SupplierError("Supplier pawa jayni", 404);
  return supplier;
}

async function findInvoice(store, id, session) {
  if (!mongoose.isValidObjectId(id)) throw new SupplierError("Invoice pawa jayni", 404);
  const invoice = await querySession(SupplierInvoice.findOne({ _id: id, store }), session);
  if (!invoice) throw new SupplierError("Invoice pawa jayni", 404);
  return invoice;
}

function invoiceView(invoice) {
  return {
    id: String(invoice._id),
    invoiceNo: invoice.invoiceNo,
    issueDate: invoice.issueDate,
    totalAmountPaisa: invoice.totalAmountPaisa,
    paidAmountPaisa: invoice.paidAmountPaisa,
    dueAmountPaisa: invoiceDuePaisa(invoice),
    paymentStatus: invoicePaymentStatus(invoice),
    state: invoice.state,
    holdFlag: invoice.holdFlag === true,
    holdReason: invoice.holdReason || "",
    voidReason: invoice.voidReason || "",
  };
}

function orderView(order) {
  return {
    id: String(order._id),
    orderNo: order.orderNo,
    orderDate: order.orderDate,
    totalQty: order.totalQty,
    totalAmountPaisa: order.totalAmountPaisa,
    status: order.status,
    stockApplied: order.stockApplied === true,
    stockMode: order.stockMode,
  };
}

/* ------------------------------- supplier ------------------------------- */

async function createSupplier(ctx, body) {
  const input = normalizeSupplierInput(body);
  let supplier;
  try {
    supplier = await Supplier.create({
      ...input,
      store: storeOf(ctx),
      state: "active",
      createdBy: userOf(ctx),
    });
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw new SupplierError("Ei phone number diye active supplier age theke ache", 409);
    }
    throw err;
  }
  await auditSupplier(ctx.req, {
    store: storeOf(ctx),
    user: userOf(ctx),
    action: "supplier.create",
    entity: "supplier",
    entityId: supplier._id,
    newValue: { name: supplier.name, companyName: supplier.companyName },
  });
  return supplier;
}

async function updateSupplier(ctx, id, body) {
  const supplier = await findSupplier(storeOf(ctx), id);
  if (supplier.state === "trashed") {
    throw new SupplierError("Trashed supplier age restore korun", 409);
  }
  const input = normalizeSupplierInput(body, { partial: true });
  const old = { name: supplier.name, companyName: supplier.companyName, address: supplier.address, note: supplier.note };
  Object.assign(supplier, input);
  try {
    await supplier.save();
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw new SupplierError("Ei phone number diye active supplier age theke ache", 409);
    }
    throw err;
  }
  await auditSupplier(ctx.req, {
    store: storeOf(ctx),
    user: userOf(ctx),
    action: "supplier.update",
    entity: "supplier",
    entityId: supplier._id,
    oldValue: old,
    newValue: { name: supplier.name, companyName: supplier.companyName, address: supplier.address, note: supplier.note },
  });
  return supplier;
}

async function voidSupplier(ctx, id, reason) {
  const supplier = await findSupplier(storeOf(ctx), id);
  if (supplier.state === "void") return { supplier, alreadyVoid: true };
  if (supplier.state !== "active") throw new SupplierError("Ei supplier void kora jabe na", 409);
  const why = normalizeReason(reason, { field: "Void reason" });
  supplier.state = "void";
  supplier.voidReason = why;
  supplier.voidedAt = new Date();
  supplier.voidedBy = userOf(ctx);
  await supplier.save();
  await auditSupplier(ctx.req, {
    store: storeOf(ctx),
    user: userOf(ctx),
    action: "supplier.void",
    entity: "supplier",
    entityId: supplier._id,
    oldValue: { state: "active" },
    newValue: { state: "void", reason: why },
  });
  return { supplier, alreadyVoid: false };
}

async function trashSupplier(ctx, id, reason) {
  const supplier = await findSupplier(storeOf(ctx), id);
  if (supplier.state === "trashed") return { supplier, alreadyTrashed: true };

  const openOrder = await SupplierOrder.exists({ store: storeOf(ctx), supplier: supplier._id, status: "ordered" });
  if (openOrder) throw new SupplierError("Supplier er open purchase order ache — age receive/cancel korun", 409);

  const dueInvoice = await SupplierInvoice.findOne({
    store: storeOf(ctx),
    supplier: supplier._id,
    state: "active",
    $expr: { $lt: ["$paidAmountPaisa", "$totalAmountPaisa"] },
  }).select("_id invoiceNo");
  if (dueInvoice) {
    throw new SupplierError(`Invoice ${dueInvoice.invoiceNo} e due ache — trash korar age payment/void korun`, 409);
  }

  const oldState = supplier.state;
  const why = normalizeReason(reason, { field: "Trash reason", required: false });
  supplier.state = "trashed";
  supplier.deletedAt = new Date();
  supplier.trashedBy = userOf(ctx);
  await supplier.save();
  await auditSupplier(ctx.req, {
    store: storeOf(ctx),
    user: userOf(ctx),
    action: "supplier.trash",
    entity: "supplier",
    entityId: supplier._id,
    oldValue: { state: oldState },
    newValue: { state: "trashed", reason: why },
  });
  return { supplier, alreadyTrashed: false };
}

async function restoreSupplier(ctx, id) {
  const supplier = await findSupplier(storeOf(ctx), id);
  if (supplier.state === "active") return { supplier, alreadyActive: true };
  const oldState = supplier.state;
  supplier.state = "active";
  supplier.deletedAt = null;
  supplier.voidReason = "";
  try {
    await supplier.save();
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw new SupplierError("Ei phone number diye already ekta active supplier ache", 409);
    }
    throw err;
  }
  await auditSupplier(ctx.req, {
    store: storeOf(ctx),
    user: userOf(ctx),
    action: "supplier.restore",
    entity: "supplier",
    entityId: supplier._id,
    oldValue: { state: oldState },
    newValue: { state: "active" },
  });
  return { supplier, alreadyActive: false };
}

async function purgeSupplier(ctx, id) {
  const supplier = await findSupplier(storeOf(ctx), id);
  if (supplier.state !== "trashed") throw new SupplierError("Purge er age supplier trash korun", 409);

  const deleted = await withSupplierTransaction(async (session) => {
    const counts = {};
    for (const [name, Model] of [
      ["orders", SupplierOrder],
      ["invoices", SupplierInvoice],
      ["payments", SupplierPayment],
      ["stockMovements", StockMovement],
    ]) {
      const res = await Model.deleteMany({ store: storeOf(ctx), supplier: supplier._id }, { session });
      counts[name] = res.deletedCount || 0;
    }
    await Product.updateMany(
      { store: storeOf(ctx), supplierId: supplier._id },
      { $set: { supplierId: null } },
      { session }
    );
    await Supplier.deleteOne({ _id: supplier._id, store: storeOf(ctx) }, { session });
    return counts;
  });

  await auditSupplier(ctx.req, {
    store: storeOf(ctx),
    user: userOf(ctx),
    action: "supplier.purge",
    entity: "supplier",
    entityId: supplier._id,
    oldValue: { name: supplier.name, state: "trashed" },
    newValue: deleted,
  });
  return deleted;
}

/* -------------------------------- orders -------------------------------- */

async function createOrder(ctx, supplierId, body, idempotencyKey) {
  const store = storeOf(ctx);
  const key = normalizeIdempotencyKey(idempotencyKey);
  const supplierObjectId = validateObjectId(supplierId, "Supplier");

  const existing = await SupplierIdempotency.findOne({ store, scope: "order.create", key }).lean();
  if (existing) {
    if (existing.response) return { ...existing.response, replayed: true };
    throw new SupplierError("Ei request already processing e ache", 409);
  }

  const settings = await getSupplierSettings(store);
  const input = normalizeOrderInput(body, { maxOrderQty: settings.maxOrderQty });
  const now = new Date();
  const year = zonedDateKey(now, settings.timezone).slice(0, 4);

  let result = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
    try {
      result = await withSupplierTransaction(async (session) => {
        const supplier = await findSupplier(store, supplierObjectId, session);
        if (supplier.state !== "active") throw new SupplierError("Inactive supplier er jonno order kora jabe na", 409);

        const ids = input.items.map((it) => it.productId);
        const products = await querySession(Product.find({ _id: { $in: ids }, store }), session);
        if (products.length !== ids.length) throw new SupplierError("Kono product pawa jayni", 400);

        const productMap = new Map(products.map((p) => [String(p._id), p]));
        const lines = input.items.map((it) => {
          const product = productMap.get(it.productId);
          if (!product) throw new SupplierError("Product pawa jayni", 400);
          if (product.status !== "published") throw new SupplierError("Draft product diye supplier order kora jabe na", 409);
          const productCode =
            String(product.sku || "").trim() || `P-${String(product._id).slice(-6).toUpperCase()}`;
          const lineTotalPaisa = it.quantity * it.unitCostPaisa;
          if (!Number.isSafeInteger(lineTotalPaisa)) throw new SupplierError("Order total calculation limit chole geche", 400);
          return {
            product: product._id,
            productCode,
            name: String(product.title || product.name || "Product").trim(),
            quantity: it.quantity,
            unitCostPaisa: it.unitCostPaisa,
            lineTotalPaisa,
          };
        });

        const totalQty = lines.reduce((sum, line) => sum + line.quantity, 0);
        const totalAmountPaisa = lines.reduce((sum, line) => sum + line.lineTotalPaisa, 0);
        if (!Number.isSafeInteger(totalQty) || !Number.isSafeInteger(totalAmountPaisa)) {
          throw new SupplierError("Order total calculation limit chole geche", 400);
        }

        const orderNo = await nextSupplierNumber(store, "order", year, session);
        const invoiceNo = await nextSupplierNumber(store, "invoice", year, session);

        const orderDoc = new SupplierOrder({
          store,
          supplier: supplier._id,
          orderNo,
          orderDate: input.orderDate,
          items: lines,
          totalQty,
          totalAmountPaisa,
          note: input.note,
          source: "manual",
          idempotencyKey: key,
          createdBy: userOf(ctx),
        });
        await orderDoc.save({ session });

        const invoiceDoc = new SupplierInvoice({
          store,
          supplier: supplier._id,
          order: orderDoc._id,
          invoiceNo,
          issueDate: now,
          lines,
          totalAmountPaisa,
          paidAmountPaisa: 0,
          state: "active",
          createdBy: userOf(ctx),
        });
        await invoiceDoc.save({ session });

        // Only fill an empty link; never steal a product from another supplier.
        await Product.updateMany(
          { _id: { $in: ids }, store, supplierId: null },
          { $set: { supplierId: supplier._id } },
          { session }
        );

        const response = {
          orderId: String(orderDoc._id),
          invoiceId: String(invoiceDoc._id),
          orderNo,
          invoiceNo,
          orderDate: input.orderDate,
          totalQty,
          totalAmountPaisa,
          supplierId: String(supplier._id),
          supplierName: supplier.name,
        };
        await SupplierIdempotency.create(
          [{ store, scope: "order.create", key, status: "completed", response }],
          { session }
        );
        return response;
      });
    } catch (err) {
      lastError = err;
      if (isIdempotencyDuplicate(err)) {
        const saved = await SupplierIdempotency.findOne({ store, scope: "order.create", key }).lean();
        if (saved && saved.response) return { ...saved.response, replayed: true };
        throw new SupplierError("Ei request already processing e ache", 409);
      }
      if (!isDuplicateKey(err) || attempt === 2) throw err;
    }
  }

  if (!result) throw lastError || new SupplierError("Order create kora jayni", 500);

  await auditSupplier(ctx.req, {
    store,
    user: userOf(ctx),
    action: "supplier.order.create",
    entity: "supplier_order",
    entityId: result.orderId,
    newValue: {
      supplierId: result.supplierId,
      orderNo: result.orderNo,
      invoiceNo: result.invoiceNo,
      totalQty: result.totalQty,
      totalAmountPaisa: result.totalAmountPaisa,
    },
  });
  return { ...result, replayed: false };
}

async function reverseOrderStock({ store, order, session, userId, invoiceId }) {
  const movements = [];
  for (const item of order.items || []) {
    const product = await querySession(
      Product.findOneAndUpdate(
        { _id: item.product, store, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } },
        { new: true, session }
      ),
      session
    );
    if (!product) {
      throw new SupplierError(
        `Stock reverse kora jabe na — "${item.name}" er current stock kom. Age manually adjust korun.`,
        409
      );
    }
    movements.push({
      store,
      supplier: order.supplier,
      order: order._id,
      invoice: invoiceId || null,
      product: item.product,
      change: -item.quantity,
      stockAfter: product.stock,
      mode: "reversal",
      reason: `Reversal for ${order.orderNo}`,
      createdBy: userId,
    });
  }
  if (movements.length) await StockMovement.create(movements, { session });
  return movements.length;
}

async function receiveOrder(ctx, orderId) {
  const store = storeOf(ctx);
  const settings = await getSupplierSettings(store);
  const auto = settings.autoAdjustStock === true;

  const result = await withSupplierTransaction(async (session) => {
    if (!mongoose.isValidObjectId(orderId)) throw new SupplierError("Order pawa jayni", 404);
    const current = await querySession(SupplierOrder.findOne({ _id: orderId, store }), session);
    if (!current) throw new SupplierError("Order pawa jayni", 404);
    if (current.status === "received") {
      return {
        orderId: String(current._id),
        orderNo: current.orderNo,
        status: "received",
        stockApplied: current.stockApplied === true,
        stockChanged: false,
        alreadyReceived: true,
        message: current.stockApplied
          ? "Ei order age thekei received — stock abar add hoyni."
          : "Ei order age thekei received — stock change hoyni.",
      };
    }
    if (current.status !== "ordered") throw new SupplierError("Cancelled order receive kora jabe na", 409);

    const received = await querySession(
      SupplierOrder.findOneAndUpdate(
        { _id: current._id, store, status: "ordered" },
        {
          $set: {
            status: "received",
            receivedAt: new Date(),
            receivedBy: userOf(ctx),
            stockApplied: auto,
            stockMode: auto ? "auto" : "none",
          },
        },
        { new: true, session }
      ),
      session
    );
    if (!received) {
      const latest = await querySession(SupplierOrder.findOne({ _id: orderId, store }), session);
      if (latest && latest.status === "received") {
        return {
          orderId: String(latest._id),
          orderNo: latest.orderNo,
          status: "received",
          stockApplied: latest.stockApplied === true,
          stockChanged: false,
          alreadyReceived: true,
          message: "Ei order age thekei received — stock abar add hoyni.",
        };
      }
      throw new SupplierError("Order receive kora jayni — status abar check korun", 409);
    }

    if (auto) {
      const movements = [];
      for (const item of received.items || []) {
        const product = await querySession(
          Product.findOneAndUpdate(
            { _id: item.product, store },
            { $inc: { stock: item.quantity } },
            { new: true, session }
          ),
          session
        );
        if (!product) throw new SupplierError(`Product "${item.name}" pawa jayni — stock update hoyni`, 409);
        movements.push({
          store,
          supplier: received.supplier,
          order: received._id,
          product: item.product,
          change: item.quantity,
          stockAfter: product.stock,
          mode: "auto",
          reason: `Received ${received.orderNo}`,
          createdBy: userOf(ctx),
        });
      }
      if (movements.length) await StockMovement.create(movements, { session });
    }

    return {
      orderId: String(received._id),
      orderNo: received.orderNo,
      status: "received",
      stockApplied: auto,
      stockChanged: auto,
      alreadyReceived: false,
      message: auto
        ? "Order received — product stock auto update hoyeche."
        : "Stock not changed. Adjust manually.",
    };
  });

  if (!result.alreadyReceived) {
    await auditSupplier(ctx.req, {
      store,
      user: userOf(ctx),
      action: "supplier.order.receive",
      entity: "supplier_order",
      entityId: result.orderId,
      oldValue: { status: "ordered" },
      newValue: { status: "received", stockApplied: result.stockApplied },
    });
  }
  return result;
}

async function cancelOrder(ctx, orderId, reason) {
  const store = storeOf(ctx);
  const why = normalizeReason(reason, { field: "Cancel reason" });

  const result = await withSupplierTransaction(async (session) => {
    if (!mongoose.isValidObjectId(orderId)) throw new SupplierError("Order pawa jayni", 404);
    const order = await querySession(SupplierOrder.findOne({ _id: orderId, store }), session);
    if (!order) throw new SupplierError("Order pawa jayni", 404);
    if (order.status === "cancelled") {
      return { orderId: String(order._id), status: "cancelled", alreadyCancelled: true, stockReversed: false };
    }

    const claimed = await querySession(
      SupplierOrder.findOneAndUpdate(
        { _id: order._id, store, status: order.status, stockApplied: order.stockApplied },
        {
          $set: {
            status: "cancelled",
            cancelledAt: new Date(),
            cancelledBy: userOf(ctx),
            cancelReason: why,
            stockApplied: false,
            stockMode: order.stockApplied ? "reversed" : order.stockMode,
          },
        },
        { new: true, session }
      ),
      session
    );
    if (!claimed) throw new SupplierError("Order cancel kora jayni — abar chesta korun", 409);

    const invoice = await querySession(
      SupplierInvoice.findOne({ store, order: order._id, state: "active" }),
      session
    );

    let stockReversed = false;
    if (order.stockApplied) {
      await reverseOrderStock({
        store,
        order,
        session,
        userId: userOf(ctx),
        invoiceId: invoice ? invoice._id : null,
      });
      stockReversed = true;
    }

    if (invoice) {
      await SupplierInvoice.updateOne(
        { _id: invoice._id, store, state: "active" },
        {
          $set: {
            state: "void",
            voidReason: why,
            voidedAt: new Date(),
            voidedBy: userOf(ctx),
          },
        },
        { session }
      );
    }

    return {
      orderId: String(order._id),
      orderNo: order.orderNo,
      status: "cancelled",
      alreadyCancelled: false,
      stockReversed,
      invoiceVoided: !!invoice,
    };
  });

  if (!result.alreadyCancelled) {
    await auditSupplier(ctx.req, {
      store,
      user: userOf(ctx),
      action: "supplier.order.cancel",
      entity: "supplier_order",
      entityId: result.orderId,
      oldValue: { status: "ordered|received" },
      newValue: { status: "cancelled", reason: why, stockReversed: result.stockReversed },
    });
  }
  return result;
}

/* ------------------------------- invoice -------------------------------- */

async function voidInvoice(ctx, invoiceId, reason) {
  const store = storeOf(ctx);
  const why = normalizeReason(reason, { field: "Void reason" });

  const result = await withSupplierTransaction(async (session) => {
    const invoice = await findInvoice(store, invoiceId, session);
    if (invoice.state === "void") {
      return { invoiceId: String(invoice._id), state: "void", alreadyVoid: true, stockReversed: false };
    }

    const claimed = await querySession(
      SupplierInvoice.findOneAndUpdate(
        { _id: invoice._id, store, state: "active" },
        {
          $set: {
            state: "void",
            voidReason: why,
            voidedAt: new Date(),
            voidedBy: userOf(ctx),
          },
        },
        { new: true, session }
      ),
      session
    );
    if (!claimed) throw new SupplierError("Invoice void kora jayni — abar chesta korun", 409);

    let stockReversed = false;
    if (invoice.order) {
      const order = await querySession(SupplierOrder.findOne({ _id: invoice.order, store }), session);
      if (order && order.stockApplied) {
        await reverseOrderStock({
          store,
          order,
          session,
          userId: userOf(ctx),
          invoiceId: invoice._id,
        });
        await SupplierOrder.updateOne(
          { _id: order._id, store },
          { $set: { stockApplied: false, stockMode: "reversed" } },
          { session }
        );
        stockReversed = true;
      }
    }

    return {
      invoiceId: String(invoice._id),
      invoiceNo: invoice.invoiceNo,
      state: "void",
      alreadyVoid: false,
      stockReversed,
    };
  });

  if (!result.alreadyVoid) {
    await auditSupplier(ctx.req, {
      store,
      user: userOf(ctx),
      action: "supplier.invoice.void",
      entity: "supplier_invoice",
      entityId: result.invoiceId,
      oldValue: { state: "active" },
      newValue: { state: "void", reason: why, stockReversed: result.stockReversed },
    });
  }
  return result;
}

async function setInvoiceHold(ctx, invoiceId, body) {
  const store = storeOf(ctx);
  const input = normalizeHoldInput(body);
  const invoice = await findInvoice(store, invoiceId);
  if (invoice.state === "void") throw new SupplierError("Void invoice hold kora jabe na", 409);
  const old = { holdFlag: invoice.holdFlag, holdReason: invoice.holdReason };
  invoice.holdFlag = input.holdFlag;
  invoice.holdReason = input.holdReason;
  await invoice.save();
  await auditSupplier(ctx.req, {
    store,
    user: userOf(ctx),
    action: input.holdFlag ? "supplier.invoice.hold" : "supplier.invoice.unhold",
    entity: "supplier_invoice",
    entityId: invoice._id,
    oldValue: old,
    newValue: { holdFlag: invoice.holdFlag, holdReason: invoice.holdReason },
  });
  return invoiceView(invoice);
}

/* ------------------------------- payments -------------------------------- */

async function addPayment(ctx, invoiceId, body) {
  const store = storeOf(ctx);
  const input = normalizePaymentInput(body);

  const result = await withSupplierTransaction(async (session) => {
    const invoice = await findInvoice(store, invoiceId, session);
    if (invoice.state === "void") throw new SupplierError("Void invoice e payment kora jabe na", 409);

    const updated = await querySession(
      SupplierInvoice.findOneAndUpdate(
        {
          _id: invoice._id,
          store,
          state: "active",
          $expr: {
            $lte: [{ $add: ["$paidAmountPaisa", input.amountPaisa] }, "$totalAmountPaisa"],
          },
        },
        { $inc: { paidAmountPaisa: input.amountPaisa } },
        { new: true, session }
      ),
      session
    );

    if (!updated) {
      const latest = await findInvoice(store, invoiceId, session);
      if (latest.state === "void") throw new SupplierError("Void invoice e payment kora jabe na", 409);
      throw new SupplierError(
        `Payment due er beshi hote parbe na (due: ৳ ${(invoiceDuePaisa(latest) / 100).toFixed(2)})`,
        409
      );
    }

    const payment = new SupplierPayment({
      store,
      supplier: updated.supplier,
      invoice: updated._id,
      order: updated.order,
      amountPaisa: input.amountPaisa,
      method: input.method,
      reference: input.reference,
      paidAt: input.paidAt,
      note: input.note,
      recordedBy: userOf(ctx),
    });
    await payment.save({ session });

    return {
      paymentId: String(payment._id),
      invoice: invoiceView(updated),
      amountPaisa: input.amountPaisa,
    };
  });

  await auditSupplier(ctx.req, {
    store,
    user: userOf(ctx),
    action: "supplier.payment.record",
    entity: "supplier_payment",
    entityId: result.paymentId,
    newValue: {
      invoiceId: String(result.invoice.id),
      amountPaisa: result.amountPaisa,
      paymentStatus: result.invoice.paymentStatus,
    },
  });
  return result;
}

async function voidPayment(ctx, paymentId, reason) {
  const store = storeOf(ctx);
  const why = normalizeReason(reason, { field: "Void reason" });
  if (!mongoose.isValidObjectId(paymentId)) throw new SupplierError("Payment pawa jayni", 404);

  const result = await withSupplierTransaction(async (session) => {
    const payment = await querySession(SupplierPayment.findOne({ _id: paymentId, store }), session);
    if (!payment) throw new SupplierError("Payment pawa jayni", 404);
    if (payment.state === "void") {
      return { paymentId: String(payment._id), state: "void", alreadyVoid: true };
    }

    const claimed = await querySession(
      SupplierPayment.findOneAndUpdate(
        { _id: payment._id, store, state: "active" },
        {
          $set: {
            state: "void",
            voidReason: why,
            voidedAt: new Date(),
            voidedBy: userOf(ctx),
          },
        },
        { new: true, session }
      ),
      session
    );
    if (!claimed) throw new SupplierError("Payment void kora jayni — abar chesta korun", 409);

    const invoice = await querySession(
      SupplierInvoice.findOneAndUpdate(
        { _id: payment.invoice, store, paidAmountPaisa: { $gte: payment.amountPaisa } },
        { $inc: { paidAmountPaisa: -payment.amountPaisa } },
        { new: true, session }
      ),
      session
    );
    if (!invoice) throw new SupplierError("Invoice paid amount mile ni — payment void kora jayni", 409);

    return {
      paymentId: String(payment._id),
      state: "void",
      alreadyVoid: false,
      invoice: invoiceView(invoice),
    };
  });

  if (!result.alreadyVoid) {
    await auditSupplier(ctx.req, {
      store,
      user: userOf(ctx),
      action: "supplier.payment.void",
      entity: "supplier_payment",
      entityId: result.paymentId,
      oldValue: { state: "active" },
      newValue: { state: "void", reason: why },
    });
  }
  return result;
}

/* ------------------------------ stock log -------------------------------- */

async function adjustStock(ctx, supplierId, body) {
  const store = storeOf(ctx);
  const input = normalizeStockAdjustment(body);

  const result = await withSupplierTransaction(async (session) => {
    const supplier = await findSupplier(store, supplierId, session);
    if (supplier.state === "trashed") throw new SupplierError("Trashed supplier er stock adjust kora jabe na", 409);

    const product = await querySession(Product.findOne({ _id: input.productId, store }), session);
    if (!product) throw new SupplierError("Product pawa jayni", 404);
    if (product.supplierId && String(product.supplierId) !== String(supplier._id)) {
      throw new SupplierError("Ei product onno supplier er sathe linked", 409);
    }

    const guard =
      input.change < 0
        ? { _id: product._id, store, stock: { $gte: Math.abs(input.change) } }
        : { _id: product._id, store };
    const updated = await querySession(
      Product.findOneAndUpdate(guard, { $inc: { stock: input.change } }, { new: true, session }),
      session
    );
    if (!updated) throw new SupplierError("Stock negative hoye jabe — adjustment kora jayni", 409);

    if (!product.supplierId) {
      await Product.updateOne(
        { _id: product._id, store, supplierId: null },
        { $set: { supplierId: supplier._id } },
        { session }
      );
    }

    const movement = new StockMovement({
      store,
      supplier: supplier._id,
      product: product._id,
      change: input.change,
      stockAfter: updated.stock,
      mode: "manual",
      reason: input.reason,
      createdBy: userOf(ctx),
    });
    await movement.save({ session });

    return {
      movementId: String(movement._id),
      productId: String(product._id),
      change: input.change,
      stockAfter: updated.stock,
    };
  });

  await auditSupplier(ctx.req, {
    store,
    user: userOf(ctx),
    action: "supplier.stock.adjust",
    entity: "stock_movement",
    entityId: result.movementId,
    newValue: { productId: result.productId, change: result.change, reason: input.reason },
  });
  return result;
}

module.exports = {
  createSupplier,
  updateSupplier,
  voidSupplier,
  trashSupplier,
  restoreSupplier,
  purgeSupplier,
  createOrder,
  receiveOrder,
  cancelOrder,
  voidInvoice,
  setInvoiceHold,
  addPayment,
  voidPayment,
  adjustStock,
  invoiceView,
  orderView,
  findSupplier,
  findInvoice,
};
