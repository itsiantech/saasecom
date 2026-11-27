const mongoose = require("mongoose");
const Product = require("../models/Product");
const ProductVariation = require("../models/ProductVariation");
const ProductPriceTier = require("../models/ProductPriceTier");
const Category = require("../models/Category");
const ProductCategory = require("../models/ProductCategory");
const Brand = require("../models/Brand");
const Attribute = require("../models/Attribute");
const AttributeTerm = require("../models/AttributeTerm");
const Author = require("../models/Author");
const Publisher = require("../models/Publisher");
const Review = require("../models/Review");
const HeroSlide = require("../models/HeroSlide");
const SiteSetting = require("../models/SiteSetting");
const ShopFavicon = require("../models/ShopFavicon");
const SocialLink = require("../models/SocialLink");
const StoreSettings = require("../models/StoreSettings");
const { publicSlide, sortForPublic } = require("../lib/heroSlides");
const { readSliderSettings } = require("../lib/sliderSettings");
const { buildTree, getDescendantIds } = require("../lib/categoryHelpers");
const { toCard, brandingFor, loadSettings, escapeRegex } = require("./storefrontController");
const { getWholesaleSettings } = require("../lib/wholesaleSettings");
const { getSettingsMap } = require("./settingsController");
const { loadLiveFlashSales, bestFlashSale, publicFlashSale } = require("../services/promotions");
const { toPaisa, fromPaisa } = require("../lib/money");
const { parseSections, fixedConfig } = require("../lib/homeSections");
const { sanitizeRichText } = require("../lib/richText");
const { buildMenu } = require("../lib/storeMenu");
const { buildGoogleSeo } = require("../lib/googleSeo");
const { featuresForStore } = require("../lib/features");
const { bookState, getBooksRoot, genreIds } = require("../lib/bookModule");
const { parsePage, pageMeta } = require("../lib/paginate");

/* ------------------------------------------------------------------ *
 * Public catalog reads. Every query here is store-scoped BY HAND:
 * aggregate() bypasses lib/tenantPlugin, so `$match: { store }` is the
 * isolation boundary — never remove it, and the isolation test in
 * tests/tenantIsolation.test.js fails if it goes missing.
 * ------------------------------------------------------------------ */

const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  popular: { soldCount: -1, createdAt: -1 },
  // price sorts need the effective price (sale wins over regular), so they run in $addFields
  price_asc: { _effectivePrice: 1, createdAt: -1 },
  price_desc: { _effectivePrice: -1, createdAt: -1 },
  discount: { _discountPct: -1, soldCount: -1 },
};

// salePrice > 0 ? salePrice : (regularPrice || price) — mirrors storefrontController.toCard
const EFFECTIVE_PRICE = {
  $cond: [{ $gt: ["$salePrice", 0] }, "$salePrice", { $ifNull: ["$regularPrice", "$price"] }],
};

// old seeded products have no slug — the id is the stable public key instead
function cardOf(product, internationalEnabled) {
  const card = toCard(product, internationalEnabled);
  card.slug = card.slug || String(product._id);
  return card;
}

// one grouped query per page instead of per card; aggregate() skips tenantPlugin,
// so the store id stays part of the $match.
async function ratingMapFor(storeId, productIds) {
  if (!productIds.length) return new Map();
  const rows = await Review.aggregate([
    {
      $match: {
        store: new mongoose.Types.ObjectId(String(storeId)),
        product: { $in: productIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
        status: "published",
      },
    },
    { $group: { _id: "$product", count: { $sum: 1 }, sum: { $sum: "$rating" } } },
  ]);
  return new Map(
    rows.map((row) => [String(row._id), { count: row.count, average: Math.round((row.sum / row.count) * 10) / 10 }])
  );
}

function withRating(card, ratings, productId) {
  const rating = ratings.get(String(productId));
  card.ratingAverage = rating ? rating.average : 0;
  card.ratingCount = rating ? rating.count : 0;
  return card;
}

function baseFilter(storeId, extra = {}) {
  return { store: storeId, status: "published", ...extra };
}

function intArg(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function objectIdOr(value) {
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(value) : null;
}

// category/brand can arrive as slug or raw id — resolve to ids within THIS store only.
async function resolveFacetIds(Model, storeId, raw) {
  const ids = String(raw || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!ids.length) return [];

  const oids = ids.map(objectIdOr).filter(Boolean);
  const slugs = ids.filter((v) => !mongoose.isValidObjectId(v)).map((v) => v.toLowerCase());
  const found = await Model.find(baseFilter(storeId, { $or: [
    ...(oids.length ? [{ _id: { $in: oids } }] : []),
    ...(slugs.length ? [{ slug: { $in: slugs } }] : []),
  ] })).select("_id").lean();
  return found.map((row) => row._id);
}

/* ------------------------------------------------------------------ *
 * Book / Ebook module — public reads.
 * The data endpoints answer while the owner's switch is on (plan +
 * toggle); whether a surface is actually rendered is the theme's call
 * and stays a frontend concern.
 * ------------------------------------------------------------------ */

const BOOK_FORMATS = ["print", "ebook", "audio"];

function booksOff(res) {
  return res.status(404).json({ message: "Book module ei dokane chalu nei" });
}

// author/publisher filters accept slug or raw id, comma separated, same
// contract as category/brand. Unknown or foreign values must narrow to
// nothing — never "ignore the filter".
async function resolvePeopleIds(Model, storeId, raw) {
  const parts = String(raw || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (!parts.length) return [];

  const oids = parts.map(objectIdOr).filter(Boolean);
  const slugs = parts.filter((v) => !mongoose.isValidObjectId(v)).map((v) => v.toLowerCase());
  const rows = await Model.find({
    store: storeId,
    status: "published",
    $or: [
      ...(oids.length ? [{ _id: { $in: oids } }] : []),
      ...(slugs.length ? [{ slug: { $in: slugs } }] : []),
    ],
  })
    .select("_id")
    .lean();
  return rows.map((row) => row._id);
}

function publicAuthorRow(row, bookCount) {
  return {
    id: row._id,
    name: row.name || row.nameBn || "",
    nameBn: row.nameBn || "",
    slug: row.slug || String(row._id),
    photo: row.photo || "",
    country: row.country || "",
    bookCount: bookCount || 0,
  };
}

function publicPublisherRow(row, bookCount) {
  return {
    id: row._id,
    name: row.name || row.nameBn || "",
    nameBn: row.nameBn || "",
    slug: row.slug || String(row._id),
    logo: row.logo || "",
    bookCount: bookCount || 0,
  };
}

function publicBookBlock(details) {
  if (!details || typeof details !== "object") return null;
  const authors = (details.authors || [])
    .filter((row) => row && row._id && (!row.status || row.status === "published"))
    .map((row) => ({
      id: row._id,
      name: row.name || row.nameBn || "",
      nameBn: row.nameBn || "",
      slug: row.slug || String(row._id),
      photo: row.photo || "",
    }));
  const pub = details.publisher;
  const publisher = pub && pub._id && (!pub.status || pub.status === "published")
    ? { id: pub._id, name: pub.name || pub.nameBn || "", nameBn: pub.nameBn || "", slug: pub.slug || String(pub._id), logo: pub.logo || "" }
    : null;
  return {
    authors,
    publisher,
    translator: details.translator || "",
    editor: details.editor || "",
    isbn: details.isbn || "",
    edition: details.edition || "",
    publicationYear: details.publicationYear || null,
    pages: details.pages || null,
    language: details.language || "",
    binding: details.binding || "",
    formats: Array.isArray(details.formats) && details.formats.length ? details.formats : ["print"],
  };
}

const BOOK_PEOPLE = {
  author: {
    Model: Author,
    key: "authors",
    one: "author",
    refField: "bookDetails.authors",
    fields: "name nameBn slug photo country status",
  },
  publisher: {
    Model: Publisher,
    key: "publishers",
    one: "publisher",
    refField: "bookDetails.publisher",
    fields: "name nameBn slug logo status",
  },
};

// Cover cards show the author line and format badge while the module is on.
// Rows carry raw author ids (aggregate paths can't populate), so this joins
// them in one batched read instead of per card.
async function attachBookCards(storeId, rows, cards) {
  if (!rows.length) return cards;
  if (!(await bookState(storeId)).on) return cards;

  const idSet = new Set();
  rows.forEach((row) => (row.bookDetails?.authors || []).forEach((id) => idSet.add(String(id))));
  const ids = [...idSet].map(objectIdOr).filter(Boolean);
  const people = ids.length
    ? await Author.find({ store: storeId, _id: { $in: ids }, status: "published" })
        .select("name nameBn slug photo status")
        .lean()
    : [];
  const byId = new Map(people.map((row) => [String(row._id), row]));

  rows.forEach((row, index) => {
    const card = cards[index];
    if (!card) return;
    const authors = (row.bookDetails?.authors || [])
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((person) => ({
        id: person._id,
        name: person.name || person.nameBn || "",
        nameBn: person.nameBn || "",
        slug: person.slug || String(person._id),
        photo: person.photo || "",
      }));
    if (authors.length) card.authors = authors;
    const formats = row.bookDetails?.formats;
    if (Array.isArray(formats) && formats.length) card.formats = formats;
  });
  return cards;
}

// Storefront counts must only include published books — the admin counts
// (lib/bookModule) intentionally include drafts, these must not.
async function publishedCountsByField(storeId, field, ids) {
  const clean = ids.map(objectIdOr).filter(Boolean);
  const out = {};
  if (!clean.length) return out;
  const rows = await Product.aggregate([
    { $match: { store: new mongoose.Types.ObjectId(String(storeId)), status: "published", [field]: { $in: clean } } },
    { $unwind: `$${field}` },
    { $match: { [field]: { $in: clean } } },
    { $group: { _id: `$${field}`, n: { $addToSet: "$_id" } } },
  ]);
  rows.forEach((row) => {
    out[String(row._id)] = (row.n || []).length;
  });
  return out;
}

async function publishedCountsByCategory(storeId, categoryIds) {
  const clean = categoryIds.map(objectIdOr).filter(Boolean);
  if (!clean.length) return {};

  const storeOid = new mongoose.Types.ObjectId(String(storeId));
  const [legacy, joins] = await Promise.all([
    Product.aggregate([
      { $match: { store: storeOid, status: "published", categories: { $in: clean } } },
      { $unwind: "$categories" },
      { $match: { categories: { $in: clean } } },
      { $group: { _id: "$categories", n: { $addToSet: "$_id" } } },
    ]),
    ProductCategory.aggregate([
      { $match: { store: storeOid, category: { $in: clean } } },
      { $lookup: { from: "products", localField: "product", foreignField: "_id", as: "productDoc" } },
      { $unwind: "$productDoc" },
      { $match: { "productDoc.store": storeOid, "productDoc.status": "published" } },
      { $group: { _id: "$category", n: { $addToSet: "$product" } } },
    ]),
  ]);

  const merged = new Map();
  const add = (id, list) => {
    const key = String(id);
    if (!merged.has(key)) merged.set(key, new Set());
    (list || []).forEach((row) => merged.get(key).add(String(row)));
  };
  legacy.forEach((row) => add(row._id, row.n));
  joins.forEach((row) => add(row._id, row.n));
  const out = {};
  merged.forEach((set, key) => {
    out[key] = set.size;
  });
  return out;
}

function peopleListHandler(kind) {
  const cfg = BOOK_PEOPLE[kind];
  return async function listPeople(req, res, next) {
    try {
      const store = req.publicStore;
      if (!(await bookState(store._id)).on) return booksOff(res);

      const { page, limit, skip } = parsePage(req.query, { defaultLimit: 24, maxLimit: 60 });
      const filter = { store: store._id, status: "published" };
      const search = String(req.query.q || "").trim().slice(0, 120);
      if (search) {
        const rx = new RegExp(escapeRegex(search), "i");
        filter.$or = [{ name: rx }, { nameBn: rx }];
      }
      const sort = String(req.query.sort || "") === "-name" ? { name: -1 } : { name: 1 };

      const total = await cfg.Model.countDocuments(filter);
      const rows = total > page - 1
        ? await cfg.Model.find(filter).select(cfg.fields).sort(sort).skip(skip).limit(limit).lean()
        : [];
      const counts = await publishedCountsByField(store._id, cfg.refField, rows.map((row) => String(row._id)));
      const map = kind === "author" ? publicAuthorRow : publicPublisherRow;

      res.json({
        store: { id: store._id, name: store.name, slug: store.slug, currency: store.currency, language: store.language },
        [cfg.key]: rows.map((row) => map(row, counts[String(row._id)])),
        meta: pageMeta({ page, limit, total }),
      });
    } catch (err) {
      next(err);
    }
  };
}

function peopleDetailHandler(kind) {
  const cfg = BOOK_PEOPLE[kind];
  return async function getPerson(req, res, next) {
    try {
      const store = req.publicStore;
      if (!(await bookState(store._id)).on) return booksOff(res);

      const key = String(req.params.slug || "").trim();
      if (!key) return res.status(404).json({ message: "Pawa jayni" });
      const filter = { store: store._id, status: "published", ...(objectIdOr(key) ? { _id: objectIdOr(key) } : { slug: key.toLowerCase() }) };
      const row = await cfg.Model.findOne(filter).lean();
      if (!row) return res.status(404).json({ message: "Pawa jayni" });

      const { page, limit, skip } = parsePage(req.query, { defaultLimit: 12, maxLimit: 48 });
      const bookFilter = baseFilter(store._id, { [cfg.refField]: row._id });
      const total = await Product.countDocuments(bookFilter);
      const books = total > page - 1
        ? await Product.find(bookFilter)
            .select("title name slug images price regularPrice salePrice stock soldCount hasVariations internationalConfig.sizes bookDetails")
            .sort({ "bookDetails.publicationYear": -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean()
        : [];
      const ratings = await ratingMapFor(store._id, books.map((book) => book._id));

      const detail = kind === "author"
        ? {
            id: row._id,
            name: row.name || row.nameBn || "",
            nameBn: row.nameBn || "",
            slug: row.slug || String(row._id),
            photo: row.photo || "",
            bio: row.bio || "",
            bioBn: row.bioBn || "",
            country: row.country || "",
            birthYear: row.birthYear || null,
            deathYear: row.deathYear || null,
            links: (row.links || []).filter((link) => link && link.url),
          }
        : {
            id: row._id,
            name: row.name || row.nameBn || "",
            nameBn: row.nameBn || "",
            slug: row.slug || String(row._id),
            logo: row.logo || "",
            description: row.description || "",
            descriptionBn: row.descriptionBn || "",
            address: row.address || "",
            phone: row.phone || "",
            email: row.email || "",
            website: row.website || "",
          };

      res.json({
        store: { id: store._id, name: store.name, slug: store.slug, currency: store.currency, language: store.language },
        [cfg.one]: detail,
        books: await attachBookCards(
          store._id,
          books,
          books.map((book) => {
            const card = cardOf(book, false);
            card.soldCount = book.soldCount || 0;
            // shelf metadata for the author/publisher pages
            card.formats = (book.bookDetails && book.bookDetails.formats) || [];
            card.publicationYear = (book.bookDetails && book.bookDetails.publicationYear) || null;
            return withRating(card, ratings, book._id);
          })
        ),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      });
    } catch (err) {
      next(err);
    }
  };
}

// Genre rail for the storefront: published categories under the Books
// root only, with book counts, flat + tree.
async function listBookGenres(req, res, next) {
  try {
    const store = req.publicStore;
    if (!(await bookState(store._id)).on) return booksOff(res);

    const root = await getBooksRoot(store._id);
    if (!root) return res.json({ genres: [], tree: [] });

    const ids = (await genreIds(store._id)).map(objectIdOr).filter(Boolean);
    const rows = ids.length
      ? await Category.find({
          store: store._id,
          _id: { $in: ids, $ne: root._id },
          status: "published",
          deletedAt: null,
        })
          .select("name nameBn slug parent level order image")
          .sort({ order: 1, name: 1 })
          .lean()
      : [];
    const counts = await publishedCountsByCategory(store._id, rows.map((row) => String(row._id)));

    res.json({
      root: { id: root._id, name: root.name, nameBn: root.nameBn || "", slug: root.slug },
      genres: rows.map((row) => ({
        id: row._id,
        name: row.name || "",
        nameBn: row.nameBn || "",
        slug: row.slug || "",
        parent: row.parent || null,
        level: row.level || 0,
        image: row.image || "",
        bookCount: counts[String(row._id)] || 0,
      })),
      tree: buildTree(rows.map((row) => ({ ...row, children: undefined }))),
    });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * Categories live in two places: the product form writes ProductCategory
 * join rows, seeded/legacy products only carry Product.categories. Every
 * read below unions both, otherwise join-only products disappear from
 * their category page (and an old backfill would be required per store).
 * ------------------------------------------------------------------ */

async function productIdsWithCategories(storeId, categoryIds) {
  if (!categoryIds.length) return [];
  const rows = await ProductCategory.find({ store: storeId, category: { $in: categoryIds } })
    .select("product")
    .lean();
  return [...new Set(rows.map((row) => String(row.product)))].map(objectIdOr).filter(Boolean);
}

async function categoriesOfProducts(storeId, productIds) {
  if (!productIds.length) return new Map();
  const rows = await ProductCategory.find({ store: storeId, product: { $in: productIds } })
    .select("product category")
    .lean();
  const map = new Map();
  for (const row of rows) {
    const key = String(row.product);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(String(row.category));
  }
  return map;
}

function mergeJoinedCategories(products, joined) {
  for (const product of products) {
    const extra = joined.get(String(product._id)) || [];
    if (!extra.length) continue;
    product.categories = [...new Set([...(product.categories || []).map(String), ...extra])];
  }
  return products;
}

// attrs=term,term — AND across attributes, OR within one attribute's terms.
async function productIdsWithAttributeTerms(storeId, termIds) {
  const terms = termIds.length
    ? await AttributeTerm.find({ store: storeId, _id: { $in: termIds } }).select("_id attribute").lean()
    : [];
  if (!terms.length) return [];

  const byAttribute = new Map();
  for (const term of terms) {
    const key = String(term.attribute);
    if (!byAttribute.has(key)) byAttribute.set(key, []);
    byAttribute.get(key).push(term._id);
  }

  let result = null;
  for (const group of byAttribute.values()) {
    const rows = await ProductVariation.find({ store: storeId, term: { $in: group } })
      .select("product")
      .lean();
    const ids = new Set(rows.map((row) => String(row.product)));
    result = result ? new Set([...result].filter((id) => ids.has(id))) : ids;
    if (!result.size) return [];
  }
  return [...(result || [])].map(objectIdOr).filter(Boolean);
}

async function listProducts(req, res, next) {
  try {
    const store = req.publicStore;
    const page = intArg(req.query.page, 1, 100000, 1);
    const limit = intArg(req.query.limit, 1, 60, 24);
    const sortKey = SORTS[req.query.sort] ? req.query.sort : "newest";
    const needsExpression = sortKey === "price_asc" || sortKey === "price_desc" || sortKey === "discount";

    const match = baseFilter(store._id);

    const query = String(req.query.q || "").trim().slice(0, 120);
    if (query) {
      const regex = new RegExp(escapeRegex(query), "i");
      match.$or = [{ title: regex }, { name: regex }, { shortDescription: regex }];
    }

    // category filter includes the whole subtree.
    // A facet that was asked for but does not exist in THIS store must return nothing,
    // never "ignore the filter" (that would leak the whole catalog on a foreign id).
    const categoryRaw = String(req.query.category || "").trim();
    const categoryIds = await resolveFacetIds(Category, store._id, categoryRaw);
    if (categoryRaw) {
      // getDescendantIds returns strings; aggregate() does not cast them to ObjectId,
      // so price/discount sorts would match nothing unless the $in holds real ObjectIds.
      const subtree = categoryIds.length
        ? (await getDescendantIds(Category, store._id, categoryIds)).map(objectIdOr).filter(Boolean)
        : [];
      const joined = await productIdsWithCategories(store._id, subtree);
      match.$and = [
        ...(match.$and || []),
        { $or: [{ categories: { $in: subtree } }, { _id: { $in: joined } }] },
      ];
    }

    const brandRaw = String(req.query.brand || "").trim();
    const brandIds = await resolveFacetIds(Brand, store._id, brandRaw);
    if (brandRaw) {
      // picking a parent brand must also show products filed under its sub-brands
      const subtree = brandIds.length
        ? (await getDescendantIds(Brand, store._id, brandIds)).map(objectIdOr).filter(Boolean)
        : [];
      match.brand = { $in: subtree };
    }

    const attrTermIds = [...new Set(
      String(req.query.attrs || "")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => mongoose.isValidObjectId(part))
    )].slice(0, 24);
    if (String(req.query.attrs || "").trim()) {
      const matched = await productIdsWithAttributeTerms(store._id, attrTermIds);
      match.$and = [...(match.$and || []), { _id: { $in: matched } }];
    }

    // book filters: author/publisher take slug or id, format takes print|ebook|audio.
    // A module that is off, or a value that does not resolve, matches nothing.
    const authorRaw = String(req.query.author || "").trim();
    const publisherRaw = String(req.query.publisher || "").trim();
    const formatRaw = String(req.query.format || "").trim();
    const bookFilterEcho = {};
    if (authorRaw || publisherRaw || formatRaw) {
      const live = (await bookState(store._id)).on;
      const authorIds = live && authorRaw ? await resolvePeopleIds(Author, store._id, authorRaw) : [];
      const publisherIds = live && publisherRaw ? await resolvePeopleIds(Publisher, store._id, publisherRaw) : [];
      const formats = live && formatRaw
        ? formatRaw.split(",").map((part) => part.trim().toLowerCase()).filter((key) => BOOK_FORMATS.includes(key))
        : [];
      if (authorRaw) {
        match["bookDetails.authors"] = { $in: authorIds };
        bookFilterEcho.author = authorIds;
      }
      if (publisherRaw) {
        match["bookDetails.publisher"] = { $in: publisherIds };
        bookFilterEcho.publisher = publisherIds;
      }
      if (formatRaw) {
        match["bookDetails.formats"] = { $in: formats.length ? formats : ["__none__"] };
        bookFilterEcho.format = formats;
      }
    }

    const minPrice = Number(req.query.minPrice);
    const maxPrice = Number(req.query.maxPrice);
    const priceBounds = {};
    if (Number.isFinite(minPrice)) priceBounds.$gte = minPrice;
    if (Number.isFinite(maxPrice)) priceBounds.$lte = maxPrice;
    if (Object.keys(priceBounds).length) {
      // $expr so the sale price wins over the regular price, same as the card shows
      match.$expr = { $and: [
        ...(priceBounds.$gte !== undefined ? [{ $gte: [EFFECTIVE_PRICE, priceBounds.$gte] }] : []),
        ...(priceBounds.$lte !== undefined ? [{ $lte: [EFFECTIVE_PRICE, priceBounds.$lte] }] : []),
      ] };
    }

    if (req.query.inStock === "1" || req.query.inStock === "true") match.stock = { $gt: 0 };
    if (req.query.featured === "1") match.isTopFeature = true;
    if (req.query.hotDeal === "1") match.isHotDeal = true;

    const projection = "name title slug images price regularPrice salePrice stock categories brand soldCount moq isHotDeal isTopFeature hasVariations internationalConfig.sizes createdAt bookDetails.authors bookDetails.formats";
    let rows;
    let total;

    if (needsExpression) {
      // two stages: $addFields expressions can't read a field created in the same stage
      const pipeline = [
        { $match: match },
        { $addFields: { _effectivePrice: EFFECTIVE_PRICE } },
        {
          $addFields: {
            _discountPct: {
              $cond: [
                { $gt: ["$regularPrice", 0] },
                { $divide: [{ $multiply: [{ $subtract: ["$regularPrice", "$_effectivePrice"] }, 100] }, "$regularPrice"] },
                0,
              ],
            },
          },
        },
        { $sort: SORTS[sortKey] },
        { $facet: {
          rows: [{ $skip: (page - 1) * limit }, { $limit: limit }, { $project: { name: 1, title: 1, slug: 1, images: 1, price: 1, regularPrice: 1, salePrice: 1, stock: 1, categories: 1, brand: 1, soldCount: 1, moq: 1, isHotDeal: 1, isTopFeature: 1, hasVariations: 1, "internationalConfig.sizes": 1, createdAt: 1, _effectivePrice: 1, "bookDetails.authors": 1, "bookDetails.formats": 1 } }],
          count: [{ $count: "total" }],
        } },
      ];
      const [facet] = await Product.aggregate(pipeline);
      rows = facet.rows;
      total = facet.count[0] ? facet.count[0].total : 0;
    } else {
      const [found, count] = await Promise.all([
        Product.find(match).select(projection).sort(SORTS[sortKey]).skip((page - 1) * limit).limit(limit).lean(),
        Product.countDocuments(match),
      ]);
      rows = found;
      total = count;
    }

    // join-row categories are the source of truth after a product-form save;
    // fold them in so flash-sale matching sees the full category set too
    mergeJoinedCategories(rows, await categoriesOfProducts(store._id, rows.map((row) => row._id)));

    const [international, wholesale, flashSales, ratings] = await Promise.all([
      loadSettings(store._id),
      getWholesaleSettings(store._id),
      loadLiveFlashSales(store._id),
      ratingMapFor(store._id, rows.map((row) => row._id)),
    ]);

    const cards = await attachBookCards(
      store._id,
      rows,
      rows.map((product) => {
        const card = cardOf(product, international.enabled);
        card.regularPrice = product.regularPrice || product.price || 0;
        card.salePrice = product.salePrice || 0;
        card.soldCount = product.soldCount || 0;
        card.moq = product.moq || 1;
        card.stock = Number(product.stock) || 0;
        const flash = bestFlashSale({
          sales: flashSales,
          productId: product._id,
          categoryIds: product.categories || [],
          basePaisa: toPaisa(card.price),
        });
        if (flash) {
          card.price = fromPaisa(flash.pricePaisa);
          card.flashSale = { ...publicFlashSale(flash.sale), price: card.price };
        }
        if (wholesale.enabled) card.wholesaleBadge = wholesale.badgeText;
        return withRating(card, ratings, product._id);
      })
    );

    res.json({
      store: { id: store._id, name: store.name, slug: store.slug, currency: store.currency, language: store.language },
      products: cards,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      filters: { sort: sortKey, query, category: categoryIds, brand: brandIds, attrs: attrTermIds, ...bookFilterEcho },
    });
  } catch (err) {
    next(err);
  }
}

async function listCategories(req, res, next) {
  try {
    const rows = await Category.find(baseFilter(req.publicStore._id, { status: "published", deletedAt: null }))
      .select("name slug parent ancestors level order image icon")
      .sort({ order: 1 })
      .lean();
    res.json({ categories: buildTree(rows.map((row) => ({ ...row, children: undefined }))) });
  } catch (err) {
    next(err);
  }
}

async function listBrands(req, res, next) {
  try {
    const rows = await Brand.find(baseFilter(req.publicStore._id, { status: "published", deletedAt: null }))
      .select("name slug parent ancestors level order image")
      .sort({ order: 1, name: 1 })
      .lean();
    res.json({
      brands: rows.map((row) => ({
        id: row._id,
        name: row.name,
        slug: row.slug,
        parent: row.parent || null,
        level: row.level || 0,
        image: row.image || "",
      })),
      // main brand -> sub-brand tree for the shop filter sidebar
      tree: buildTree(rows.map((row) => ({ ...row, children: undefined }))),
    });
  } catch (err) {
    next(err);
  }
}

// Attribute facets for the shop sidebar: only attributes/terms that at least
// one published product of THIS store actually uses.
async function listAttributes(req, res, next) {
  try {
    const storeId = req.publicStore._id;
    const storeOid = new mongoose.Types.ObjectId(String(storeId));
    const used = await ProductVariation.aggregate([
      { $match: { store: storeOid } },
      { $lookup: { from: "products", localField: "product", foreignField: "_id", as: "productDoc" } },
      { $unwind: "$productDoc" },
      { $match: { "productDoc.store": storeOid, "productDoc.status": "published" } },
      { $group: { _id: { attribute: "$attribute", term: "$term" }, count: { $sum: 1 } } },
      { $match: { "_id.attribute": { $ne: null }, "_id.term": { $ne: null } } },
    ]);
    if (!used.length) return res.json({ attributes: [] });

    const attributeIds = [...new Set(used.map((row) => String(row._id.attribute)))].map(objectIdOr).filter(Boolean);
    const termIds = [...new Set(used.map((row) => String(row._id.term)))].map(objectIdOr).filter(Boolean);
    const [attributes, terms] = await Promise.all([
      Attribute.find({ store: storeId, _id: { $in: attributeIds } }).select("name").lean(),
      AttributeTerm.find({ store: storeId, _id: { $in: termIds } }).select("name attribute").lean(),
    ]);

    const counts = new Map(used.map((row) => [String(row._id.term), row.count]));
    const byAttribute = new Map();
    for (const term of terms) {
      const key = String(term.attribute);
      if (!byAttribute.has(key)) byAttribute.set(key, []);
      byAttribute.get(key).push({
        id: term._id,
        name: term.name,
        count: counts.get(String(term._id)) || 0,
      });
    }

    res.json({
      attributes: attributes
        .map((attribute) => ({
          id: attribute._id,
          name: attribute.name,
          terms: (byAttribute.get(String(attribute._id)) || []).sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .filter((attribute) => attribute.terms.length)
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (err) {
    next(err);
  }
}

// header search dropdown — titles only, cheap
async function suggestions(req, res, next) {
  try {
    const q = String(req.query.q || "").trim().slice(0, 60);
    if (!q) return res.json({ suggestions: [] });
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const rows = await Product.find(baseFilter(req.publicStore._id, { $or: [{ title: regex }, { name: regex }] }))
      .select("title name slug images")
      .limit(8)
      .lean();
    res.json({
      suggestions: rows.map((row) => ({
        name: row.title || row.name,
        slug: row.slug || String(row._id),
        image: (row.images || [])[0] || "",
      })),
    });
  } catch (err) {
    next(err);
  }
}

function publicProduct(product) {
  // explicit allow-list: cost, supplierId and admin flags never leave the backend
  return {
    id: product._id,
    name: product.title || product.name || "Unnamed product",
    slug: product.slug || String(product._id),
    sku: product.sku || "",
    description: sanitizeRichText(product.description || ""),
    shortDescription: product.shortDescription || "",
    images: product.images || [],
    videoUrl: product.videoUrl || "",
    price: product.salePrice > 0 ? product.salePrice : product.regularPrice || product.price || 0,
    regularPrice: product.regularPrice || product.price || 0,
    salePrice: product.salePrice || 0,
    stock: Number(product.stock) || 0,
    inStock: (Number(product.stock) || 0) > 0,
    soldCount: product.soldCount || 0,
    moq: product.moq || 1,
    weightKg: product.weightKg || 0,
    hasVariations: !!product.hasVariations,
    hasSwatches: !!product.hasSwatches,
    lensEnabled: !!product.lensEnabled,
    categories: product.categories || [],
    brand: product.brand || null,
    internationalConfig: product.internationalConfig || null,
    createdAt: product.createdAt,
  };
}

async function getProduct(req, res, next) {
  try {
    const store = req.publicStore;
    const key = String(req.params.slug || "").trim();
    if (!key) return res.status(404).json({ message: "Product pawa jayni" });

    const filter = baseFilter(store._id, objectIdOr(key) ? { _id: objectIdOr(key) } : { slug: key.toLowerCase() });
    const product = await Product.findOne(filter)
      .populate("brand", "name slug")
      .populate("bookDetails.authors", "name nameBn slug photo status")
      .populate("bookDetails.publisher", "name nameBn slug logo status")
      .lean();
    if (!product) return res.status(404).json({ message: "Product pawa jayni" });

    // categories: legacy array ∪ join rows (see productIdsWithCategories)
    const categoryLinks = await ProductCategory.find({ store: store._id, product: product._id })
      .select("category")
      .lean();
    const categoryIds = [...new Set([
      ...(product.categories || []).map(String),
      ...categoryLinks.map((row) => String(row.category)),
    ])].map(objectIdOr).filter(Boolean);
    product.categories = categoryIds.length
      ? await Category.find({ store: store._id, _id: { $in: categoryIds } }).select("name slug").lean()
      : [];
    product.brand = product.brand || null;

    const [international, wholesale, variations, tierRows, flashSales, reviews, related, authorBooks] = await Promise.all([
      loadSettings(store._id),
      getWholesaleSettings(store._id),
      ProductVariation.find({ store: store._id, product: product._id })
        .select("termName attributeName image regularPrice salePrice stock")
        .sort({ createdAt: 1 })
        .lean(),
      ProductPriceTier.find({ store: store._id, product: product._id }).sort({ minQty: 1 }).lean(),
      loadLiveFlashSales(store._id),
      reviewSummary(store._id, product._id),
      findRelated(store._id, product, categoryIds),
      sameAuthorBooks(store._id, product),
    ]);

    const basePrice = product.salePrice > 0 ? product.salePrice : product.regularPrice || product.price || 0;
    const flash = bestFlashSale({
      sales: flashSales,
      productId: product._id,
      categoryIds: product.categories || [],
      basePaisa: toPaisa(basePrice),
    });

    // book block only exists while the module is on; populated rows are
    // already allow-listed (draft/trashed people are dropped inside)
    const book = (await bookState(store._id)).on ? publicBookBlock(product.bookDetails) : null;

    res.json({
      store: { id: store._id, name: store.name, slug: store.slug, currency: store.currency, language: store.language },
      product: publicProduct(product),
      book,
      flashSale: flash ? { ...publicFlashSale(flash.sale), price: fromPaisa(flash.pricePaisa), discountPaisa: flash.discountPaisa } : null,
      variations,
      tiers: tierRows.map((row) => ({ variation: row.variation || null, minQty: row.minQty, maxQty: row.maxQty, pricePaisa: row.pricePaisa })),
      international,
      isInternational: international.enabled && !!product.internationalConfig,
      wholesale: { enabled: wholesale.enabled === true, badgeText: wholesale.badgeText, moq: wholesale.moq, showRetailPrice: wholesale.showRetailPrice },
      reviews: reviews.summary,
      myReviews: reviews.list,
      related,
      authorBooks,
    });
  } catch (err) {
    next(err);
  }
}

async function reviewSummary(storeId, productId, limit = 10) {
  const rows = await Review.find({ store: storeId, product: productId, status: "published" })
    .select("rating title body customerName createdAt images")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  const counted = await Review.aggregate([
    { $match: { store: new mongoose.Types.ObjectId(String(storeId)), product: new mongoose.Types.ObjectId(String(productId)), status: "published" } },
    { $group: { _id: "$rating", n: { $sum: 1 } } },
  ]);
  const total = counted.reduce((sum, row) => sum + row.n, 0);
  const average = total ? counted.reduce((sum, row) => sum + row._id * row.n, 0) / total : 0;
  return {
    summary: {
      count: total,
      average: Math.round(average * 10) / 10,
      byRating: counted.reduce((acc, row) => ({ ...acc, [row._id]: row.n }), {}),
    },
    list: rows,
  };
}

// same category, best sellers first, never the product itself
async function findRelated(storeId, product, categoryIds = []) {
  if (!categoryIds.length) return [];
  const joined = await productIdsWithCategories(storeId, categoryIds);
  const rows = await Product.find(
    baseFilter(storeId, {
      _id: { $ne: product._id },
      $or: [{ categories: { $in: categoryIds } }, { _id: { $in: joined } }],
    })
  )
    .select("title name slug images price regularPrice salePrice stock soldCount hasVariations internationalConfig.sizes bookDetails.authors bookDetails.formats")
    .sort({ soldCount: -1, createdAt: -1 })
    .limit(12)
    .lean();
  const ratings = await ratingMapFor(storeId, rows.map((row) => row._id));
  return attachBookCards(
    storeId,
    rows,
    rows.map((row) => {
      const card = cardOf(row, false);
      card.soldCount = row.soldCount || 0;
      return withRating(card, ratings, row._id);
    })
  );
}

// More books by this product's first listed author — the "same author" rail
// on the book product page. Silent unless the module is on.
async function sameAuthorBooks(storeId, product, limit = 10) {
  if (!(await bookState(storeId)).on) return [];
  const authorIds = (product.bookDetails?.authors || [])
    .filter((row) => row && row._id && (!row.status || row.status === "published"))
    .map((row) => row._id);
  if (!authorIds.length) return [];

  const rows = await Product.find(
    baseFilter(storeId, {
      _id: { $ne: product._id },
      "bookDetails.authors": { $in: authorIds },
    })
  )
    .select("title name slug images price regularPrice salePrice stock soldCount hasVariations internationalConfig.sizes bookDetails.authors bookDetails.formats")
    .sort({ "bookDetails.publicationYear": -1, createdAt: -1 })
    .limit(limit)
    .lean();

  return attachBookCards(
    storeId,
    rows,
    rows.map((row) => {
      const card = cardOf(row, false);
      card.soldCount = row.soldCount || 0;
      return card;
    })
  );
}

async function listHeroSlides(req, res, next) {
  try {
    const rows = await HeroSlide.find({ store: req.publicStore._id }).lean();
    res.json({
      slides: sortForPublic(rows).map(publicSlide),
      // layout / transition "" = admin never picked one; the theme decides its own default
      ...(await readSliderSettings(req.publicStore._id)),
    });
  } catch (err) {
    next(err);
  }
}

async function listFlashSales(req, res, next) {  try {
    const store = req.publicStore;
    const sales = await loadLiveFlashSales(store._id);
    res.json({
      flashSales: sales.map((sale) => {
        const pub = publicFlashSale(sale);
        return { ...pub, endsInMs: pub.endAt ? Math.max(0, new Date(pub.endAt).getTime() - Date.now()) : null };
      }),
    });
  } catch (err) {
    next(err);
  }
}

const HOME_SECTION_PROJECTION =
  "name title slug images price regularPrice salePrice stock categories soldCount moq hasVariations internationalConfig.sizes bookDetails.authors bookDetails.formats";

function decoratedCard(product, ctx) {
  const card = cardOf(product, ctx.international.enabled);
  card.regularPrice = product.regularPrice || product.price || 0;
  card.salePrice = product.salePrice || 0;
  card.soldCount = product.soldCount || 0;
  card.moq = product.moq || 1;
  card.stock = Number(product.stock) || 0;
  const flash = bestFlashSale({
    sales: ctx.flashSales,
    productId: product._id,
    categoryIds: product.categories || [],
    basePaisa: toPaisa(card.price),
  });
  if (flash) {
    card.price = fromPaisa(flash.pricePaisa);
    card.flashSale = { ...publicFlashSale(flash.sale), price: card.price };
  }
  if (ctx.wholesale.enabled) card.wholesaleBadge = ctx.wholesale.badgeText;
  return withRating(card, ctx.ratings, product._id);
}

// Home page blocks the admin configured: category sections in saved order,
// each with its own product limit, plus the two fixed-section toggles.
async function listHome(req, res, next) {
  try {
    const store = req.publicStore;
    const [map, international, wholesale, flashSales] = await Promise.all([
      getSettingsMap(),
      loadSettings(store._id),
      getWholesaleSettings(store._id),
      loadLiveFlashSales(store._id),
    ]);

    const fixed = fixedConfig(map);
    const flags = {
      hotDeals: fixed.hot.enabled,
      newProducts: fixed.new.enabled,
    };

    const configured = parseSections(map.home_category_sections).filter((row) => row.enabled !== false);
    if (!configured.length) return res.json({ sections: [], flags, fixed });

    const cats = await Category.find({ store: store._id, deletedAt: null }).select("_id name slug").lean();
    const byId = new Map(cats.map((row) => [String(row._id), row]));
    const picked = configured
      .map((row) => ({ ...row, categoryDoc: byId.get(String(row.category)) }))
      .filter((row) => row.categoryDoc);

    const productRows = await Promise.all(
      picked.map(async (row) => {
        const subtree = (await getDescendantIds(Category, store._id, [row.categoryDoc._id]))
          .map(objectIdOr)
          .filter(Boolean);
        const joined = await productIdsWithCategories(store._id, subtree);
        return Product.find({
          store: store._id,
          status: "published",
          $or: [{ categories: { $in: subtree } }, { _id: { $in: joined } }],
        })
          .select(HOME_SECTION_PROJECTION)
          .sort({ soldCount: -1, createdAt: -1 })
          .limit(Number(row.limit) || 12)
          .lean();
      })
    );

    mergeJoinedCategories(productRows.flat(), await categoriesOfProducts(store._id, productRows.flat().map((row) => row._id)));

    const ratings = await ratingMapFor(store._id, productRows.flat().map((row) => row._id));
    const ctx = { international, wholesale, flashSales, ratings };
    const flatRows = productRows.flat();
    const flatCards = await attachBookCards(store._id, flatRows, flatRows.map((product) => decoratedCard(product, ctx)));

    let cursor = 0;
    const sections = picked
      .map((row, index) => {
        const count = productRows[index].length;
        const cards = flatCards.slice(cursor, cursor + count);
        cursor += count;
        return {
          id: row.id,
          mode: row.mode,
          columns: row.columns,
          limit: row.limit,
          category: {
            id: row.categoryDoc._id,
            name: row.categoryDoc.name,
            slug: row.categoryDoc.slug || String(row.categoryDoc._id),
          },
          products: cards,
        };
      })
      .filter((row) => row.products.length);

    res.json({
      // a category with nothing published is hidden, not shown empty
      sections,
      flags,
      fixed,
    });
  } catch (err) {
    next(err);
  }
}

async function getStoreInfo(req, res, next) {
  try {
    const store = req.publicStore;
    const [site, faviconDoc, settingsDoc, international, wholesale, social, map, menuCategories, access, books] = await Promise.all([
      SiteSetting.findOne({ store: store._id }).lean(),
      ShopFavicon.findOne({ store: store._id }).lean(),
      StoreSettings.findOne({ storeId: store._id }).select("seo").lean(),
      loadSettings(store._id),
      getWholesaleSettings(store._id),
      SocialLink.find({ store: store._id }).sort({ sortOrder: 1, name: 1 }).lean(),
      getSettingsMap(),
      Category.find({ store: store._id, deletedAt: null, status: { $ne: "trashed" } })
        .select("_id name slug")
        .lean(),
      featuresForStore(store),
      bookState(store._id),
    ]);
    const seo = (settingsDoc && settingsDoc.seo) || {};
    res.json({
      store: {
        id: store._id,
        name: store.name,
        slug: store.slug,
        currency: store.currency,
        language: store.language,
        contact: store.contact,
      },
      branding: brandingFor(store, site, faviconDoc),
      seo: {
        title: String(seo.metaTitle || "").trim(),
        description: String(seo.metaDescription || "").trim(),
        keywords: String(seo.metaKeywords || "").trim(),
      },
      international,
      features: access.features,
      // nav hints for book-capable themes: the module is live somewhere
      books: { active: books.active, levels: books.levels },
      wholesale: {
        enabled: access.features.wholesale === true && wholesale.enabled === true,
        badgeText: wholesale.badgeText,
        moq: wholesale.moq,
      },
      card: {
        addToCart: String(map.card_add_to_cart_enabled) !== "false",
        buyNow: String(map.card_buy_now_enabled) !== "false",
        checkoutPopup: String(map.card_checkout_popup_enabled) !== "false",
      },
      social: social.map((row) => ({ name: row.name, icon: row.icon || "", url: row.url })),
      menu: buildMenu(map.storefront_menu, { categories: menuCategories, language: store.language }),
      googleSeo: buildGoogleSeo(map),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getStoreInfo,
  listHome,
  listCategories,
  listBrands,
  listAttributes,
  listProducts,
  listHeroSlides,
  getProduct,
  listFlashSales,
  suggestions,
  listAuthors: peopleListHandler("author"),
  getAuthor: peopleDetailHandler("author"),
  listPublishers: peopleListHandler("publisher"),
  getPublisher: peopleDetailHandler("publisher"),
  listBookGenres,
};
