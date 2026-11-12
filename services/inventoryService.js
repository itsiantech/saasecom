const Product = require("../models/Product");
const ProductVariation = require("../models/ProductVariation");
const ProductSwatch = require("../models/ProductSwatch");
const Category = require("../models/Category");
const Order = require("../models/Order");
const SupplierOrder = require("../models/SupplierOrder");
const Supplier = require("../models/Supplier");
const StockMovement = require("../models/StockMovement");
const InventoryMovement = require("../models/InventoryMovement");
const Warehouse = require("../models/Warehouse");
const WarehouseStock = require("../models/WarehouseStock");
const {
  LOW_STOCK_DEFAULT,
  MAX_MOVEMENT_SCAN,
  inventoryError,
  toInteger,
  cleanText,
  escapeRegex,
  parseStockImport,
  batchReference,
} = require("../lib/inventory");

/* ------------------------------- helpers ------------------------------- */

function targetKey(productId, variationId, swatchId) {
  return `${productId}|${variationId || ""}|${swatchId || ""}`;
}

function unitPrice(product, variation, swatch) {
  const base = Number(product.salePrice) || Number(product.regularPrice) || Number(product.price) || 0;
  if (swatch) return Number(swatch.price) || base;
  if (variation) return Number(variation.salePrice) || Number(variation.regularPrice) || base;
  return base;
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function targetFilter(storeId, target) {
  return {
    store: storeId,
    product: target.product._id,
    variation: target.variation ? target.variation._id : null,
    swatch: target.swatch ? target.swatch._id : null,
  };
}

async function loadStockData(storeId) {
  const [products, variations, swatches, categories] = await Promise.all([
    Product.find({ store: storeId })
      .select("title sku stock regularPrice salePrice price status hasVariations hasSwatches categories")
      .lean(),
    ProductVariation.find({ store: storeId })
      .select("product attributeName termName stock regularPrice salePrice")
      .lean(),
    ProductSwatch.find({ store: storeId }).select("product name price stock").lean(),
    Category.find({ store: storeId }).select("name").lean(),
  ]);

  const byProduct = new Map();
  for (const product of products) {
    byProduct.set(String(product._id), { product, variations: [], swatches: [] });
  }
  for (const variation of variations) {
    const entry = byProduct.get(String(variation.product));
    if (entry) entry.variations.push(variation);
  }
  for (const swatch of swatches) {
    const entry = byProduct.get(String(swatch.product));
    if (entry) entry.swatches.push(swatch);
  }
  const categoryNames = new Map(
    categories.map((category) => [String(category._id), category.name || "Untitled"])
  );
  return { products, variations, swatches, byProduct, categoryNames };
}

function productRow(product, entry, categoryNames) {
  const variations = (entry && entry.variations) || [];
  const swatches = (entry && entry.swatches) || [];
  const variantUnits = variations.reduce((sum, v) => sum + (Number(v.stock) || 0), 0);
  const swatchUnits = swatches.reduce((sum, s) => sum + (Number(s.stock) || 0), 0);
  const base = Number(product.stock) || 0;
  const units = base + variantUnits + swatchUnits;
  const baseValue = base * unitPrice(product);
  const variantValue = variations.reduce((sum, v) => sum + (Number(v.stock) || 0) * unitPrice(product, v), 0);
  const swatchValue = swatches.reduce((sum, s) => sum + (Number(s.stock) || 0) * unitPrice(product, null, s), 0);
  const firstCategory =
    Array.isArray(product.categories) && product.categories.length ? String(product.categories[0]) : "";
  return {
    id: String(product._id),
    title: product.title || "Untitled product",
    sku: product.sku || "",
    status: product.status || "draft",
    category: categoryNames.get(firstCategory) || "Uncategorized",
    base,
    variantUnits,
    swatchUnits,
    variants: variations.length,
    swatches: swatches.length,
    units,
    value: money(baseValue + variantValue + swatchValue),
  };
}

async function ensureDefaultWarehouse(storeId) {
  let warehouse = await Warehouse.findOne({ store: storeId, isDefault: true });
  if (warehouse) return warehouse;
  try {
    warehouse = await Warehouse.create({ store: storeId, name: "Main Warehouse", isDefault: true });
  } catch (err) {
    if (!err || err.code !== 11000) throw err;
    warehouse = await Warehouse.findOne({ store: storeId, isDefault: true });
    if (!warehouse) {
      // an admin already made a warehouse called "Main Warehouse" — promote it
      warehouse = await Warehouse.findOne({ store: storeId, name: "Main Warehouse" });
      if (warehouse) {
        warehouse.isDefault = true;
        await warehouse.save();
      }
    }
  }
  if (!warehouse) throw inventoryError("Default warehouse toiri kora jayni", 500);
  return warehouse;
}

async function resolveTarget(storeId, input) {
  const productId = input.productId || input.product;
  if (!productId) throw inventoryError("Product select korun");
  const product = await Product.findOne({ _id: productId, store: storeId }).lean();
  if (!product) throw inventoryError("Product pawa jayni", 404);

  const variationId = input.variationId || input.variation || null;
  const swatchId = input.swatchId || input.swatch || null;
  if (variationId && swatchId) throw inventoryError("Variation ar swatch ek shathe deya jabe na");

  let variation = null;
  let swatch = null;
  if (variationId) {
    variation = await ProductVariation.findOne({
      _id: variationId,
      product: product._id,
      store: storeId,
    }).lean();
    if (!variation) throw inventoryError("Variation pawa jayni", 404);
  }
  if (swatchId) {
    swatch = await ProductSwatch.findOne({ _id: swatchId, product: product._id, store: storeId }).lean();
    if (!swatch) throw inventoryError("Swatch pawa jayni", 404);
  }

  const model = variation ? ProductVariation : swatch ? ProductSwatch : Product;
  const doc = variation || swatch || product;
  const label = variation
    ? `${variation.attributeName || "Variant"}: ${variation.termName || ""}`.trim()
    : swatch
    ? `Swatch: ${swatch.name || ""}`.trim()
    : "";
  return { product, variation, swatch, model, targetId: doc._id, doc, label };
}

async function allocationsFor(storeId, target) {
  const rows = await WarehouseStock.find(targetFilter(storeId, target)).select("warehouse quantity").lean();
  const total = rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  return { total, rows };
}

function assertCapacity(next, allocated) {
  if (next < 0) throw inventoryError("Stock 0 er kom hote parbe na");
  if (next < allocated) {
    throw inventoryError(
      `Ei item er ${allocated} piece onno warehouse e allocate kora ache — stock tar niche nama jabe na`
    );
  }
}

// Optimistic set-stock loop: the update lands only while `stock` still holds
// the value we read, so two admins editing the same row cannot lose a change.
async function setTargetStock(storeId, target, nextOf, allocated) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await target.model
      .findOne({ _id: target.targetId, store: storeId })
      .select("stock")
      .lean();
    if (!current) throw inventoryError("Product pawa jayni", 404);
    const before = Number(current.stock) || 0;
    const next = nextOf(before);
    if (next === before) return { changed: false, before, after: before };
    assertCapacity(next, allocated);
    const updated = await target.model.findOneAndUpdate(
      { _id: target.targetId, store: storeId, stock: before },
      { $set: { stock: next } },
      { new: true }
    );
    if (updated) return { changed: true, before, after: next };
  }
  throw inventoryError("Stock update conflict — abar chesta korun", 409);
}

async function writeMovement(storeId, userId, target, row) {
  return InventoryMovement.create({
    store: storeId,
    product: target.product._id,
    variation: target.variation ? target.variation._id : null,
    swatch: target.swatch ? target.swatch._id : null,
    sku: target.product.sku || "",
    productName: target.product.title || "Untitled product",
    variantLabel: target.label,
    type: row.type,
    quantity: row.quantity,
    change: row.change,
    before: row.before == null ? null : row.before,
    after: row.after == null ? null : row.after,
    warehouse: row.warehouse || null,
    toWarehouse: row.toWarehouse || null,
    reference: cleanText(row.reference, 120),
    note: cleanText(row.note, 300),
    createdBy: userId || null,
  });
}

function ledgerRow(row) {
  return {
    id: String(row._id),
    at: row.createdAt,
    type: row.type,
    product: row.productName,
    sku: row.sku,
    variant: row.variantLabel,
    quantity: row.quantity,
    change: row.change,
    before: row.before,
    after: row.after,
    reference: row.reference,
    note: row.note,
  };
}

/* ------------------------------ overview ------------------------------- */

async function overview(storeId, query = {}) {
  const threshold = toInteger(
    query.lowStock == null ? LOW_STOCK_DEFAULT : query.lowStock,
    "Low stock limit",
    { min: 1, max: 1000 }
  );
  const ctx = await loadStockData(storeId);
  const rows = ctx.products.map((product) =>
    productRow(product, ctx.byProduct.get(String(product._id)), ctx.categoryNames)
  );

  const totals = rows.reduce(
    (acc, row) => {
      acc.products += 1;
      if (row.status === "published") acc.published += 1;
      acc.base += row.base;
      acc.variantUnits += row.variantUnits;
      acc.swatchUnits += row.swatchUnits;
      acc.units += row.units;
      acc.value += row.value;
      if (row.units === 0) acc.outOfStock += 1;
      else if (row.units <= threshold) acc.lowStock += 1;
      return acc;
    },
    {
      products: 0,
      published: 0,
      base: 0,
      variantUnits: 0,
      swatchUnits: 0,
      units: 0,
      value: 0,
      lowStock: 0,
      outOfStock: 0,
    }
  );
  totals.value = money(totals.value);

  const alerts = rows
    .filter((row) => row.units <= threshold)
    .sort((a, b) => a.units - b.units || a.title.localeCompare(b.title))
    .slice(0, 20);
  const recent = await movements(storeId, { days: 14, page: 1, limit: 8 });

  return { lowStockThreshold: threshold, totals, alerts, recent: recent.rows };
}

async function categoryStock(storeId) {
  const ctx = await loadStockData(storeId);
  const map = new Map();
  for (const product of ctx.products) {
    const row = productRow(product, ctx.byProduct.get(String(product._id)), ctx.categoryNames);
    const current = map.get(row.category) || { category: row.category, products: 0, units: 0, value: 0 };
    current.products += 1;
    current.units += row.units;
    current.value += row.value;
    map.set(row.category, current);
  }
  const rows = [...map.values()]
    .map((row) => ({ ...row, value: money(row.value) }))
    .sort((a, b) => b.units - a.units || a.category.localeCompare(b.category));
  const totals = rows.reduce(
    (acc, row) => ({
      products: acc.products + row.products,
      units: acc.units + row.units,
      value: money(acc.value + row.value),
    }),
    { products: 0, units: 0, value: 0 }
  );
  return { rows, totals };
}

async function variantStock(storeId) {
  const ctx = await loadStockData(storeId);
  const map = new Map();
  for (const entry of ctx.byProduct.values()) {
    const { product } = entry;
    for (const variation of entry.variations) {
      const attribute = variation.attributeName || "Variant";
      const term = variation.termName || "—";
      const key = `${attribute}\u0000${term}`;
      const current = map.get(key) || { attribute, term, products: new Set(), units: 0, value: 0 };
      current.products.add(String(product._id));
      const stock = Number(variation.stock) || 0;
      current.units += stock;
      current.value += stock * unitPrice(product, variation);
      map.set(key, current);
    }
    for (const swatch of entry.swatches) {
      const term = swatch.name || "—";
      const key = `Swatch\u0000${term}`;
      const current = map.get(key) || { attribute: "Swatch", term, products: new Set(), units: 0, value: 0 };
      current.products.add(String(product._id));
      const stock = Number(swatch.stock) || 0;
      current.units += stock;
      current.value += stock * unitPrice(product, null, swatch);
      map.set(key, current);
    }
  }
  const rows = [...map.values()]
    .map((row) => ({
      attribute: row.attribute,
      term: row.term,
      products: row.products.size,
      units: row.units,
      value: money(row.value),
    }))
    .sort((a, b) => b.units - a.units || a.attribute.localeCompare(b.attribute));
  const totals = rows.reduce(
    (acc, row) => ({ terms: acc.terms + 1, units: acc.units + row.units, value: money(acc.value + row.value) }),
    { terms: 0, units: 0, value: 0 }
  );
  return { rows, totals };
}

/* --------------------------- supplier purchases -------------------------- */

async function supplierStock(storeId, query = {}) {
  const status = String(query.status || "").trim();
  if (status && !["ordered", "received", "cancelled"].includes(status)) {
    throw inventoryError("Status ordered, received ba cancelled hote hobe");
  }
  const q = String(query.q || "").trim().toLowerCase();

  const [orders, suppliers] = await Promise.all([
    SupplierOrder.find({ store: storeId, ...(status ? { status } : {}) })
      .sort({ orderDate: -1 })
      .limit(500)
      .lean(),
    Supplier.find({ store: storeId }).select("name companyName").lean(),
  ]);
  const suppliersById = new Map(suppliers.map((supplier) => [String(supplier._id), supplier]));
  const rows = [];
  const seenOrders = new Set();
  for (const order of orders) {
    const supplier = suppliersById.get(String(order.supplier));
    const supplierName = supplier ? supplier.name || supplier.companyName || "Supplier" : "Supplier";
    for (const item of order.items || []) {
      const haystack = `${supplierName} ${order.orderNo} ${item.productCode} ${item.name}`.toLowerCase();
      if (q && !haystack.includes(q)) continue;
      seenOrders.add(String(order._id));
      rows.push({
        orderId: String(order._id),
        orderNo: order.orderNo,
        date: order.orderDate,
        supplier: supplierName,
        product: item.name,
        sku: item.productCode,
        quantity: item.quantity,
        unitCost: money((item.unitCostPaisa || 0) / 100),
        lineTotal: money((item.lineTotalPaisa || 0) / 100),
        status: order.status,
        stockApplied: order.stockApplied === true,
      });
    }
  }
  const totals = rows.reduce(
    (acc, row) => ({
      items: acc.items + 1,
      units: acc.units + row.quantity,
      cost: money(acc.cost + row.lineTotal),
    }),
    { items: 0, units: 0, cost: 0 }
  );
  totals.orders = seenOrders.size;
  return { rows, totals };
}

/* ---------------------------- stock movements ---------------------------- */

const SUPPLIER_TYPE = { auto: "purchase", manual: "adjustment", reversal: "reversal" };

async function fetchMovementRows(storeId, days) {
  const since = new Date(Date.now() - days * 86400000);
  const [ctx, ledger, supplierLedger, orders] = await Promise.all([
    loadStockData(storeId),
    InventoryMovement.find({ store: storeId, createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(MAX_MOVEMENT_SCAN)
      .lean(),
    StockMovement.find({ store: storeId, createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(MAX_MOVEMENT_SCAN)
      .lean(),
    Order.find({
      store: storeId,
      createdAt: { $gte: since },
      stockDeducted: true,
      stockRestored: { $ne: true },
      status: { $ne: "cancelled" },
    })
      .select("orderNumber items createdAt")
      .sort({ createdAt: -1 })
      .limit(MAX_MOVEMENT_SCAN)
      .lean(),
  ]);

  const warehouseMap = new Map();
  const warehouseIds = new Set();
  for (const row of ledger) {
    if (row.warehouse) warehouseIds.add(String(row.warehouse));
    if (row.toWarehouse) warehouseIds.add(String(row.toWarehouse));
  }
  if (warehouseIds.size) {
    const warehouses = await Warehouse.find({ store: storeId, _id: { $in: [...warehouseIds] } })
      .select("name")
      .lean();
    warehouses.forEach((warehouse) => warehouseMap.set(String(warehouse._id), warehouse.name));
  }

  const supplierOrderIds = [
    ...new Set(supplierLedger.map((row) => row.order).filter(Boolean).map(String)),
  ];
  const supplierOrders = supplierOrderIds.length
    ? await SupplierOrder.find({ store: storeId, _id: { $in: supplierOrderIds } }).select("orderNo").lean()
    : [];
  const orderNoById = new Map(supplierOrders.map((order) => [String(order._id), order.orderNo]));

  const titles = new Map(
    ctx.products.map((product) => [
      String(product._id),
      { title: product.title || "Untitled product", sku: product.sku || "" },
    ])
  );
  const variationLabels = new Map(
    ctx.variations.map((variation) => [
      String(variation._id),
      `${variation.attributeName || "Variant"}: ${variation.termName || ""}`.trim(),
    ])
  );

  const rows = [];
  for (const row of ledger) {
    rows.push({
      at: row.createdAt,
      type: row.type === "transfer_in" || row.type === "transfer_out" ? "transfer" : row.type,
      source: "inventory",
      product: row.productName,
      sku: row.sku,
      variant: row.variantLabel,
      quantity: row.quantity,
      change: row.change,
      before: row.before,
      after: row.after,
      reference: row.reference,
      note: row.note,
      warehouse: row.warehouse ? warehouseMap.get(String(row.warehouse)) || "" : "",
      toWarehouse: row.toWarehouse ? warehouseMap.get(String(row.toWarehouse)) || "" : "",
      direction: row.type === "transfer_out" ? "out" : row.type === "transfer_in" ? "in" : "",
    });
  }
  for (const row of supplierLedger) {
    const info = titles.get(String(row.product)) || { title: "Product", sku: "" };
    rows.push({
      at: row.createdAt,
      type: SUPPLIER_TYPE[row.mode] || "purchase",
      source: "supplier",
      product: info.title,
      sku: info.sku,
      variant: "",
      quantity: Math.abs(row.change),
      change: row.change,
      before: row.stockAfter == null ? null : row.stockAfter - row.change,
      after: row.stockAfter,
      reference: orderNoById.get(String(row.order)) || "",
      note: row.reason || "",
      warehouse: "",
      toWarehouse: "",
      direction: "",
    });
  }
  for (const order of orders) {
    for (const item of order.items || []) {
      const info = titles.get(String(item.product)) || { title: "Product", sku: "" };
      rows.push({
        at: order.createdAt,
        type: "sale",
        source: "order",
        product: info.title,
        sku: info.sku,
        variant: item.variation ? variationLabels.get(String(item.variation)) || "" : "",
        quantity: item.quantity,
        change: -(Number(item.quantity) || 0),
        before: null,
        after: null,
        reference: order.orderNumber || "",
        note: "",
        warehouse: "",
        toWarehouse: "",
        direction: "",
      });
    }
  }
  rows.sort((a, b) => new Date(b.at) - new Date(a.at));
  return rows;
}

const MOVEMENT_TYPES = ["all", "sale", "purchase", "damage", "return", "adjustment", "transfer", "reversal"];

async function movements(storeId, query = {}) {
  const days = Math.min(366, Math.max(1, Number(query.days) || 30));
  const type = MOVEMENT_TYPES.includes(String(query.type)) ? String(query.type) : "all";
  const q = String(query.q || "").trim().toLowerCase();
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(5000, Math.max(1, Number(query.limit) || 50));

  let rows = await fetchMovementRows(storeId, days);
  if (type !== "all") rows = rows.filter((row) => row.type === type);
  if (q) {
    rows = rows.filter((row) =>
      `${row.product} ${row.sku} ${row.variant} ${row.reference} ${row.note}`.toLowerCase().includes(q)
    );
  }
  const total = rows.length;
  return { rows: rows.slice((page - 1) * limit, page * limit), total, page, limit, days, type };
}

/* ------------------------ damage & returned stock ------------------------ */

async function damageReturnList(storeId, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(5000, Math.max(1, Number(query.limit) || 50));
  const [rows, total, agg] = await Promise.all([
    InventoryMovement.find({ store: storeId, type: { $in: ["damage", "return"] } })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    InventoryMovement.countDocuments({ store: storeId, type: { $in: ["damage", "return"] } }),
    InventoryMovement.aggregate([
      { $match: { store: storeId, type: { $in: ["damage", "return"] } } },
      { $group: { _id: "$type", quantity: { $sum: "$quantity" }, restocked: { $sum: "$change" } } },
    ]),
  ]);
  const summary = { damaged: 0, returned: 0, restocked: 0 };
  for (const row of agg) {
    if (row._id === "damage") summary.damaged = row.quantity;
    else {
      summary.returned = row.quantity;
      summary.restocked = Math.max(0, row.restocked);
    }
  }
  return { rows: rows.map(ledgerRow), total, page, limit, summary };
}

async function recordDamageReturn(storeId, userId, input) {
  const mode = String(input.mode || "").toLowerCase();
  if (!["damage", "return"].includes(mode)) throw inventoryError("Mode damage ba return hote hobe");
  const target = await resolveTarget(storeId, input);
  const quantity = toInteger(input.quantity, "Quantity", { min: 1 });
  const { total: allocated } = await allocationsFor(storeId, target);

  let result;
  if (mode === "damage") {
    result = await setTargetStock(
      storeId,
      target,
      (before) => {
        if (before < quantity) throw inventoryError(`Stock e sudhu ${before} piece ache`);
        return before - quantity;
      },
      allocated
    );
  } else if (input.restock === true || input.restock === "true") {
    result = await setTargetStock(storeId, target, (before) => before + quantity, allocated);
  } else {
    const current = await target.model.findOne({ _id: target.targetId, store: storeId }).select("stock").lean();
    const before = Number(current && current.stock) || 0;
    result = { changed: false, before, after: before };
  }

  const change = mode === "damage" ? -quantity : result.changed ? quantity : 0;
  await writeMovement(storeId, userId, target, {
    type: mode,
    quantity,
    change,
    before: result.before,
    after: result.after,
    reference: input.reference,
    note: input.note,
  });
  return {
    mode,
    quantity,
    change,
    before: result.before,
    after: result.after,
    product: target.product.title,
    variant: target.label,
  };
}

/* --------------------------- stock adjustments --------------------------- */

async function adjustStock(storeId, userId, input) {
  const target = await resolveTarget(storeId, input);
  const mode = ["set", "increase", "decrease"].includes(input.mode) ? input.mode : "set";
  const quantity = toInteger(input.quantity, "Quantity", { min: 0 });
  if (mode !== "set" && quantity < 1) throw inventoryError("Quantity 1 er beshi hote hobe");

  const { total: allocated } = await allocationsFor(storeId, target);
  const result = await setTargetStock(
    storeId,
    target,
    (before) => {
      if (mode === "increase") return before + quantity;
      if (mode === "decrease") {
        if (before < quantity) throw inventoryError(`Stock e sudhu ${before} piece ache`);
        return before - quantity;
      }
      return quantity;
    },
    allocated
  );

  let reference = "";
  if (result.changed) {
    reference = cleanText(input.reference, 120) || batchReference("ADJ");
    await writeMovement(storeId, userId, target, {
      type: "adjustment",
      quantity: Math.abs(result.after - result.before),
      change: result.after - result.before,
      before: result.before,
      after: result.after,
      reference,
      note: input.reason,
    });
  }
  return {
    changed: result.changed,
    reference,
    mode,
    before: result.before,
    after: result.after,
    product: target.product.title,
    variant: target.label,
  };
}

async function adjustmentList(storeId, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(5000, Math.max(1, Number(query.limit) || 50));
  const [rows, total] = await Promise.all([
    InventoryMovement.find({ store: storeId, type: "adjustment" })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    InventoryMovement.countDocuments({ store: storeId, type: "adjustment" }),
  ]);
  return { rows: rows.map(ledgerRow), total, page, limit };
}

/* ------------------------------ CSV import ------------------------------ */

async function importStock(storeId, userId, input) {
  const parsed = parseStockImport(input.csv);
  const ctx = await loadStockData(storeId);

  const skuMap = new Map();
  for (const product of ctx.products) {
    const sku = String(product.sku || "").trim().toLowerCase();
    if (!sku) continue;
    const list = skuMap.get(sku) || [];
    list.push(product);
    skuMap.set(sku, list);
  }

  const changes = [];
  const errors = [...parsed.errors];
  for (const row of parsed.rows) {
    const matches = skuMap.get(row.sku.trim().toLowerCase()) || [];
    if (!matches.length) {
      errors.push({ line: row.line, message: `${row.sku}: SKU pawa jayni` });
      continue;
    }
    if (matches.length > 1) {
      errors.push({ line: row.line, message: `${row.sku}: ekadhik product e ei SKU ache` });
      continue;
    }
    const product = matches[0];
    const entry = ctx.byProduct.get(String(product._id));
    if (row.variant && row.swatch) {
      errors.push({ line: row.line, message: `${row.sku}: variant ar swatch ek shathe deya jabe na` });
      continue;
    }

    let variation = null;
    let swatch = null;
    if (row.variant) {
      variation =
        (entry.variations || []).find(
          (v) => String(v.termName || "").trim().toLowerCase() === row.variant.toLowerCase()
        ) || null;
      if (!variation) {
        errors.push({ line: row.line, message: `${row.sku}: variation "${row.variant}" pawa jayni` });
        continue;
      }
    }
    if (row.swatch) {
      swatch =
        (entry.swatches || []).find(
          (s) => String(s.name || "").trim().toLowerCase() === row.swatch.toLowerCase()
        ) || null;
      if (!swatch) {
        errors.push({ line: row.line, message: `${row.sku}: swatch "${row.swatch}" pawa jayni` });
        continue;
      }
    }

    const before = Number(variation ? variation.stock : swatch ? swatch.stock : product.stock) || 0;
    const variantLabel = variation
      ? `${variation.attributeName || "Variant"}: ${variation.termName || ""}`.trim()
      : swatch
      ? `Swatch: ${swatch.name || ""}`.trim()
      : "";
    changes.push({
      line: row.line,
      productId: String(product._id),
      variationId: variation ? String(variation._id) : "",
      swatchId: swatch ? String(swatch._id) : "",
      sku: row.sku,
      product: product.title || "Untitled product",
      variant: variantLabel,
      before,
      after: row.stock,
      delta: row.stock - before,
      note: row.note,
    });
  }

  const dryRun = input.dryRun !== false && input.dryRun !== "false";
  const reference = batchReference("IMP");
  if (dryRun) {
    return {
      dryRun: true,
      reference,
      changes,
      errors,
      changed: changes.filter((change) => change.delta !== 0).length,
    };
  }

  let applied = 0;
  let skipped = 0;
  const failed = [];
  for (const change of changes) {
    if (change.delta === 0) {
      skipped += 1;
      continue;
    }
    try {
      const result = await adjustStock(storeId, userId, {
        productId: change.productId,
        variationId: change.variationId || undefined,
        swatchId: change.swatchId || undefined,
        mode: "set",
        quantity: change.after,
        reason: `CSV import${change.note ? " · " + change.note : ""}`,
        reference,
      });
      if (result.changed) applied += 1;
      else skipped += 1;
    } catch (err) {
      failed.push({ line: change.line, message: err.message });
    }
  }
  return {
    dryRun: false,
    reference,
    applied,
    skipped,
    changes,
    errors: errors.concat(failed),
  };
}

/* ------------------------------- warehouses ------------------------------ */

async function warehouseList(storeId) {
  await ensureDefaultWarehouse(storeId);
  const [warehouses, ctx, allocationRows] = await Promise.all([
    Warehouse.find({ store: storeId }).sort({ isDefault: -1, name: 1 }).lean(),
    loadStockData(storeId),
    WarehouseStock.find({ store: storeId }).select("warehouse product variation swatch quantity").lean(),
  ]);

  const targetUnits = new Map();
  for (const product of ctx.products) {
    const entry = ctx.byProduct.get(String(product._id));
    targetUnits.set(targetKey(product._id, "", ""), Number(product.stock) || 0);
    for (const variation of entry.variations) {
      targetUnits.set(targetKey(product._id, variation._id, ""), Number(variation.stock) || 0);
    }
    for (const swatch of entry.swatches) {
      targetUnits.set(targetKey(product._id, "", swatch._id), Number(swatch.stock) || 0);
    }
  }

  const byWarehouse = new Map();
  let allocated = 0;
  for (const row of allocationRows) {
    if (!targetUnits.has(targetKey(row.product, row.variation, row.swatch))) continue;
    const quantity = Number(row.quantity) || 0;
    byWarehouse.set(String(row.warehouse), (byWarehouse.get(String(row.warehouse)) || 0) + quantity);
    allocated += quantity;
  }
  const totalUnits = [...targetUnits.values()].reduce((sum, units) => sum + units, 0);

  const rows = warehouses.map((warehouse) => ({
    id: String(warehouse._id),
    name: warehouse.name,
    address: warehouse.address || "",
    isDefault: warehouse.isDefault === true,
    active: warehouse.active !== false,
    units: warehouse.isDefault ? totalUnits - allocated : byWarehouse.get(String(warehouse._id)) || 0,
  }));
  return { rows, totals: { units: totalUnits, allocated, warehouses: rows.length } };
}

async function createWarehouse(storeId, input) {
  const name = cleanText(input.name, 80);
  if (!name) throw inventoryError("Warehouse name din");
  const address = cleanText(input.address, 300);
  try {
    const doc = await Warehouse.create({ store: storeId, name, address });
    return { id: String(doc._id), name: doc.name, address: doc.address, isDefault: false, units: 0 };
  } catch (err) {
    if (err && err.code === 11000) throw inventoryError("Ei name e warehouse already ache", 409);
    throw err;
  }
}

async function deleteWarehouse(storeId, id) {
  const warehouse = await Warehouse.findOne({ _id: id, store: storeId });
  if (!warehouse) throw inventoryError("Warehouse pawa jayni", 404);
  if (warehouse.isDefault) throw inventoryError("Main warehouse delete kora jabe na");
  const held = await WarehouseStock.aggregate([
    { $match: { store: storeId, warehouse: warehouse._id } },
    { $group: { _id: null, total: { $sum: "$quantity" } } },
  ]);
  const units = held.length ? held[0].total : 0;
  if (units > 0) throw inventoryError(`Ei warehouse e ${units} piece ache — age transfer korun`, 409);
  await WarehouseStock.deleteMany({ store: storeId, warehouse: warehouse._id });
  await warehouse.deleteOne();
  return { ok: true };
}

async function transferStock(storeId, userId, input) {
  const sourceId = input.fromWarehouseId || input.from;
  const destId = input.toWarehouseId || input.to;
  if (!sourceId || !destId) throw inventoryError("From ar To warehouse select korun");
  if (String(sourceId) === String(destId)) throw inventoryError("Same warehouse e transfer kora jabe na");

  const [source, dest] = await Promise.all([
    Warehouse.findOne({ _id: sourceId, store: storeId }).lean(),
    Warehouse.findOne({ _id: destId, store: storeId }).lean(),
  ]);
  if (!source) throw inventoryError("Source warehouse pawa jayni", 404);
  if (!dest) throw inventoryError("Destination warehouse pawa jayni", 404);

  const target = await resolveTarget(storeId, input);
  const quantity = toInteger(input.quantity, "Quantity", { min: 1 });
  const current = await target.model.findOne({ _id: target.targetId, store: storeId }).select("stock").lean();
  if (!current) throw inventoryError("Product pawa jayni", 404);
  const stock = Number(current.stock) || 0;

  const allocations = await WarehouseStock.find(targetFilter(storeId, target))
    .select("warehouse quantity")
    .lean();
  const allocatedTotal = allocations.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  const qtyAt = (warehouse) => {
    if (warehouse.isDefault) return stock - allocatedTotal;
    const row = allocations.find((item) => String(item.warehouse) === String(warehouse._id));
    return row ? Number(row.quantity) || 0 : 0;
  };
  const sourceBefore = qtyAt(source);
  const destBefore = qtyAt(dest);
  if (sourceBefore < quantity) {
    throw inventoryError(`Source warehouse e sudhu ${Math.max(0, sourceBefore)} piece ache`);
  }

  if (!source.isDefault) {
    const claimed = await WarehouseStock.findOneAndUpdate(
      {
        ...targetFilter(storeId, target),
        warehouse: source._id,
        quantity: { $gte: quantity },
      },
      { $inc: { quantity: -quantity } },
      { new: true }
    );
    if (!claimed) throw inventoryError("Transfer conflict — source stock abar check korun", 409);
  }

  if (!dest.isDefault) {
    try {
      await WarehouseStock.findOneAndUpdate(
        { ...targetFilter(storeId, target), warehouse: dest._id },
        { $inc: { quantity } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (err) {
      if (!source.isDefault) {
        await WarehouseStock.updateOne(
          { ...targetFilter(storeId, target), warehouse: source._id },
          { $inc: { quantity } }
        );
      }
      throw err;
    }
  }

  // the default warehouse balance is implicit, so re-check that the other
  // warehouses still fit inside the product's total stock
  if (source.isDefault) {
    const check = await WarehouseStock.aggregate([
      { $match: targetFilter(storeId, target) },
      { $group: { _id: null, total: { $sum: "$quantity" } } },
    ]);
    const allocatedNow = check.length ? check[0].total : 0;
    if (allocatedNow > stock) {
      if (!dest.isDefault) {
        await WarehouseStock.updateOne(
          { ...targetFilter(storeId, target), warehouse: dest._id },
          { $inc: { quantity: -quantity } }
        );
      }
      throw inventoryError("Main warehouse e eto piece nei — abar chesta korun", 409);
    }
  }

  const reference = batchReference("TRF");
  const sourceAfter = sourceBefore - quantity;
  const destAfter = destBefore + quantity;
  const note = input.note;
  await writeMovement(storeId, userId, target, {
    type: "transfer_out",
    quantity,
    change: 0,
    before: sourceBefore,
    after: sourceAfter,
    warehouse: source._id,
    toWarehouse: dest._id,
    reference,
    note,
  });
  await writeMovement(storeId, userId, target, {
    type: "transfer_in",
    quantity,
    change: 0,
    before: destBefore,
    after: destAfter,
    warehouse: dest._id,
    toWarehouse: source._id,
    reference,
    note,
  });

  return {
    reference,
    quantity,
    product: target.product.title,
    variant: target.label,
    from: { id: String(source._id), name: source.name, after: sourceAfter },
    to: { id: String(dest._id), name: dest.name, after: destAfter },
  };
}

async function transfersList(storeId, query = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(5000, Math.max(1, Number(query.limit) || 50));
  const [rows, total, warehouses] = await Promise.all([
    InventoryMovement.find({ store: storeId, type: "transfer_out" })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    InventoryMovement.countDocuments({ store: storeId, type: "transfer_out" }),
    Warehouse.find({ store: storeId }).select("name").lean(),
  ]);
  const names = new Map(warehouses.map((warehouse) => [String(warehouse._id), warehouse.name]));
  return {
    rows: rows.map((row) => ({
      id: String(row._id),
      at: row.createdAt,
      product: row.productName,
      sku: row.sku,
      variant: row.variantLabel,
      quantity: row.quantity,
      from: names.get(String(row.warehouse)) || "",
      to: names.get(String(row.toWarehouse)) || "",
      reference: row.reference,
      note: row.note,
      after: row.after,
    })),
    total,
    page,
    limit,
  };
}

/* ---------------------------- product pickers ---------------------------- */

async function productOptions(storeId, query = {}) {
  const q = String(query.q || "").trim();
  const find = { store: storeId };
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    find.$or = [{ title: rx }, { sku: rx }];
  }
  const products = await Product.find(find)
    .select("title sku stock status hasVariations hasSwatches")
    .sort({ title: 1 })
    .limit(300)
    .lean();
  const ids = products.map((product) => product._id);
  const [variations, swatches] = await Promise.all([
    ProductVariation.find({ store: storeId, product: { $in: ids } })
      .select("product attributeName termName stock")
      .lean(),
    ProductSwatch.find({ store: storeId, product: { $in: ids } }).select("product name stock").lean(),
  ]);
  const varMap = new Map();
  for (const variation of variations) {
    const key = String(variation.product);
    const list = varMap.get(key) || [];
    list.push(variation);
    varMap.set(key, list);
  }
  const swatchMap = new Map();
  for (const swatch of swatches) {
    const key = String(swatch.product);
    const list = swatchMap.get(key) || [];
    list.push(swatch);
    swatchMap.set(key, list);
  }
  return products.map((product) => {
    const vars = varMap.get(String(product._id)) || [];
    const sws = swatchMap.get(String(product._id)) || [];
    const units =
      (Number(product.stock) || 0) +
      vars.reduce((sum, variation) => sum + (Number(variation.stock) || 0), 0) +
      sws.reduce((sum, swatch) => sum + (Number(swatch.stock) || 0), 0);
    return {
      id: String(product._id),
      title: product.title || "Untitled product",
      sku: product.sku || "",
      status: product.status || "draft",
      base: Number(product.stock) || 0,
      units,
      variations: vars.map((variation) => ({
        id: String(variation._id),
        label: `${variation.attributeName || "Variant"}: ${variation.termName || ""}`.trim(),
        stock: Number(variation.stock) || 0,
      })),
      swatches: sws.map((swatch) => ({
        id: String(swatch._id),
        label: `Swatch: ${swatch.name || ""}`.trim(),
        stock: Number(swatch.stock) || 0,
      })),
    };
  });
}

/* -------------------------------- exports -------------------------------- */

function isoDay(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function isoStamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16).replace("T", " ");
}

async function buildExport(storeId, view, query = {}) {
  const stamp = isoDay(new Date());
  const name = (label) => `inventory-${label}-${stamp}.csv`;

  if (view === "overview") {
    const ctx = await loadStockData(storeId);
    const rows = ctx.products.map((product) =>
      productRow(product, ctx.byProduct.get(String(product._id)), ctx.categoryNames)
    );
    return {
      title: "Stock overview",
      fileName: name("overview"),
      headers: [
        "Product",
        "SKU",
        "Status",
        "Category",
        "Base stock",
        "Variant units",
        "Swatch units",
        "On hand",
        "Stock value (BDT)",
      ],
      rows: rows.map((row) => [
        row.title,
        row.sku,
        row.status,
        row.category,
        row.base,
        row.variantUnits,
        row.swatchUnits,
        row.units,
        row.value,
      ]),
    };
  }

  if (view === "category") {
    const data = await categoryStock(storeId);
    return {
      title: "Category-wise stock",
      fileName: name("category"),
      headers: ["Category", "Products", "Units", "Stock value (BDT)"],
      rows: data.rows.map((row) => [row.category, row.products, row.units, row.value]),
    };
  }

  if (view === "variant") {
    const data = await variantStock(storeId);
    return {
      title: "Attribute / variant stock",
      fileName: name("variant"),
      headers: ["Attribute", "Term", "Products", "Units", "Stock value (BDT)"],
      rows: data.rows.map((row) => [row.attribute, row.term, row.products, row.units, row.value]),
    };
  }

  if (view === "supplier") {
    const data = await supplierStock(storeId, query);
    return {
      title: "Supplier stock (purchase)",
      fileName: name("supplier"),
      headers: [
        "Order",
        "Date",
        "Supplier",
        "Product",
        "SKU",
        "Qty",
        "Unit cost (BDT)",
        "Line total (BDT)",
        "Status",
        "Stock applied",
      ],
      rows: data.rows.map((row) => [
        row.orderNo,
        isoDay(row.date),
        row.supplier,
        row.product,
        row.sku,
        row.quantity,
        row.unitCost,
        row.lineTotal,
        row.status,
        row.stockApplied ? "Yes" : "No",
      ]),
    };
  }

  if (view === "movements") {
    const data = await movements(storeId, { ...query, page: 1, limit: MAX_MOVEMENT_SCAN });
    return {
      title: "Stock movements",
      fileName: name("movements"),
      headers: [
        "Date",
        "Type",
        "Product",
        "SKU",
        "Variant",
        "Quantity",
        "Change",
        "Before",
        "After",
        "Warehouse",
        "To warehouse",
        "Reference",
        "Note",
      ],
      rows: data.rows.map((row) => [
        isoStamp(row.at),
        row.type,
        row.product,
        row.sku,
        row.variant,
        row.quantity,
        row.change,
        row.before == null ? "" : row.before,
        row.after == null ? "" : row.after,
        row.warehouse,
        row.toWarehouse,
        row.reference,
        row.note,
      ]),
    };
  }

  if (view === "damage") {
    const data = await damageReturnList(storeId, { page: 1, limit: 5000 });
    return {
      title: "Damage & returned stock",
      fileName: name("damage-return"),
      headers: ["Date", "Type", "Product", "SKU", "Variant", "Quantity", "Stock change", "Before", "After", "Reference", "Note"],
      rows: data.rows.map((row) => [
        isoStamp(row.at),
        row.type,
        row.product,
        row.sku,
        row.variant,
        row.quantity,
        row.change,
        row.before == null ? "" : row.before,
        row.after == null ? "" : row.after,
        row.reference,
        row.note,
      ]),
    };
  }

  if (view === "adjustment") {
    const data = await adjustmentList(storeId, { page: 1, limit: 5000 });
    return {
      title: "Stock adjustments",
      fileName: name("adjustment"),
      headers: ["Date", "Product", "SKU", "Variant", "Quantity", "Stock change", "Before", "After", "Reference", "Reason"],
      rows: data.rows.map((row) => [
        isoStamp(row.at),
        row.product,
        row.sku,
        row.variant,
        row.quantity,
        row.change,
        row.before == null ? "" : row.before,
        row.after == null ? "" : row.after,
        row.reference,
        row.note,
      ]),
    };
  }

  if (view === "transfer") {
    const data = await transfersList(storeId, { page: 1, limit: 5000 });
    return {
      title: "Warehouse transfers",
      fileName: name("transfer"),
      headers: ["Date", "Product", "SKU", "Variant", "Quantity", "From", "To", "Reference", "Note"],
      rows: data.rows.map((row) => [
        isoStamp(row.at),
        row.product,
        row.sku,
        row.variant,
        row.quantity,
        row.from,
        row.to,
        row.reference,
        row.note,
      ]),
    };
  }

  throw inventoryError("Export view pawa jayni");
}

module.exports = {
  overview,
  categoryStock,
  variantStock,
  supplierStock,
  movements,
  damageReturnList,
  recordDamageReturn,
  adjustStock,
  adjustmentList,
  importStock,
  warehouseList,
  createWarehouse,
  deleteWarehouse,
  transferStock,
  transfersList,
  productOptions,
  buildExport,
};
