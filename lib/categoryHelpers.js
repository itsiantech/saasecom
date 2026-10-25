const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const { UPLOAD_DIR } = require("../middleware/upload");

/* ------------------------------------------------------------------ *
 * Small utilities
 * ------------------------------------------------------------------ */

function escapeRegex(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Turn arbitrary text (Bengali / English / numbers) into a URL-safe slug.
// Keeps unicode letters & numbers so Bengali names do not become empty slugs.
function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Make a slug unique inside one store. If the base is empty we fall back to a random id.
async function uniqueSlug(Category, base, storeId, excludeId, prefix = "cat") {
  let candidate = String(base || "").trim();
  if (!candidate) candidate = prefix + "-" + Math.random().toString(36).slice(2, 8);

  let slug = candidate;
  let i = 2;
  const filter = { store: storeId, slug };
  if (excludeId) filter._id = { $ne: excludeId };

  // NOTE: Category.exists() is not covered by tenantPlugin's pre-hooks, so the
  // store filter is passed explicitly here.
  while (await Category.exists(filter)) {
    if (i > 100) {
      slug = candidate + "-" + Math.random().toString(36).slice(2, 8);
      break;
    }
    slug = candidate + "-" + i;
    filter.slug = slug;
    i++;
  }
  return slug;
}

// Build a nested tree from a flat list of (lean) category documents.
function buildTree(categories) {
  const nodes = new Map();
  categories.forEach((c) => nodes.set(c._id.toString(), { ...c, children: [] }));

  const roots = [];
  nodes.forEach((node) => {
    const parentId = node.parent ? node.parent.toString() : null;
    if (parentId && nodes.has(parentId)) nodes.get(parentId).children.push(node);
    else roots.push(node);
  });

  const sortRec = (list) => {
    list.sort(
      (a, b) =>
        (a.order || 0) - (b.order || 0) ||
        String(a.name || "").localeCompare(String(b.name || ""))
    );
    list.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/* ------------------------------------------------------------------ *
 * Tree traversal / integrity
 * ------------------------------------------------------------------ */

// Return every descendant id (BFS by parent) plus the seed ids themselves.
async function getDescendantIds(Category, storeId, seedIds) {
  const result = new Set(seedIds.map(String));
  let frontier = seedIds.map((id) => new mongoose.Types.ObjectId(id));

  while (frontier.length) {
    const children = await Category.find({ store: storeId, parent: { $in: frontier } })
      .select("_id")
      .lean();
    const next = [];
    for (const child of children) {
      const s = child._id.toString();
      if (!result.has(s)) {
        result.add(s);
        next.push(child._id);
      }
    }
    frontier = next;
  }
  return [...result];
}

// Recompute `ancestors` and `level` for a root and its whole subtree after a move.
// Reads the root from DB (so the caller must persist the root first), then BFS-walks
// children grouped by parent and bulk-writes the corrected values.
async function recomputeSubtree(Category, storeId, rootId) {
  const root = await Category.findOne({ _id: rootId, store: storeId }).lean();
  if (!root) return;

  const descendants = await Category.find({ store: storeId, ancestors: rootId })
    .select("_id parent")
    .lean();

  const byParent = new Map();
  for (const d of descendants) {
    const p = d.parent ? d.parent.toString() : null;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(d);
  }

  const ops = [];
  const rootAncestors = (root.ancestors || []).map((a) => new mongoose.Types.ObjectId(a));
  const queue = [{ id: root._id.toString(), ancestors: rootAncestors, level: rootAncestors.length }];

  while (queue.length) {
    const cur = queue.shift();
    ops.push({
      updateOne: {
        filter: { _id: cur.id, store: storeId },
        update: { $set: { ancestors: cur.ancestors, level: cur.level } },
      },
    });
    const children = byParent.get(cur.id) || [];
    for (const child of children) {
      queue.push({
        id: child._id.toString(),
        ancestors: [...cur.ancestors, new mongoose.Types.ObjectId(cur.id)],
        level: cur.level + 1,
      });
    }
  }

  if (ops.length) await Category.bulkWrite(ops);
}

/* ------------------------------------------------------------------ *
 * Trash / restore / permanent delete
 * ------------------------------------------------------------------ */

// Build the update ops that flip a set of documents to a restored state.
// We read the docs first (instead of using an aggregation-pipeline update) because
// Mongoose 9 requires the `updatePipeline` option for pipeline updates, and a
// plain bulkWrite is explicit and easy to reason about.
function restoreOps(docs, storeId) {
  return docs.map((d) => ({
    updateOne: {
      filter: { _id: d._id, store: storeId },
      update: {
        $set: {
          status: d.previousStatus || "draft",
          previousStatus: null,
          deletedAt: null,
        },
      },
    },
  }));
}

// Soft-delete a set of ids AND all their descendants. Remembers previous status.
async function softTrashMany(Category, storeId, ids) {
  const allIds = await getDescendantIds(Category, storeId, ids);
  const idObjs = allIds.map((id) => new mongoose.Types.ObjectId(id));

  const docs = await Category.find({
    store: storeId,
    _id: { $in: idObjs },
    status: { $ne: "trashed" },
  })
    .select("_id status")
    .lean();

  if (docs.length) {
    const now = new Date();
    const ops = docs.map((d) => ({
      updateOne: {
        filter: { _id: d._id, store: storeId },
        update: { $set: { status: "trashed", deletedAt: now, previousStatus: d.status } },
      },
    }));
    await Category.bulkWrite(ops);
  }
  return allIds.length;
}

// Restore a set of ids AND their trashed descendants (and the trashed ancestor
// chain so the restored node stays reachable in the tree).
async function restoreMany(Category, storeId, ids) {
  const allIds = await getDescendantIds(Category, storeId, ids);
  const idObjs = allIds.map((id) => new mongoose.Types.ObjectId(id));

  const docs = await Category.find({
    store: storeId,
    _id: { $in: idObjs },
    status: "trashed",
  })
    .select("_id previousStatus")
    .lean();
  const ops = restoreOps(docs, storeId);
  if (ops.length) await Category.bulkWrite(ops);

  // Bring back trashed ancestors too.
  const withAncestors = await Category.find({ store: storeId, _id: { $in: idObjs } })
    .select("ancestors")
    .lean();
  const ancestorIds = new Set();
  withAncestors.forEach((d) => (d.ancestors || []).forEach((a) => ancestorIds.add(a.toString())));

  if (ancestorIds.size) {
    const ancDocs = await Category.find({
      store: storeId,
      _id: { $in: [...ancestorIds] },
      status: "trashed",
    })
      .select("_id previousStatus")
      .lean();
    const ancOps = restoreOps(ancDocs, storeId);
    if (ancOps.length) await Category.bulkWrite(ancOps);
  }
  return allIds.length;
}

// Delete permanently: removes docs, their image files, and product references.
// `productField` is the Product field that references these docs ("category" or "brand").
async function permanentDeleteMany(Category, Product, storeId, ids, productField = "category") {
  const allIds = await getDescendantIds(Category, storeId, ids);
  const idObjs = allIds.map((id) => new mongoose.Types.ObjectId(id));

  const docs = await Category.find({ store: storeId, _id: { $in: idObjs } })
    .select("image")
    .lean();
  docs.forEach((d) => removeImageFile(d.image));

  await Category.deleteMany({ store: storeId, _id: { $in: idObjs } });
  // Detach products from the removed docs (keep the products themselves).
  await Product.updateMany(
    { store: storeId, [productField]: { $in: idObjs } },
    { $unset: { [productField]: "" } }
  );
  return allIds.length;
}

// Delete an uploaded image from disk. Only touches files inside our upload folder.
function removeImageFile(imagePath) {
  if (!imagePath || !String(imagePath).startsWith("/uploads/")) return;
  const filePath = path.join(UPLOAD_DIR, path.basename(imagePath));
  fs.unlink(filePath, () => {});
}

module.exports = {
  escapeRegex,
  slugify,
  uniqueSlug,
  buildTree,
  getDescendantIds,
  recomputeSubtree,
  softTrashMany,
  restoreMany,
  permanentDeleteMany,
  removeImageFile,
};
