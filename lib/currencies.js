// StoreSettings er currency picker + symbol fallback ek-i source theke ashe.
const CURRENCIES = [
  { code: "USD", symbol: "$", name: "US Dollar", country: "United States" },
  { code: "BDT", symbol: "৳", name: "Bangladeshi Taka", country: "Bangladesh" },
  { code: "EUR", symbol: "€", name: "Euro", country: "European Union" },
  { code: "GBP", symbol: "£", name: "British Pound", country: "United Kingdom" },
  { code: "INR", symbol: "₹", name: "Indian Rupee", country: "India" },
  { code: "AUD", symbol: "A$", name: "Australian Dollar", country: "Australia" },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar", country: "Canada" },
  { code: "JPY", symbol: "¥", name: "Japanese Yen", country: "Japan" },
  { code: "CNY", symbol: "¥", name: "Chinese Yuan", country: "China" },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar", country: "Singapore" },
  { code: "MYR", symbol: "RM", name: "Malaysian Ringgit", country: "Malaysia" },
  { code: "PKR", symbol: "₨", name: "Pakistani Rupee", country: "Pakistan" },
  { code: "SAR", symbol: "﷼", name: "Saudi Riyal", country: "Saudi Arabia" },
  { code: "AED", symbol: "د.إ", name: "UAE Dirham", country: "United Arab Emirates" },
];

const BY_CODE = new Map(CURRENCIES.map((row) => [row.code, row]));

function currencyByCode(code) {
  return BY_CODE.get(String(code || "").toUpperCase()) || null;
}

module.exports = { CURRENCIES, currencyByCode };
