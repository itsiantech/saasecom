const mongoose = require("mongoose");
const HeroSlide = require("../models/HeroSlide");
const { getStoreId } = require("../lib/tenantContext");
const { MAX_SLIDES, normalizeSlide } = require("../lib/heroSlides");

function storeIdOf(req) {
  if (req.store && req.store._id) return req.store._id;
  return getStoreId();
}

function adminView(slide) {
  return {
    id: slide._id,
    image: slide.image,
    alt: slide.alt || "",
    title: slide.title || "",
    subtitle: slide.subtitle || "",
    buttonLabel: slide.buttonLabel || "",
    linkUrl: slide.linkUrl || "",
    active: slide.active !== false,
    sortOrder: Number(slide.sortOrder) || 0,
    createdAt: slide.createdAt,
  };
}

async function listRows(storeId) {
  const rows = await HeroSlide.find({ store: storeId })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();
  return rows.map(adminView);
}

async function resequence(storeId) {
  const rows = await HeroSlide.find({ store: storeId })
    .sort({ sortOrder: 1, createdAt: 1 })
    .select("_id")
    .lean();
  if (!rows.length) return;
  await HeroSlide.bulkWrite(
    rows.map((row, index) => ({
      updateOne: {
        filter: { _id: row._id, store: storeId },
        update: { $set: { sortOrder: index } },
      },
    }))
  );
}

function fail(res, next, err) {
  if (err instanceof Error && !err.status) {
    return res.status(400).json({ message: err.message });
  }
  next(err);
}

async function list(req, res, next) {
  try {
    const storeId = storeIdOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    res.json({ items: await listRows(storeId), max: MAX_SLIDES });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const storeId = storeIdOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    if ((await HeroSlide.countDocuments({ store: storeId })) >= MAX_SLIDES) {
      return res.status(400).json({ message: `Ekta store e max ${MAX_SLIDES} ta slide rakha jabe` });
    }
    const payload = normalizeSlide(req.body || {});
    const last = await HeroSlide.findOne({ store: storeId })
      .sort({ sortOrder: -1 })
      .select("sortOrder")
      .lean();
    const slide = await HeroSlide.create({
      store: storeId,
      ...payload,
      sortOrder: last ? (Number(last.sortOrder) || 0) + 1 : 0,
    });
    res.status(201).json({ ok: true, item: adminView(slide.toObject()) });
  } catch (err) {
    fail(res, next, err);
  }
}

async function update(req, res, next) {
  try {
    const storeId = storeIdOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Slide pawa jayni" });
    }
    const slide = await HeroSlide.findOne({ _id: req.params.id, store: storeId });
    if (!slide) return res.status(404).json({ message: "Slide pawa jayni" });

    const current = slide.toObject();
    const payload = normalizeSlide({
      image: current.image,
      alt: current.alt,
      title: current.title,
      subtitle: current.subtitle,
      buttonLabel: current.buttonLabel,
      linkUrl: current.linkUrl,
      active: current.active,
      ...(req.body || {}),
    });
    Object.assign(slide, payload);
    await slide.save();
    res.json({ ok: true, item: adminView(slide.toObject()) });
  } catch (err) {
    fail(res, next, err);
  }
}

async function remove(req, res, next) {
  try {
    const storeId = storeIdOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    const result = await HeroSlide.deleteOne({ _id: req.params.id, store: storeId });
    if (!result.deletedCount) return res.status(404).json({ message: "Slide pawa jayni" });
    await resequence(storeId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function reorder(req, res, next) {
  try {
    const storeId = storeIdOf(req);
    if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
    const incoming = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
    const rows = await HeroSlide.find({ store: storeId })
      .sort({ sortOrder: 1, createdAt: 1 })
      .select("_id")
      .lean();
    const known = new Set(rows.map((row) => String(row._id)));
    const ordered = [];
    const seen = new Set();
    incoming.forEach((id) => {
      const key = String(id || "");
      if (known.has(key) && !seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    });
    rows.forEach((row) => {
      const key = String(row._id);
      if (!seen.has(key)) ordered.push(key);
    });
    if (ordered.length) {
      await HeroSlide.bulkWrite(
        ordered.map((id, index) => ({
          updateOne: {
            filter: { _id: id, store: storeId },
            update: { $set: { sortOrder: index } },
          },
        }))
      );
    }
    res.json({ ok: true, items: await listRows(storeId) });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove, reorder };
