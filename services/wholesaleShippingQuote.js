const Product = require("../models/Product");
const { getWholesaleSettings } = require("../lib/wholesaleSettings");
const { loadShippingData } = require("../lib/wholesaleShippingData");
const {
  WholesaleShippingError,
  calculateWholesaleShipping,
} = require("./wholesaleShipping");

function resolveLineCategory(categoryIds, ruleCategoryIds) {
  const rules = ruleCategoryIds instanceof Set ? ruleCategoryIds : new Set(ruleCategoryIds || []);
  const list = Array.isArray(categoryIds) ? categoryIds.map(String) : [];
  return list.find((id) => rules.has(id)) || list[0] || null;
}

function buildShippingLines(items, productsById, ruleCategoryIds) {
  const lines = [];
  for (const item of items || []) {
    if (!item || !item.product) continue;
    const productId = String(item.product._id || item.product);
    const product =
      productsById instanceof Map ? productsById.get(productId) : productsById && productsById[productId];
    if (!product) continue;
    const quantity = Math.max(0, Math.round(Number(item.quantity) || 0));
    if (!quantity) continue;
    lines.push({
      categoryId: resolveLineCategory(product.categories, ruleCategoryIds),
      weightKg: Math.max(0, Number(product.weightKg) || 0),
      quantity,
    });
  }
  return lines;
}

function buildQuote({ settings, data, lines, speedId = "" }) {
  const base = calculateWholesaleShipping({
    lines,
    rules: data.rules,
    vehicles: data.vehicles,
    overflowRule: settings.vehicleOverflowRule,
  });

  const wantedId = speedId ? String(speedId) : "";
  const speed = wantedId
    ? (data.speeds || []).find((row) => String(row._id) === wantedId)
    : null;
  if (wantedId && !speed) throw new WholesaleShippingError("Delivery speed valid na");

  const result = speed
    ? calculateWholesaleShipping({
        lines,
        rules: data.rules,
        vehicles: data.vehicles,
        overflowRule: settings.vehicleOverflowRule,
        speed,
      })
    : base;

  const categoryNames = new Map(
    (data.rules || []).map((rule) => [String(rule.category), rule.categoryName || ""])
  );

  const options = [
    {
      speedId: "",
      name: "Standard delivery",
      etaDays: null,
      extraType: null,
      extraValue: 0,
      extraPaisa: 0,
      totalPaisa: base.totalPaisa,
    },
    ...(data.speeds || []).map((row) => {
      const calc = calculateWholesaleShipping({
        lines,
        rules: data.rules,
        vehicles: data.vehicles,
        overflowRule: settings.vehicleOverflowRule,
        speed: row,
      });
      return {
        speedId: String(row._id),
        name: row.name,
        etaDays: row.etaDays,
        extraType: row.extraType,
        extraValue: row.extraValue,
        extraPaisa: calc.speedPaisa,
        totalPaisa: calc.totalPaisa,
      };
    }),
  ];

  return {
    enabled: true,
    weightKg: result.weightKg,
    categoryPaisa: result.categoryPaisa,
    vehiclePaisa: result.vehiclePaisa,
    speedPaisa: result.speedPaisa,
    totalPaisa: result.totalPaisa,
    categories: result.categories.map((row) => ({
      ...row,
      categoryName: categoryNames.get(String(row.category)) || "",
    })),
    vehicles: result.vehicles,
    vehicleCount: result.vehicleCount,
    speed: result.speed,
    overflowRule: result.overflowRule,
    options,
    selectedSpeedId: speed ? String(speed._id) : "",
  };
}

async function quoteWholesaleShipping({ storeId, items, speedId = "" }) {
  const settings = await getWholesaleSettings(storeId);
  if (!settings.enabled) return { enabled: false, options: [] };

  const data = await loadShippingData(storeId);
  const ids = [
    ...new Set(
      (items || [])
        .map((item) => (item && item.product ? String(item.product._id || item.product) : ""))
        .filter(Boolean)
    ),
  ];
  const products = ids.length
    ? await Product.find({ _id: { $in: ids }, store: storeId })
        .select("categories weightKg")
        .lean()
    : [];
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  const ruleCategoryIds = new Set((data.rules || []).map((rule) => String(rule.category)));
  const lines = buildShippingLines(items, productsById, ruleCategoryIds);

  return buildQuote({ settings, data, lines, speedId });
}

function toShippingBreakdown(quote) {
  if (!quote || !quote.enabled) return null;
  return {
    mode: "wholesale",
    weightKg: quote.weightKg,
    categoryPaisa: quote.categoryPaisa,
    vehiclePaisa: quote.vehiclePaisa,
    speedPaisa: quote.speedPaisa,
    totalPaisa: quote.totalPaisa,
    categories: quote.categories,
    vehicles: quote.vehicles,
    vehicleCount: quote.vehicleCount,
    speed: quote.speed,
    overflowRule: quote.overflowRule,
  };
}

module.exports = {
  WholesaleShippingError,
  resolveLineCategory,
  buildShippingLines,
  buildQuote,
  quoteWholesaleShipping,
  toShippingBreakdown,
};
