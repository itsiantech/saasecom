/* Storefront menu — a 3-level tree of storefront pages and categories.
 * Stored as JSON in Settings (key: storefront_menu). Only type + ref are
 * persisted; labels and links are resolved from the live page list and
 * Category collection on every read, so a renamed category stays correct. */

const PAGES = [
  { ref: "home", label: "Home", bn: "হোম", path: "/" },
  { ref: "shop", label: "Shop", bn: "শপ", path: "/shop" },
  { ref: "cart", label: "Cart", bn: "কার্ট", path: "/cart" },
  { ref: "checkout", label: "Checkout", bn: "চেকআউট", path: "/checkout" },
  { ref: "account", label: "Account", bn: "আমার অ্যাকাউন্ট", path: "/account" },
  { ref: "track-order", label: "Track order", bn: "অর্ডার ট্র্যাক", path: "/track-order" },
  { ref: "wishlist", label: "Wishlist", bn: "উইশলিস্ট", path: "/wishlist" },
  { ref: "contact", label: "Contact", bn: "যোগাযোগ", path: "/contact" },
];

const PAGE_BY_REF = new Map(PAGES.map((page) => [page.ref, page]));
const MAX_DEPTH = 3;
const MAX_ITEMS = 120;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function parseMenu(value) {
  if (Array.isArray(value)) return value;
  const raw = String(value == null ? "" : value).trim();
  if (!raw || raw.length > 64 * 1024) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Persisted shape: { id, type: "page"|"category", ref, children }. Unknown
// pages, foreign categories, duplicates and anything past level 3 are dropped.
function normalizeMenu(value, options = {}) {
  const allowed = options.allowedCategoryIds
    ? new Set(options.allowedCategoryIds.map(String))
    : null;
  const seenRefs = new Set();
  const seenIds = new Set();
  let count = 0;
  let nextId = 1;

  function nextGeneratedId() {
    let id = "m" + nextId++;
    while (seenIds.has(id)) id = "m" + nextId++;
    return id;
  }

  function walk(rows, depth) {
    if (!Array.isArray(rows) || depth >= MAX_DEPTH) return [];
    const out = [];
    rows.forEach((row) => {
      if (!row || typeof row !== "object" || count >= MAX_ITEMS) return;
      const type = row.type === "page" || row.type === "category" ? row.type : null;
      if (!type) return;
      const ref = String(row.ref || "").trim().slice(0, 64);
      if (!ref) return;
      if (type === "page" && !PAGE_BY_REF.has(ref)) return;
      if (type === "category") {
        if (!OBJECT_ID_RE.test(ref) && !(allowed && allowed.has(ref))) return;
        if (allowed && !allowed.has(ref)) return;
      }
      const refKey = type + ":" + ref;
      if (seenRefs.has(refKey)) return;
      seenRefs.add(refKey);
      count += 1;

      let id = String(row.id || "").trim();
      if (!ID_RE.test(id) || seenIds.has(id)) id = nextGeneratedId();
      seenIds.add(id);

      out.push({ id, type, ref, children: walk(row.children, depth + 1) });
    });
    return out;
  }

  return walk(parseMenu(value), 0);
}

// Display tree: page/category names, links and Bengali/English labels.
function decorateMenu(nodes, options = {}) {
  const categories = options.categories || [];
  const byId = new Map(categories.map((row) => [String(row._id || row.id), row]));
  const bengali = options.language === "bn";

  function walk(rows) {
    const out = [];
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      let label = "";
      let path = "";
      if (row.type === "page") {
        const page = PAGE_BY_REF.get(row.ref);
        if (!page) return;
        label = bengali ? page.bn : page.label;
        path = page.path;
      } else if (row.type === "category") {
        const category = byId.get(String(row.ref));
        if (!category) return;
        label = String(category.name || "").trim() || "Untitled";
        path = "/shop?category=" + encodeURIComponent(category.slug || String(category._id || row.ref));
      } else {
        return;
      }
      out.push({
        id: row.id,
        type: row.type,
        ref: row.ref,
        label,
        path,
        children: walk(row.children),
      });
    });
    return out;
  }

  return walk(nodes);
}

function buildMenu(value, options = {}) {
  return decorateMenu(normalizeMenu(value, options), options);
}

module.exports = {
  PAGES,
  MAX_DEPTH,
  MAX_ITEMS,
  parseMenu,
  normalizeMenu,
  decorateMenu,
  buildMenu,
};