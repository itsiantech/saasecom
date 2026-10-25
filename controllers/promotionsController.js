const Product = require("../models/Product");
const Category = require("../models/Category");
const { getStoreId } = require("../lib/tenantContext");
const { buildTree } = require("../lib/categoryHelpers");
const { getSettingsMap } = require("./settingsController");

function storeIdOf(req) {
  if (req.store && req.store._id) return req.store._id;
  return getStoreId();
}

function boolOf(map, key) {
  return String(map[key]) === "true";
}

// GET /api/promotions/status — sidebar show/hide + admin toggle
async function status(req, res, next) {
  try {
    const map = await getSettingsMap();
    res.json({ flashSalesEnabled: boolOf(map, "flash_sales_enabled") });
  } catch (err) {
    next(err);
  }
}

// GET /api/promotions/options — products + category tree for pickers
async function options(req, res, next) {
  try {
    const storeId = storeIdOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });

    const [products, categories] = await Promise.all([
      Product.find({ store: storeId })
        .select("title name images status")
        .sort({ title: 1, name: 1 })
        .lean(),
      Category.find({ store: storeId, status: { $ne: "trashed" } })
        .select("name parent level order status")
        .sort({ order: 1, name: 1 })
        .lean(),
    ]);

    res.json({
      products: products.map((p) => ({
        id: p._id,
        name: p.title || p.name || "Untitled product",
        image: (p.images && p.images[0]) || "",
        status: p.status,
      })),
      categories: buildTree(categories),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { status, options };
