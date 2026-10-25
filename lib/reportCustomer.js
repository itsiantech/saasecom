// Guests are grouped by phone, then email, so one person is not counted many
// times. Orders with neither fall back to their own id.
function normalizePhone(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("880")) digits = `0${digits.slice(3)}`;
  else if (digits.length === 10 && digits.startsWith("1")) digits = `0${digits}`;
  return digits;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function customerKeyFor(order) {
  if (!order) return "g:o:unknown";
  if (order.customer) {
    const id = typeof order.customer === "object" && order.customer._id ? order.customer._id : order.customer;
    if (id) return `u:${String(id)}`;
  }
  const phone = normalizePhone(order.customerPhone);
  if (phone) return `g:p:${phone}`;
  const email = normalizeEmail(order.customerEmail);
  if (email) return `g:e:${email}`;
  return `g:o:${String(order._id || "unknown")}`;
}

function customerIsGuest(order) {
  return !order || !order.customer;
}

function customerDisplayName(order) {
  const name = String((order && order.customerName) || "").trim();
  if (name) return name;
  const phone = normalizePhone(order && order.customerPhone);
  if (phone) return phone;
  const email = normalizeEmail(order && order.customerEmail);
  if (email) return email;
  return "Guest";
}

module.exports = {
  normalizePhone,
  normalizeEmail,
  customerKeyFor,
  customerIsGuest,
  customerDisplayName,
};
