process.env.JWT_SECRET = process.env.JWT_SECRET || "books-module-secret";
// themeSupport() reads the theme manifests — the fixture folder declares which
// fixture theme renders the book module (bookshop) and which does not (plainsort).
process.env.THEMES_DIR = require("path").join(__dirname, "fixtures", "themes-books");

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { tenantStorage } = require("../lib/tenantContext");
const { scopedKey } = require("../lib/settingsScope");
const { clearBookCache, bookState, STARTER_GENRES } = require("../lib/bookModule");

const MODELS = [
  "Plan", "Store", "User", "Product", "Category", "ProductCategory", "Author", "Publisher",
  "Settings", "Appearance", "AuditLog", "Attribute", "AttributeTerm", "Brand", "Tag",
  "ProductTag", "ProductVariation", "ProductSwatch", "ProductPriceTier", "SpecDefinition",
  "InstallmentOffer", "Order",
].map((name) => require("../models/" + name));

const state = {};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(async (req, res, next) => {
    try {
      const slug = String(req.headers["x-store-slug"] || "").trim().toLowerCase();
      const store = slug ? await require("../models/Store").findOne({ slug }) : null;
      if (!store) return res.status(400).json({ message: "Store pawa jayni" });
      tenantStorage.run({ storeId: store._id }, () => {
        req.store = store;
        next();
      });
    } catch (err) {
      next(err);
    }
  });
  app.use("/api/books", require("../routes/books"));
  app.use("/api/categories", require("../routes/categories"));
  app.use("/api/product-form", require("../routes/productForm"));
  app.use("/api/settings", require("../routes/settings"));
  app.use((err, _req, res, _next) =>
    res.status(err.status || 500).json({ message: err.message || "Server error", code: err.code })
  );
  return app;
}

function bearer(user) {
  return "Bearer " + jwt.sign({ id: String(user._id), role: "admin" }, process.env.JWT_SECRET);
}

// every store row carries its own owner so requireAdmin() has to pass too
function get(pathname, store) {
  return request(state.app).get(pathname).set("x-store-slug", store.slug).set("Authorization", bearer(store.owner));
}
function post(pathname, store, body) {
  return request(state.app).post(pathname).set("x-store-slug", store.slug).set("Authorization", bearer(store.owner)).send(body || {});
}
function put(pathname, store, body) {
  return request(state.app).put(pathname).set("x-store-slug", store.slug).set("Authorization", bearer(store.owner)).send(body || {});
}
function patch(pathname, store, body) {
  return request(state.app).patch(pathname).set("x-store-slug", store.slug).set("Authorization", bearer(store.owner)).send(body || {});
}
function del(pathname, store) {
  return request(state.app).delete(pathname).set("x-store-slug", store.slug).set("Authorization", bearer(store.owner));
}

// Writes the owner's switch straight to the Settings row. Used wherever a test
// needs the toggle state without the settings controller's side effects (the
// root-planting is asserted on purpose, in its own test).
async function rawToggle(store, enabled) {
  const key = scopedKey(store._id, "books_module_enabled");
  await require("../models/Settings").updateOne(
    { key },
    { $set: { key, value: enabled ? "true" : "false" } },
    { upsert: true }
  );
  clearBookCache(store._id);
}

// The real save path: PUT /api/settings (plan gate + cache clear + root planting).
async function apiToggle(store, enabled) {
  const res = await put("/api/settings", store, {
    settings: { books_module_enabled: enabled ? "true" : "false" },
  });
  assert.equal(res.status, 200, res.body && res.body.message);
  return res;
}

async function toggleRow(store) {
  const doc = await require("../models/Settings").findOne({ key: scopedKey(store._id, "books_module_enabled") });
  return doc ? doc.value : null;
}

async function setTheme(store, name) {
  const Appearance = require("../models/Appearance");
  await Appearance.updateOne({ store: store._id }, { $set: { "published.theme": name } }, { upsert: true });
  clearBookCache(store._id);
}

async function makeAuthor(store, name, extra) {
  const res = await post("/api/books/authors", store, { name, ...(extra || {}) });
  assert.equal(res.status, 201, res.body.message);
  return res.body.author;
}

async function makeBook(store, title, bookDetails, extra) {
  const res = await post("/api/product-form", store, {
    title,
    regularPrice: 350,
    salePrice: 300,
    stock: 10,
    status: "published",
    ...(extra || {}),
    ...(bookDetails ? { bookDetails } : {}),
  });
  assert.equal(res.status, 201, res.body.message);
  return res.body.product;
}

async function rootOf(store) {
  const res = await post("/api/books/genres/root", store, {});
  assert.equal(res.status, 200, res.body.message);
  return res.body.root;
}

before(async () => {
  state.mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
  await mongoose.connect(state.mongo.getUri("books_module"));
  await Promise.all(MODELS.map((model) => model.init()));

  const Plan = require("../models/Plan");
  const Store = require("../models/Store");
  const User = require("../models/User");

  state.planBooks = await Plan.create({
    name: "Publisher", slug: "publisher", price: 0,
    limits: { products: 0, orders: 0 },
    features: { products: true, categories: true, books: true },
  });
  state.planLocked = await Plan.create({
    name: "Starter", slug: "starter", price: 0,
    limits: { products: 0, orders: 0 },
    features: { products: true, categories: true, books: false },
  });
  state.planTiny = await Plan.create({
    name: "Tiny", slug: "tiny", price: 0,
    limits: { products: 1, orders: 0 },
    features: { products: true, categories: true, books: true },
  });

  async function shop(slug, plan, ownerName) {
    const owner = await User.create({ name: ownerName, email: ownerName.toLowerCase() + "@e.com", role: "admin" });
    const doc = await Store.create({ name: ownerName, slug, owner: owner._id, plan: plan._id });
    return { _id: doc._id, slug, name: doc.name, owner };
  }

  state.a = await shop("bookworld", state.planBooks, "Owner A");      // module fully on
  state.b = await shop("rareprints", state.planBooks, "Owner B");     // toggle on, theme without book support
  state.c = await shop("shelved", state.planBooks, "Owner C");        // toggle off, flipped during the suite
  state.d = await shop("nolicense", state.planLocked, "Owner D");     // package without the books feature
  state.e = await shop("oneslot", state.planTiny, "Owner E");         // 1-product plan
  state.f = await shop("freshshop", state.planBooks, "Owner F");      // untouched, for the Settings path

  await setTheme(state.b, "plainsort");
  await rawToggle(state.a, true);
  await rawToggle(state.b, true);
  await rawToggle(state.c, false);
  await rawToggle(state.d, false);
  await rawToggle(state.e, false);
  await rawToggle(state.f, false);

  state.app = buildApp();
}, { timeout: 300000 });

after(async () => {
  await mongoose.disconnect();
  if (state.mongo) await state.mongo.stop();
});

/* ------------------------------------------------------------------ *
 * Gating: plan × toggle × theme
 * ------------------------------------------------------------------ */

test("plan without the books feature is locked out of /api/books", async () => {
  const res = await get("/api/books/authors", state.d);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "feature_locked");

  const s = await bookState(state.d._id);
  assert.deepEqual(
    { plan: s.plan, toggle: s.toggle, supported: s.supported, active: s.active, reason: s.reason },
    { plan: false, toggle: false, supported: true, active: false, reason: "plan" }
  );
});

test("owner toggle off answers books_module_off instead of an empty list", async () => {
  const res = await get("/api/books/authors", state.c);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "books_module_off");

  const s = await bookState(state.c._id);
  assert.equal(s.plan, true);
  assert.equal(s.toggle, false);
  assert.equal(s.on, false);
  assert.equal(s.reason, "toggle");
});

test("/api/books/state names the gate that is closed", async () => {
  const on = await get("/api/books/state", state.a);
  assert.equal(on.status, 200);
  assert.equal(on.body.books.active, true);
  assert.equal(on.body.books.reason, "on");
  assert.deepEqual(on.body.books.levels, ["product", "pages"]);
  assert.equal(on.body.books.theme, "bookshop");

  const themeOff = await get("/api/books/state", state.b);
  assert.equal(themeOff.body.books.on, true, "data layer stays reachable");
  assert.equal(themeOff.body.books.supported, false);
  assert.equal(themeOff.body.books.active, false);
  assert.equal(themeOff.body.books.reason, "theme");
});

test("the off module can still be probed, so the panel names the switch", async () => {
  // E has the books feature but the owner switch off — exactly the state where the
  // gate banner has to say "Settings-এ চালু করুন" instead of a bare 403.
  const list = await get("/api/books/authors", state.e);
  assert.equal(list.status, 403);
  assert.equal(list.body.code, "books_module_off");

  const s = await get("/api/books/state", state.e);
  assert.equal(s.status, 200);
  assert.deepEqual(
    {
      plan: s.body.books.plan,
      toggle: s.body.books.toggle,
      supported: s.body.books.supported,
      active: s.body.books.active,
      reason: s.body.books.reason,
    },
    { plan: true, toggle: false, supported: true, active: false, reason: "toggle" }
  );
});

test("a theme switching to a book-capable theme flips only the storefront gate", async () => {
  await setTheme(state.b, "bookshop");
  let s = await get("/api/books/state", state.b);
  assert.equal(s.body.books.active, true);

  await setTheme(state.b, "plainsort");
  s = await get("/api/books/state", state.b);
  assert.equal(s.body.books.active, false);
  assert.equal(s.body.books.supported, false);
});

/* ------------------------------------------------------------------ *
 * Authors & publishers
 * ------------------------------------------------------------------ */

test("inline create needs only a name and publishes with a unique slug", async () => {
  const first = await makeAuthor(state.a, "Humayun Ahmed");
  assert.equal(first.status, "published");
  assert.equal(first.slug, "humayun-ahmed");

  const second = await makeAuthor(state.a, "Humayun Ahmed");
  assert.equal(second.slug, "humayun-ahmed-2");

  const bengali = await post("/api/books/authors", state.a, { nameBn: "হুমায়ূন আহমেদ" });
  assert.equal(bengali.status, 201);
  assert.equal(bengali.body.author.name, "হুমায়ূন আহমেদ");
  // slugify keeps unicode letters (vowel signs drop, same as categories)
  assert.match(bengali.body.author.slug, /\p{Script=Bengali}/u);

  const blank = await post("/api/books/authors", state.a, { bio: "x" });
  assert.equal(blank.status, 400);
  assert.match(blank.body.message, /নাম দিতে হবে/);
});

test("author list searches, pages and caps the limit", async () => {
  const Author = require("../models/Author");
  await Author.create(
    Array.from({ length: 25 }, (_unused, i) => ({
      store: state.a._id,
      name: `Paginate ${i + 1}`,
      status: "published",
      slug: `paginate-${i + 1}`,
    }))
  );

  const capped = await get("/api/books/authors?limit=5000", state.a);
  assert.equal(capped.status, 200);
  assert.equal(capped.body.meta.limit, 100);
  assert.ok(capped.body.meta.total >= 25);

  const p1 = await get("/api/books/authors?page=1&limit=10", state.a);
  assert.equal(p1.body.authors.length, 10);
  assert.equal(p1.body.meta.page, 1);
  assert.equal(p1.body.meta.pages, Math.ceil(p1.body.meta.total / 10));
  assert.equal(p1.body.meta.hasNext, true);

  const page = await get("/api/books/authors?page=2&limit=10", state.a);
  assert.equal(page.body.authors.length, 10);
  assert.notEqual(page.body.authors[0]._id, p1.body.authors[0]._id);

  const outOfRange = await get("/api/books/authors?page=99&limit=10", state.a);
  assert.deepEqual(outOfRange.body.authors, []);
  assert.equal(outOfRange.body.meta.outOfRange, true);
  assert.equal(outOfRange.body.meta.total, p1.body.meta.total);

  const search = await get("/api/books/authors?search=Paginate 1", state.a);
  assert.equal(search.body.meta.total, 11); // Paginate 1, 10..19

  assert.equal((await get("/api/books/authors?search=%3A%2E%2A", state.a)).status, 200);
});

test("picker options are published-only, capped and search-filtered", async () => {
  const Author = require("../models/Author");
  const hidden = await makeAuthor(state.a, "Draft Person");
  await Author.updateOne({ _id: hidden._id, store: state.a._id }, { $set: { status: "draft" } });
  clearBookCache(state.a._id);

  const opts = await get("/api/books/authors/options?limit=9999", state.a);
  assert.equal(opts.status, 200);
  assert.equal(opts.body.meta.limit, 50);
  assert.equal(
    opts.body.authorOptions.some((row) => String(row._id) === String(hidden._id)),
    false
  );

  const found = await get("/api/books/authors/options?search=humayun", state.a);
  assert.ok(found.body.authorOptions.length >= 2);
  found.body.authorOptions.forEach((row) => assert.ok(row.name.toLowerCase().includes("humayun")));
});

test("store B can neither see nor edit store A's author", async () => {
  const mine = await makeAuthor(state.a, "Private Author");

  const list = await get("/api/books/authors?search=Private Author", state.b);
  assert.deepEqual(list.body.authors, []);
  const detail = await get(`/api/books/authors/${mine._id}`, state.b);
  assert.equal(detail.status, 404);
  const edit = await patch(`/api/books/authors/${mine._id}`, state.b, { name: "Hijacked" });
  assert.equal(edit.status, 404);
  const options = await get("/api/books/authors/options?search=Private Author", state.b);
  assert.deepEqual(options.body.authorOptions, []);

  const own = await get(`/api/books/authors/${mine._id}`, state.a);
  assert.equal(own.status, 200);
  assert.equal(own.body.author.name, "Private Author");
});

test("publisher fields are cleaned: unsafe urls dropped, links capped", async () => {
  const res = await post("/api/books/publishers", state.a, {
    name: "Sheba Prakashi",
    website: "javascript:alert(1)",
    email: "  INFO@SHEBA.COM ",
    description: "x".repeat(5000),
    links: [{ platform: "web", url: "javascript:evil(1)" }],
  });
  assert.equal(res.status, 201, res.body.message);
  const pub = res.body.publisher;
  assert.equal(pub.website, "");
  assert.equal(pub.email, "info@sheba.com");
  assert.equal(pub.description.length, 4000);

  const ok = await post("/api/books/publishers", state.a, {
    name: "Adorn",
    website: "https://adorn.example",
  });
  assert.equal(ok.body.publisher.website, "https://adorn.example/");

  const badAuthor = await post("/api/books/authors", state.a, {
    name: "Link Author",
    links: [
      ...Array.from({ length: 12 }, (_u, i) => ({ platform: `p${i}`, url: `https://x.example/${i}` })),
      { platform: "bad", url: "data:text/html,<script>" },
    ],
  });
  assert.equal(badAuthor.body.author.links.length, 8);
  assert.equal(badAuthor.body.author.links.some((l) => l.platform === "bad"), false);
});

test("a multipart create keeps the social links the form sent as text", async () => {
  // The author/publisher modal posts multipart/form-data because of the photo field,
  // so every value — the links array included — arrives as one string.
  const form = () =>
    request(state.app)
      .post("/api/books/authors")
      .set("x-store-slug", state.a.slug)
      .set("Authorization", bearer(state.a.owner));

  const res = await form()
    .field("name", "Multipart Author")
    .field(
      "links",
      JSON.stringify([
        { platform: "web", url: "https://mpl.example" },
        { platform: "bad", url: "javascript:alert(1)" },
      ])
    );
  assert.equal(res.status, 201, res.body.message);
  assert.deepEqual(res.body.author.links, [{ platform: "web", url: "https://mpl.example/" }]);

  const junk = await form().field("name", "Broken Links").field("links", "not json");
  assert.equal(junk.status, 201, junk.body.message);
  assert.deepEqual(junk.body.author.links, []);
});

/* ------------------------------------------------------------------ *
 * Product form — the Book details card
 * ------------------------------------------------------------------ */

test("bookDetails keeps author order, publisher and resolves chip labels", async () => {
  const a1 = await makeAuthor(state.a, "Reqamee Ahmed");
  const a2 = await makeAuthor(state.a, "Syed Manzoor");
  const a3 = await makeAuthor(state.a, "Nurengul Alam");
  const pub = (await post("/api/books/publishers", state.a, { name: "Sahitya Sansad" })).body.publisher;

  const product = await makeBook(state.a, "Order Test", {
    authors: [String(a3._id), String(a1._id), String(a2._id), String(a1._id)],
    publisher: String(pub._id),
    translator: "Someone",
    editor: "Editor",
    edition: "1st",
    publicationYear: 1998,
    pages: 320,
    language: "Bangla",
    binding: "paperback",
    formats: ["print", "ebook"],
  });

  assert.deepEqual(product.bookDetails.authors.map(String), [
    String(a3._id), String(a1._id), String(a2._id),
  ], "picked order kept, duplicate dropped");
  assert.equal(String(product.bookDetails.publisher), String(pub._id));
  assert.equal(product.bookDetails.pages, 320);
  assert.deepEqual(product.bookDetails.formats, ["print", "ebook"]);
  assert.equal(product.productType, "physical");

  const loaded = await get(`/api/product-form/${product._id}`, state.a);
  assert.deepEqual(loaded.body.bookAuthors.map((row) => row.name), [
    "Nurengul Alam", "Reqamee Ahmed", "Syed Manzoor",
  ]);
  assert.equal(loaded.body.bookPublisher.name, "Sahitya Sansad");
});

test("ebook-only formats make the product digital", async () => {
  const only = await makeBook(state.a, "Ebook Only", { authors: [], formats: ["ebook"] });
  assert.equal(only.productType, "digital");
  const audio = await makeBook(state.a, "Audio Only", { formats: ["audio"] });
  assert.equal(audio.productType, "digital");
  const both = await makeBook(state.a, "Print And Ebook", { formats: ["ebook", "print"] });
  assert.equal(both.productType, "physical");
});

test("non-book products never get a bookDetails block", async () => {
  const plain = await makeBook(state.a, "USB Cable");
  assert.equal(plain.bookDetails, undefined);
  assert.equal(plain.productType, "physical");

  const loaded = await get(`/api/product-form/${plain._id}`, state.a);
  assert.deepEqual(loaded.body.bookAuthors, []);
  assert.equal(loaded.body.bookPublisher, null);

  const meta = await get("/api/product-form/meta", state.a);
  assert.equal(meta.status, 200);
  assert.equal(meta.body.books.active, true);

  const emptied = await makeBook(state.a, "Emptied Card");
  const updated = await put(`/api/product-form/${emptied._id}`, state.a, {
    title: "Emptied Card",
    regularPrice: 10,
    bookDetails: { authors: [], formats: ["print"] },
  });
  assert.equal(updated.status, 200, updated.body.message);
  assert.equal(updated.body.product.bookDetails, undefined);
});

test("the form ignores bookDetails while the module is off and keeps stored data", async () => {
  // C starts with the toggle OFF
  const ignored = await post("/api/product-form", state.c, {
    title: "Ignored Book",
    regularPrice: 100,
    bookDetails: { authors: [], isbn: "9781402894626", formats: ["print"] },
  });
  assert.equal(ignored.status, 201, ignored.body.message);
  assert.equal(ignored.body.product.bookDetails, undefined);

  await rawToggle(state.c, true);
  const author = await makeAuthor(state.c, "Sajjad Sayed");
  const saved = await makeBook(state.c, "Stored Book", {
    authors: [String(author._id)],
    isbn: "0306406152",
    formats: ["print", "ebook"],
  });
  assert.equal(saved.bookDetails.isbn, "0306406152");

  await rawToggle(state.c, false);
  assert.equal((await get("/api/books/authors", state.c)).status, 403);
  const whileOff = await put(`/api/product-form/${saved._id}`, state.c, {
    title: "Stored Book Renamed",
    regularPrice: 100,
    bookDetails: { authors: [], isbn: "9781402894626", formats: ["ebook"] },
  });
  assert.equal(whileOff.status, 200, whileOff.body.message);
  assert.equal(whileOff.body.product.bookDetails.isbn, "0306406152", "off must not rewrite the card");

  await rawToggle(state.c, true);
  const back = await get("/api/books/authors?search=Sajjad", state.c);
  assert.equal(back.body.authors.length, 1);
  const refetched = await get(`/api/product-form/${saved._id}`, state.c);
  assert.equal(refetched.body.product.bookDetails.isbn, "0306406152");
  assert.deepEqual(refetched.body.bookAuthors.map((r) => r.name), ["Sajjad Sayed"]);
});

test("ISBN is check-digit validated and unique per store", async () => {
  const bad = await post("/api/product-form", state.a, {
    title: "Bad ISBN",
    regularPrice: 10,
    bookDetails: { isbn: "9781402894627" },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /ISBN/);

  const short = await post("/api/product-form", state.a, {
    title: "Short ISBN",
    regularPrice: 10,
    bookDetails: { isbn: "12345" },
  });
  assert.equal(short.status, 400);

  const dashed = await makeBook(state.a, "Dashed ISBN", { isbn: "978-1-4028-9462-6" });
  assert.equal(dashed.bookDetails.isbn, "9781402894626");

  const clash = await post("/api/product-form", state.a, {
    title: "Clash",
    regularPrice: 10,
    bookDetails: { isbn: "9781402894626" },
  });
  assert.equal(clash.status, 400);
  assert.match(clash.body.message, /already ache/);

  // the same ISBN is perfectly fine in another store
  const elsewhere = await makeBook(state.b, "Same ISBN Elsewhere", { isbn: "9781402894626" });
  assert.equal(elsewhere.bookDetails.isbn, "9781402894626");

  // an ISBN-10 ending in X keeps its check digit
  const withX = await makeBook(state.a, "ISBN Ten X", { isbn: "080442957X" });
  assert.equal(withX.bookDetails.isbn, "080442957X");

  // re-saving the same product must not collide with itself
  const resaved = await put(`/api/product-form/${dashed._id}`, state.a, {
    title: "Dashed ISBN",
    regularPrice: 10,
    bookDetails: { isbn: "978-1-4028-9462-6", pages: 120 },
  });
  assert.equal(resaved.status, 200, resaved.body.message);
  assert.equal(resaved.body.product.bookDetails.pages, 120);
});

test("author ids from another store are rejected on the form", async () => {
  const foreign = await makeAuthor(state.a, "Foreign Author");
  const res = await post("/api/product-form", state.b, {
    title: "Cross Tenant Book",
    regularPrice: 10,
    bookDetails: { authors: [String(foreign._id)] },
  });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /ei dokaner na/);

  const badShape = await post("/api/product-form", state.a, {
    title: "Bad Shape",
    regularPrice: 10,
    bookDetails: ["not", "an", "object"],
  });
  assert.equal(badShape.status, 400);

  const badBinding = await post("/api/product-form", state.a, {
    title: "Bad Binding",
    regularPrice: 10,
    bookDetails: { binding: "spiral" },
  });
  assert.equal(badBinding.status, 400);
});

test("authors and publishers are not plan-limited, products are", async () => {
  await rawToggle(state.e, true);
  for (let i = 1; i <= 4; i++) await makeAuthor(state.e, `Busy Author ${i}`);
  await post("/api/books/publishers", state.e, { name: "Busy Publisher" });

  const first = await post("/api/product-form", state.e, { title: "Slot One", regularPrice: 10 });
  assert.equal(first.status, 201, first.body.message);
  const second = await post("/api/product-form", state.e, { title: "Slot Two", regularPrice: 10 });
  assert.equal(second.status, 403);
  assert.match(second.body.message, /sorbocho 1 ti product/);
});

/* ------------------------------------------------------------------ *
 * Genres = the Books category subtree
 * ------------------------------------------------------------------ */

test("the Books root is created once and only once", async () => {
  const Category = require("../models/Category");
  const first = await post("/api/books/genres/root", state.c, {});
  assert.equal(first.status, 200, first.body.message);
  assert.equal(first.body.created, true);
  assert.equal(first.body.root.slug, "books");

  const again = await post("/api/books/genres/root", state.c, {});
  assert.equal(again.body.created, false);
  assert.equal(String(again.body.root._id), String(first.body.root._id));
  assert.equal(await Category.countDocuments({ store: state.c._id, systemType: "book" }), 1);

  // store A is still untouched by C's root
  assert.equal(await Category.countDocuments({ store: state.a._id, systemType: "book" }), 0);
});

test("starter pack plants the ten genres under the root and never repeats", async () => {
  const root = await rootOf(state.a);
  const added = await post("/api/books/genres/starter", state.a, {});
  assert.equal(added.status, 200, added.body.message);
  assert.equal(added.body.added.length, STARTER_GENRES.length);
  assert.equal(added.body.added[0].nameBn, "উপন্যাস");

  const list = await get("/api/books/genres", state.a);
  assert.equal(String(list.body.root._id), String(root._id));
  assert.equal(list.body.meta.total, STARTER_GENRES.length);
  assert.equal(list.body.genres.every((row) => String(row.parent) === String(root._id)), true);
  assert.equal(list.body.genres.every((row) => row.isDemo === true), true);
  assert.equal(list.body.genres.every((row) => row.status === "draft"), true);

  const twice = await post("/api/books/genres/starter", state.a, {});
  assert.deepEqual(twice.body.added, []);

  const genres = require("../models/Category");
  assert.equal(await genres.countDocuments({ store: state.a._id, parent: root._id }), STARTER_GENRES.length);
});

test("genre page paginates, filters by status and searches", async () => {
  const root = await rootOf(state.a);
  const Category = require("../models/Category");
  for (let i = 1; i <= 12; i++) {
    await Category.create({
      store: state.a._id,
      name: `Shelf ${i}`,
      slug: `shelf-${i}`,
      parent: root._id,
      ancestors: [root._id],
      level: 1,
      order: 100 + i,
      status: "published",
    });
  }

  const p1 = await get("/api/books/genres?limit=20", state.a);
  assert.equal(p1.body.meta.total, 22);
  assert.equal(p1.body.genres.length, 20);
  assert.equal(p1.body.meta.pages, 2);
  const p2 = await get("/api/books/genres?limit=20&page=2", state.a);
  assert.equal(p2.body.genres.length, 2);
  const far = await get("/api/books/genres?page=7", state.a);
  assert.deepEqual(far.body.genres, []);
  assert.equal(far.body.meta.outOfRange, true);

  const drafts = await get("/api/books/genres?status=draft", state.a);
  assert.equal(drafts.body.meta.total, STARTER_GENRES.length);
  const search = await get("/api/books/genres?search=Novels", state.a);
  assert.equal(search.body.genres.length, 1);
  assert.equal(search.body.genres[0].nameBn, "উপন্যাস");
});

test("genre selection in the product form is the same data the category page shows", async () => {
  const novels = (await get("/api/books/genres?search=Novels", state.a)).body.genres[0];
  const book = await makeBook(state.a, "Counted Novel", null, { categories: [String(novels._id)] });
  assert.ok(book.categories.map(String).includes(String(novels._id)));

  const genres = await get("/api/books/genres", state.a);
  const row = genres.body.genres.find((g) => String(g._id) === String(novels._id));
  assert.equal(row.books, 1);

  const cats = await get("/api/categories", state.a);
  const cat = cats.body.categories.find((c) => String(c._id) === String(novels._id));
  assert.equal(cat.productCount, 1);
  assert.equal(cat.locked, false);

  // the other direction: a category made on the Categories page is a genre at once
  const created = await post("/api/categories", state.a, { name: "Satire", parent: String(novels.parent), status: "published" });
  assert.equal(created.status, 201, created.body.message);
  const after = await get("/api/books/genres?search=Satire", state.a);
  assert.equal(after.body.genres.length, 1);
  assert.equal(String(after.body.genres[0].parent), String(novels.parent));

  // removing it from the product drops the count again
  await put(`/api/product-form/${book._id}`, state.a, { title: "Counted Novel", regularPrice: 350, categories: [] });
  const recount = await get("/api/books/genres?search=Novels", state.a);
  assert.equal(recount.body.genres[0].books, 0);
});

test("genre create and rename save the Bengali name", async () => {
  const root = await rootOf(state.a);
  const created = await post("/api/categories", state.a, {
    name: "Travel",
    nameBn: "ভ্রমণ",
    parent: String(root._id),
    status: "draft",
  });
  assert.equal(created.status, 201, created.body.message);
  assert.equal(created.body.nameBn, "ভ্রমণ");

  const renamed = await put(`/api/categories/${created.body._id}`, state.a, {
    name: "Travel",
    nameBn: "পর্যটন",
    parent: String(root._id),
    status: "published",
  });
  assert.equal(renamed.status, 200, renamed.body.message);
  assert.equal(renamed.body.nameBn, "পর্যটন");

  const listed = await get("/api/books/genres?search=Travel", state.a);
  assert.equal(listed.body.genres.length, 1);
  assert.equal(listed.body.genres[0].nameBn, "পর্যটন");
  assert.equal(listed.body.genres[0].status, "published");
});

test("the category tree marks the root locked and reports module state", async () => {
  const root = await rootOf(state.a);
  const cats = await get("/api/categories?tree=true", state.a);
  assert.equal(cats.body.books.active, true);
  const treeNode = cats.body.tree.find((node) => String(node._id) === String(root._id));
  assert.equal(treeNode.locked, true);
  assert.equal(treeNode.systemType, "book");
});

test("the Books root cannot be deleted, trashed or moved while the module is on", async () => {
  const root = await rootOf(state.a);
  assert.equal(root.slug, "books", "slug uniqueness is per store, not global");
  const electronics = await post("/api/categories", state.a, { name: "Electronics", status: "published" });
  const otherId = String(electronics.body._id);

  const soft = await del(`/api/categories/${root._id}`, state.a);
  assert.equal(soft.status, 400);
  assert.equal(soft.body.code, "book_root_protected");

  const perm = await del(`/api/categories/${root._id}/permanent`, state.a);
  assert.equal(perm.status, 400);

  const bulkTrash = await patch("/api/categories/bulk", state.a, { action: "trash", ids: [otherId, String(root._id)] });
  assert.equal(bulkTrash.status, 400);
  assert.equal((await require("../models/Category").findById(root._id)).status, "published");

  const moved = await put(`/api/categories/${root._id}`, state.a, { parent: otherId, slug: "books" });
  assert.equal(moved.status, 400);
  const reordered = await patch("/api/categories/reorder", state.a, { items: [{ id: String(root._id), parent: otherId, order: 0 }] });
  assert.equal(reordered.status, 400);
  const trashed = await put(`/api/categories/${root._id}`, state.a, { status: "trashed", slug: "books", parent: "" });
  assert.equal(trashed.status, 400);

  // ...but an ordinary edit of the root (rename, keep slug/parent) still works
  const renamed = await put(`/api/categories/${root._id}`, state.a, { name: "Book Zone", slug: "books", parent: "" });
  assert.equal(renamed.status, 200, renamed.body.message);
  assert.equal(renamed.body.name, "Book Zone");
  assert.equal(renamed.body.slug, "books");

  // ...and a normal category may still be moved under the root
  const moveNormal = await put(`/api/categories/${otherId}`, state.a, { parent: String(root._id), slug: "electronics" });
  assert.equal(moveNormal.status, 200, moveNormal.body.message);
  assert.equal(String(moveNormal.body.parent), String(root._id));
});

test("with the module off the root is an ordinary category again", async () => {
  const Category = require("../models/Category");
  const root = await rootOf(state.c);
  await rawToggle(state.c, false);

  const res = await del(`/api/categories/${root._id}`, state.c);
  assert.equal(res.status, 200, res.body.message);
  const row = await Category.findOne({ _id: root._id, store: state.c._id }).lean();
  assert.equal(row.status, "trashed");

  // turning it back on must not plant a second root, nor lose the data
  await rawToggle(state.c, true);
  const again = await post("/api/books/genres/root", state.c, {});
  assert.equal(String(again.body.root._id), String(root._id));
  assert.equal(again.body.created, false);
  assert.equal(await Category.countDocuments({ store: state.c._id, systemType: "book" }), 1);
});

test("genre migration proposes only genre-looking categories and moves them whole", async () => {
  const Category = require("../models/Category");
  const fiction = await post("/api/categories", state.a, { name: "Detective fiction", status: "published" });
  const coldCase = await post("/api/categories", state.a, {
    name: "Cold case mystery",
    parent: String(fiction.body._id),
    status: "published",
  });
  await post("/api/categories", state.a, { name: "Washing machines", status: "published" });
  await makeBook(state.a, "Case File One", null, { categories: [String(fiction.body._id)] });
  await makeBook(state.a, "Case File Two", null, { categories: [String(coldCase.body._id)] });

  const plan = await get("/api/books/genres/migration", state.a);
  assert.equal(plan.status, 200, plan.body.message);
  const names = plan.body.candidates.map((c) => c.name);
  assert.ok(names.includes("Detective fiction"));
  assert.ok(names.includes("Cold case mystery"), "children are offered too — the admin picks");
  assert.equal(names.includes("Washing machines"), false);
  const candidate = plan.body.candidates.find((c) => c.name === "Detective fiction");
  assert.equal(candidate.products, 1);
  assert.equal(candidate.children, 1);
  assert.equal(candidate.urlChanges, false, "moving keeps the category slug");

  const noIds = await post("/api/books/genres/migration/apply", state.a, { ids: [] });
  assert.equal(noIds.status, 400);

  const applied = await post("/api/books/genres/migration/apply", state.a, { ids: [String(fiction.body._id)] });
  assert.equal(applied.status, 200, applied.body.message);
  assert.equal(applied.body.moved.length, 1);

  const root = await rootOf(state.a);
  const movedRow = await Category.findOne({ _id: fiction.body._id, store: state.a._id }).lean();
  assert.equal(String(movedRow.parent), String(root._id));
  assert.equal(movedRow.level, 1);
  const childRow = await Category.findOne({ _id: coldCase.body._id, store: state.a._id }).lean();
  assert.deepEqual(childRow.ancestors.map(String), [String(root._id), String(fiction.body._id)]);
  assert.equal(childRow.level, 2);

  // an already-moved id is not moved twice, and the root itself is skipped
  const twice = await post("/api/books/genres/migration/apply", state.a, {
    ids: [String(fiction.body._id), String(root._id)],
  });
  assert.deepEqual(twice.body.moved, []);
});

/* ------------------------------------------------------------------ *
 * Trash / restore / merge / permanent delete
 * ------------------------------------------------------------------ */

test("bulk trash and restore remember the previous status", async () => {
  const Author = require("../models/Author");
  const row = await makeAuthor(state.a, "Recycled Author");

  const bad = await patch("/api/books/authors/bulk", state.a, { action: "explode", ids: [String(row._id)] });
  assert.equal(bad.status, 400);
  const empty = await patch("/api/books/authors/bulk", state.a, { action: "trash", ids: ["not-an-id"] });
  assert.equal(empty.status, 400);

  const trashed = await patch("/api/books/authors/bulk", state.a, { action: "trash", ids: [String(row._id)] });
  assert.equal(trashed.status, 200, trashed.body.message);
  let db = await Author.findOne({ _id: row._id, store: state.a._id }).lean();
  assert.equal(db.status, "trashed");
  assert.equal(db.previousStatus, "published");
  assert.ok(db.deletedAt);

  const hidden = await get("/api/books/authors?search=Recycled", state.a);
  assert.deepEqual(hidden.body.authors, []);
  const inTrash = await get("/api/books/authors?status=trashed&search=Recycled", state.a);
  assert.equal(inTrash.body.authors.length, 1);
  const opts = await get("/api/books/authors/options?search=Recycled", state.a);
  assert.deepEqual(opts.body.authorOptions, []);

  const restored = await patch("/api/books/authors/bulk", state.a, { action: "restore", ids: [String(row._id)] });
  assert.equal(restored.status, 200);
  db = await Author.findOne({ _id: row._id, store: state.a._id }).lean();
  assert.equal(db.status, "published");
  assert.equal(db.previousStatus, null);
  assert.equal(db.deletedAt, null);

  await patch("/api/books/authors/bulk", state.a, { action: "draft", ids: [String(row._id)] });
  db = await Author.findOne({ _id: row._id, store: state.a._id }).lean();
  assert.equal(db.status, "draft");
});

test("status counts follow the store and exclude other tenants", async () => {
  const res = await get("/api/books/authors", state.a);
  const counts = res.body.counts;
  assert.equal(counts.all, counts.draft + counts.published + counts.trashed);
  const b = await get("/api/books/authors", state.b);
  assert.ok(b.body.counts.all < counts.all);
});

test("merge moves the books, keeps author order and trashes the source", async () => {
  const Author = require("../models/Author");
  const keep = await makeAuthor(state.a, "Ashapurna Debi");
  const dup = await makeAuthor(state.a, "Asha Purna Debi");
  const other = await makeAuthor(state.a, "Behrooz Choyko");

  const book = await makeBook(state.a, "Merge Me", {
    authors: [String(other._id), String(dup._id), String(keep._id)],
  });

  const self = await post(`/api/books/authors/${String(dup._id)}/merge`, state.a, { into: String(dup._id) });
  assert.equal(self.status, 400);
  const badTarget = await post(`/api/books/authors/${String(dup._id)}/merge`, state.a, { into: "nope" });
  assert.equal(badTarget.status, 400);

  const res = await post(`/api/books/authors/${String(dup._id)}/merge`, state.a, { into: String(keep._id) });
  assert.equal(res.status, 200, res.body.message);
  assert.equal(res.body.moved, 1);
  assert.equal(String(res.body.into._id), String(keep._id));

  const after = await require("../models/Product").findById(book._id).lean();
  assert.deepEqual(after.bookDetails.authors.map(String), [
    String(other._id), String(keep._id),
  ], "source replaced in place, order kept, duplicate dropped");

  const dupRow = await Author.findOne({ _id: dup._id, store: state.a._id }).lean();
  assert.equal(dupRow.status, "trashed");
  assert.equal(dupRow.previousStatus, "published");

  const detail = await get(`/api/books/authors/${keep._id}`, state.a);
  assert.equal(detail.body.bookCount, 1);
});

test("detail lists the author's books with pagination", async () => {
  const author = await makeAuthor(state.a, "Prolific Writer");
  await makeBook(state.a, "Prolific One", { authors: [String(author._id)], publicationYear: 2001 });
  await makeBook(state.a, "Prolific Two", { authors: [String(author._id)], publicationYear: 2005 });
  const other = await makeAuthor(state.a, "Prolific Writer Clone");
  await makeBook(state.a, "Other Book", { authors: [String(other._id)] });

  const page1 = await get(`/api/books/authors/${author._id}?limit=1`, state.a);
  assert.equal(page1.status, 200, page1.body.message);
  assert.equal(page1.body.bookCount, 2);
  assert.equal(page1.body.books.length, 1);
  assert.equal(page1.body.books[0].title, "Prolific Two", "newest publication first");
  assert.equal(page1.body.meta.total, 2);
  assert.equal(page1.body.meta.pages, 2);

  const page2 = await get(`/api/books/authors/${author._id}?limit=1&page=2`, state.a);
  assert.equal(page2.body.books[0].title, "Prolific One");

  const listed = await get("/api/books/authors?search=Prolific&sort=-books", state.a);
  assert.equal(listed.body.authors[0].bookCount >= listed.body.authors[1].bookCount, true);
  assert.equal(String(listed.body.authors[0]._id), String(author._id));

  const missing = await get(`/api/books/authors/${new mongoose.Types.ObjectId()}`, state.a);
  assert.equal(missing.status, 404);
  const invalid = await get("/api/books/authors/not-an-id", state.a);
  assert.equal(invalid.status, 400);
});

test("permanent delete removes the record and detaches every book", async () => {
  const Author = require("../models/Author");
  const Publisher = require("../models/Publisher");
  const doomed = await makeAuthor(state.a, "Doomed Author");
  const pub = (await post("/api/books/publishers", state.a, { name: "Doomed Press" })).body.publisher;
  const book = await makeBook(state.a, "Orphan Proof", {
    authors: [String(doomed._id)],
    publisher: String(pub._id),
  });

  const res = await patch("/api/books/authors/bulk", state.a, { action: "permanent", ids: [String(doomed._id)] });
  assert.equal(res.status, 200, res.body.message);
  assert.equal(await Author.countDocuments({ _id: doomed._id, store: state.a._id }), 0);

  const after = await require("../models/Product").findById(book._id).lean();
  assert.deepEqual(after.bookDetails.authors.map(String), []);
  assert.equal(String(after.bookDetails.publisher), String(pub._id));

  const pubDel = await patch("/api/books/publishers/bulk", state.a, { action: "permanent", ids: [String(pub._id)] });
  assert.equal(pubDel.status, 200, pubDel.body.message);
  assert.equal(await Publisher.countDocuments({ _id: pub._id, store: state.a._id }), 0);
  const cleared = await require("../models/Product").findById(book._id).lean();
  assert.equal(cleared.bookDetails.publisher, null);

  const audit = await require("../models/AuditLog").find({ store: state.a._id, action: "books.author_delete" }).lean();
  assert.equal(audit.length, 1);
});

test("publisher merge is single-select and list pages work the same", async () => {
  const keep = (await post("/api/books/publishers", state.a, { name: "Sheikh Para" })).body.publisher;
  const dup = (await post("/api/books/publishers", state.a, { name: "Sheikhpara" })).body.publisher;
  const book = await makeBook(state.a, "Publisher Merge", { publisher: String(dup._id) });

  const listed = await get("/api/books/publishers?search=Sheikh", state.a);
  assert.equal(listed.body.meta.total, 2);
  assert.equal(listed.body.publishers.length, 2);

  const res = await post(`/api/books/publishers/${String(dup._id)}/merge`, state.a, { into: String(keep._id) });
  assert.equal(res.status, 200, res.body.message);
  assert.equal(res.body.moved, 1);
  const after = await require("../models/Product").findById(book._id).lean();
  assert.equal(String(after.bookDetails.publisher), String(keep._id));

  const detail = await get(`/api/books/publishers/${keep._id}`, state.a);
  assert.equal(detail.body.bookCount, 1);
  assert.equal(detail.body.books[0].title, "Publisher Merge");

  const opts = await get("/api/books/publishers/options?search=Sheikh", state.a);
  assert.equal(opts.body.publisherOptions.length, 1);
});

test("update edits fields, re-slugs on request and clears a picture", async () => {
  const row = await makeAuthor(state.a, "Rename Me", { photo: "/uploads/somefile.png", birthYear: 1931 });
  const res = await patch(`/api/books/authors/${row._id}`, state.a, {
    name: "Renamed Author",
    slug: "renamed-author",
    birthYear: "1932",
    deathYear: "2006",
    removeImage: "true",
  });
  assert.equal(res.status, 200, res.body.message);
  assert.equal(res.body.author.name, "Renamed Author");
  assert.equal(res.body.author.slug, "renamed-author");
  assert.equal(res.body.author.birthYear, 1932);
  assert.equal(res.body.author.deathYear, 2006);
  assert.equal(res.body.author.photo, "");

  const taken = await patch(`/api/books/authors/${row._id}`, state.a, { slug: "humayun-ahmed" });
  assert.equal(taken.status, 200);
  assert.notEqual(taken.body.author.slug, "humayun-ahmed");
  assert.ok(taken.body.author.slug.startsWith("humayun-ahmed-"));

  const nonsense = await patch(`/api/books/authors/${row._id}`, state.a, { birthYear: "abc", deathYear: "" });
  assert.equal(nonsense.status, 200);
  assert.equal(nonsense.body.author.birthYear, null);
  assert.equal(nonsense.body.author.deathYear, null);
});

test("slug uniqueness is per store", async () => {
  const mine = await makeAuthor(state.a, "Shared Name");
  const theirs = await makeAuthor(state.b, "Shared Name");
  assert.equal(theirs.slug, mine.slug);
});

/* ------------------------------------------------------------------ *
 * Settings is the real switch (PUT /api/settings path, not a raw row)
 * ------------------------------------------------------------------ */

test("a plan without the books feature cannot switch the module on itself", async () => {
  await apiToggle(state.d, true);
  assert.equal(await toggleRow(state.d), "false", "the toggle key is dropped before it is stored");
  assert.equal((await get("/api/books/authors", state.d)).body.code, "feature_locked");
});

test("switching the module on in Settings plants the root, off keeps the data", async () => {
  const Category = require("../models/Category");
  const Author = require("../models/Author");
  assert.equal(await Category.countDocuments({ store: state.f._id, systemType: "book" }), 0);

  await apiToggle(state.f, true);
  const again = await post("/api/books/genres/root", state.f, {});
  assert.equal(again.body.created, false, "the settings save already planted it");
  const st = await get("/api/books/state", state.f);
  assert.equal(st.body.books.active, true, "the cached state was invalidated by the save");

  const author = await makeAuthor(state.f, "Settings Author");
  const book = await makeBook(state.f, "Settings Book", { authors: [String(author._id)], isbn: "9786150000008" });

  await apiToggle(state.f, false);
  assert.equal((await get("/api/books/authors", state.f)).body.code, "books_module_off");
  assert.equal(await Category.countDocuments({ store: state.f._id, systemType: "book" }), 1);
  assert.equal(await Author.countDocuments({ store: state.f._id }), 1);

  await apiToggle(state.f, true);
  assert.equal((await get("/api/books/authors", state.f)).status, 200);
  const refetched = await get(`/api/product-form/${book._id}`, state.f);
  assert.equal(refetched.body.product.bookDetails.isbn, "9786150000008");
  assert.deepEqual(refetched.body.bookAuthors.map((r) => r.name), ["Settings Author"]);
});
