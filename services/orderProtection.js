/* Website-side order protection — evaluated at checkout before the order is
 * created. Blacklist entries always reject (generic polite message, never
 * reveals why). Rate limits and duplicate-address rules only flag unless the
 * store owner set that rule to "reject". */
const Order = require("../models/Order");
const Blacklist = require("../models/Blacklist");
const { normalizeBdPhone } = require("../lib/fraudRisk");
const { intOf } = require("../lib/protectionSettings");

const BLACKLIST_MESSAGE =
  "দুঃখিত, এই মুহূর্তে আপনার অর্ডারটি নেওয়া যাচ্ছে না। অনুগ্রহ করে আমাদের সাপোর্ট টিমের সাথে যোগাযোগ করুন।";

function normalizeAddress(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/* settings = the store's settings map (protect_* keys).
 * Returns { reject: string|null, flags: [{ rule, reason }] }. */
async function evaluateProtection({ storeId, phone, ip, address, settings = {} }) {
  const flags = [];
  const cleanPhone = normalizeBdPhone(phone);
  const cleanIp = String(ip || "").trim();
  const addr = normalizeAddress(address);

  // ---- blacklist (always rejects) ----
  const or = [];
  if (cleanPhone) or.push({ type: "phone", value: cleanPhone });
  if (cleanIp) or.push({ type: "ip", value: cleanIp });
  if (addr) or.push({ type: "address", value: addr });
  if (or.length) {
    const hit = await Blacklist.findOne({ store: storeId, $or: or }).lean();
    if (hit) {
      return { reject: BLACKLIST_MESSAGE, flags: [{ rule: "blacklist", reason: hit.type }] };
    }
  }

  const rateAction = settings.protect_rate_action === "reject" ? "reject" : "flag";
  const windowHours = intOf(settings, "protect_rate_window_hours");
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

  // ---- max orders per phone / per IP in the window ----
  const phoneMax = intOf(settings, "protect_rate_phone_max");
  if (cleanPhone && phoneMax > 0) {
    const n = await Order.countDocuments({
      store: storeId,
      customerPhone: cleanPhone,
      createdAt: { $gte: since },
    });
    if (n >= phoneMax) {
      if (rateAction === "reject") {
        return {
          reject: `গত ${windowHours} ঘণ্টায় এই নম্বর থেকে সর্বোচ্চ সংখ্যক অর্ডার হয়ে গেছে। অনুগ্রহ করে পরে আবার চেষ্টা করুন।`,
          flags: [{ rule: "rate_phone", reason: `${n}/${phoneMax}` }],
        };
      }
      flags.push({ rule: "rate_phone", reason: `${n}/${phoneMax} orders in ${windowHours}h` });
    }
  }
  const ipMax = intOf(settings, "protect_rate_ip_max");
  if (cleanIp && ipMax > 0) {
    const n = await Order.countDocuments({
      store: storeId,
      customerIp: cleanIp,
      createdAt: { $gte: since },
    });
    if (n >= ipMax) {
      if (rateAction === "reject") {
        return {
          reject: `গত ${windowHours} ঘণ্টায় এই সংযোগ থেকে সর্বোচ্চ সংখ্যক অর্ডার হয়ে গেছে। অনুগ্রহ করে পরে আবার চেষ্টা করুন।`,
          flags: [{ rule: "rate_ip", reason: `${n}/${ipMax}` }],
        };
      }
      flags.push({ rule: "rate_ip", reason: `${n}/${ipMax} orders in ${windowHours}h` });
    }
  }

  // ---- same address, many names/phones in a short time ----
  if (settings.protect_duplicate_enabled !== "false" && addr) {
    const minutes = intOf(settings, "protect_duplicate_window_minutes");
    const minOrders = intOf(settings, "protect_duplicate_min_orders");
    const recent = await Order.find({
      store: storeId,
      createdAt: { $gte: new Date(Date.now() - minutes * 60 * 1000) },
      address: { $ne: "" },
    })
      .select("address customerName customerPhone")
      .lean();
    const identities = new Set();
    recent.forEach((o) => {
      if (normalizeAddress(o.address) === addr) {
        identities.add(`${String(o.customerName || "").toLowerCase()}|${normalizeBdPhone(o.customerPhone) || o.customerPhone}`);
      }
    });
    if (identities.size >= minOrders) {
      const reason = `${identities.size} different names/phones at this address in ${minutes}m`;
      if (settings.protect_duplicate_action === "reject") {
        return { reject: BLACKLIST_MESSAGE, flags: [{ rule: "duplicate_address", reason }] };
      }
      flags.push({ rule: "duplicate_address", reason });
    }
  }

  return { reject: null, flags };
}

module.exports = { evaluateProtection, normalizeAddress, BLACKLIST_MESSAGE };