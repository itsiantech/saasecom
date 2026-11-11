const mongoose = require("mongoose");
const PromotionDraft = require("../models/PromotionDraft");

const KINDS = ["coupon", "flash-sale"];
const DRAFT_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const META_KEYS = new Set(["draftKey", "draftOf", "id", "targetId", "payload", "values"]);
const MAX_PAYLOAD_CHARS = 64 * 1024;

class PromotionDraftError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function assertKind(kind) {
  if (!KINDS.includes(kind)) throw new PromotionDraftError("Draft type valid na");
}

function normalizeKey(value) {
  const key = String(value || "").trim();
  if (!DRAFT_KEY_RE.test(key)) throw new PromotionDraftError("Draft key valid na");
  return key;
}

// FormGuard sends flat form values; anything nested or oversized is dropped
// so a draft row can never grow into an arbitrary JSON store.
function cleanPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PromotionDraftError("Draft data valid na");
  }
  const out = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key) || key.indexOf("__") === 0) return;
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      out[key] = value;
      return;
    }
    if (typeof value === "string") {
      out[key] = value.slice(0, 4000);
      return;
    }
    if (Array.isArray(value)) {
      out[key] = value
        .slice(0, 500)
        .map((item) => {
          if (typeof item === "string") return item.slice(0, 128);
          if (typeof item === "number") return item;
          return null;
        })
        .filter((item) => item !== null);
    }
  });
  if (JSON.stringify(out).length > MAX_PAYLOAD_CHARS) {
    throw new PromotionDraftError("Draft data onek boro");
  }
  return out;
}

function payloadOf(source) {
  if (source.payload && typeof source.payload === "object") return source.payload;
  if (source.values && typeof source.values === "object") return source.values;
  const rest = {};
  Object.entries(source).forEach(([key, value]) => {
    if (!META_KEYS.has(key)) rest[key] = value;
  });
  return rest;
}

function view(draft) {
  return {
    id: String(draft._id),
    draftKey: draft.draftKey,
    targetId: draft.targetId ? String(draft.targetId) : null,
    payload: draft.payload || {},
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

async function saveDraft(storeId, userId, kind, body) {
  assertKind(kind);
  if (!storeId) throw new PromotionDraftError("Store pawa jayni");
  const source = body && typeof body === "object" ? body : {};
  const draftKey = normalizeKey(source.draftKey);
  const payload = cleanPayload(payloadOf(source));

  let targetId = null;
  if (source.targetId) {
    if (!mongoose.isValidObjectId(source.targetId)) throw new PromotionDraftError("Target id valid na");
    targetId = source.targetId;
  }

  let draft = null;
  if (source.id) {
    if (!mongoose.isValidObjectId(source.id)) throw new PromotionDraftError("Draft pawa jayni", 404);
    draft = await PromotionDraft.findOne({ _id: source.id, store: storeId, kind });
    if (!draft) throw new PromotionDraftError("Draft pawa jayni", 404);
  }
  if (!draft) draft = await PromotionDraft.findOne({ store: storeId, kind, draftKey });

  if (draft) {
    draft.draftKey = draftKey;
    draft.payload = payload;
    if (targetId) draft.targetId = targetId;
    await draft.save();
    return view(draft);
  }

  try {
    const created = await PromotionDraft.create({
      store: storeId,
      kind,
      draftKey,
      targetId,
      payload,
      createdBy: userId || null,
    });
    return view(created);
  } catch (err) {
    if (!err || err.code !== 11000) throw err;
    // parallel autosave already inserted this session's draft — update it
    const existing = await PromotionDraft.findOne({ store: storeId, kind, draftKey });
    if (!existing) throw err;
    existing.payload = payload;
    if (targetId) existing.targetId = targetId;
    await existing.save();
    return view(existing);
  }
}

async function listDrafts(storeId, kind) {
  assertKind(kind);
  if (!storeId) return [];
  const items = await PromotionDraft.find({ store: storeId, kind }).sort({ updatedAt: -1 }).lean();
  return items.map(view);
}

async function deleteDraftById(storeId, kind, id) {
  assertKind(kind);
  if (!mongoose.isValidObjectId(id)) throw new PromotionDraftError("Draft pawa jayni", 404);
  const removed = await PromotionDraft.deleteOne({ _id: id, store: storeId, kind });
  if (!removed.deletedCount) throw new PromotionDraftError("Draft pawa jayni", 404);
  return 1;
}

async function deleteDraftByKey(storeId, kind, draftKey) {
  const key = String(draftKey || "").trim();
  if (!storeId || !KINDS.includes(kind) || !DRAFT_KEY_RE.test(key)) return 0;
  const removed = await PromotionDraft.deleteOne({ store: storeId, kind, draftKey: key });
  return removed.deletedCount || 0;
}

module.exports = {
  PromotionDraftError,
  saveDraft,
  listDrafts,
  deleteDraftById,
  deleteDraftByKey,
};