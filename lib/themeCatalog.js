/* ------------------------------------------------------------------ *
 * Theme catalog for the Appearance admin module.
 * The themes themselves live in the storefront repo (themes/<name>/
 * theme.json); this reads that folder so the panel and the storefront
 * never disagree about which themes or default tokens exist.
 * THEMES_DIR overrides the location when both apps are not siblings.
 * ------------------------------------------------------------------ */
const fs = require("fs");
const path = require("path");

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// Deployed checkouts rename the storefront (e.g. rashacart-frontend), so look
// at the sibling folders instead of assuming the local ecommerce-frontend name.
let cachedDir = "";

function findThemesDir() {
  const repoRoot = path.resolve(__dirname, "..");
  const parent = path.dirname(repoRoot);
  let siblings = [];
  try {
    siblings = fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((row) => row.isDirectory())
      .map((row) => row.name);
  } catch {
    return "";
  }
  siblings.sort((a, b) => (a === "ecommerce-frontend" ? -1 : b === "ecommerce-frontend" ? 1 : 0));
  for (const name of siblings) {
    const dir = path.join(parent, name, "themes");
    try {
      if (fs.statSync(dir).isDirectory()) return dir;
    } catch {
      // not a storefront checkout
    }
  }
  return "";
}

function themesDir() {
  if (process.env.THEMES_DIR) return process.env.THEMES_DIR;
  if (!cachedDir) cachedDir = findThemesDir() || path.resolve(__dirname, "../../ecommerce-frontend/themes");
  return cachedDir;
}

// theme.json opts into storefront modules two ways: a plain list (["builder"])
// means "supported", a map ({ books: ["product", "pages"] }) declares which
// levels of that module the theme actually renders.
const SUPPORT_ALL = ["*"];

function normalizeModules(raw) {
  const support = {};
  if (Array.isArray(raw)) {
    raw.forEach((row) => {
      const key = String(row || "").trim();
      if (key) support[key] = [...SUPPORT_ALL];
    });
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      const name = String(key || "").trim();
      if (!name) continue;
      if (value === true) support[name] = [...SUPPORT_ALL];
      else if (Array.isArray(value)) support[name] = value.map((row) => String(row).trim()).filter(Boolean);
      else if (typeof value === "string") support[name] = [value.trim()].filter(Boolean);
      else support[name] = [];
    }
  }
  return support;
}

function readTheme(name) {
  if (!NAME_RE.test(String(name || ""))) return null;
  try {
    const raw = fs.readFileSync(path.join(themesDir(), name, "theme.json"), "utf8");
    const meta = JSON.parse(raw);
    const moduleSupport = normalizeModules(meta.modules);
    // `modules` may stay a plain list (the storefront gates on includes()),
    // while `moduleSupport` refines it: { books: ["product", "pages"] }.
    if (meta.moduleSupport && typeof meta.moduleSupport === "object" && !Array.isArray(meta.moduleSupport)) {
      Object.assign(moduleSupport, normalizeModules(meta.moduleSupport));
    }
    return {
      name: String(meta.name || name),
      label: String(meta.label || name),
      description: String(meta.description || ""),
      tokens: meta.tokens && typeof meta.tokens === "object" ? meta.tokens : {},
      // themes opt into storefront modules (builder, books, …); absent = none
      modules: Object.keys(moduleSupport),
      moduleSupport,
      // a book-first theme turns the books module on when it is published
      bookFirst: meta.bookFirst === true,
    };
  } catch {
    return null;
  }
}

function listThemes() {
  let entries = [];
  try {
    entries = fs.readdirSync(themesDir(), { withFileTypes: true }).filter((row) => row.isDirectory());
  } catch {
    return [{ name: "theme1", label: "Theme 1", description: "", tokens: {}, modules: [], moduleSupport: {}, bookFirst: false }];
  }
  const themes = entries.map((row) => readTheme(row.name)).filter(Boolean);
  return themes.length ? themes.sort((a, b) => a.name.localeCompare(b.name)) : [{ name: "theme1", label: "Theme 1", description: "", tokens: {}, modules: [], moduleSupport: {}, bookFirst: false }];
}

function findTheme(name) {
  return listThemes().find((theme) => theme.name === String(name || ""));
}

// only the active theme's own token keys, string values — a store must not be
// able to inject arbitrary CSS through the tokens map
function sanitizeTokens(theme, tokens) {
  const allowed = new Set(Object.keys((theme && theme.tokens) || {}));
  const clean = {};
  for (const [key, value] of Object.entries(tokens || {})) {
    if (!allowed.has(key)) continue;
    const text = String(value == null ? "" : value).trim().slice(0, 200);
    if (text) clean[key] = text;
  }
  return clean;
}

function mergeTokens(theme, overrides) {
  return { ...((theme && theme.tokens) || {}), ...sanitizeTokens(theme, overrides) };
}

module.exports = { listThemes, findTheme, sanitizeTokens, mergeTokens, NAME_RE };
