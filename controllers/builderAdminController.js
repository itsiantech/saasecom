const mongoose = require("mongoose");
const BuilderTemplate = require("../models/BuilderTemplate");
const SavedBuild = require("../models/SavedBuild");
const BuilderEvent = require("../models/BuilderEvent");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Brand = require("../models/Brand");
const Tag = require("../models/Tag");
const SpecDefinition = require("../models/SpecDefinition");
const { cleanTemplate, publicTemplate, querySlotProducts } = require("../lib/builderTemplates");
const { filterCandidates } = require("../lib/builderRules");
const { starterTemplate } = require("../lib/builderStarter");
const { writeAudit } = require("../lib/audit");
const pub = require("./publicBuilderController");

function storeIdOf(req) {
  return req.store && req.store._id;
}

function serializeTemplate(doc) {
  return {
    id: String(doc._id),
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...publicTemplate(doc),
  };
}

function templateError(message, status = 400, code = "invalid_template") {
  return Object.assign(new Error(message), { status, code });
}

/* ------------------------------------------------------------------ *
 * read
 * ------------------------------------------------------------------ */

async function list(req, res, next) {
  try {
    const storeId = storeIdOf(req);
    const [templates, stats] = await Promise.all([
      BuilderTemplate.find({}).sort({ createdAt: -1 }).lean(),
      SavedBuild.aggregate([
        { $match: { store: new mongoose.Types.ObjectId(String(storeId)) } },
        {
          $group: {
            _id: "$template",
            builds: { $sum: 1 },
            lastBuiltAt: { $max: "$createdAt" },
          },
        },
      ]),
    ]);
    const byTemplate = new Map(stats.map((row) => [String(row._id), row]));
    res.json({
      templates: templates.map((template) => {
        const stat = byTemplate.get(String(template._id)) || {};
        return {
          id: String(template._id),
          name: template.name,
          slug: template.slug,
          description: template.description || "",
          status: template.status,
          slotCount: (template.slots || []).length,
          ruleCount: (template.rules || []).length,
          builds: stat.builds || 0,
          lastBuiltAt: stat.lastBuiltAt || null,
          updatedAt: template.updatedAt,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
}

async function meta(req, res, next) {
  try {
    const [categories, brands, tags, specs] = await Promise.all([
      Category.find({ status: { $ne: "trashed" } }).select("name slug parent").sort({ name: 1 }).lean(),
      Brand.find({ status: { $ne: "trashed" } }).select("name").sort({ name: 1 }).lean(),
      Tag.find({}).select("name").sort({ name: 1 }).lean(),
      SpecDefinition.find({ active: { $ne: false } }).sort({ sortOrder: 1 }).lean(),
    ]);
    const catName = new Map(categories.map((cat) => [String(cat._id), cat.name || "Untitled"]));
    res.json({
      categories: categories.map((cat) => ({
        id: String(cat._id),
        name: cat.name || "Untitled",
        slug: cat.slug || "",
        parent: cat.parent ? String(cat.parent) : null,
      })),
      brands: brands.map((brand) => ({ id: String(brand._id), name: brand.name || "Untitled" })),
      tags: tags.map((tag) => ({ id: String(tag._id), name: tag.name })),
      specs: specs.map((def) => ({
        id: String(def._id),
        category: def.category ? String(def.category) : null,
        categoryName: def.category ? catName.get(String(def.category)) || "" : "",
        key: def.key,
        label: def.label,
        labelBn: def.labelBn || "",
        type: def.type,
        unit: def.unit || "",
        enumValues: (def.enumValues || []).map((value) => ({ value: value.value, label: value.label || value.value })),
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function get(req, res, next) {
  try {
    const doc = await BuilderTemplate.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Template pawa jayni" });
    res.json({ template: serializeTemplate(doc) });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * write
 * ------------------------------------------------------------------ */

async function ensureSlugFree(slug, excludeId) {
  const filter = { slug };
  if (excludeId) filter._id = { $ne: excludeId };
  const clash = await BuilderTemplate.findOne(filter).select("_id name").lean();
  if (clash) {
    throw templateError(`Ei address agei ache: ${slug}`, 409, "slug_taken");
  }
}

async function create(req, res, next) {
  try {
    const data = cleanTemplate(req.body);
    await ensureSlugFree(data.slug);
    const doc = await BuilderTemplate.create({ store: storeIdOf(req), ...data });
    await writeAudit({
      store: storeIdOf(req),
      user: req.user && req.user.id,
      action: "productBuilder.template_create",
      entity: "BuilderTemplate",
      entityId: doc._id,
      newValue: { name: doc.name, slug: doc.slug, status: doc.status },
    });
    res.status(201).json({ template: serializeTemplate(doc) });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const doc = await BuilderTemplate.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Template pawa jayni" });

    const data = cleanTemplate(req.body);
    await ensureSlugFree(data.slug, doc._id);

    const before = { name: doc.name, slug: doc.slug, status: doc.status };
    doc.set({
      name: data.name,
      slug: data.slug,
      description: data.description,
      status: data.status,
      groups: data.groups,
      slots: data.slots,
      rules: data.rules,
      settings: data.settings,
    });
    await doc.save();

    if (before.status !== doc.status || before.name !== doc.name || before.slug !== doc.slug) {
      await writeAudit({
        store: storeIdOf(req),
        user: req.user && req.user.id,
        action: "productBuilder.template_update",
        entity: "BuilderTemplate",
        entityId: doc._id,
        oldValue: before,
        newValue: { name: doc.name, slug: doc.slug, status: doc.status },
      });
    }
    res.json({ template: serializeTemplate(doc) });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const doc = await BuilderTemplate.findById(req.params.id);
    if (!doc) return res.status(404).json({ message: "Template pawa jayni" });
    // saved builds point at this template; a share link without it would 404 anyway
    await SavedBuild.deleteMany({ template: doc._id });
    await doc.deleteOne();
    await writeAudit({
      store: storeIdOf(req),
      user: req.user && req.user.id,
      action: "productBuilder.template_delete",
      entity: "BuilderTemplate",
      entityId: doc._id,
      oldValue: { name: doc.name, slug: doc.slug },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function createStarter(req, res, next) {
  try {
    const data = cleanTemplate(starterTemplate());
    const existing = await BuilderTemplate.findOne({ slug: data.slug }).select("_id"); 
    if (existing) {
      return res.status(409).json({ code: "slug_taken", message: "PC Builder template agei ache" });
    }
    const doc = await BuilderTemplate.create({ store: storeIdOf(req), ...data });
    await writeAudit({
      store: storeIdOf(req),
      user: req.user && req.user.id,
      action: "productBuilder.template_starter",
      entity: "BuilderTemplate",
      entityId: doc._id,
      newValue: { name: doc.name, slug: doc.slug },
    });
    res.status(201).json({ template: serializeTemplate(doc) });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * build history + analytics + sandbox
 * ------------------------------------------------------------------ */

async function builds(req, res, next) {
  try {
    const template = await BuilderTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: "Template pawa jayni" });

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const [rows, total] = await Promise.all([
      SavedBuild.find({ template: template._id })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      SavedBuild.countDocuments({ template: template._id }),
    ]);

    res.json({
      total,
      limit,
      offset,
      builds: rows.map((row) => ({
        token: row.token,
        name: row.name || "",
        items: (row.selections || []).length,
        subtotal: Number(row.subtotal) || 0,
        violations: (row.violations || []).length,
        guest: !row.user,
        createdAt: row.createdAt,
        url: `/builder?build=${encodeURIComponent(row.token)}`,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function analytics(req, res, next) {
  try {
    const template = await BuilderTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: "Template pawa jayni" });

    const storeId = storeIdOf(req);
    const match = {
      store: new mongoose.Types.ObjectId(String(storeId)),
      template: template._id,
    };
    const day = 24 * 60 * 60 * 1000;
    const since30 = new Date(Date.now() - 30 * day);
    const eventMatch = { template: template._id, event: "part_chosen" };
    const [totalBuilds, last7, last30, blockedBuilds, sums, top, partsChosen, abandonedBuilds, abandoned30] =
      await Promise.all([
        SavedBuild.countDocuments({ template: template._id }),
        SavedBuild.countDocuments({ template: template._id, createdAt: { $gte: new Date(Date.now() - 7 * day) } }),
        SavedBuild.countDocuments({ template: template._id, createdAt: { $gte: since30 } }),
        SavedBuild.countDocuments({ template: template._id, "violations.0": { $exists: true } }),
        SavedBuild.aggregate([
          { $match: match },
          { $group: { _id: null, average: { $avg: "$subtotal" }, revenue: { $sum: "$subtotal" } } },
        ]),
        SavedBuild.aggregate([
          { $match: match },
          { $unwind: "$selections" },
          {
            $group: {
              _id: { slot: "$selections.slot", product: "$selections.product" },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 12 },
        ]),
        BuilderEvent.countDocuments(eventMatch),
        BuilderEvent.countDocuments({ template: template._id, event: "build_abandoned" }),
        BuilderEvent.countDocuments({ template: template._id, event: "build_abandoned", createdAt: { $gte: since30 } }),
      ]);

    const products = top.length
      ? await Product.find({ _id: { $in: top.map((row) => row._id.product) } })
          .select("title name slug images")
          .lean()
      : [];
    const byId = new Map(products.map((product) => [String(product._id), product]));

    const totals = sums[0] || { average: 0, revenue: 0 };
    res.json({
      analytics: {
        totalBuilds,
        last7,
        last30,
        blockedBuilds,
        partsChosen,
        abandonedBuilds,
        abandoned30,
        averageSubtotal: Math.round((Number(totals.average) || 0) * 100) / 100,
        potentialRevenue: Math.round((Number(totals.revenue) || 0) * 100) / 100,
        topParts: top.map((row) => {
          const product = byId.get(String(row._id.product));
          return {
            slot: row._id.slot,
            productId: String(row._id.product),
            title: product ? product.title || product.name || "" : "(deleted product)",
            image: (product && product.images && product.images[0]) || "",
            count: row.count,
          };
        }),
      },
    });
  } catch (err) {
    next(err);
  }
}

async function sandbox(req, res, next) {
  try {
    const template = await BuilderTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: "Template pawa jayni" });

    const resolved = await pub.resolveSelections(
      storeIdOf(req),
      template,
      pub.parseSelections(req.body)
    );
    const { violations, missing } = pub.violationsFor(template, resolved);
    res.json({
      ok: !violations.some((violation) => violation.level === "block"),
      violations,
      missing,
      items: resolved.items,
      totals: pub.totalsOf(resolved.items),
    });
  } catch (err) {
    next(err);
  }
}

async function slotProducts(req, res, next) {
  try {
    const template = await BuilderTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ message: "Template pawa jayni" });

    const slotKey = String(req.params.slotKey || "").trim().toLowerCase();
    const slot = (template.slots || []).find((row) => row.key === slotKey);
    if (!slot) return res.status(404).json({ message: "Slot pawa jayni" });

    const resolved = await pub.resolveSelections(
      storeIdOf(req),
      template,
      pub.parseSelections(req.body)
    );
    const rows = await querySlotProducts(storeIdOf(req), slot, {
      q: req.body && req.body.q,
      sort: req.body && req.body.sort,
      limit: Math.min(100, Math.max(1, parseInt(req.body && req.body.limit, 10) || 60)),
    });
    const judged = filterCandidates(template.rules, slot.key, rows, {
      products: resolved.products,
      quantities: resolved.quantities,
    });

    res.json({
      items: judged.map(({ product, compatible, reasons, reasonsBn, warnings }) => ({
        id: String(product._id),
        title: product.title || product.name || "",
        slug: product.slug || String(product._id),
        image: (product.images && product.images[0]) || "",
        price: pub.effectivePrice(product),
        stock: Number(product.stock) || 0,
        specs: product.specs || {},
        compatible,
        reasons,
        reasonsBn,
        warnings: warnings.map((warn) => warn.messageBn || warn.message),
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  meta,
  get,
  create,
  update,
  remove,
  createStarter,
  builds,
  analytics,
  sandbox,
  slotProducts,
};
