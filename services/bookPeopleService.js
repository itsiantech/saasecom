/* ------------------------------------------------------------------ *
   Authors & publishers — the two people records behind the book module.
   Both are plain tenant documents (not plan-limited: they are metadata,
   not catalogue slots), so a store with 10 products can still list 200
   authors. One parameterised core serves both kinds; the HTTP layer
   lives in controllers/booksController.js.
   ------------------------------------------------------------------ */
const mongoose = require("mongoose");
const Author = require("../models/Author");
const Publisher = require("../models/Publisher");
const Product = require("../models/Product");
const cache = require("../lib/cache");
const { escapeRegex, slugify, uniqueSlug } = require("../lib/categoryHelpers");
const { parsePage, parseSort, pageMeta } = require("../lib/paginate");
const { productCountsByField } = require("../lib/bookModule");
const { writeAudit } = require("../lib/audit");

const KINDS = {
  author: {
    Model: Author,
    entity: "Author",
    refField: "bookDetails.authors",
    many: true,
    photoField: "photo",
  },
  publisher: {
    Model: Publisher,
    entity: "Publisher",
    refField: "bookDetails.publisher",
    many: false,
    photoField: "logo",
  },
};

const SORTS = { name: "name", created: "createdAt", updated: "updatedAt" };
const DEFAULT_STATUS = "published";

function kindConfig(kind) {
  const cfg = KINDS[String(kind || "").toLowerCase()];
  if (!cfg) {
    const err = new Error("Unknown book record kind");
    err.status = 400;
    throw err;
  }
  return cfg;
}

function text(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function yearValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

// Only a plain http(s) link may be stored — the storefront renders these as <a>.
function safeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.href.slice(0, 300);
  } catch {
    return "";
  }
}

function cleanLinks(list) {
  // a multipart body gives every field as a string, so the JSON array the form
  // sends arrives textified — accept both shapes.
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const url = safeUrl(row.url);
    if (!url) continue;
    out.push({ platform: text(row.platform, 30), url });
    if (out.length >= 8) break;
  }
  return out;
}

function assignShared(cfg, row, body) {
  if (body.name !== undefined) row.name = text(body.name, 160);
  if (body.nameBn !== undefined) row.nameBn = text(body.nameBn, 160);
  if (["draft", "published", "trashed"].includes(body.status)) {
    row.status = body.status;
    row.deletedAt = body.status === "trashed" ? new Date() : null;
  }
  const picture = body[cfg.photoField];
  if (typeof picture === "string" && picture.startsWith("/uploads/")) row[cfg.photoField] = picture.slice(0, 300);
}

function assignAuthor(row, body) {
  if (body.bio !== undefined) row.bio = text(body.bio, 4000);
  if (body.bioBn !== undefined) row.bioBn = text(body.bioBn, 4000);
  if (body.country !== undefined) row.country = text(body.country, 60);
  if (body.birthYear !== undefined) row.birthYear = yearValue(body.birthYear);
  if (body.deathYear !== undefined) row.deathYear = yearValue(body.deathYear);
  if (body.links !== undefined) row.links = cleanLinks(body.links);
}

function assignPublisher(row, body) {
  if (body.description !== undefined) row.description = text(body.description, 4000);
  if (body.descriptionBn !== undefined) row.descriptionBn = text(body.descriptionBn, 4000);
  if (body.address !== undefined) row.address = text(body.address, 300);
  if (body.phone !== undefined) row.phone = text(body.phone, 40);
  if (body.email !== undefined) row.email = text(body.email, 160).toLowerCase();
  if (body.website !== undefined) row.website = safeUrl(body.website);
}

async function slugFor(cfg, storeId, row, requestedSlug) {
  const base = slugify(requestedSlug || row.name || row.nameBn);
  row.slug = await uniqueSlug(cfg.Model, base || "item", storeId, row._id || null, cfg.entity.toLowerCase());
}

/* ------------------------------------------------------------------ *
 * List — search / status filter / sort / server-side pagination
 * ------------------------------------------------------------------ */

async function list(storeId, kind, query = {}) {
  const cfg = kindConfig(kind);
  const { page, limit, skip } = parsePage(query, { defaultLimit: 20, maxLimit: 100 });

  const filter = { store: storeId };
  filter.status = ["draft", "published", "trashed"].includes(query.status) ? query.status : { $ne: "trashed" };
  const search = String(query.search || "").trim();
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: rx }, { nameBn: rx }, { slug: rx }];
  }

  const total = await cfg.Model.countDocuments(filter);

  // Sorting by book count needs the counts first, so the (small) filtered set is
  // ordered in memory before the page is cut.
  const sortKey = String(query.sort || "").toLowerCase();
  let rows;
  if (sortKey.replace(/^-/, "") === "books") {
    const all = await cfg.Model.find(filter).sort({ name: 1 }).lean();
    const counts = await productCountsByField(storeId, cfg.refField, all.map((r) => String(r._id)));
    const dir = sortKey.startsWith("-") ? -1 : 1;
    all.sort((a, b) => ((counts[String(a._id)] || 0) - (counts[String(b._id)] || 0)) * dir);
    rows = all.slice(skip, skip + limit);
  } else {
    const sort = parseSort(query, SORTS, { name: 1 });
    rows = total > page - 1 ? await cfg.Model.find(filter).sort(sort).skip(skip).limit(limit).lean() : [];
  }

  const counts = await productCountsByField(storeId, cfg.refField, rows.map((r) => String(r._id)));
  const statusAgg = await cfg.Model.aggregate([
    { $match: { store: new mongoose.Types.ObjectId(String(storeId)) } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const statusCounts = { all: 0, draft: 0, published: 0, trashed: 0 };
  statusAgg.forEach((row) => {
    if (row._id) statusCounts[row._id] = row.count;
    statusCounts.all += row.count;
  });

  return {
    rows: rows.map((row) => ({ ...row, bookCount: counts[String(row._id)] || 0 })),
    meta: pageMeta({ page, limit, total }),
    counts: statusCounts,
  };
}

/* ------------------------------------------------------------------ *
 * Create / update
 * ------------------------------------------------------------------ */

async function create(storeId, kind, body = {}, file) {
  const cfg = kindConfig(kind);
  const name = text(body.name, 160);
  const nameBn = text(body.nameBn, 160);
  if (!name && !nameBn) {
    const err = new Error("নাম দিতে হবে");
    err.status = 400;
    throw err;
  }

  const row = new cfg.Model({ store: storeId, name: name || nameBn, nameBn, status: DEFAULT_STATUS });
  assignShared(cfg, row, body);
  if (cfg === KINDS.author) assignAuthor(row, body);
  else assignPublisher(row, body);
  if (file) row[cfg.photoField] = "/uploads/" + file.filename;
  await slugFor(cfg, storeId, row, body.slug);
  await row.save();
  cache.invalidatePrefix(`books:picker:${storeId}:`);
  return row;
}

async function update(storeId, kind, id, body = {}, file) {
  const cfg = kindConfig(kind);
  if (!mongoose.isValidObjectId(id)) {
    const err = new Error("Invalid id");
    err.status = 400;
    throw err;
  }
  const row = await cfg.Model.findOne({ _id: id, store: storeId });
  if (!row) {
    const err = new Error(`${cfg.entity} pawa jayni`);
    err.status = 404;
    throw err;
  }

  assignShared(cfg, row, body);
  if (cfg === KINDS.author) assignAuthor(row, body);
  else assignPublisher(row, body);
  if (file) row[cfg.photoField] = "/uploads/" + file.filename;
  else if (body.removeImage === "true" || body.removeImage === true) row[cfg.photoField] = "";
  if (body.slug !== undefined || !row.slug) await slugFor(cfg, storeId, row, body.slug);
  if (!row.name) row.name = row.nameBn;

  await row.save();
  cache.invalidatePrefix(`books:picker:${storeId}:`);
  return row;
}

/* ------------------------------------------------------------------ *
 * Detail — record + the books that reference it (paginated)
 * ------------------------------------------------------------------ */

async function detail(storeId, kind, id, query = {}) {
  const cfg = kindConfig(kind);
  if (!mongoose.isValidObjectId(id)) {
    const err = new Error("Invalid id");
    err.status = 400;
    throw err;
  }
  const row = await cfg.Model.findOne({ _id: id, store: storeId }).lean();
  if (!row) {
    const err = new Error(`${cfg.entity} pawa jayni`);
    err.status = 404;
    throw err;
  }

  const { page, limit, skip } = parsePage(query, { defaultLimit: 12, maxLimit: 50 });
  const objId = new mongoose.Types.ObjectId(String(id));
  const match = { store: storeId, [cfg.refField]: objId };
  const total = await Product.countDocuments(match);
  const books =
    total > page - 1
      ? await Product.find(match)
          .sort({ "bookDetails.publicationYear": -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .select("title name slug images regularPrice salePrice status bookDetails")
          .lean()
      : [];
  const counts = await productCountsByField(storeId, cfg.refField, [String(id)]);

  return {
    record: row,
    bookCount: counts[String(id)] || 0,
    books: books.map((p) => ({
      _id: p._id,
      title: p.title || p.name || "",
      slug: p.slug || "",
      image: (p.images || [])[0] || "",
      regularPrice: p.regularPrice || 0,
      salePrice: p.salePrice || 0,
      status: p.status,
      publicationYear: (p.bookDetails || {}).publicationYear || null,
      formats: (p.bookDetails || {}).formats || [],
    })),
    meta: pageMeta({ page, limit, total }),
  };
}

/* ------------------------------------------------------------------ *
 * Bulk actions — trash / restore / publish / draft / permanent
 * ------------------------------------------------------------------ */

async function bulk(storeId, kind, action, ids, userId) {
  const cfg = kindConfig(kind);
  const list = (Array.isArray(ids) ? ids : []).filter((id) => mongoose.isValidObjectId(id));
  if (!list.length) {
    const err = new Error("Kono valid id nei");
    err.status = 400;
    throw err;
  }
  const objIds = list.map((id) => new mongoose.Types.ObjectId(String(id)));
  const find = { store: storeId, _id: { $in: objIds } };

  if (action === "trash") {
    const rows = await cfg.Model.find({ ...find, status: { $ne: "trashed" } }).select("_id status").lean();
    await cfg.Model.bulkWrite(
      rows.map((r) => ({
        updateOne: {
          filter: { _id: r._id, store: storeId },
          update: { $set: { status: "trashed", deletedAt: new Date(), previousStatus: r.status } },
        },
      }))
    );
  } else if (action === "restore") {
    const rows = await cfg.Model.find({ ...find, status: "trashed" }).select("_id previousStatus").lean();
    await cfg.Model.bulkWrite(
      rows.map((r) => ({
        updateOne: {
          filter: { _id: r._id, store: storeId },
          update: { $set: { status: r.previousStatus || "draft", previousStatus: null, deletedAt: null } },
        },
      }))
    );
  } else if (action === "publish" || action === "draft") {
    await cfg.Model.updateMany(
      { ...find, status: { $ne: "trashed" } },
      { $set: { status: action === "publish" ? "published" : "draft" } }
    );
  } else if (action === "permanent") {
    await detachProducts(storeId, cfg, objIds);
    await cfg.Model.deleteMany(find);
    await writeAudit({
      store: storeId,
      user: userId,
      action: `books.${cfg.entity.toLowerCase()}_delete`,
      entity: cfg.entity,
      entityId: list.join(","),
      newValue: { permanent: true, count: list.length },
    });
  } else {
    const err = new Error("Valid action lagbe (trash|restore|publish|draft|permanent)");
    err.status = 400;
    throw err;
  }

  cache.invalidatePrefix(`books:picker:${storeId}:`);
  return { ok: true, affected: list.length };
}

// Books must never keep a dangling reference to a removed record.
async function detachProducts(storeId, cfg, objIds) {
  const match = { store: storeId, [cfg.refField]: { $in: objIds } };
  if (cfg.many) await Product.updateMany(match, { $pull: { [cfg.refField]: { $in: objIds } } });
  else await Product.updateMany(match, { $set: { [cfg.refField]: null } });
}

/* ------------------------------------------------------------------ *
 * Merge duplicates — move every book from the source into the target
 * ------------------------------------------------------------------ */

async function merge(storeId, kind, sourceId, targetId, userId) {
  const cfg = kindConfig(kind);
  if (![sourceId, targetId].every((id) => mongoose.isValidObjectId(id))) {
    const err = new Error("Invalid id");
    err.status = 400;
    throw err;
  }
  if (String(sourceId) === String(targetId)) {
    const err = new Error("Ek-i record ke merge kora jabe na");
    err.status = 400;
    throw err;
  }
  const sourceObj = new mongoose.Types.ObjectId(String(sourceId));
  const targetObj = new mongoose.Types.ObjectId(String(targetId));
  const source = await cfg.Model.findOne({ _id: sourceObj, store: storeId });
  const target = await cfg.Model.findOne({ _id: targetObj, store: storeId });
  if (!source || !target) {
    const err = new Error(`${cfg.entity} pawa jayni`);
    err.status = 404;
    throw err;
  }

  let moved = 0;
  if (cfg.many) {
    // Replace in place so the author order on each book survives the merge.
    const rows = await Product.find({ store: storeId, [cfg.refField]: sourceObj }).select("bookDetails");
    const ops = rows.map((row) => {
      const seen = new Set();
      const authors = [];
      for (const id of (row.bookDetails && row.bookDetails.authors) || []) {
        const key = String(id) === String(sourceObj) ? String(targetObj) : String(id);
        if (seen.has(key)) continue;
        seen.add(key);
        authors.push(key);
      }
      return { updateOne: { filter: { _id: row._id, store: storeId }, update: { $set: { "bookDetails.authors": authors } } } };
    });
    if (ops.length) await Product.bulkWrite(ops);
    moved = ops.length;
  } else {
    const result = await Product.updateMany(
      { store: storeId, [cfg.refField]: sourceObj },
      { $set: { [cfg.refField]: targetObj } }
    );
    moved = result.modifiedCount || 0;
  }

  const was = source.status === "trashed" ? null : source.status;
  source.status = "trashed";
  source.previousStatus = was;
  source.deletedAt = new Date();
  await source.save();

  await writeAudit({
    store: storeId,
    user: userId,
    action: `books.${cfg.entity.toLowerCase()}_merge`,
    entity: cfg.entity,
    entityId: target._id,
    oldValue: { merged: String(source._id), name: source.name },
    newValue: { into: String(target._id), moved },
  });
  cache.invalidatePrefix(`books:picker:${storeId}:`);
  return { ok: true, moved, into: { _id: target._id, name: target.name, slug: target.slug } };
}

/* ------------------------------------------------------------------ *
 * Picker options for the product form (search + pagination, cached)
 * ------------------------------------------------------------------ */

async function options(storeId, kind, query = {}) {
  const cfg = kindConfig(kind);
  const { page, limit, skip } = parsePage(query, { defaultLimit: 30, maxLimit: 50 });
  const search = String(query.search || "").trim();
  const key = `books:picker:${storeId}:${cfg.entity}:${search.toLowerCase()}:${page}:${limit}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const filter = { store: storeId, status: "published" };
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ name: rx }, { nameBn: rx }];
  }
  const total = await cfg.Model.countDocuments(filter);
  const rows = total > page - 1 ? await cfg.Model.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean() : [];
  const counts = await productCountsByField(storeId, cfg.refField, rows.map((r) => String(r._id)));
  const result = {
    options: rows.map((row) => ({
      _id: row._id,
      name: row.name || row.nameBn || "",
      nameBn: row.nameBn || "",
      slug: row.slug || "",
      bookCount: counts[String(row._id)] || 0,
    })),
    meta: pageMeta({ page, limit, total }),
  };
  cache.set(key, result, 30 * 1000);
  return result;
}

module.exports = { list, create, update, detail, bulk, merge, options, KINDS, safeUrl, cleanLinks };
