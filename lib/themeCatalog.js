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

function themesDir() {
  return process.env.THEMES_DIR || path.resolve(__dirname, "../../ecommerce-frontend/themes");
}

function readTheme(name) {
  if (!NAME_RE.test(String(name || ""))) return null;
  try {
    const raw = fs.readFileSync(path.join(themesDir(), name, "theme.json"), "utf8");
    const meta = JSON.parse(raw);
    return {
      name: String(meta.name || name),
      label: String(meta.label || name),
      description: String(meta.description || ""),
      tokens: meta.tokens && typeof meta.tokens === "object" ? meta.tokens : {},
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
    return [{ name: "theme1", label: "Theme 1", description: "", tokens: {} }];
  }
  const themes = entries.map((row) => readTheme(row.name)).filter(Boolean);
  return themes.length ? themes.sort((a, b) => a.name.localeCompare(b.name)) : [{ name: "theme1", label: "Theme 1", description: "", tokens: {} }];
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
