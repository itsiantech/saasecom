const mongoose = require("mongoose");
const Category = require("../models/Category");
const Product = require("../models/Product");
const { getStoreId } = require("../lib/tenantContext");
const {
  escapeRegex,
  slugify,
  uniqueSlug,
  buildTree,
  recomputeSubtree,
  softTrashMany,
  restoreMany,
  permanentDeleteMany,
  removeImageFile,
} = require("../lib/categoryHelpers");

// Categories are per-store (multi-tenant). Fall back to the async-local tenant id.
function storeIdOf(req) {
  if (req.store && req.store._id) return req.store._id;
  return getStoreId();
}

function buildIcon(body) {
  const type = body.iconType === "custom" || body.iconType === "library" ? body.iconType : "none";
  const value = typeof body.iconValue === "string" ? body.iconValue.slice(0, 4000) : "";
  return { type, value };
}

// Resolve ancestors + level for a (possibly new) parent id.
async function resolveParent(storeId, parentId, currentId) {
  if (!parentId) return { parent: null, ancestors: [], level: 0 };

  if (currentId && String(parentId) === String(currentId)) {
    const err = new Error("Nijer under nije move kora jabe na");
    err.status = 400;
    throw err;
  }

  const parent = await Category.findOne({ _id: parentId, store: storeId });
  if (!parent) {
    const err = new Error("Parent category pawa jayni");
    err.status = 400;
    throw err;
  }
  if (parent.status === "trashed") {
    const err = new Error("Trashed parent er under e category rakha jabe na");
    err.status = 400;
    throw err;
  }

  // Cycle prevention: if the current category is an ancestor of the new parent,
  // the parent is actually a descendant of the current category -> forbidden.
  if (
    currentId &&
    (parent.ancestors || []).some((a) => String(a) === String(currentId))
  ) {
    const err = new Error("Nijer descendant er under move kora jabe na (cycle)");
    err.status = 400;
    throw err;
  }

  const ancestors = [...(parent.ancestors || []).map((a) => new mongoose.Types.ObjectId(a)), parent._id];
  return { parent: parent._id, ancestors, level: ancestors.length };
}

// Next sibling order (max + 1) inside a parent.
async function nextOrder(storeId, parentId) {
  const siblings = await Category.find({
    store: storeId,
    parent: parentId || null,
    status: { $ne: "trashed" },
  })
    .select("order")
    .lean();
  if (!siblings.length) return 0;
  return Math.max(...siblings.map((s) => s.order || 0)) + 1;
}

/* ------------------------------------------------------------------ *
 * GET /api/categories?status=&search=&tree=true
 * ------------------------------------------------------------------ */
async function list(req, res) {
  const storeId = storeIdOf(req);
  if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });

  const { status, search, tree } = req.query;
  const filter = { store: storeId };

  if (status && ["draft", "published", "trashed"].includes(status)) filter.status = status;
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: rx }, { slug: rx }];
  }

  const categories = await Category.find(filter).sort({ order: 1, createdAt: 1 }).lean();

  // Per-status counts for the tab badges.
  const countsAgg = await Category.aggregate([
    { $match: { store: storeId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const counts = { all: 0, draft: 0, published: 0, trashed: 0 };
  countsAgg.forEach((c) => {
    counts[c._id] = c.count;
    counts.all += c.count;
  });

  // Attach direct product count + children count to every row.
  const productCounts = await Product.aggregate([
    { $match: { store: storeId, category: { $ne: null } } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
  ]);
  const pcMap = new Map(productCounts.map((p) => [p._id.toString(), p.count]));

  const childCounts = await Category.aggregate([
    { $match: { store: storeId, parent: { $ne: null } } },
    { $group: { _id: "$parent", count: { $sum: 1 } } },
  ]);
  const ccMap = new Map(childCounts.map((c) => [c._id.toString(), c.count]));

  const enriched = categories.map((c) => ({
    ...c,
    productCount: pcMap.get(c._id.toString()) || 0,
    childrenCount: ccMap.get(c._id.toString()) || 0,
  }));

  if (tree === "true") return res.json({ tree: buildTree(enriched), counts });
  res.json({ categories: enriched, counts });
}

/* ------------------------------------------------------------------ *
 * GET /api/categories/:id  (detail + breadcrumb + mini tree + products)
 * ------------------------------------------------------------------ */
async function getOne(req, res) {
  const storeId = storeIdOf(req);
  const category = await Category.findOne({ _id: req.params.id, store: storeId }).lean();
  if (!category) return res.status(404).json({ message: "Category pawa jayni" });

  // Breadcrumb: ordered list of ancestors + self.
  const breadcrumb = [];
  if (category.ancestors && category.ancestors.length) {
    const parents = await Category.find({ store: storeId, _id: { $in: category.ancestors } }).lean();
    const byId = new Map(parents.map((p) => [p._id.toString(), p]));
    for (const aid of category.ancestors) {
      const p = byId.get(aid.toString());
      if (p) breadcrumb.push({ _id: p._id, name: p.name, slug: p.slug });
    }
  }
  breadcrumb.push({ _id: category._id, name: category.name, slug: category.slug });

  // Direct children + one more level (sub-sub-categories) grouped under each child.
  const children = await Category.find({
    store: storeId,
    parent: category._id,
    status: { $ne: "trashed" },
  })
    .sort({ order: 1 })
    .lean();

  const childIds = children.map((c) => c._id);
  const grandchildren = childIds.length
    ? await Category.find({
        store: storeId,
        parent: { $in: childIds },
        status: { $ne: "trashed" },
      })
        .sort({ order: 1 })
        .lean()
    : [];

  const gcByParent = new Map();
  grandchildren.forEach((g) => {
    const p = g.parent.toString();
    if (!gcByParent.has(p)) gcByParent.set(p, []);
    gcByParent.get(p).push(g);
  });
  const childrenTree = children.map((c) => ({
    ...c,
    children: gcByParent.get(c._id.toString()) || [],
  }));

  // Products directly under this category (optionally include sub-category products).
  const includeSub = req.query.includeSub === "true";
  let productFilter = { store: storeId };
  if (includeSub) {
    const desc = await Category.find({ store: storeId, ancestors: category._id })
      .select("_id")
      .lean();
    productFilter.category = { $in: [category._id, ...desc.map((d) => d._id)] };
  } else {
    productFilter.category = category._id;
  }
  const products = await Product.find(productFilter).lean();

  res.json({ category, breadcrumb, children: childrenTree, products });
}

/* ------------------------------------------------------------------ *
 * POST /api/categories   (multipart/form-data)
 * ------------------------------------------------------------------ */
async function create(req, res) {
  const storeId = storeIdOf(req);
  if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });

  const body = req.body || {};
  const name = typeof body.name === "string" ? body.name : "";
  const parentId = body.parent && mongoose.isValidObjectId(body.parent) ? body.parent : null;

  const parentInfo = await resolveParent(storeId, parentId, null);

  // "Publish" -> published, anything else (Save / empty) -> draft. Never auto-publish.
  const status = body.status === "published" ? "published" : "draft";

  const slug = await uniqueSlug(Category, slugify(body.slug || name), storeId, null);

  const hasOrder = body.order !== undefined && Number.isFinite(Number(body.order));
  const order = hasOrder ? Number(body.order) : await nextOrder(storeId, parentInfo.parent);

  const category = await Category.create({
    store: storeId,
    name,
    slug,
    parent: parentInfo.parent,
    ancestors: parentInfo.ancestors,
    level: parentInfo.level,
    order,
    image: req.file ? "/uploads/" + req.file.filename : "",
    icon: buildIcon(body),
    status,
  });

  res.status(201).json(category);
}

/* ------------------------------------------------------------------ *
 * PUT /api/categories/:id   (multipart/form-data)
 * ------------------------------------------------------------------ */
async function update(req, res) {
  const storeId = storeIdOf(req);
  const category = await Category.findOne({ _id: req.params.id, store: storeId });
  if (!category) return res.status(404).json({ message: "Category pawa jayni" });

  const body = req.body || {};
  let parentChanged = false;

  if (body.name !== undefined) category.name = String(body.name);

  // Slug stays manually editable; if the user changes it we re-check uniqueness.
  if (body.slug !== undefined) {
    const base = slugify(body.slug);
    category.slug = await uniqueSlug(Category, base || slugify(category.name), storeId, category._id);
  }

  // Parent change -> validate + recalc ancestors/level for the whole subtree.
  if (body.parent !== undefined) {
    const parentId = body.parent && mongoose.isValidObjectId(body.parent) ? body.parent : null;
    const parentInfo = await resolveParent(storeId, parentId, category._id);
    if (String(category.parent || "") !== String(parentInfo.parent || "")) parentChanged = true;
    category.parent = parentInfo.parent;
    category.ancestors = parentInfo.ancestors;
    category.level = parentInfo.level;
  }

  if (body.order !== undefined && Number.isFinite(Number(body.order))) {
    category.order = Number(body.order);
  }

  if (body.status !== undefined) {
    if (body.status === "published") {
      category.status = "published";
      category.deletedAt = null;
    } else if (body.status === "draft") {
      category.status = "draft";
    } else if (body.status === "trashed") {
      category.status = "trashed";
      category.deletedAt = new Date();
    }
  }

  if (body.iconType !== undefined || body.iconValue !== undefined) {
    category.icon = buildIcon(body);
  }

  if (req.file) {
    removeImageFile(category.image);
    category.image = "/uploads/" + req.file.filename;
  } else if (body.imageRemove === "true") {
    removeImageFile(category.image);
    category.image = "";
  }

  await category.save();

  // Persist the root first, then fix descendants' ancestors/level.
  if (parentChanged) await recomputeSubtree(Category, storeId, category._id);

  res.json(category);
}

/* ------------------------------------------------------------------ *
 * PATCH /api/categories/reorder   { items: [{ id, parent, order }] }
 * ------------------------------------------------------------------ */
async function reorder(req, res) {
  const storeId = storeIdOf(req);
  const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ message: "Kono item nei" });

  const ops = [];
  const movedRoots = [];

  for (const item of items) {
    const { id, parent, order } = item || {};
    if (!id || !mongoose.isValidObjectId(id)) continue;

    const category = await Category.findOne({ _id: id, store: storeId });
    if (!category) continue;

    const newParent = parent && mongoose.isValidObjectId(parent) ? parent : null;

    // Determine the new parent/ancestors. `newParent === null` means "move to root",
    // so we must clear the parent/ancestors/level explicitly (not just skip the block).
    let parentInfo = { parent: null, ancestors: [], level: 0 };
    if (newParent) {
      // Cycle prevention: reject moving under itself or under its own descendant.
      parentInfo = await resolveParent(storeId, newParent, category._id);
    }
    if (String(category.parent || "") !== String(parentInfo.parent || "")) {
      category.parent = parentInfo.parent;
      category.ancestors = parentInfo.ancestors;
      category.level = parentInfo.level;
      movedRoots.push(category._id);
    }

    const finalOrder = Number.isFinite(Number(order)) ? Number(order) : category.order;
    ops.push({
      updateOne: {
        filter: { _id: category._id, store: storeId },
        update: {
          $set: {
            parent: category.parent,
            ancestors: category.ancestors,
            level: category.level,
            order: finalOrder,
          },
        },
      },
    });
  }

  if (!ops.length) return res.status(400).json({ message: "Kono valid item nei" });

  await Category.bulkWrite(ops);
  for (const rootId of movedRoots) {
    await recomputeSubtree(Category, storeId, rootId);
  }

  res.json({ ok: true, updated: ops.length });
}

/* ------------------------------------------------------------------ *
 * PATCH /api/categories/bulk   { action, ids }
 * ------------------------------------------------------------------ */
async function bulk(req, res) {
  const storeId = storeIdOf(req);
  const { action, ids } = req.body || {};
  const list = (Array.isArray(ids) ? ids : []).filter((id) => mongoose.isValidObjectId(id));
  if (!list.length) return res.status(400).json({ message: "Kono valid id nei" });

  switch (action) {
    case "trash": {
      const affected = await softTrashMany(Category, storeId, list);
      return res.json({ ok: true, affected });
    }
    case "restore": {
      const affected = await restoreMany(Category, storeId, list);
      return res.json({ ok: true, affected });
    }
    case "publish": {
      await Category.updateMany(
        { store: storeId, _id: { $in: list }, status: { $ne: "trashed" } },
        { $set: { status: "published" } }
      );
      return res.json({ ok: true });
    }
    case "draft": {
      await Category.updateMany(
        { store: storeId, _id: { $in: list }, status: { $ne: "trashed" } },
        { $set: { status: "draft" } }
      );
      return res.json({ ok: true });
    }
    case "permanent": {
      const affected = await permanentDeleteMany(Category, Product, storeId, list);
      return res.json({ ok: true, affected });
    }
    default:
      return res.status(400).json({ message: "Valid action lagbe (trash|restore|publish|draft|permanent)" });
  }
}

/* ------------------------------------------------------------------ *
 * DELETE /api/categories/:id           -> soft delete (trash)
 * PATCH  /api/categories/:id/restore   -> restore
 * DELETE /api/categories/:id/permanent -> permanent delete
 * ------------------------------------------------------------------ */
async function softDelete(req, res) {
  const storeId = storeIdOf(req);
  const exists = await Category.exists({ store: storeId, _id: req.params.id });
  if (!exists) return res.status(404).json({ message: "Category pawa jayni" });
  const affected = await softTrashMany(Category, storeId, [req.params.id]);
  res.json({ ok: true, affected });
}

async function restore(req, res) {
  const storeId = storeIdOf(req);
  const exists = await Category.exists({ store: storeId, _id: req.params.id });
  if (!exists) return res.status(404).json({ message: "Category pawa jayni" });
  const affected = await restoreMany(Category, storeId, [req.params.id]);
  res.json({ ok: true, affected });
}

async function permanentDelete(req, res) {
  const storeId = storeIdOf(req);
  const exists = await Category.exists({ store: storeId, _id: req.params.id });
  if (!exists) return res.status(404).json({ message: "Category pawa jayni" });
  const affected = await permanentDeleteMany(Category, Product, storeId, [req.params.id]);
  res.json({ ok: true, affected });
}

module.exports = {
  list,
  getOne,
  create,
  update,
  reorder,
  bulk,
  softDelete,
  restore,
  permanentDelete,
};
