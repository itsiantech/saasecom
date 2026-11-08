const Settings = require("../models/Settings");

const SETTINGS_KEY = "landingBranding";
const TITLE_MAX = 140;
const TEXT_MAX = 240;

const DEFAULT_TITLE = "LUXE — নিজের অনলাইন দোকান, মিনিটে";
const DEFAULT_FOOTER_LEFT = "ছোট ব্যবসার জন্য সহজ অনলাইন দোকান।";
const DEFAULT_FOOTER_RIGHT = "Made for small shops in Bangladesh";

function defaultCopyright() {
  return "© " + new Date().getFullYear() + " LUXE — সর্বস্বত্ব সংরক্ষিত";
}

function defaults() {
  return {
    title: DEFAULT_TITLE,
    logo: "",
    favicon: "",
    footerLeft: DEFAULT_FOOTER_LEFT,
    copyright: defaultCopyright(),
    footerRight: DEFAULT_FOOTER_RIGHT,
  };
}

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// Uploaded files land under /uploads/branding; /uploads/settings is allowed for
// values picked before this panel existed. Anything else must be http(s).
const IMAGE_RE = /^(https?:\/\/[^\s"'<>]{1,500}|\/uploads\/(?:branding|settings)\/[A-Za-z0-9._-]{1,200})$/i;

function cleanImage(value) {
  if (typeof value !== "string") return "";
  const url = value.trim();
  return IMAGE_RE.test(url) ? url : "";
}

function normalizeBranding(raw) {
  const out = defaults();
  if (!raw || typeof raw !== "object") return out;

  if (typeof raw.title === "string") out.title = cleanText(raw.title, TITLE_MAX) || DEFAULT_TITLE;
  if (typeof raw.footerLeft === "string") out.footerLeft = cleanText(raw.footerLeft, TEXT_MAX);
  if (typeof raw.copyright === "string") out.copyright = cleanText(raw.copyright, TEXT_MAX);
  if (typeof raw.footerRight === "string") out.footerRight = cleanText(raw.footerRight, TEXT_MAX);
  if (typeof raw.logo === "string") out.logo = cleanImage(raw.logo);
  if (typeof raw.favicon === "string") out.favicon = cleanImage(raw.favicon);

  return out;
}

function parseBranding(value) {
  try {
    return normalizeBranding(JSON.parse(value || "{}"));
  } catch {
    return defaults();
  }
}

async function getBranding() {
  const doc = await Settings.findOne({ key: SETTINGS_KEY });
  return doc ? parseBranding(doc.value) : defaults();
}

async function saveBranding(patch) {
  const current = await getBranding();
  const next = normalizeBranding({ ...current, ...(patch || {}) });
  await Settings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: { value: JSON.stringify(next) } },
    { upsert: true }
  );
  return next;
}

module.exports = {
  SETTINGS_KEY,
  DEFAULT_TITLE,
  DEFAULT_FOOTER_LEFT,
  DEFAULT_FOOTER_RIGHT,
  defaults,
  normalizeBranding,
  parseBranding,
  cleanImage,
  getBranding,
  saveBranding,
};
