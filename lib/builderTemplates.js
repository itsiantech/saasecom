const mongoose = require("mongoose");
const Product = require("../models/Product");
const ProductCategory = require("../models/ProductCategory");
const { cleanRules, BuilderRuleError } = require("./builderRules");

const SLOT_KEY_RE = /^[a-z][a-z0-9_-]{0,39}$/;
const GROUP_KEY_RE = /^[a-z][a-z0-9_-]{0,39}$/;
const MAX_GROUPS = 20;
const MAX_SLOTS = 60;
const MAX_FILTER_IDS = 24;

class TemplateError extends Error {
  constructor(message, code = "invalid_template") {
    super(message);
    this.name = "TemplateError";
    this.status = 400;
    this.code = code;
  }
}

function text(value, max = 300) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function normalizeSlug(raw) {
  return String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 62);
}

function intOr(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function objectIds(list, where) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new TemplateError(`${where} list hote hobe`);
  const ids = [...new Set(list.map(String))].slice(0, MAX_FILTER_IDS);
  for (const id of ids) {
    if (!mongoose.isValidObjectId(id)) throw new TemplateError(`${where} e valid id lagbe`);
  }
  return ids;
}

/* ------------------------------------------------------------------ *
 * Admin input → stored template shape. Rejects anything the rule engine
 * would silently misread (unknown slot, bad operand, duplicate keys).
 * ------------------------------------------------------------------ */

function cleanTemplate(input) {
  const src = input || {};
  const name = text(src.name, 120);
  if (!name) throw new TemplateError("Template name lagbe");

  const slug = normalizeSlug(src.slug || name);
  if (!slug) throw new TemplateError("Template slug lagbe (Bangla name hole slug alada din)");

  if (src.groups !== undefined && !Array.isArray(src.groups)) throw new TemplateError("Groups list hote hobe");
  const groups = (src.groups || []).slice(0, MAX_GROUPS).map((group, index) => {
    const key = text(group && group.key, 40).toLowerCase();
    if (!GROUP_KEY_RE.test(key)) throw new TemplateError(`Group ${index + 1}: key thik nei`);
    return {
      key,
      name: text(group.name, 80),
      nameBn: text(group.nameBn, 80),
      sortOrder: intOr(group.sortOrder, index),
    };
  });
  const groupKeys = new Set();
  for (const group of groups) {
    if (groupKeys.has(group.key)) throw new TemplateError(`Group key duibar ache: ${group.key}`);
    groupKeys.add(group.key);
  }

  if (!Array.isArray(src.slots)) throw new TemplateError("Slots list lagbe");
  const slots = src.slots.slice(0, MAX_SLOTS).map((slot, index) => {
    const key = text(slot && slot.key, 40).toLowerCase();
    if (!SLOT_KEY_RE.test(key)) throw new TemplateError(`Slot ${index + 1}: key thik nei`);
    const label = text(slot.label, 80);
    if (!label) throw new TemplateError(`Slot ${key}: label lagbe`);
    const group = text(slot.group, 40).toLowerCase();
    if (group && groupKeys.size && !groupKeys.has(group)) {
      throw new TemplateError(`Slot ${key}: group pawa jayni (${group})`);
    }
    const filter = slot.filter || {};
    return {
      key,
      label,
      labelBn: text(slot.labelBn, 80),
      group,
      required: slot.required === true,
      maxQty: Math.min(20, Math.max(1, intOr(slot.maxQty, 1))),
      sortOrder: intOr(slot.sortOrder, index),
      hint: text(slot.hint, 200),
      hintBn: text(slot.hintBn, 200),
      filter: {
        categories: objectIds(filter.categories, `Slot ${key} categories`),
        brands: objectIds(filter.brands, `Slot ${key} brands`),
        tags: objectIds(filter.tags, `Slot ${key} tags`),
        products: objectIds(filter.products, `Slot ${key} products`),
      },
    };
  });
  if (!slots.length) throw new TemplateError("Kam pokkhe ekta slot lagbe");

  const slotKeys = new Set();
  for (const slot of slots) {
    if (slotKeys.has(slot.key)) throw new TemplateError(`Slot key duibar ache: ${slot.key}`);
    slotKeys.add(slot.key);
  }

  let rules;
  try {
    rules = cleanRules(src.rules, slotKeys);
  } catch (err) {
    if (err instanceof BuilderRuleError) throw new TemplateError(err.message, err.code);
    throw err;
  }

  return {
    name,
    slug,
    description: text(src.description, 500),
    status: src.status === "published" ? "published" : "draft",
    groups,
    slots,
    rules,
    settings: {
      showTotal: !(src.settings && src.settings.showTotal === false),
      stickyBar: !(src.settings && src.settings.stickyBar === false),
    },
  };
}

function sortedSlots(template) {
  return [...(template.slots || [])].sort(
    (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || String(a.key).localeCompare(String(b.key))
  );
}

function sortedGroups(template) {
  return [...(template.groups || [])].sort(
    (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || String(a.key).localeCompare(String(b.key))
  );
}

function idList(list) {
  return (list || []).map((id) => String(id));
}

function publicRule(rule) {
  return {
    key: rule.key,
    type: rule.type,
    level: rule.level || "block",
    message: rule.message || "",
    messageBn: rule.messageBn || "",
    left: rule.left ? { slot: rule.left.slot, spec: rule.left.spec } : null,
    right: rule.right && rule.right.slot ? { slot: rule.right.slot, spec: rule.right.spec } : null,
    value: rule.value === undefined ? null : rule.value,
    terms: (rule.terms || []).map((term) => ({
      slot: term.slot,
      spec: term.spec,
      multiplier: Number(term.multiplier) || 1,
    })),
    limit: rule.limit === null || rule.limit === undefined ? null : Number(rule.limit),
  };
}

function publicTemplate(template) {
  return {
    slug: template.slug,
    name: template.name,
    description: template.description || "",
    groups: sortedGroups(template).map((group) => ({
      key: group.key,
      name: group.name || "",
      nameBn: group.nameBn || "",
    })),
    slots: sortedSlots(template).map((slot) => ({
      key: slot.key,
      label: slot.label,
      labelBn: slot.labelBn || "",
      group: slot.group || "",
      required: !!slot.required,
      maxQty: Number(slot.maxQty) || 1,
      hint: slot.hint || "",
      hintBn: slot.hintBn || "",
      filter: {
        categories: idList(slot.filter && slot.filter.categories),
        brands: idList(slot.filter && slot.filter.brands),
        tags: idList(slot.filter && slot.filter.tags),
        products: idList(slot.filter && slot.filter.products),
      },
    })),
    rules: (template.rules || []).map(publicRule),
    settings: {
      showTotal: !(template.settings && template.settings.showTotal === false),
      stickyBar: !(template.settings && template.settings.stickyBar === false),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Slot catalog reads. aggregate() bypasses tenantPlugin — the store id
 * stays inside $match (same rule as publicCatalogController).
 * ------------------------------------------------------------------ */

const EFFECTIVE_PRICE = {
  $cond: [{ $gt: ["$salePrice", 0] }, "$salePrice", { $ifNull: ["$regularPrice", "$price"] }],
};

const SORTS = {
  popular: { soldCount: -1, createdAt: -1 },
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  title: { title: 1, name: 1 },
};

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function categoryProductIds(storeId, categoryIds) {
  if (!categoryIds.length) return [];
  const rows = await ProductCategory.find({ store: storeId, category: { $in: categoryIds } })
    .select("product")
    .lean();
  return [...new Set(rows.map((row) => String(row.product)))].map((id) => new mongoose.Types.ObjectId(id));
}

async function querySlotProducts(storeId, slot, opts = {}) {
  const filter = slot.filter || {};
  const and = [{ store: new mongoose.Types.ObjectId(String(storeId)) }, { status: "published" }];

  const explicit = idList(filter.products);
  if (explicit.length) and.push({ _id: { $in: explicit.map((id) => new mongoose.Types.ObjectId(id)) } });

  const categories = idList(filter.categories);
  if (categories.length) {
    const joined = await categoryProductIds(storeId, categories);
    and.push({
      $or: [
        { categories: { $in: categories.map((id) => new mongoose.Types.ObjectId(id)) } },
        { _id: { $in: joined } },
      ],
    });
  }

  const brands = idList(filter.brands);
  if (brands.length) and.push({ brand: { $in: brands.map((id) => new mongoose.Types.ObjectId(id)) } });

  const tags = idList(filter.tags);
  if (tags.length) and.push({ tags: { $in: tags.map((id) => new mongoose.Types.ObjectId(id)) } });

  const q = text(opts.q, 120);
  if (q) {
    const regex = new RegExp(escapeRegex(q), "i");
    and.push({ $or: [{ title: regex }, { name: regex }, { sku: regex }] });
  }

  const limit = Math.min(100, Math.max(1, intOr(opts.limit, 48)));
  const sortKey = SORTS[opts.sort] ? opts.sort : "popular";
  const priceSort = opts.sort === "price_asc" || opts.sort === "price_desc";

  const pipeline = [{ $match: { $and: and } }];
  if (priceSort) {
    pipeline.push({ $addFields: { _effectivePrice: EFFECTIVE_PRICE } });
    pipeline.push({ $sort: { _effectivePrice: opts.sort === "price_asc" ? 1 : -1, createdAt: -1 } });
  } else {
    pipeline.push({ $sort: SORTS[sortKey] });
  }
  pipeline.push({ $limit: limit });

  return Product.aggregate(pipeline);
}

// Re-check that a product still belongs in the slot the shopper picked it for
// (a saved build may be loaded long after the admin changed the filter).
async function productMatchesSlot(storeId, slot, product) {
  const filter = (slot && slot.filter) || {};
  const explicit = idList(filter.products);
  if (explicit.length && !explicit.includes(String(product._id))) return false;

  const categories = idList(filter.categories);
  if (categories.length) {
    const own = (product.categories || []).map(String);
    let hit = own.some((id) => categories.includes(id));
    if (!hit) {
      const row = await ProductCategory.findOne({
        store: storeId,
        product: product._id,
        category: { $in: categories },
      })
        .select("_id")
        .lean();
      hit = !!row;
    }
    if (!hit) return false;
  }

  const brands = idList(filter.brands);
  if (brands.length && !brands.includes(String(product.brand))) return false;

  const tags = idList(filter.tags);
  if (tags.length) {
    const own = (product.tags || []).map(String);
    if (!own.some((id) => tags.includes(id))) return false;
  }

  return true;
}

module.exports = {
  TemplateError,
  cleanTemplate,
  publicTemplate,
  publicRule,
  sortedSlots,
  sortedGroups,
  querySlotProducts,
  productMatchesSlot,
  normalizeSlug,
};
