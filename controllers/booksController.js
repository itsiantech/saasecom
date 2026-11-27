/* ------------------------------------------------------------------ *
   /api/books — the admin side of the Book / Ebook module.
   * state            — is the module live, and does the theme render it
   * genres           — paginated shortcut over the Books category subtree
   * starter genres / migration — opt-in helpers, never run automatically
   * authors, publishers — searchable, server-paginated people records
   ------------------------------------------------------------------ */
const mongoose = require("mongoose");
const { getStoreId } = require("../lib/tenantContext");
const people = require("../services/bookPeopleService");
const {
  bookState,
  listGenres,
  addStarterGenres,
  genreMigrationPlan,
  applyGenreMigration,
  ensureBooksRoot,
} = require("../lib/bookModule");

function storeIdOf(req) {
  if (req.store && req.store._id) return req.store._id;
  return getStoreId();
}

function wrap(fn) {
  return async function wrapped(req, res, next) {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

function needStore(req, res) {
  const storeId = storeIdOf(req);
  if (!storeId) res.status(400).json({ message: "Store pawa jayni" });
  return storeId;
}

function needId(req, res) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: "Invalid id" });
    return null;
  }
  return id;
}

/* ------------------------------------------------------------------ *
 * Module state + genre tree
 * ------------------------------------------------------------------ */

const state = wrap(async (req, res) => {
  const storeId = needStore(req, res);
  if (!storeId) return;
  res.json({ books: await bookState(storeId) });
});

const genres = wrap(async (req, res) => {
  const storeId = needStore(req, res);
  if (!storeId) return;
  const out = await listGenres(storeId, req.query);
  res.json(out);
});

const starterGenres = wrap(async (req, res) => {
  const storeId = needStore(req, res);
  if (!storeId) return;
  res.json(await addStarterGenres(storeId));
});

const migrationPlan = wrap(async (req, res) => {
  const storeId = needStore(req, res);
  if (!storeId) return;
  res.json(await genreMigrationPlan(storeId));
});

const migrationApply = wrap(async (req, res) => {
  const storeId = needStore(req, res);
  if (!storeId) return;
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ message: "Kono category id nei" });
  res.json(await applyGenreMigration(storeId, ids));
});

const booksRoot = wrap(async (req, res) => {
  const storeId = needStore(req, res);
  if (!storeId) return;
  const out = await ensureBooksRoot(storeId);
  res.json({ ok: true, root: { _id: out.root._id, name: out.root.name, slug: out.root.slug }, created: out.created });
});

/* ------------------------------------------------------------------ *
 * Authors / publishers
 * ------------------------------------------------------------------ */

const LIST_KEY = { author: "authors", publisher: "publishers" };
const OPTION_KEY = { author: "authorOptions", publisher: "publisherOptions" };

function listHandler(kind) {
  return wrap(async (req, res) => {
    const storeId = needStore(req, res);
    if (!storeId) return;
    const out = await people.list(storeId, kind, req.query);
    res.json({ [LIST_KEY[kind]]: out.rows, meta: out.meta, counts: out.counts });
  });
}

function createHandler(kind) {
  return wrap(async (req, res) => {
    const storeId = needStore(req, res);
    if (!storeId) return;
    const row = await people.create(storeId, kind, req.body || {}, req.file);
    res.status(201).json({ [kind]: row });
  });
}

function detailHandler(kind) {
  return wrap(async (req, res) => {
    const storeId = needStore(req, res);
    const id = needId(req, res);
    if (!storeId || !id) return;
    const out = await people.detail(storeId, kind, id, req.query);
    res.json({ [kind]: out.record, bookCount: out.bookCount, books: out.books, meta: out.meta });
  });
}

function updateHandler(kind) {
  return wrap(async (req, res) => {
    const storeId = needStore(req, res);
    const id = needId(req, res);
    if (!storeId || !id) return;
    const row = await people.update(storeId, kind, id, req.body || {}, req.file);
    res.json({ [kind]: row });
  });
}

function bulkHandler(kind) {
  return wrap(async (req, res) => {
    const storeId = needStore(req, res);
    if (!storeId) return;
    const body = req.body || {};
    res.json(await people.bulk(storeId, kind, body.action, body.ids, req.user && req.user.id));
  });
}

function mergeHandler(kind) {
  return wrap(async (req, res) => {
    const storeId = needStore(req, res);
    const id = needId(req, res);
    if (!storeId || !id) return;
    const into = (req.body || {}).into;
    if (!mongoose.isValidObjectId(into)) return res.status(400).json({ message: "Merge target id lagbe" });
    res.json(await people.merge(storeId, kind, id, into, req.user && req.user.id));
  });
}

function optionsHandler(kind) {
  return wrap(async (req, res) => {
    const storeId = needStore(req, res);
    if (!storeId) return;
    const out = await people.options(storeId, kind, req.query);
    res.json({ [OPTION_KEY[kind]]: out.options, meta: out.meta });
  });
}

module.exports = {
  state,
  genres,
  starterGenres,
  migrationPlan,
  migrationApply,
  booksRoot,
  listAuthors: listHandler("author"),
  createAuthor: createHandler("author"),
  detailAuthor: detailHandler("author"),
  updateAuthor: updateHandler("author"),
  bulkAuthors: bulkHandler("author"),
  mergeAuthor: mergeHandler("author"),
  authorOptions: optionsHandler("author"),
  listPublishers: listHandler("publisher"),
  createPublisher: createHandler("publisher"),
  detailPublisher: detailHandler("publisher"),
  updatePublisher: updateHandler("publisher"),
  bulkPublishers: bulkHandler("publisher"),
  mergePublisher: mergeHandler("publisher"),
  publisherOptions: optionsHandler("publisher"),
};
