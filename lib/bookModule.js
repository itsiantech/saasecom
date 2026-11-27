/* ------------------------------------------------------------------ *
 * Book / Ebook module — one place that answers "is the module live for
 * this store, and where does its genre tree live".
 *
 * The module is live only when ALL of these hold:
 *   plan      — the store's package has the `books` feature (lib/features)
 *   toggle    — the owner turned on "Book / Ebook module" in Settings
 *   theme     — the active theme declares which book surfaces it renders
 *
 * Genres are NOT a second taxonomy: they are ordinary categories that
 * happen to sit under the protected "Books" root, so a product's genre
 * list is literally its Product.categories list.
 * ------------------------------------------------------------------ */
const mongoose = require("mongoose");
const cache = require("./cache");
const Category = require("../models/Category");
const Product = require("../models/Product");
const ProductCategory = require("../models/ProductCategory");
const Settings = require("../models/Settings");
const Appearance = require("../models/Appearance");
const Store = require("../models/Store");
const { featuresForStore } = require("./features");
const { scopedKey } = require("./settingsScope");
const { slugify, uniqueSlug, getDescendantIds, recomputeSubtree } = require("./categoryHelpers");
const { findTheme, listThemes } = require("./themeCatalog");
const { parsePage, parseSort, pageMeta } = require("./paginate");

const MODULE_KEY = "books_module_enabled";
const BOOKS_SLUG = "books";
const ROOT_NAME = "Books";
const ROOT_NAME_BN = "বই";
const STATE_TTL = 30 * 1000;

// A bookstore that switches the module on should not start from an empty
// genre list. Every entry is created as a normal (deletable) sub-category.
const STARTER_GENRES = [
  { name: "Novels", nameBn: "উপন্যাস" },
  { name: "Short stories", nameBn: "গল্প" },
  { name: "Poetry", nameBn: "কবিতা" },
  { name: "Essays", nameBn: "প্রবন্ধ" },
  { name: "History", nameBn: "ইতিহাস" },
  { name: "Science", nameBn: "বিজ্ঞান" },
  { name: "Religion", nameBn: "ধর্ম" },
  { name: "Children", nameBn: "শিশু সাহিত্য" },
  { name: "Biography", nameBn: "আত্মজীবনী" },
  { name: "Mystery & thriller", nameBn: "রহস্য" },
];

// Name words that make an existing category a likely genre (migration proposal).
const GENRE_WORDS = [
  ["novel", "উপন্যাস", "uponyas", "fiction", "কল্পকাহিনি"],
  ["story", "stories", "গল্প", "golpo"],
  ["poem", "poetry", "কবিতা", "kobita"],
  ["essay", "প্রবন্ধ", "probondho"],
  ["history", "ইতিহাস", "itihash"],
  ["science", "বিজ্ঞান", "biggano"],
  ["religion", "spiritual", "ধর্ম", "আধ্যাত্মিক"],
  ["children", "kids", "শিশু", "ছড়া"],
  ["biography", "memoir", "জীবনী", "আত্মজীবনী"],
  ["thriller", "mystery", "crime", "রহস্য", "ভূত"],
  ["self help", "motivation", "স্ব-উন্নয়ন"],
  ["travel", "ভ্রমণ"],
  ["comics", "cartoon", "কমিক"],
  ["textbook", "education", "পাঠ্য", "পরীক্ষা"],
];

function stateKey(storeId) {
  return `books:state:${storeId}`;
}

/* ------------------------------------------------------------------ *
 * The three gates
 * ------------------------------------------------------------------ */

async function isToggleOn(storeId) {
  const scoped = scopedKey(storeId, MODULE_KEY);
  const docs = await Settings.find({ key: { $in: [MODULE_KEY, scoped] } }).lean();
  let value;
  docs.forEach((d) => {
    if (d.key === MODULE_KEY) value = d.value;
  });
  docs.forEach((d) => {
    if (d.key === scoped) value = d.value;
  });
  // A store that never heard of the module must not suddenly get book screens.
  return value === true || value === "true";
}

// Which book surfaces the store's live theme renders ("product", "pages").
async function themeSupport(storeId) {
  const doc = await Appearance.findOne({ store: storeId }).lean();
  const name = (doc && doc.published && doc.published.theme) || (listThemes()[0] || {}).name;
  const theme = findTheme(name) || findTheme("theme1");
  const levels = theme && theme.moduleSupport && theme.moduleSupport.books;
  return {
    theme: theme ? theme.name : "",
    levels: Array.isArray(levels) ? levels : [],
  };
}

async function bookState(storeId) {
  if (!storeId) return { on: false, plan: false, toggle: false, levels: [], supported: false, reason: "no_store" };
  const hit = cache.get(stateKey(storeId));
  if (hit) return hit;

  const [toggle, support] = await Promise.all([isToggleOn(storeId), themeSupport(storeId)]);
  const store = await Store.findById(storeId).select("plan featureOverrides").lean();
  const access = await featuresForStore(store);
  const plan = access.features.books === true;

  let reason = "on";
  if (!plan) reason = "plan";
  else if (!toggle) reason = "toggle";
  else if (!support.levels.length) reason = "theme";

  const state = {
    plan,
    toggle,
    levels: support.levels,
    theme: support.theme,
    on: plan && toggle,
    supported: support.levels.length > 0,
    active: plan && toggle && support.levels.length > 0,
    reason,
  };
  cache.set(stateKey(storeId), state, STATE_TTL);
  return state;
}

// Does the live theme render this book surface at all?
function hasLevel(state, level) {
  return Boolean(state && state.active && state.levels.includes(level));
}

function clearBookCache(storeId) {
  if (!storeId) return;
  cache.del(stateKey(storeId));
  cache.invalidatePrefix(`books:picker:${storeId}:`);
}

/* ------------------------------------------------------------------ *
 * The protected Books root + its genre subtree
 * ------------------------------------------------------------------ */

async function getBooksRoot(storeId) {
  const root = await Category.findOne({ store: storeId, systemType: "book", parent: null }).lean();
  if (root) return root;
  // A store that already had a hand-made "books" category adopts it as the root.
  const legacy = await Category.findOne({ store: storeId, slug: BOOKS_SLUG, parent: null, status: { $ne: "trashed" } }).lean();
  if (!legacy) return null;
  await Category.updateOne({ _id: legacy._id, store: storeId }, { $set: { systemType: "book" } });
  return { ...legacy, systemType: "book" };
}

// Idempotent: turning the module on twice, or from two requests at once, must
// still leave exactly one Books root.
async function ensureBooksRoot(storeId) {
  const existing = await getBooksRoot(storeId);
  if (existing) return { root: existing, created: false };

  const slug = await uniqueSlug(Category, BOOKS_SLUG, storeId, null, "book");
  try {
    const root = await Category.create({
      store: storeId,
      name: ROOT_NAME,
      nameBn: ROOT_NAME_BN,
      slug,
      parent: null,
      ancestors: [],
      level: 0,
      order: 1,
      status: "published",
      systemType: "book",
    });
    clearBookCache(storeId);
    return { root, created: true };
  } catch (err) {
    // lost a race with a parallel request — the winner's row is the root
    const winner = await getBooksRoot(storeId);
    if (winner) return { root: winner, created: false };
    throw err;
  }
}

async function nextGenreOrder(storeId, rootId) {
  const siblings = await Category.find({ store: storeId, parent: rootId, status: { $ne: "trashed" } })
    .select("order")
    .lean();
  if (!siblings.length) return 0;
  return Math.max(...siblings.map((s) => s.order || 0)) + 1;
}

// Starter genre pack — called from the Module Settings page, never silently.
async function addStarterGenres(storeId) {
  const { root } = await ensureBooksRoot(storeId);
  const existing = await Category.find({ store: storeId, parent: root._id }).select("name").lean();
  const have = new Set(existing.map((c) => String(c.name || "").trim().toLowerCase()));

  let order = await nextGenreOrder(storeId, root._id);
  const added = [];
  for (const genre of STARTER_GENRES) {
    if (have.has(genre.name.toLowerCase())) continue;
    const slug = await uniqueSlug(Category, slugify(genre.name), storeId, null, "genre");
    const doc = await Category.create({
      store: storeId,
      name: genre.name,
      nameBn: genre.nameBn,
      slug,
      parent: root._id,
      ancestors: [root._id],
      level: 1,
      order: order++,
      status: "draft",
      isDemo: true,
    });
    added.push({ _id: doc._id, name: doc.name, nameBn: doc.nameBn, slug: doc.slug });
  }
  clearBookCache(storeId);
  return { root: { _id: root._id, name: root.name, slug: root.slug }, added };
}

// The whole genre tree under the root (direct children + deeper ones).
async function genreIds(storeId, { includeTrashed = false } = {}) {
  const root = await getBooksRoot(storeId);
  if (!root) return [];
  const ids = await getDescendantIds(Category, storeId, [root._id]);
  const docs = await Category.find({ store: storeId, _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } })
    .select("_id status")
    .lean();
  return docs.filter((d) => includeTrashed || d.status !== "trashed").map((d) => String(d._id));
}

const GENRE_SORTS = { name: "name", slug: "slug", order: "order", created: "createdAt" };

// Paginated genre list for the Module Settings "Genres" shortcut page.
async function listGenres(storeId, query = {}) {
  const root = await getBooksRoot(storeId);
  if (!root) return { root: null, genres: [], meta: pageMeta({ page: 1, limit: 20, total: 0 }) };

  const { page, limit, skip } = parsePage(query, { defaultLimit: 20, maxLimit: 100 });
  const status = ["draft", "published", "trashed"].includes(query.status) ? query.status : null;
  const filter = { store: storeId, systemType: { $ne: "book" }, $or: [{ parent: root._id }, { ancestors: root._id }] };
  if (status) filter.status = status;
  else filter.status = { $ne: "trashed" };

  const search = String(query.search || "").trim();
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$and = [{ $or: [{ name: rx }, { nameBn: rx }, { slug: rx }] }];
  }

  const sorts = parseSort(query, GENRE_SORTS, { order: 1, name: 1 });
  const total = await Category.countDocuments(filter);
  const pageRows = total > page - 1 ? await Category.find(filter).sort(sorts).skip(skip).limit(limit).lean() : [];

  const counts = await productCountsByCategory(storeId, pageRows.map((row) => String(row._id)));
  const genres = pageRows.map((row) => ({
    _id: row._id,
    name: row.name || "",
    nameBn: row.nameBn || "",
    slug: row.slug || "",
    parent: row.parent ? String(row.parent) : null,
    level: row.level || 0,
    order: row.order || 0,
    status: row.status,
    isDemo: !!row.isDemo,
    books: counts[String(row._id)] || 0,
  }));

  return {
    root: { _id: root._id, name: root.name, nameBn: root.nameBn || "", slug: root.slug, status: root.status },
    genres,
    meta: pageMeta({ page, limit, total }),
  };
}

/* ------------------------------------------------------------------ *
 * Counts — a product can be linked through Product.categories (legacy,
 * what the storefront reads) or ProductCategory rows (what the form
 * writes), so both are unioned like the category page already does.
 * ------------------------------------------------------------------ */

async function productCountsByCategory(storeId, categoryIds) {
  const ids = categoryIds.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));
  const out = {};
  if (!ids.length) return out;

  const [legacy, joins] = await Promise.all([
    Product.aggregate([
      { $match: { store: new mongoose.Types.ObjectId(String(storeId)), categories: { $in: ids } } },
      { $unwind: "$categories" },
      { $match: { categories: { $in: ids } } },
      { $group: { _id: "$categories", n: { $addToSet: "$_id" } } },
    ]),
    ProductCategory.aggregate([
      { $match: { store: new mongoose.Types.ObjectId(String(storeId)), category: { $in: ids } } },
      { $group: { _id: "$category", n: { $addToSet: "$product" } } },
    ]),
  ]);
  const merged = new Map();
  const add = (id, list) => {
    const key = String(id);
    if (!merged.has(key)) merged.set(key, new Set());
    const set = merged.get(key);
    (list || []).forEach((p) => set.add(String(p)));
  };
  legacy.forEach((row) => add(row._id, row.n));
  joins.forEach((row) => add(row._id, row.n));
  merged.forEach((set, key) => {
    out[key] = set.size;
  });
  return out;
}

// `field` is a Product path holding an array/scalar ref: bookDetails.authors, bookDetails.publisher
async function productCountsByField(storeId, field, ids) {
  const clean = ids.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));
  const out = {};
  if (!clean.length) return out;
  const rows = await Product.aggregate([
    { $match: { store: new mongoose.Types.ObjectId(String(storeId)), [field]: { $in: clean } } },
    { $unwind: { path: `$${field}`, preserveNullAndEmptyArrays: false } },
    { $match: { [field]: { $in: clean } } },
    { $group: { _id: `$${field}`, n: { $addToSet: "$_id" } } },
  ]);
  rows.forEach((row) => {
    out[String(row._id)] = (row.n || []).length;
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * Protection for the system root (only while the module is on)
 * ------------------------------------------------------------------ */

async function assertNoRoot(storeId, ids, action) {
  const state = await bookState(storeId);
  if (!state.active) return;
  const root = await getBooksRoot(storeId);
  if (!root || !(ids || []).map(String).includes(String(root._id))) return;
  const err = new Error(
    action === "trash" || action === "permanent"
      ? `"${root.name}" সিস্টেম ক্যাটাগরি — মডিউল বন্ধ করে তবে ডিলিট করুন`
      : `"${root.name}" সিস্টেম ক্যাটাগরি — মডিউল চালু থাকা অবস্থায় সরানো বা স্লাগ বদলানো যায় না`
  );
  err.status = 400;
  err.code = "book_root_protected";
  throw err;
}

function assertRootEditable(storeId, categoryId, action) {
  return assertNoRoot(storeId, [categoryId], action);
}

/* ------------------------------------------------------------------ *
 * One-time genre migration proposal (never applied automatically)
 * ------------------------------------------------------------------ */

function looksLikeGenre(name) {
  const text = String(name || "").trim().toLowerCase();
  if (!text) return false;
  return GENRE_WORDS.some((group) => group.some((word) => text.includes(word)));
}

async function genreMigrationPlan(storeId) {
  const root = await getBooksRoot(storeId);
  const filter = { store: storeId, status: { $ne: "trashed" } };
  if (root) filter._id = { $ne: root._id };
  const rows = await Category.find(filter).select("name nameBn slug parent ancestors level status").lean();

  const underRoot = root ? new Set(await genreIds(storeId, { includeTrashed: true })) : new Set();
  const candidates = [];
  for (const row of rows) {
    if (root && underRoot.has(String(row._id))) continue;
    if (!looksLikeGenre(row.name) && !looksLikeGenre(row.nameBn)) continue;
    const children = await Category.countDocuments({ store: storeId, ancestors: row._id, status: { $ne: "trashed" } });
    const counts = await productCountsByCategory(storeId, [String(row._id)]);
    candidates.push({
      _id: row._id,
      name: row.name || "",
      nameBn: row.nameBn || "",
      slug: row.slug || "",
      // Moving a category keeps its own slug, so the storefront URL survives.
      newSlug: row.slug || "",
      urlChanges: false,
      products: counts[String(row._id)] || 0,
      children,
      status: row.status,
    });
  }
  return {
    root: root ? { _id: root._id, name: root.name, slug: root.slug } : null,
    candidates,
  };
}

async function applyGenreMigration(storeId, ids) {
  const root = await ensureBooksRoot(storeId);
  const list = (Array.isArray(ids) ? ids : []).filter((id) => mongoose.isValidObjectId(id) && String(id) !== String(root.root._id));
  const moved = [];
  for (const id of list) {
    const cat = await Category.findOne({ store: storeId, _id: id });
    if (!cat) continue;
    if (cat.systemType === "book") continue;
    const under = await genreIds(storeId, { includeTrashed: true });
    if (under.includes(String(cat._id))) continue;
    cat.parent = root.root._id;
    cat.ancestors = [root.root._id];
    cat.level = 1;
    await cat.save();
    await recomputeSubtree(Category, storeId, cat._id);
    moved.push({ _id: cat._id, name: cat.name, slug: cat.slug });
  }
  clearBookCache(storeId);
  return { moved, root: { _id: root.root._id, name: root.root.name } };
}

module.exports = {
  MODULE_KEY,
  BOOKS_SLUG,
  ROOT_NAME,
  ROOT_NAME_BN,
  STARTER_GENRES,
  bookState,
  hasLevel,
  isToggleOn,
  themeSupport,
  clearBookCache,
  getBooksRoot,
  ensureBooksRoot,
  addStarterGenres,
  genreIds,
  listGenres,
  productCountsByCategory,
  productCountsByField,
  assertRootEditable,
  assertNoRoot,
  genreMigrationPlan,
  applyGenreMigration,
  looksLikeGenre,
};
