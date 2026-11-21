/* Courier dispatch — maps an order to Pathao / Steadfast payloads and stores
 * the consignment + tracking code back on the order. */
const Order = require("../models/Order");
const Store = require("../models/Store");
const courier = require("../lib/courierSettings");
const pathao = require("../lib/couriers/pathao");
const steadfast = require("../lib/couriers/steadfast");
const { loadValues, pathaoConfig, steadfastConfig } = require("./courierSettings");

class CourierError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CourierError";
    this.status = status;
  }
}

/* Lightweight payload for the order list: which providers the owner enabled. */
async function courierListInfo(storeId) {
  const values = await loadValues(storeId);
  const enabled = courier.enabledProviders(values);
  return {
    enabled: values.courier_enabled === "true",
    providers: enabled.map((key) => ({ key, label: courier.PROVIDER_LABELS[key] })),
    defaultProvider: courier.resolveDefaultProvider(values),
    codMode: values.courier_cod_mode,
  };
}

function codAmount(order, mode) {
  if (mode === "none") return 0;
  const total = Math.max(0, Number(order.totalAmount) || 0);
  if (order.paymentStatus === "paid") return 0;
  if (mode === "total") return Math.round(total);
  // due: installment orders already collected part of the money
  if (order.paymentMode === "installment") {
    return Math.round(Math.max(0, Number(order.dueAmount) || 0) / 100);
  }
  return Math.round(total);
}

function normalizeBdPhone(value) {
  let s = String(value || "").replace(/[^\d+]/g, "");
  if (s.startsWith("+880")) s = "0" + s.slice(4);
  if (s.startsWith("880") && s.length === 13) s = "0" + s.slice(3);
  return s;
}

function recipientOf(order) {
  const shipping = order.shipping || {};
  const name = order.customerName || shipping.name || "Customer";
  const phone = normalizeBdPhone(order.customerPhone || shipping.phone || "");
  const address = [order.address || shipping.address, order.thana, order.district, order.division]
    .filter(Boolean)
    .join(", ");
  return { name, phone, address };
}

function itemsOf(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const quantity = items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 1), 0);
  const description = items
    .map((item) => (item.product && (item.product.title || item.product.name)) || item.name || "")
    .filter(Boolean)
    .join(", ");
  return { quantity: Math.max(1, quantity), description: description.slice(0, 200) };
}

async function senderOf(storeId, values) {
  const store = await Store.findById(storeId).select("name contact.phone").lean();
  const name = values.courier_sender_name || (store && store.name) || "Store";
  const phone = normalizeBdPhone(values.courier_sender_phone || (store && store.contact && store.contact.phone) || "");
  return { name, phone };
}

/* District/thana → Pathao city/zone ids; configured defaults cover Bangla
 * address text and unmatched zone names. */
async function resolvePathaoDestination(cfg, order) {
  const cities = await pathao.listCities(cfg);
  const city = pathao.matchByName(cities, order.district || "");
  if (city) {
    const zones = await pathao.listZones(cfg, city.id);
    const zone = pathao.matchByName(zones, order.thana || "");
    if (zone) return { cityId: city.id, zoneId: zone.id };
    if (cfg.cityId && cfg.cityId === city.id && cfg.zoneId) {
      return { cityId: city.id, zoneId: cfg.zoneId };
    }
    throw new CourierError(
      `Pathao zone mileni (${order.thana || "thana khali"}) — thana check korun ba Settings er default zone din`
    );
  }
  if (cfg.cityId && cfg.zoneId) return { cityId: cfg.cityId, zoneId: cfg.zoneId };
  throw new CourierError(
    `Pathao city mileni (${order.district || "district khali"}) — Settings → Courier API → Pathao tab e default city/zone din`
  );
}

async function sendPathao(storeId, values, order, cod) {
  const cfg = pathaoConfig(values);
  if (!cfg.storeId) throw new CourierError("Pathao Merchant Store ID din");
  const sender = await senderOf(storeId, values);
  if (!sender.phone) throw new CourierError("Sender phone din (Settings → Courier API)");
  const recipient = recipientOf(order);
  if (!recipient.phone) throw new CourierError("Order e customer phone nai");
  if (!recipient.address) throw new CourierError("Order e delivery address nai");
  const { cityId, zoneId } = await resolvePathaoDestination(cfg, order);
  const item = itemsOf(order);
  const result = await pathao.createOrder(cfg, {
    store_id: Number(cfg.storeId),
    merchant_order_id: order.orderNumber,
    sender_name: sender.name.slice(0, 100),
    sender_phone: sender.phone,
    recipient_name: recipient.name.slice(0, 100),
    recipient_phone: recipient.phone,
    recipient_address: recipient.address.slice(0, 220),
    recipient_city: Number(cityId),
    recipient_zone: Number(zoneId),
    delivery_type: 48,
    item_type: 2,
    item_quantity: item.quantity,
    item_weight: Number(values.courier_weight) || 0.5,
    amount_to_collect: cod,
    item_description: item.description || "Parcel",
    special_instruction: String(order.orderNote || "").slice(0, 220),
  });
  return result;
}

async function sendSteadfast(storeId, values, order, cod) {
  const cfg = steadfastConfig(values);
  if (!cfg.apiKey || !cfg.secretKey) throw new CourierError("Steadfast API Key / Secret Key din");
  const recipient = recipientOf(order);
  if (!recipient.phone) throw new CourierError("Order e customer phone nai");
  if (!recipient.address) throw new CourierError("Order e delivery address nai");
  return steadfast.createOrder(cfg, {
    invoice: order.orderNumber,
    recipient_name: recipient.name.slice(0, 100),
    recipient_phone: recipient.phone,
    recipient_address: recipient.address.slice(0, 220),
    cod_amount: String(cod),
    note: String(order.orderNote || "").slice(0, 220),
  });
}

async function sendOrder(storeId, orderId, providerOverride = "") {
  const values = await loadValues(storeId);
  if (values.courier_enabled !== "true") {
    throw new CourierError("Courier API bondho — Settings → Courier API theke on korun");
  }

  const provider = String(providerOverride || "").toLowerCase() || courier.resolveDefaultProvider(values);
  if (!courier.PROVIDERS.includes(provider)) throw new CourierError("Courier chena jayni");
  if (provider === "pathao" && values.courier_pathao_enabled !== "true") {
    throw new CourierError("Pathao enable kora nai — Settings → Courier API → Pathao");
  }
  if (provider === "steadfast" && values.courier_steadfast_enabled !== "true") {
    throw new CourierError("Steadfast enable kora nai — Settings → Courier API → Steadfast");
  }

  const order = await Order.findOne({ _id: orderId, store: storeId });
  if (!order) throw new CourierError("Order pawa jayni", 404);
  if (order.courierConsignmentId || order.courierTrackingCode) {
    throw new CourierError("Ei order already courier e pathano hoyeche", 409);
  }

  const cod = codAmount(order, values.courier_cod_mode);
  let result;
  try {
    result =
      provider === "pathao"
        ? await sendPathao(storeId, values, order, cod)
        : await sendSteadfast(storeId, values, order, cod);
  } catch (err) {
    if (err instanceof CourierError) throw err;
    throw new CourierError(`${courier.PROVIDER_LABELS[provider]} e order pathate parlam na: ${err.message}`, 502);
  }

  order.courierProvider = provider;
  order.courierName = courier.PROVIDER_LABELS[provider];
  order.courierConsignmentId = result.consignmentId;
  order.courierTrackingCode = result.trackingCode || result.consignmentId;
  order.courierStatus = result.status || "";
  order.courierSentAt = new Date();
  await order.save();

  return {
    order,
    provider,
    providerLabel: courier.PROVIDER_LABELS[provider],
    consignmentId: order.courierConsignmentId,
    trackingCode: order.courierTrackingCode,
    status: order.courierStatus,
    codAmount: cod,
  };
}

module.exports = {
  CourierError,
  courierListInfo,
  codAmount,
  normalizeBdPhone,
  sendOrder,
};
