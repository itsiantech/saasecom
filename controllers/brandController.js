const mongoose = require("mongoose");
const Brand = require("../models/Brand");
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

// Brands are per-store (multi-tenant). Fall back to the async-local tenant id.
function storeIdOf(req) {
  if (req.store && req.store._id) return req.store._id;
  return getStoreId();
}

function buildIcon(body) {
  const type = body.iconType === "custom" || body.iconType === "library" ? body.iconType : "none";
  const value = typeof body.iconValue === "string" ? body.iconValue.slice(0, 4000) : "";
  return { type, value };
}

async function resolveParent(storeId, parentId, currentId) {
  if (!parentId) return { parent: null, ancestors: [], level: 0 };

  if (currentId && String(parentId) === String(currentId)) {
    const err = new Error("Nijer under nije move kora jabe na");
    err.status = 400;
    throw err;
  }

  const parent = await Brand.findOne({ _id: parentId, store: storeId });
  if (!parent) {
    const err = new Error("Parent brand pawa jayni");
    err.status = 400;
    throw err;
  }
  if (parent.status === "trashed") {
    const err = new Error("Trashed parent er under e brand rakha jabe na");
    err.status = 400;
    throw err;
  }

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

async function nextOrder(storeId, parentId) {
  const siblings = await Brand.find({
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
 * GET /api/brands?status=&search=&tree=true
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

  const brands = await Brand.find(filter).sort({ order: 1, createdAt: 1 }).lean();

  const countsAgg = await Brand.aggregate([
    { $match: { store: storeId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const counts = { all: 0, draft: 0, published: 0, trashed: 0 };
  countsAgg.forEach((c) => {
    counts[c._id] = c.count;
    counts.all += c.count;
  });

  const productCounts = await Product.aggregate([
    { $match: { store: storeId, brand: { $ne: null } } },
    { $group: { _id: "$brand", count: { $sum: 1 } } },
  ]);
  const pcMap = new Map(productCounts.map((p) => [p._id.toString(), p.count]));

  const childCounts = await Brand.aggregate([
    { $match: { store: storeId, parent: { $ne: null } } },
    { $group: { _id: "$parent", count: { $sum: 1 } } },
  ]);
  const ccMap = new Map(childCounts.map((c) => [c._id.toString(), c.count]));

  const enriched = brands.map((b) => ({
    ...b,
    productCount: pcMap.get(b._id.toString()) || 0,
    childrenCount: ccMap.get(b._id.toString()) || 0,
  }));

  if (tree === "true") return res.json({ tree: buildTree(enriched), counts });
  res.json({ brands: enriched, counts });
}

/* ------------------------------------------------------------------ *
 * GET /api/brands/:id  (detail + breadcrumb + mini tree + products)
 * ------------------------------------------------------------------ */
async function getOne(req, res) {
  const storeId = storeIdOf(req);
  const brand = await Brand.findOne({ _id: req.params.id, store: storeId }).lean();
  if (!brand) return res.status(404).json({ message: "Brand pawa jayni" });

  const breadcrumb = [];
  if (brand.ancestors && brand.ancestors.length) {
    const parents = await Brand.find({ store: storeId, _id: { $in: brand.ancestors } }).lean();
    const byId = new Map(parents.map((p) => [p._id.toString(), p]));
    for (const aid of brand.ancestors) {
      const p = byId.get(aid.toString());
      if (p) breadcrumb.push({ _id: p._id, name: p.name, slug: p.slug });
    }
  }
  breadcrumb.push({ _id: brand._id, name: brand.name, slug: brand.slug });

  const children = await Brand.find({
    store: storeId,
    parent: brand._id,
    status: { $ne: "trashed" },
  })
    .sort({ order: 1 })
    .lean();

  const childIds = children.map((c) => c._id);
  const grandchildren = childIds.length
    ? await Brand.find({
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

  const includeSub = req.query.includeSub === "true";
  let productFilter = { store: storeId };
  if (includeSub) {
    const desc = await Brand.find({ store: storeId, ancestors: brand._id })
      .select("_id")
      .lean();
    productFilter.brand = { $in: [brand._id, ...desc.map((d) => d._id)] };
  } else {
    productFilter.brand = brand._id;
  }
  const products = await Product.find(productFilter).lean();

  res.json({ brand, breadcrumb, children: childrenTree, products });
}

/* ------------------------------------------------------------------ *
 * POST /api/brands   (multipart/form-data)
 * ------------------------------------------------------------------ */
async function create(req, res) {
  const storeId = storeIdOf(req);
  if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });

  const body = req.body || {};
  const name = typeof body.name === "string" ? body.name : "";
  const parentId = body.parent && mongoose.isValidObjectId(body.parent) ? body.parent : null;

  const parentInfo = await resolveParent(storeId, parentId, null);
  const status = body.status === "published" ? "published" : "draft";
  const slug = await uniqueSlug(Brand, slugify(body.slug || name), storeId, null, "brand");

  const hasOrder = body.order !== undefined && Number.isFinite(Number(body.order));
  const order = hasOrder ? Number(body.order) : await nextOrder(storeId, parentInfo.parent);

  const brand = await Brand.create({
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

  res.status(201).json(brand);
}

/* ------------------------------------------------------------------ *
 * PUT /api/brands/:id   (multipart/form-data)
 * ------------------------------------------------------------------ */
async function update(req, res) {
  const storeId = storeIdOf(req);
  const brand = await Brand.findOne({ _id: req.params.id, store: storeId });
  if (!brand) return res.status(404).json({ message: "Brand pawa jayni" });

  const body = req.body || {};
  let parentChanged = false;

  if (body.name !== undefined) brand.name = String(body.name);

  if (body.slug !== undefined) {
    const base = slugify(body.slug);
    brand.slug = await uniqueSlug(Brand, base || slugify(brand.name), storeId, brand._id, "brand");
  }

  if (body.parent !== undefined) {
    const parentId = body.parent && mongoose.isValidObjectId(body.parent) ? body.parent : null;
    const parentInfo = await resolveParent(storeId, parentId, brand._id);
    if (String(brand.parent || "") !== String(parentInfo.parent || "")) parentChanged = true;
    brand.parent = parentInfo.parent;
    brand.ancestors = parentInfo.ancestors;
    brand.level = parentInfo.level;
  }

  if (body.order !== undefined && Number.isFinite(Number(body.order))) {
    brand.order = Number(body.order);
  }

  if (body.status !== undefined) {
    if (body.status === "published") {
      brand.status = "published";
      brand.deletedAt = null;
    } else if (body.status === "draft") {
      brand.status = "draft";
    } else if (body.status === "trashed") {
      brand.status = "trashed";
      brand.deletedAt = new Date();
    }
  }

  if (body.iconType !== undefined || body.iconValue !== undefined) {
    brand.icon = buildIcon(body);
  }

  if (req.file) {
    removeImageFile(brand.image);
    brand.image = "/uploads/" + req.file.filename;
  } else if (body.imageRemove === "true") {
    removeImageFile(brand.image);
    brand.image = "";
  }

  await brand.save();
  if (parentChanged) await recomputeSubtree(Brand, storeId, brand._id);

  res.json(brand);
}

/* ------------------------------------------------------------------ *
 * PATCH /api/brands/reorder   { items: [{ id, parent, order }] }
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

    const brand = await Brand.findOne({ _id: id, store: storeId });
    if (!brand) continue;

    const newParent = parent && mongoose.isValidObjectId(parent) ? parent : null;
    let parentInfo = { parent: null, ancestors: [], level: 0 };
    if (newParent) parentInfo = await resolveParent(storeId, newParent, brand._id);

    if (String(brand.parent || "") !== String(parentInfo.parent || "")) {
      brand.parent = parentInfo.parent;
      brand.ancestors = parentInfo.ancestors;
      brand.level = parentInfo.level;
      movedRoots.push(brand._id);
    }

    const finalOrder = Number.isFinite(Number(order)) ? Number(order) : brand.order;
    ops.push({
      updateOne: {
        filter: { _id: brand._id, store: storeId },
        update: {
          $set: {
            parent: brand.parent,
            ancestors: brand.ancestors,
            level: brand.level,
            order: finalOrder,
          },
        },
      },
    });
  }

  if (!ops.length) return res.status(400).json({ message: "Kono valid item nei" });

  await Brand.bulkWrite(ops);
  for (const rootId of movedRoots) await recomputeSubtree(Brand, storeId, rootId);

  res.json({ ok: true, updated: ops.length });
}

/* ------------------------------------------------------------------ *
 * PATCH /api/brands/bulk   { action, ids }
 * ------------------------------------------------------------------ */
async function bulk(req, res) {
  const storeId = storeIdOf(req);
  const { action, ids } = req.body || {};
  const list = (Array.isArray(ids) ? ids : []).filter((id) => mongoose.isValidObjectId(id));
  if (!list.length) return res.status(400).json({ message: "Kono valid id nei" });

  switch (action) {
    case "trash": {
      const affected = await softTrashMany(Brand, storeId, list);
      return res.json({ ok: true, affected });
    }
    case "restore": {
      const affected = await restoreMany(Brand, storeId, list);
      return res.json({ ok: true, affected });
    }
    case "publish": {
      await Brand.updateMany(
        { store: storeId, _id: { $in: list }, status: { $ne: "trashed" } },
        { $set: { status: "published" } }
      );
      return res.json({ ok: true });
    }
    case "draft": {
      await Brand.updateMany(
        { store: storeId, _id: { $in: list }, status: { $ne: "trashed" } },
        { $set: { status: "draft" } }
      );
      return res.json({ ok: true });
    }
    case "permanent": {
      const affected = await permanentDeleteMany(Brand, Product, storeId, list, "brand");
      return res.json({ ok: true, affected });
    }
    default:
      return res.status(400).json({ message: "Valid action lagbe (trash|restore|publish|draft|permanent)" });
  }
}

/* ------------------------------------------------------------------ *
 * DELETE /api/brands/:id           -> soft delete (trash)
 * PATCH  /api/brands/:id/restore   -> restore
 * DELETE /api/brands/:id/permanent -> permanent delete
 * ------------------------------------------------------------------ */
async function softDelete(req, res) {
  const storeId = storeIdOf(req);
  const exists = await Brand.exists({ store: storeId, _id: req.params.id });
  if (!exists) return res.status(404).json({ message: "Brand pawa jayni" });
  const affected = await softTrashMany(Brand, storeId, [req.params.id]);
  res.json({ ok: true, affected });
}

async function restore(req, res) {
  const storeId = storeIdOf(req);
  const exists = await Brand.exists({ store: storeId, _id: req.params.id });
  if (!exists) return res.status(404).json({ message: "Brand pawa jayni" });
  const affected = await restoreMany(Brand, storeId, [req.params.id]);
  res.json({ ok: true, affected });
}

async function permanentDelete(req, res) {
  const storeId = storeIdOf(req);
  const exists = await Brand.exists({ store: storeId, _id: req.params.id });
  if (!exists) return res.status(404).json({ message: "Brand pawa jayni" });
  const affected = await permanentDeleteMany(Brand, Product, storeId, [req.params.id], "brand");
  res.json({ ok: true, affected });
}

module.exports = { list, getOne, create, update, reorder, bulk, softDelete, restore, permanentDelete };
