const crypto = require("crypto");
const Appearance = require("../models/Appearance");
const User = require("../models/User");
const { listThemes, findTheme, sanitizeTokens, mergeTokens } = require("../lib/themeCatalog");

/* ------------------------------------------------------------------ *
 * Appearance: pick a theme + override its design tokens, preview the
 * draft on the real storefront, publish, roll back to a revision.
 * Tokens are whitelisted against the theme's own theme.json, so nothing
 * outside the declared design system can reach the storefront CSS.
 * ------------------------------------------------------------------ */

const DEFAULT_THEME = "theme1";
const REVISION_LIMIT = 10;
const PREVIEW_MINUTES = 30;

async function actor(req) {
  try {
    const user = await User.findById(req.user.id).select("name email").lean();
    return (user && (user.email || user.name)) || String(req.user.id);
  } catch {
    return String(req.user.id);
  }
}

async function loadOrCreate(storeId) {
  const existing = await Appearance.findOne({ store: storeId });
  if (existing) return existing;
  const first = (listThemes()[0] || { name: DEFAULT_THEME }).name;
  return Appearance.create({
    store: storeId,
    draft: { theme: first, tokens: {} },
    published: { theme: first, tokens: {} },
  });
}

function themeFor(name) {
  return findTheme(name) || findTheme(DEFAULT_THEME) || (listThemes()[0] || { name: DEFAULT_THEME, label: DEFAULT_THEME, tokens: {} });
}

function effective(name, overrides) {
  const theme = themeFor(name);
  const clean = sanitizeTokens(theme, overrides);
  return { theme: theme.name, label: theme.label, tokens: mergeTokens(theme, clean), overrides: clean };
}

function sameBlock(a, b) {
  const left = effective(a.theme, a.tokens);
  const right = effective(b.theme, b.tokens);
  return left.theme === right.theme && JSON.stringify(left.tokens) === JSON.stringify(right.tokens);
}

async function getAppearance(req, res, next) {
  try {
    const doc = await loadOrCreate(req.store._id);
    res.json({
      themes: listThemes(),
      draft: {
        ...effective(doc.draft.theme, doc.draft.tokens),
        savedAt: doc.draft.savedAt,
        savedBy: doc.draft.savedBy,
      },
      published: {
        ...effective(doc.published.theme, doc.published.tokens),
        publishedAt: doc.published.publishedAt,
        publishedBy: doc.published.publishedBy,
      },
      revisions: (doc.revisions || [])
        .slice(-REVISION_LIMIT)
        .reverse()
        .map((row) => ({ id: String(row._id), ...effective(row.theme, row.tokens), publishedAt: row.publishedAt, publishedBy: row.publishedBy })),
      dirty: !sameBlock(doc.draft, doc.published),
    });
  } catch (err) {
    next(err);
  }
}

async function saveDraft(req, res, next) {
  try {
    const theme = findTheme((req.body || {}).theme);
    if (!theme) return res.status(400).json({ message: "Theme pawa jayni" });
    const doc = await loadOrCreate(req.store._id);
    doc.draft = {
      theme: theme.name,
      tokens: sanitizeTokens(theme, (req.body || {}).tokens),
      savedAt: new Date(),
      savedBy: await actor(req),
    };
    await doc.save();
    res.json({ draft: { ...effective(doc.draft.theme, doc.draft.tokens), savedAt: doc.draft.savedAt, savedBy: doc.draft.savedBy } });
  } catch (err) {
    next(err);
  }
}

async function resetDraft(req, res, next) {
  try {
    const doc = await loadOrCreate(req.store._id);
    doc.draft = {
      theme: doc.published.theme || DEFAULT_THEME,
      tokens: doc.published.tokens || {},
      savedAt: new Date(),
      savedBy: await actor(req),
    };
    await doc.save();
    res.json({ draft: { ...effective(doc.draft.theme, doc.draft.tokens), savedAt: doc.draft.savedAt, savedBy: doc.draft.savedBy } });
  } catch (err) {
    next(err);
  }
}

async function publishDraft(req, res, next) {
  try {
    const doc = await loadOrCreate(req.store._id);
    if (!doc.draft.theme) return res.status(400).json({ message: "Draft theme nei" });
    if (sameBlock(doc.draft, doc.published)) return res.status(400).json({ message: "Draft ar published ek-i, publish korar kichu nei" });

    const now = new Date();
    const who = await actor(req);
    doc.published = { theme: doc.draft.theme, tokens: doc.draft.tokens || {}, publishedAt: now, publishedBy: who };
    doc.revisions.push({ theme: doc.published.theme, tokens: doc.published.tokens, publishedAt: now, publishedBy: who });
    if (doc.revisions.length > REVISION_LIMIT) doc.revisions = doc.revisions.slice(-REVISION_LIMIT);
    // a live draft token must stop being served once the draft is live
    doc.previewToken = "";
    doc.previewExpiresAt = null;
    await doc.save();

    res.json({
      published: { ...effective(doc.published.theme, doc.published.tokens), publishedAt: now, publishedBy: who },
    });
  } catch (err) {
    next(err);
  }
}

async function restoreRevision(req, res, next) {
  try {
    const doc = await loadOrCreate(req.store._id);
    const revision = (doc.revisions || []).find((row) => String(row._id) === String(req.params.id));
    if (!revision) return res.status(404).json({ message: "Revision pawa jayni" });
    doc.draft = {
      theme: revision.theme,
      tokens: revision.tokens || {},
      savedAt: new Date(),
      savedBy: await actor(req),
    };
    await doc.save();
    res.json({ draft: { ...effective(doc.draft.theme, doc.draft.tokens), savedAt: doc.draft.savedAt, savedBy: doc.draft.savedBy } });
  } catch (err) {
    next(err);
  }
}

async function createPreview(req, res, next) {
  try {
    const doc = await loadOrCreate(req.store._id);
    const token = crypto.randomBytes(18).toString("hex");
    const expiresAt = new Date(Date.now() + PREVIEW_MINUTES * 60 * 1000);
    doc.previewToken = token;
    doc.previewExpiresAt = expiresAt;
    await doc.save();

    const store = req.store;
    const base = String(process.env.STOREFRONT_URL || "http://localhost:3000").replace(/\/+$/, "");
    const onDomain = store.customDomainStatus === "verified" && store.customDomain;
    const url = onDomain
      ? `https://${store.customDomain}/?appearance=${token}`
      : `${base}/?store=${encodeURIComponent(store.slug)}&appearance=${token}`;

    res.json({ token, expiresAt, url, minutes: PREVIEW_MINUTES });
  } catch (err) {
    next(err);
  }
}

// public: what the storefront renders. A valid preview token swaps in the draft.
async function publicAppearance(req, res, next) {
  try {
    const doc = await Appearance.findOne({ store: req.publicStore._id }).lean();
    const token = String(req.query.preview || "").trim();
    const preview =
      token &&
      doc &&
      doc.previewToken === token &&
      doc.previewExpiresAt &&
      new Date(doc.previewExpiresAt).getTime() > Date.now();

    const source = preview ? doc.draft : doc && doc.published;
    const result = effective(source && source.theme, source && source.tokens);
    res.json({
      appearance: {
        theme: result.theme,
        label: result.label,
        tokens: result.tokens,
        preview: Boolean(preview),
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAppearance,
  saveDraft,
  resetDraft,
  publishDraft,
  restoreRevision,
  createPreview,
  publicAppearance,
};
