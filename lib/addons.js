const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");
const Addon = require("../models/Addon");

// Add-on files stay OUTSIDE public/ — they are served only through the
// /addons route in server.js, which sends a sandbox CSP with every file.
const ADDON_DIR = path.join(__dirname, "..", "storage", "addons");

const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 500;

// SVG is deliberately absent: it is markup that can carry script, and an
// add-on page must not be able to plant executable markup on our origin.
const ALLOWED_EXT = new Set([
  ".html", ".css", ".js", ".mjs", ".json", ".txt", ".map",
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico",
  ".woff", ".woff2", ".ttf",
]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico"]);

function bad(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 41)
    .replace(/-+$/g, "");
}

// Zip-slip guard: only plain relative paths inside the package survive.
function safeEntryName(raw) {
  const name = String(raw || "").replace(/\\/g, "/");
  if (!name || name.startsWith("/") || /^[a-z]:/i.test(name)) return null;
  const parts = name.split("/");
  if (parts.some((p) => p === ".." || p === "")) return null;
  const clean = parts.filter((p) => p !== ".").join("/");
  return clean || null;
}

function parseManifest(text) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw bad("manifest.json পড়া যায়নি — বৈধ JSON দিন");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw bad("manifest.json অবজেক্ট হতে হবে");
  }
  const name = String(manifest.name || "").trim();
  if (!name || name.length > 80) throw bad("manifest-এ name দিন (সর্বোচ্চ ৮০ অক্ষর)");

  const key = slugify(manifest.key || manifest.nameEn || name);
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(key)) {
    throw bad("manifest-এ key দিন — ইংরেজি ছোট হাতের অক্ষর/সংখ্যা/হাইফেন (যেমন: my-addon)");
  }

  const entry = safeEntryName(manifest.entry);
  if (!entry || path.extname(entry).toLowerCase() !== ".html") {
    throw bad("manifest-এ entry দিন — একটি .html ফাইলের আপেক্ষিক পাথ");
  }

  let icon = "";
  if (manifest.icon !== undefined && manifest.icon !== null && String(manifest.icon).trim() !== "") {
    icon = safeEntryName(manifest.icon);
    if (!icon || !IMAGE_EXT.has(path.extname(icon).toLowerCase())) {
      throw bad("icon হতে হবে প্যাকেজের ভেতরের একটি ছবি (png/jpg/webp/gif/ico)");
    }
  }

  return {
    key,
    name,
    nameEn: String(manifest.nameEn || "").trim().slice(0, 80),
    description: String(manifest.description || "").trim().slice(0, 300),
    version: String(manifest.version || "1.0.0").trim().slice(0, 20) || "1.0.0",
    icon,
    entry,
  };
}

// Reads the zip fully in memory and returns validated files; throws on any
// unsafe path, forbidden extension, or size/count limit.
function inspectZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw bad("ফাইলটি বৈধ zip নয়");
  }
  if (buffer.length > MAX_ZIP_BYTES) throw bad("zip সর্বোচ্চ ২০MB হতে পারে");

  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw bad("zip ফাইলটি পড়া যায়নি");
  }
  const entries = zip.getEntries();
  const files = [];
  const names = new Set();
  let total = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = safeEntryName(entry.entryName);
    if (!name) throw bad("zip-এ অনিরাপদ পাথ আছে: " + String(entry.entryName).slice(0, 80));
    if (names.has(name)) throw bad("zip-এ একই নামের ফাইল দুইবার আছে: " + name);
    names.add(name);
    const ext = path.extname(name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) throw bad("এই ধরনের ফাইল অনুমোদিত নয়: " + name);
    if (entry.header.size > MAX_FILE_BYTES) throw bad("ফাইল অনেক বড় (সর্বোচ্চ ১০MB): " + name);
    total += entry.header.size;
    if (total > MAX_TOTAL_BYTES) throw bad("zip খোলার পর মোট সাইজ ৫০MB ছাড়িয়ে গেছে");
    if (files.length >= MAX_FILES) throw bad("zip-ে ফাইল সংখ্যা অনেক বেশি (সর্বোচ্চ ৫০০)");
    files.push({ name, entry });
  }
  if (!files.length) throw bad("zip খালি");

  const manifestEntry = files.find((f) => f.name === "manifest.json");
  if (!manifestEntry) throw bad("zip-এর রুটে manifest.json থাকতে হবে");
  const manifest = parseManifest(manifestEntry.entry.getData().toString("utf8"));
  if (!names.has(manifest.entry)) throw bad("entry ফাইলটি zip-এ নেই: " + manifest.entry);
  if (manifest.icon && !names.has(manifest.icon)) throw bad("icon ফাইলটি zip-এ নেই: " + manifest.icon);

  const resolved = files.map((f) => {
    const data = f.entry.getData();
    if (data.length > MAX_FILE_BYTES) throw bad("ফাইল অনেক বড় (সর্বোচ্চ ১০MB): " + f.name);
    return { name: f.name, data };
  });
  return { manifest, files: resolved, totalBytes: resolved.reduce((s, f) => s + f.data.length, 0) };
}

async function installAddon(buffer, userId, preInspected) {
  const { manifest, files, totalBytes } = preInspected || inspectZip(buffer);
  const dir = path.join(ADDON_DIR, manifest.key);
  if (!path.resolve(dir).startsWith(path.resolve(ADDON_DIR) + path.sep)) {
    throw bad("অনিরাপদ পাথ");
  }
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(dir, { recursive: true });
  for (const file of files) {
    const target = path.join(dir, file.name);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, file.data);
  }
  const addon = await Addon.findOneAndUpdate(
    { key: manifest.key },
    {
      $set: {
        name: manifest.name,
        nameEn: manifest.nameEn,
        description: manifest.description,
        version: manifest.version,
        icon: manifest.icon,
        entry: manifest.entry,
        fileCount: files.length,
        totalBytes,
        uploadedBy: userId || null,
      },
      $setOnInsert: { status: "active" },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return addon;
}

async function removeAddonFiles(key) {
  const dir = path.join(ADDON_DIR, String(key || ""));
  if (!path.resolve(dir).startsWith(path.resolve(ADDON_DIR) + path.sep)) return;
  await fs.promises.rm(dir, { recursive: true, force: true });
}

function addonUrl(addon, rel) {
  return rel ? "/addons/" + addon.key + "/" + rel.split("/").map(encodeURIComponent).join("/") : "";
}

// what the store dashboard receives — only active, not-disabled packages
async function listForStore(store) {
  const disabled = new Set((store && store.disabledAddons) || []);
  const addons = await Addon.find({ status: "active" }).sort({ createdAt: 1 });
  return addons
    .filter((a) => !disabled.has(a.key))
    .map((a) => ({
      key: a.key,
      name: a.name,
      nameEn: a.nameEn,
      description: a.description,
      version: a.version,
      icon: addonUrl(a, a.icon),
      entry: addonUrl(a, a.entry),
    }));
}

function adminView(addon, enabledStores) {
  return {
    id: String(addon._id),
    key: addon.key,
    name: addon.name,
    nameEn: addon.nameEn,
    description: addon.description,
    version: addon.version,
    status: addon.status,
    icon: addonUrl(addon, addon.icon),
    entry: addonUrl(addon, addon.entry),
    fileCount: addon.fileCount,
    totalBytes: addon.totalBytes,
    enabledStores: enabledStores === undefined ? null : enabledStores,
    createdAt: addon.createdAt,
    updatedAt: addon.updatedAt,
  };
}

module.exports = {
  ADDON_DIR,
  MAX_ZIP_BYTES,
  inspectZip,
  parseManifest,
  safeEntryName,
  slugify,
  installAddon,
  removeAddonFiles,
  listForStore,
  adminView,
  addonUrl,
};