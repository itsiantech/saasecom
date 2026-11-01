/* Home page category sections — stored as a JSON string in Settings
 * (key: home_category_sections), one row per category block. */

const MODES = ["slider", "drag", "grid"];
const COLUMNS = [4, 5, 6];
const MIN_LIMIT = 4;
const MAX_LIMIT = 24;
const DEFAULT_LIMIT = 12;

function parseSections(value) {
  if (Array.isArray(value)) return value;
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// allowedCategoryIds null hole category check skip (read path e caller nijei filter kore)
function normalizeSections(raw, allowedCategoryIds) {
  const allowed = allowedCategoryIds ? new Set(allowedCategoryIds.map(String)) : null;
  const seen = new Set();
  const rows = [];

  parseSections(raw).forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const category = String(row.category || "").trim();
    if (!category) return;
    if (allowed && !allowed.has(category)) return;
    if (seen.has(category)) return;
    seen.add(category);

    rows.push({
      id: String(row.id || "").trim().slice(0, 40) || "s" + (index + 1),
      category,
      mode: MODES.includes(row.mode) ? row.mode : "grid",
      columns: COLUMNS.includes(Number(row.columns)) ? Number(row.columns) : 4,
      limit: clampInt(row.limit, MIN_LIMIT, MAX_LIMIT, DEFAULT_LIMIT),
      enabled: row.enabled !== false && row.enabled !== "false",
    });
  });

  return rows;
}

module.exports = {
  MODES,
  COLUMNS,
  MIN_LIMIT,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  parseSections,
  normalizeSections,
};
