/* ------------------------------------------------------------------ *
   bookDetails validation for the product form.
   Genres are NOT part of this payload — they are ordinary categories the
   picker writes into Product.categories, so there is nothing to keep in
   sync here.
   ------------------------------------------------------------------ */
const mongoose = require("mongoose");
const Author = require("../models/Author");
const Publisher = require("../models/Publisher");
const Product = require("../models/Product");

const FORMATS = ["print", "ebook", "audio"];
const BINDINGS = ["", "paperback", "hardcover", "helical", "pdf", "epub", "audiobook", "boxed"];
const MAX_AUTHORS = 20;

function text(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function intOr(value, min, max) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

// "978-984-123-456-7" / "0-306-40615-2" -> digits only (an ISBN-10 check digit may be X)
function normalizeIsbn(raw) {
  const cleaned = String(raw || "").toUpperCase().replace(/[^0-9X]/g, "");
  if (/^\d{13}$/.test(cleaned)) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(cleaned[i]) * (i % 2 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === Number(cleaned[12]) ? cleaned : null;
  }
  if (/^\d{9}[\dX]$/.test(cleaned)) {
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(cleaned[i]) * (10 - i);
    sum += cleaned[9] === "X" ? 10 : Number(cleaned[9]);
    return sum % 11 === 0 ? cleaned : null;
  }
  return null;
}

function cleanFormats(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  list.forEach((row) => {
    const key = String(row || "").trim().toLowerCase();
    if (FORMATS.includes(key)) seen.add(key);
  });
  return FORMATS.filter((key) => seen.has(key));
}

/* ------------------------------------------------------------------ *
 * payload.bookDetails -> { ok, value } or { ok:false, message }
 * `null` value means "no book data" — the caller leaves the field unset.
 * ------------------------------------------------------------------ */
async function sanitizeBookDetails(storeId, input, existingId) {
  if (input === undefined || input === null) return { ok: true, value: undefined };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "Book details object hote hobe" };
  }

  const wantedAuthors = (Array.isArray(input.authors) ? input.authors : [])
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => String(id));
  const uniqueAuthors = [...new Set(wantedAuthors)];
  if (uniqueAuthors.length > MAX_AUTHORS) return { ok: false, message: `Ekta boite ${MAX_AUTHORS} tar beshi author na` };

  let authors = [];
  if (uniqueAuthors.length) {
    const found = await Author.find({ store: storeId, _id: { $in: uniqueAuthors }, status: { $ne: "trashed" } })
      .select("_id")
      .lean();
    const live = new Set(found.map((row) => String(row._id)));
    const missing = uniqueAuthors.filter((id) => !live.has(id));
    if (missing.length) return { ok: false, message: "Author gulo ei dokaner na — abar choose korun" };
    // keep the order the admin picked them in
    authors = uniqueAuthors;
  }

  let publisher = null;
  if (input.publisher) {
    if (!mongoose.isValidObjectId(input.publisher)) return { ok: false, message: "Publisher id thik na" };
    const row = await Publisher.findOne({ store: storeId, _id: input.publisher, status: { $ne: "trashed" } })
      .select("_id")
      .lean();
    if (!row) return { ok: false, message: "Publisher ei dokaner na" };
    publisher = row._id;
  }

  let isbn = "";
  if (input.isbn !== undefined && input.isbn !== null && String(input.isbn).trim() !== "") {
    const normalized = normalizeIsbn(input.isbn);
    if (!normalized) return { ok: false, message: "ISBN 10 ba 13 digit er hote hobe (check digit milche na)" };
    const clash = await Product.findOne({
      store: storeId,
      "bookDetails.isbn": normalized,
      ...(existingId ? { _id: { $ne: existingId } } : {}),
    })
      .select("_id title")
      .lean();
    if (clash) {
      return { ok: false, message: `ei ISBN ta "${clash.title || clash._id}" product e already ache` };
    }
    isbn = normalized;
  }

  const binding = text(input.binding, 40).toLowerCase();
  if (binding && !BINDINGS.includes(binding)) return { ok: false, message: "Binding value jana na" };

  return {
    ok: true,
    value: {
      authors,
      publisher,
      translator: text(input.translator, 160),
      editor: text(input.editor, 160),
      isbn,
      edition: text(input.edition, 40),
      publicationYear: intOr(input.publicationYear, 800, 2200),
      pages: intOr(input.pages, 0, 100000),
      language: text(input.language, 40),
      binding,
      formats: cleanFormats(input.formats),
    },
  };
}

// Ebook/audio-only products carry no physical stock — the catalog already
// shows a Digital badge for productType "digital".
function productTypeForFormats(formats, current) {
  if (!Array.isArray(formats) || !formats.length) return current;
  return formats.length === 1 && formats[0] !== "print" ? "digital" : "physical";
}

module.exports = { sanitizeBookDetails, normalizeIsbn, cleanFormats, productTypeForFormats, FORMATS, BINDINGS };
