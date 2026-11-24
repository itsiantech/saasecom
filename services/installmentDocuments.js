/* ==========================================================================
   Private NID document vault for retail EMI applications.
   - bytes live in storage/private (never under public/)
   - AES-256-GCM at rest via lib/secretBox.encryptBuffer
   - an upload returns a short-lived token; the application form sends the
     token back with /apply and only then is the file attached to an app
   - retention purge deletes both the row and the file
   ========================================================================== */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const mongoose = require("mongoose");
const InstallmentDocument = require("../models/InstallmentDocument");
const InstallmentApplication = require("../models/InstallmentApplication");
const { sniffImage } = require("../middleware/upload");
const { encryptBuffer, decryptBuffer } = require("../lib/secretBox");
const { getInstallmentSettings } = require("../lib/installmentSettings");

const ROOT = path.join(__dirname, "..", "storage", "private", "installment-documents");
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_DOCS = 4;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const CLOSED_STATUSES = ["rejected", "cancelled", "expired", "completed"];

function documentError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function safeFilename(value) {
  return String(value || "")
    .replace(/[^\w.\- ]+/g, "_")
    .trim()
    .slice(0, 120);
}

function decodeBase64(value) {
  const text = String(value || "");
  if (!text) throw documentError("ফাইল ডেটা দেওয়া হয়নি");
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
    throw documentError("ফাইল ডেটা ভাঙা — আবার আপলোড করুন");
  }
  const buffer = Buffer.from(text, "base64");
  if (!buffer.length) throw documentError("ফাইল খালি");
  return buffer;
}

function storagePath(key) {
  const full = path.resolve(ROOT, String(key || ""));
  if (!full.startsWith(ROOT + path.sep)) throw documentError("Document path invalid na", 400);
  return full;
}

async function removeFile(key) {
  if (!key) return false;
  try {
    await fs.promises.unlink(storagePath(key));
    return true;
  } catch (err) {
    if (err.code !== "ENOENT") console.error("installment document unlink:", err.message);
    return false;
  }
}

function documentView(row) {
  return {
    id: String(row._id),
    type: row.type,
    mime: row.mime,
    filename: row.filename || "",
    sizeBytes: row.sizeBytes || 0,
    status: row.status,
    uploadedAt: row.createdAt || row.uploadedAt || null,
    purgedAt: row.purgedAt || null,
  };
}

// Store an encrypted upload and return its capability token.
async function uploadDocument({ storeId, type, filename, data }) {
  if (!storeId) throw documentError("Store pawa jayni", 400);
  if (!mongoose.isValidObjectId(storeId)) throw documentError("Store pawa jayni", 400);

  const settings = await getInstallmentSettings(storeId);
  const types = (settings.applicant && settings.applicant.documentTypes) || [];
  const cleanType = String(type || "").trim().slice(0, 40);
  if (!types.includes(cleanType)) {
    throw documentError("এই ধরনের ডকুমেন্ট এই দোকানে নেওয়া হয় না", 400);
  }

  const buffer = decodeBase64(data);
  if (buffer.length > MAX_BYTES) {
    throw documentError("ডকুমেন্ট সর্বোচ্চ ২০MB হতে পারে", 400);
  }
  const mime = sniffImage(buffer);
  if (!ALLOWED_MIME.has(mime)) {
    throw documentError("ডকুমেন্ট JPG, PNG বা WebP হতে হবে", 400);
  }

  const id = new mongoose.Types.ObjectId();
  const key = `${String(storeId)}/${id.toHexString()}.bin`;
  const file = storagePath(key);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, encryptBuffer(buffer));

  try {
    const row = await InstallmentDocument.create({
      _id: id,
      store: storeId,
      token: crypto.randomBytes(24).toString("hex"),
      type: cleanType,
      filename: safeFilename(filename),
      path: key,
      mime,
      sizeBytes: buffer.length,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      status: "pending",
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    });
    return { token: row.token, document: documentView(row) };
  } catch (err) {
    await removeFile(key);
    throw err;
  }
}

// Resolve tokens before stock is reserved. Returns the pending rows in the
// same order the client sent them.
async function claimTokens({ storeId, tokens }) {
  const list = (Array.isArray(tokens) ? tokens : [])
    .map((entry) => (typeof entry === "string" ? entry : entry && entry.token))
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const unique = Array.from(new Set(list));
  if (unique.length !== list.length) throw documentError("একই ডকুমেন্ট দুইবার পাঠানো হয়েছে");
  if (unique.length > MAX_DOCS) throw documentError(`সর্বোচ্চ ${MAX_DOCS}টি ডকুমেন্ট দেওয়া যাবে`);

  if (!unique.length) return [];
  const rows = await InstallmentDocument.find({
    store: storeId,
    token: { $in: unique },
    status: "pending",
    expiresAt: { $gt: new Date() },
  }).lean();
  if (rows.length !== unique.length) {
    throw documentError("ডকুমেন্ট আপলোডের মেয়াদ শেষ — আবার আপলোড করুন");
  }
  const byToken = new Map(rows.map((row) => [row.token, row]));
  return unique.map((token) => byToken.get(token));
}

// Every configured document type must be present when documents are required.
function assertRequiredTypes(rows, settings) {
  const required = settings.applicant && settings.applicant.requireDocuments;
  if (!required) return;
  const types = (settings.applicant.documentTypes || []).filter(Boolean);
  if (!types.length) {
    if (!rows.length) throw documentError("এই দোকানের জন্য ডকুমেন্ট আপলোড করা লাগবে");
    return;
  }
  const present = new Set(rows.map((row) => row.type));
  const missing = types.filter((type) => !present.has(type));
  if (missing.length) {
    throw documentError(`ডকুমেন্ট আপলোড করুন: ${missing.join(", ")}`);
  }
}

// Attach claimed rows to the application. Returns the embedded summaries.
async function attachDocuments({ storeId, applicationId, rows }) {
  const tokens = (rows || []).map((row) => row.token).filter(Boolean);
  if (!tokens.length) return [];
  const now = new Date();
  const result = await InstallmentDocument.updateMany(
    { store: storeId, token: { $in: tokens }, status: "pending" },
    {
      $set: {
        status: "attached",
        application: applicationId,
        attachedAt: now,
        expiresAt: null,
      },
    }
  );
  if (result.modifiedCount !== tokens.length) {
    // Another request consumed one of the tokens between claim and attach.
    await detachDocuments({ storeId, applicationId });
    throw documentError("ডকুমেন্ট সংযুক্ত করা যায়নি — আবার চেষ্টা করুন", 409);
  }

  const attached = await InstallmentDocument.find({ store: storeId, application: applicationId }).lean();
  const embedded = attached.map((row) => ({
    type: row.type,
    path: row.path,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    encrypted: true,
    uploadedAt: row.attachedAt || row.createdAt,
  }));
  await InstallmentApplication.updateOne(
    { _id: applicationId, store: storeId },
    { $set: { documents: embedded } }
  );
  return embedded;
}

// Roll back an interrupted apply: rows go back to pending with a fresh window.
async function detachDocuments({ storeId, applicationId }) {
  await InstallmentDocument.updateMany(
    { store: storeId, application: applicationId, status: "attached" },
    { $set: { status: "pending", application: null, attachedAt: null, expiresAt: new Date(Date.now() + PENDING_TTL_MS) } }
  );
  await InstallmentApplication.updateOne(
    { _id: applicationId, store: storeId },
    { $set: { documents: [] } }
  ).catch(() => {});
}

async function listForApplication({ storeId, applicationId }) {
  const rows = await InstallmentDocument.find({ store: storeId, application: applicationId })
    .sort({ createdAt: 1 })
    .lean();
  return rows.map(documentView);
}

async function readDocument({ storeId, applicationId, documentId }) {
  if (!mongoose.isValidObjectId(documentId)) throw documentError("Document pawa jayni", 404);
  const row = await InstallmentDocument.findOne({
    _id: documentId,
    store: storeId,
    application: applicationId,
    status: "attached",
  }).lean();
  if (!row) throw documentError("Document pawa jayni", 404);
  const encrypted = await fs.promises.readFile(storagePath(row.path));
  return { row, buffer: decryptBuffer(encrypted) };
}

// Delete expired pending uploads and attached documents whose application has
// been closed for longer than the store's retention window.
async function purgeStoreDocuments(storeId, { now = new Date() } = {}) {
  const settings = await getInstallmentSettings(storeId);
  const retentionDays = Math.max(0, Number(settings.documents && settings.documents.retentionDays) || 0);
  const summary = { pending: 0, expired: 0, files: 0, errors: 0 };

  const stale = await InstallmentDocument.find({
    store: storeId,
    status: "pending",
    expiresAt: { $lte: now },
  }).lean();
  for (const row of stale) {
    try {
      if (await removeFile(row.path)) summary.files += 1;
      await InstallmentDocument.updateOne(
        { _id: row._id, store: storeId },
        { $set: { status: "purged", purgedAt: now, path: "" } }
      );
      summary.pending += 1;
    } catch (err) {
      summary.errors += 1;
      console.error("installment document purge (pending):", err.message);
    }
  }

  if (retentionDays > 0) {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const apps = await InstallmentApplication.find({
      store: storeId,
      status: { $in: CLOSED_STATUSES },
      updatedAt: { $lte: cutoff },
    })
      .select("_id")
      .limit(500)
      .lean();
    if (apps.length) {
      const ids = apps.map((app) => app._id);
      const rows = await InstallmentDocument.find({
        store: storeId,
        application: { $in: ids },
        status: "attached",
      }).lean();
      for (const row of rows) {
        try {
          if (await removeFile(row.path)) summary.files += 1;
          await InstallmentDocument.updateOne(
            { _id: row._id, store: storeId },
            { $set: { status: "purged", purgedAt: now, path: "" } }
          );
          summary.expired += 1;
        } catch (err) {
          summary.errors += 1;
          console.error("installment document purge (retention):", err.message);
        }
      }
      // Embedded copies keep an audit marker, never the storage key.
      const appsFull = await InstallmentApplication.find({ _id: { $in: ids }, store: storeId })
        .select("documents")
        .lean();
      for (const app of appsFull) {
        const markers = (app.documents || []).map((doc) => ({
          type: doc.type,
          mime: "",
          sizeBytes: 0,
          encrypted: true,
          uploadedAt: doc.uploadedAt,
          purgedAt: now,
        }));
        await InstallmentApplication.updateOne(
          { _id: app._id, store: storeId },
          { $set: { documents: markers } }
        );
      }
    }
  }

  return summary;
}

module.exports = {
  ROOT,
  MAX_BYTES,
  MAX_DOCS,
  uploadDocument,
  claimTokens,
  assertRequiredTypes,
  attachDocuments,
  detachDocuments,
  listForApplication,
  readDocument,
  purgeStoreDocuments,
  documentView,
};
