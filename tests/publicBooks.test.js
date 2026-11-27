process.env.JWT_SECRET = process.env.JWT_SECRET || "public-books-secret";
// Same fixture folder the admin suite uses: bookshop declares book surfaces,
// plainsort does not, zarraybooks keeps modules a list + explicit support map.
process.env.THEMES_DIR = require("path").join(__dirname, "fixtures", "themes-books");

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const Plan = require("../models/Plan");
const Store = require("../models/Store");
const User = require("../models/User");
const Product = require("../models/Product");
const ProductCategory = require("../models/ProductCategory");
const Category = require("../models/Category");
const Author = require("../models/Author");
const Publisher = require("../models/Publisher");
const Settings = require("../models/Settings");
const Appearance = require("../models/Appearance");

const { scopedKey } = require("../lib/settingsScope");
const { clearBookCache, bookState } = require("../lib/bookModule");
const { findTheme } = require("../lib/themeCatalog");

const MODELS = [Plan, Store, User, Product, ProductCategory, Category, Author, Publisher, Settings, Appearance];

const state = {};

function get(path, slug = "public-books-a") {
  return request(state.app).get(path).set("x-store-slug", slug);
}

async function makeStore(slug, plan, theme) {
  const owner = await User.create({ name: "Owner " + slug, email: slug + "@e.com", role: "admin" });
  const store = await Store.create({ name: "Shop " + slug, slug, owner: owner._id, plan: plan._id });
  await Appearance.updateOne({ store: store._id }, { $set: { "published.theme": theme } }, { upsert: true });
  return store;
}

async function toggle(store, on) {
  const key = scopedKey(store._id, "books_module_enabled");
  await Settings.updateOne({ key }, { $set: { key, value: on ? "true" : "false" } }, { upsert: true });
  clearBookCache(store._id);
}

before(async () => {
  state.mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
  await mongoose.connect(state.mongo.getUri("public_books"));
  await Promise.all(MODELS.map((model) => model.init()));

  const planBooks = await Plan.create({
    name: "Publisher", slug: "pb-publisher", price: 0,
    limits: { products: 0, orders: 0 },
    features: { products: true, categories: true, books: true },
  });
  const planLocked = await Plan.create({
    name: "Starter", slug: "pb-starter", price: 0,
    limits: { products: 0, orders: 0 },
    features: { products: true, categories: true, books: false },
  });

  state.a = await makeStore("public-books-a", planBooks, "bookshop");
  state.b = await makeStore("public-books-b", planBooks, "bookshop");
  state.locked = await makeStore("public-books-locked", planLocked, "bookshop");
  state.arr = await makeStore("public-books-arr", planBooks, "zarraybooks");

  await toggle(state.a, true);
  await toggle(state.b, false);
  await toggle(state.locked, true);
  await toggle(state.arr, true);

  // Books root + two genres (one draft) in store A
  const root = await Category.create({ store: state.a._id, name: "Books", nameBn: "বই", slug: "books", parent: null, level: 0, status: "published", systemType: "book" });
  state.novels = await Category.create({ store: state.a._id, name: "Novels", slug: "novels", parent: root._id, ancestors: [root._id], level: 1, status: "published" });
  state.draftGenre = await Category.create({ store: state.a._id, name: "Draft genre", slug: "draft-genre", parent: root._id, ancestors: [root._id], level: 1, status: "draft" });

  state.humayun = await Author.create({
    store: state.a._id, name: "Humayun Ahmed", slug: "humayun-ahmed", status: "published",
    bio: "Bangla novelist", country: "BD", birthYear: 1948, deathYear: 2012,
    links: [{ platform: "website", url: "https://example.com/humayun" }, { platform: "bad", url: "" }],
  });
  state.draftAuthor = await Author.create({ store: state.a._id, name: "Draft Author", slug: "draft-author", status: "draft" });
  state.anisul = await Author.create({ store: state.a._id, name: "Anisul Hoque", slug: "anisul-hoque", status: "published" });
  state.prothoma = await Publisher.create({ store: state.a._id, name: "Prothoma", slug: "prothoma", status: "published", website: "https://prothoma.com" });

  const base = { regularPrice: 300, price: 300, stock: 10 };
  const [misir, hi, ebookOnly, draftBook, plain, theirs] = await Product.insertMany([
    { store: state.a._id, title: "Misir Ali", name: "Misir Ali", slug: "misir-ali", status: "published", ...base, categories: [state.novels._id], bookDetails: { authors: [state.humayun._id], publisher: state.prothoma._id, isbn: "9789840000001", publicationYear: 1985, formats: ["print", "ebook"], pages: 210 } },
    { store: state.a._id, title: "Hi", name: "Hi", slug: "hi", status: "published", ...base, bookDetails: { authors: [state.humayun._id, state.draftAuthor._id], publicationYear: 1990, formats: ["print"] } },
    { store: state.a._id, title: "Ebook only", name: "Ebook only", slug: "ebook-only", status: "published", ...base, bookDetails: { authors: [state.anisul._id], publicationYear: 2020, formats: ["ebook"] } },
    { store: state.a._id, title: "Draft book", name: "Draft book", slug: "draft-book", status: "draft", ...base, bookDetails: { authors: [state.humayun._id], formats: ["print"] } },
    { store: state.a._id, title: "Plain mug", name: "Plain mug", slug: "plain-mug", status: "published", ...base },
    { store: state.b._id, title: "Their ebook", name: "Their ebook", slug: "their-ebook", status: "published", ...base, bookDetails: { formats: ["ebook"] } },
  ]);
  state.misir = misir;
  state.theirs = theirs;
  await ProductCategory.create({ store: state.a._id, product: misir._id, category: state.novels._id });

  state.foreignAuthor = await Author.create({ store: state.b._id, name: "Foreign Author", slug: "foreign-author", status: "published" });

  // ISBN index needs the row; the plain product and draft row must not collide.
  await Product.init();

  state.app = express();
  state.app.use(express.json());
  state.app.use("/api/public", require("../routes/publicApi"));
  state.app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ message: err.message || "Server error", code: err.code });
  });
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

function slugs(body) {
  return (body.products || []).map((row) => row.slug).sort();
}

/* ------------------------------------------------------------------ *
 * Authors / publishers
 * ------------------------------------------------------------------ */

test("authors list shows published people of this store only, with book counts", async () => {
  const res = await get("/api/public/authors");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.authors.map((row) => row.slug), ["anisul-hoque", "humayun-ahmed"]);
  const bySlug = new Map(res.body.authors.map((row) => [row.slug, row]));
  assert.equal(bySlug.get("humayun-ahmed").bookCount, 2, "draft book is not counted");
  assert.equal(bySlug.get("anisul-hoque").bookCount, 1);
  assert.equal(bySlug.get("humayun-ahmed").country, "BD");
  assert.equal(res.body.meta.total, 2);

  const searched = await get("/api/public/authors?q=humayun");
  assert.equal(searched.status, 200, JSON.stringify(searched.body));
  assert.deepEqual(searched.body.authors.map((row) => row.slug), ["humayun-ahmed"]);

  const paged = await get("/api/public/authors?limit=1&page=2");
  assert.deepEqual(paged.body.authors.map((row) => row.slug), ["humayun-ahmed"]);
  assert.equal(paged.body.meta.pages, 2);
});

test("author detail returns profile + published books, unknown and foreign slugs 404", async () => {
  const res = await get("/api/public/authors/humayun-ahmed");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.author.name, "Humayun Ahmed");
  assert.equal(res.body.author.bio, "Bangla novelist");
  assert.deepEqual(res.body.author.links.map((row) => row.platform), ["website"]);
  assert.deepEqual(res.body.books.map((row) => row.slug).sort(), ["hi", "misir-ali"]);
  assert.equal(res.body.pagination.total, 2);

  assert.equal((await get("/api/public/authors/draft-author")).status, 404);
  assert.equal((await get("/api/public/authors/nobody")).status, 404);
  // the foreign author exists, but only in store B
  assert.equal((await get("/api/public/authors/foreign-author")).status, 404);
});

test("publishers list and detail, with their books", async () => {
  const list = await get("/api/public/publishers");
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.deepEqual(list.body.publishers.map((row) => row.slug), ["prothoma"]);
  assert.equal(list.body.publishers[0].bookCount, 1);
  assert.equal(list.body.publishers[0].name, "Prothoma");
  assert.equal(list.body.publishers[0].logo, "");

  const detail = await get("/api/public/publishers/prothoma");
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.publisher.website, "https://prothoma.com");
  assert.deepEqual(detail.body.books.map((row) => row.slug), ["misir-ali"]);
  assert.equal((await get("/api/public/publishers/nobody")).status, 404);
});

test("book endpoints 404 while the module is off or the plan lacks it", async () => {
  for (const path of ["/api/public/authors", "/api/public/authors/humayun-ahmed", "/api/public/publishers", "/api/public/genres"]) {
    const off = await get(path, "public-books-b");
    assert.equal(off.status, 404, path);
    const locked = await get(path, "public-books-locked");
    assert.equal(locked.status, 404, path);
  }
});

/* ------------------------------------------------------------------ *
 * Book filters on the product list
 * ------------------------------------------------------------------ */

test("author / publisher / format filters narrow the product list", async () => {
  const byAuthor = await get("/api/public/products?author=humayun-ahmed");
  assert.equal(byAuthor.status, 200, JSON.stringify(byAuthor.body));
  assert.deepEqual(slugs(byAuthor.body), ["hi", "misir-ali"]);
  assert.equal(byAuthor.body.filters.author.length, 1);

  const bothAuthors = await get("/api/public/products?author=humayun-ahmed,anisul-hoque");
  assert.deepEqual(slugs(bothAuthors.body), ["ebook-only", "hi", "misir-ali"]);

  const byPublisher = await get("/api/public/products?publisher=prothoma");
  assert.deepEqual(slugs(byPublisher.body), ["misir-ali"]);

  const ebook = await get("/api/public/products?format=ebook");
  assert.deepEqual(slugs(ebook.body), ["ebook-only", "misir-ali"]);

  const print = await get("/api/public/products?format=print");
  assert.deepEqual(slugs(print.body), ["hi", "misir-ali"], "draft book stays hidden");

  const combined = await get("/api/public/products?author=humayun-ahmed&format=ebook");
  assert.deepEqual(slugs(combined.body), ["misir-ali"]);
});

test("unknown book filter values match nothing — never the whole catalog", async () => {
  assert.deepEqual(slugs((await get("/api/public/products?author=nobody")).body), []);
  assert.deepEqual(slugs((await get("/api/public/products?publisher=nobody")).body), []);
  assert.deepEqual(slugs((await get("/api/public/products?format=vinyl")).body), []);
  // a foreign author slug must not resolve against store A's catalog
  assert.deepEqual(slugs((await get("/api/public/products?author=foreign-author")).body), []);
  // module off: even real book data in that store is not filterable
  assert.deepEqual(slugs((await get("/api/public/products?format=ebook", "public-books-b")).body), []);
});

/* ------------------------------------------------------------------ *
 * Product page book block
 * ------------------------------------------------------------------ */

test("product detail carries the book block with allow-listed people", async () => {
  const res = await get("/api/public/products/misir-ali");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.book, "book block present");
  assert.deepEqual(res.body.book.authors.map((row) => row.slug), ["humayun-ahmed"]);
  assert.equal(res.body.book.publisher.slug, "prothoma");
  assert.equal(res.body.book.isbn, "9789840000001");
  assert.equal(res.body.book.publicationYear, 1985);
  assert.equal(res.body.book.pages, 210);
  assert.deepEqual(res.body.book.formats, ["print", "ebook"]);

  // draft authors never reach the storefront
  const hi = await get("/api/public/products/hi");
  assert.deepEqual(hi.body.book.authors.map((row) => row.slug), ["humayun-ahmed"]);

  // no book data, and a module that is off, both produce null
  const plain = await get("/api/public/products/plain-mug");
  assert.equal(plain.body.book, null);
  const off = await get("/api/public/products/their-ebook", "public-books-b");
  assert.equal(off.status, 200);
  assert.equal(off.body.book, null);
});

test("the product page offers more books by the same author", async () => {
  const res = await get("/api/public/products/misir-ali");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const slugs = res.body.authorBooks.map((row) => row.slug).sort();
  assert.deepEqual(slugs, ["hi"], "other published books of the author, never the current one");
  const hi = res.body.authorBooks[0];
  assert.equal(hi.authors[0].slug, "humayun-ahmed");
  assert.deepEqual(hi.formats, ["print"]);

  // module off → no rail
  const off = await get("/api/public/products/their-ebook", "public-books-b");
  assert.deepEqual(off.body.authorBooks, []);
});

test("listing cards carry the author line and format for cover shelves", async () => {
  const res = await get("/api/public/products?limit=50");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const misir = res.body.products.find((row) => row.slug === "misir-ali");
  assert.equal(misir.authors[0].slug, "humayun-ahmed");
  assert.deepEqual(misir.authors.map((row) => row.slug), ["humayun-ahmed"], "draft author is dropped");
  assert.deepEqual(misir.formats, ["print", "ebook"]);

  // plain products stay untouched by the book pass
  const plain = res.body.products.find((row) => row.slug === "plain-mug");
  assert.equal(plain.authors, undefined);
  assert.equal(plain.formats, undefined);

  // module off → cards keep their old shape
  const off = await get("/api/public/products?limit=50", "public-books-b");
  assert.equal(off.body.products[0].authors, undefined);
  assert.equal(off.body.products[0].formats, undefined);
});

test("author and publisher book shelves carry cover-card author data", async () => {
  const res = await get("/api/public/authors/humayun-ahmed");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const book = res.body.books.find((row) => row.slug === "hi");
  assert.equal(book.authors[0].slug, "humayun-ahmed");
  assert.deepEqual(book.formats, ["print"]);
});


/* ------------------------------------------------------------------ *
 * Genres + theme support
 * ------------------------------------------------------------------ */

test("genres list published categories under the Books root with counts", async () => {
  const res = await get("/api/public/genres");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.root.slug, "books");
  assert.deepEqual(res.body.genres.map((row) => row.slug), ["novels"], "draft genre stays hidden");
  assert.equal(res.body.genres[0].bookCount, 1);
  assert.equal(res.body.tree.length, 1);
});

test("array modules + explicit moduleSupport map still turns the module on", async () => {
  const theme = findTheme("zarraybooks");
  assert.deepEqual(theme.modules.sort(), ["books", "builder"]);
  assert.deepEqual(theme.moduleSupport.books, ["product", "pages"]);

  const st = await bookState(state.arr._id);
  assert.equal(st.on, true);
  assert.equal(st.supported, true);
  assert.equal(st.active, true);

  const res = await get("/api/public/authors", "public-books-arr");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.authors, []);
});
