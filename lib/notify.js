/* ==========================================================================
   Order notification service — email + SMS.
   Best-effort: kono notification fail korle order create/update fail korbe na.
   ========================================================================== */
const Order = require("../models/Order");
const Store = require("../models/Store");
const EmailSetting = require("../models/EmailSetting");
const SmsSetting = require("../models/SmsSetting");
const { sendTemplate } = require("./mailer");
const { sendSms } = require("./sms");
const { renderTemplate, itemsTableHtml, esc } = require("./emailTemplates");

function money(n) {
  return "৳" + (Number(n) || 0).toLocaleString("en-US");
}

function orderContext(order, storeName) {
  const subtotal = (order.items || []).reduce(
    (s, it) => s + (Number(it.price) || (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0)),
    0
  );
  const address = [
    order.address,
    order.thana,
    order.district,
    order.division,
    order.postCode,
    order.country,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    store_name: esc(storeName),
    order_number: esc(order.orderNumber || ""),
    invoice_number: esc(order.invoiceNumber || ""),
    customer_name: esc(order.customerName || "Customer"),
    items: itemsTableHtml(order),
    subtotal: money(subtotal),
    shipping: money(order.shippingAmount),
    total: money(order.totalAmount),
    payment_method: esc(order.paymentLabel || order.paymentMethod || ""),
    shipping_address: esc(address || "—"),
    status: esc(order.status || ""),
    year: new Date().getFullYear(),
  };
}

async function fullOrder(orderId) {
  return Order.findById(orderId).populate("items.product").lean();
}

async function storeNameOf(storeId) {
  const store = await Store.findById(storeId).select("name").lean();
  return (store && store.name) || "Store";
}

async function notifyOrderPlaced(order) {
  try {
    const storeId = order.store;
    const [full, storeName] = await Promise.all([fullOrder(order._id), storeNameOf(storeId)]);
    if (!full) return;
    const ctx = orderContext(full, storeName);

    const email = await EmailSetting.findOne({ store: storeId }).lean();
    if (email && email.enabled) {
      if (email.notifyAdminNewOrder) {
        const to = email.orderEmail || email.adminEmail;
        if (to) await sendTemplate(storeId, "order_new_admin", ctx, to);
      }
      if (email.notifyCustomerNewOrder && full.customerEmail) {
        await sendTemplate(storeId, "order_new_customer", ctx, full.customerEmail);
      }
    }

    const sms = await SmsSetting.findOne({ store: storeId }).lean();
    if (sms && sms.enabled && sms.notifyOrder) {
      if (full.customerPhone) {
        await sendSms(storeId, full.customerPhone, renderTemplate(sms.orderTemplate, ctx));
      }
      if (sms.notifyAdminOrder && sms.adminPhone) {
        await sendSms(storeId, sms.adminPhone, `New order ${full.orderNumber} — ${money(full.totalAmount)}`);
      }
    }
  } catch (err) {
    console.error("notifyOrderPlaced:", err.message);
  }
}

async function notifyOrderCancelled(order) {
  try {
    const storeId = order.store;
    const [full, storeName] = await Promise.all([fullOrder(order._id), storeNameOf(storeId)]);
    if (!full) return;
    const ctx = orderContext(full, storeName);

    const email = await EmailSetting.findOne({ store: storeId }).lean();
    if (email && email.enabled) {
      const adminTo = email.cancelEmail || email.orderEmail || email.adminEmail;
      if (adminTo) await sendTemplate(storeId, "order_cancelled", ctx, adminTo);
      if (email.notifyCustomerCancelled && full.customerEmail) {
        await sendTemplate(storeId, "order_cancelled", ctx, full.customerEmail);
      }
    }

    const sms = await SmsSetting.findOne({ store: storeId }).lean();
    if (sms && sms.enabled && sms.notifyOrder && full.customerPhone) {
      await sendSms(
        storeId,
        full.customerPhone,
        `Order ${full.orderNumber} cancelled. — ${storeName}`
      );
    }
  } catch (err) {
    console.error("notifyOrderCancelled:", err.message);
  }
}

async function notifyOrderStatus(order) {
  try {
    const storeId = order.store;
    const [full, storeName] = await Promise.all([fullOrder(order._id), storeNameOf(storeId)]);
    if (!full) return;
    const ctx = orderContext(full, storeName);

    const email = await EmailSetting.findOne({ store: storeId }).lean();
    if (email && email.enabled && email.notifyCustomerStatus && full.customerEmail) {
      await sendTemplate(storeId, "order_status", ctx, full.customerEmail);
    }

    const sms = await SmsSetting.findOne({ store: storeId }).lean();
    if (sms && sms.enabled && sms.notifyOrder && full.customerPhone) {
      await sendSms(storeId, full.customerPhone, `Order ${full.orderNumber} status: ${full.status}. — ${storeName}`);
    }
  } catch (err) {
    console.error("notifyOrderStatus:", err.message);
  }
}

module.exports = { notifyOrderPlaced, notifyOrderCancelled, notifyOrderStatus, orderContext };
