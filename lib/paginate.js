/* ------------------------------------------------------------------ *
 * One pager for every list in the app (admin + storefront).
 * Pagination is always server side: the caller filters, we count, skip
 * and limit. A page past the last one returns no rows but reports the
 * real `pages` + `outOfRange` so the UI can fix the URL instead of
 * silently showing an empty table.
 * ------------------------------------------------------------------ */

function parsePage(query, opts = {}) {
  const defaultLimit = opts.defaultLimit || 20;
  const maxLimit = opts.maxLimit || 100;
  const raw = query || {};
  const page = Math.min(1e6, Math.max(1, parseInt(raw.page, 10) || 1));
  const limit = Math.min(maxLimit, Math.max(1, parseInt(raw.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
}

// `allowed` maps the client sort key to the field it may sort by.
// "-name" means descending; anything unknown falls back to `fallback`.
function parseSort(query, allowed, fallback) {
  const raw = String((query || {}).sort || "").trim().toLowerCase();
  const desc = raw.startsWith("-");
  const field = allowed[desc ? raw.slice(1) : raw];
  return field ? { [field]: desc ? -1 : 1 } : { ...fallback };
}

function pagesOf(total, limit) {
  return Math.max(1, Math.ceil(total / Math.max(1, limit)));
}

function pageMeta({ page, limit, total }) {
  const pages = pagesOf(total, limit);
  return {
    page,
    limit,
    total,
    pages,
    outOfRange: page > pages,
    hasPrev: page > 1,
    hasNext: page < pages,
  };
}

module.exports = { parsePage, parseSort, pagesOf, pageMeta };
