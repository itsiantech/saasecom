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

/* The two fixed sections (হট ডিল, নতুন পণ্য) stay above the category blocks
 * but take the same layout knobs: mode / columns / limit / enabled. Each knob
 * is its own Settings key so the older enabled-only rows keep working. */
const FIXED_SECTIONS = [
  { id: "hot", base: "home_hot_deals", defaultLimit: 6 },
  { id: "new", base: "home_new_products", defaultLimit: 12 },
];

const FIXED_KEYS = FIXED_SECTIONS.flatMap(({ base }) => [
  `${base}_mode`,
  `${base}_columns`,
  `${base}_limit`,
]);

function fixedSectionDefaults(base) {
  return { mode: "grid", columns: 4, limit: (FIXED_SECTIONS.find((row) => row.base === base) || {}).defaultLimit || DEFAULT_LIMIT };
}

function normalizeFixedValue(key, value) {
  const section = FIXED_SECTIONS.find((row) => key.startsWith(row.base + "_"));
  if (!section) return value;
  const fallback = fixedSectionDefaults(section.base);
  if (key === section.base + "_mode") {
    const mode = String(value == null ? "" : value).trim().toLowerCase();
    return MODES.includes(mode) ? mode : fallback.mode;
  }
  if (key === section.base + "_columns") {
    return String(COLUMNS.includes(Number(value)) ? Number(value) : fallback.columns);
  }
  return String(clampInt(value, MIN_LIMIT, MAX_LIMIT, fallback.limit));
}

function fixedConfig(map = {}) {
  const out = {};
  FIXED_SECTIONS.forEach(({ id, base, defaultLimit }) => {
    out[id] = {
      enabled: String(map[base + "_enabled"]) !== "false",
      mode: MODES.includes(map[base + "_mode"]) ? map[base + "_mode"] : "grid",
      columns: COLUMNS.includes(Number(map[base + "_columns"])) ? Number(map[base + "_columns"]) : 4,
      limit: clampInt(map[base + "_limit"], MIN_LIMIT, MAX_LIMIT, defaultLimit),
    };
  });
  return out;
}

module.exports = {
  MODES,
  COLUMNS,
  MIN_LIMIT,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  parseSections,
  normalizeSections,
  FIXED_KEYS,
  fixedSectionDefaults,
  normalizeFixedValue,
  fixedConfig,
};
