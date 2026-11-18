const crypto = require("crypto");
const mongoose = require("mongoose");
const BuilderTemplate = require("../models/BuilderTemplate");
const SavedBuild = require("../models/SavedBuild");
const BuilderEvent = require("../models/BuilderEvent");
const Product = require("../models/Product");
const cartController = require("./cartController");
const { featuresForStore } = require("../lib/features");
const { publicTemplate, querySlotProducts, productMatchesSlot } = require("../lib/builderTemplates");
const { evaluateRules, filterCandidates } = require("../lib/builderRules");

/* ------------------------------------------------------------------ *
 * /api/public/builder/* — storefront configurator.
 * publicStore already ran (store + tenant storage). The plan/store gate
 * answers 404 here: a store without the module must look like it never
 * had a builder at all.
 * ------------------------------------------------------------------ */

async function builderGate(req, res, next) {
  try {
    const access = await featuresForStore(req.publicStore);
    if (!access.features.productBuilder) {
      return res.status(404).json({ message: "Builder pawa jayni" });
    }
    req.builderAccess = access;
    next();
  } catch (err) {
    next(err);
  }
}

function text(value, max = 200) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function effectivePrice(product) {
  return Number(product.salePrice) > 0
    ? Number(product.salePrice)
    : Number(product.regularPrice || product.price || 0);
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function imageOf(product) {
  return (product && product.images && product.images[0]) || "";
}

function slotOrder(template) {
  return [...(template.slots || [])].sort(
    (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || String(a.key).localeCompare(String(b.key))
  );
}

function parseSelections(body) {
  const raw = body && body.selections;
  const map = new Map();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return map;
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = text(rawKey, 40).toLowerCase();
    if (!key) continue;
    const id = typeof rawValue === "string" ? rawValue : rawValue && (rawValue.productId || rawValue.id);
    if (!mongoose.isValidObjectId(id)) continue;
    const quantity = Number(rawValue && rawValue.quantity);
    map.set(key, { id: String(id), quantity: Number.isFinite(quantity) ? quantity : 1 });
  }
  return map;
}

function itemView(slot, product, quantity) {
  return {
    slot: slot.key,
    id: String(product._id),
    title: product.title || product.name || "",
    slug: product.slug || String(product._id),
    image: imageOf(product),
    price: effectivePrice(product),
    stock: Number(product.stock) || 0,
    quantity,
    specs: product.specs || {},
  };
}

function totalsOf(items) {
  return {
    count: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: money(items.reduce((sum, item) => sum + item.price * item.quantity, 0)),
  };
}

async function loadTemplate(req) {
  const slug = text(req.params.slug, 80).toLowerCase();
  if (!slug) return null;
  return BuilderTemplate.findOne({ store: req.publicStore._id, slug, status: "published" });
}

// selections → live product docs; unknown slots are ignored, missing/draft
// products become block-level errors the shopper can see and fix.
async function resolveSelections(storeId, template, selections) {
  const slots = new Map((template.slots || []).map((slot) => [slot.key, slot]));
  const ids = [];
  for (const [slotKey, selection] of selections) {
    if (slots.has(slotKey)) ids.push(selection.id);
  }

  const products = ids.length
    ? await Product.find({ store: storeId, _id: { $in: ids }, status: "published" })
    : [];
  const byId = new Map(products.map((product) => [String(product._id), product]));

  const result = { products: {}, quantities: {}, items: [], errors: [], ignored: [] };
  for (const [slotKey, selection] of selections) {
    const slot = slots.get(slotKey);
    if (!slot) {
      result.ignored.push(slotKey);
      continue;
    }
    const product = byId.get(selection.id);
    if (!product) {
      result.errors.push({
        slot: slotKey,
        productId: selection.id,
        code: "product_missing",
        message: `${slot.labelBn || slot.label} — নির্বাচিত পণ্যটি আর পাওয়া যাচ্ছে না`,
        messageEn: `${slot.label} — the selected product is no longer available`,
      });
      continue;
    }
    const quantity = Math.min(Math.max(1, Math.round(selection.quantity) || 1), Number(slot.maxQty) || 1);
    result.products[slotKey] = product;
    result.quantities[slotKey] = quantity;
    result.items.push(itemView(slot, product, quantity));
  }
  return result;
}

function violationsFor(template, resolved) {
  const violations = evaluateRules(template.rules, {
    products: resolved.products,
    quantities: resolved.quantities,
  });

  for (const err of resolved.errors) {
    violations.push({
      rule: `selection:${err.slot}`,
      type: "selection",
      level: "block",
      code: err.code,
      message: err.messageEn,
      messageBn: err.message,
      slots: [err.slot],
    });
  }

  const missing = [];
  for (const slot of slotOrder(template)) {
    if (!slot.required || resolved.products[slot.key]) continue;
    missing.push(slot.key);
    violations.push({
      rule: `required:${slot.key}`,
      type: "required",
      level: "block",
      code: "required",
      message: `${slot.label || slot.key} is not selected`,
      messageBn: `${slot.labelBn || slot.label || slot.key} নির্বাচন করা হয়নি`,
      slots: [slot.key],
    });
  }

  return { violations, missing };
}

function publicBuild(build, template) {
  return {
    token: build.token,
    name: build.name || "",
    template: template ? { slug: template.slug, name: template.name } : null,
    subtotal: Number(build.subtotal) || 0,
    selections: (build.selections || []).map((row) => ({
      slot: row.slot,
      productId: String(row.product),
      quantity: Number(row.quantity) || 1,
      title: row.title || "",
      image: row.image || "",
      price: Number(row.price) || 0,
    })),
    violations: (build.violations || []).map((row) => ({
      rule: row.rule,
      level: row.level,
      message: row.message,
      messageBn: row.messageBn,
    })),
    createdAt: build.createdAt,
  };
}

/* ------------------------------------------------------------------ *
 * handlers
 * ------------------------------------------------------------------ */

async function listTemplates(req, res, next) {
  try {
    const templates = await BuilderTemplate.find({ store: req.publicStore._id, status: "published" })
      .sort({ createdAt: -1 })
      .select("name slug description slots")
      .lean();
    res.json({
      templates: templates.map((template) => ({
        slug: template.slug,
        name: template.name,
        description: template.description || "",
        slotCount: (template.slots || []).length,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function getTemplate(req, res, next) {
  try {
    const template = await loadTemplate(req);
    if (!template) return res.status(404).json({ message: "Builder pawa jayni" });
    res.json({ template: publicTemplate(template) });
  } catch (err) {
    next(err);
  }
}

async function slotProducts(req, res, next) {
  try {
    const template = await loadTemplate(req);
    if (!template) return res.status(404).json({ message: "Builder pawa jayni" });

    const slotKey = text(req.params.slotKey, 40).toLowerCase();
    const slot = (template.slots || []).find((row) => row.key === slotKey);
    if (!slot) return res.status(404).json({ message: "Slot pawa jayni" });

    const selections = parseSelections(req.body);
    const resolved = await resolveSelections(req.publicStore._id, template, selections);

    const includeIncompatible = req.body && req.body.includeIncompatible === true;
    const wanted = Math.min(100, Math.max(1, parseInt(req.body && req.body.limit, 10) || 48));
    const rows = await querySlotProducts(req.publicStore._id, slot, {
      q: text(req.body && req.body.q, 120),
      sort: text(req.body && req.body.sort, 20),
      limit: includeIncompatible ? wanted : Math.min(100, wanted * 2),
    });

    const judged = filterCandidates(template.rules, slot.key, rows, {
      products: resolved.products,
      quantities: resolved.quantities,
    });

    const items = [];
    const excluded = [];
    for (const row of judged) {
      const product = row.product;
      if (!row.compatible) {
        if (excluded.length < 50) {
          excluded.push({
            id: String(product._id),
            title: product.title || product.name || "",
            reasons: row.reasons,
            reasonsBn: row.reasonsBn,
          });
        }
        if (!includeIncompatible) continue;
      }
      items.push({
        id: String(product._id),
        title: product.title || product.name || "",
        slug: product.slug || String(product._id),
        image: imageOf(product),
        price: effectivePrice(product),
        stock: Number(product.stock) || 0,
        inStock: Number(product.stock) > 0,
        specs: product.specs || {},
        compatible: row.compatible,
        reasons: row.reasons,
        reasonsBn: row.reasonsBn,
        warnings: row.warnings.map((warn) => warn.messageBn || warn.message),
      });
    }

    res.json({
      slot: {
        key: slot.key,
        label: slot.label,
        labelBn: slot.labelBn || "",
        group: slot.group || "",
        required: !!slot.required,
        maxQty: Number(slot.maxQty) || 1,
      },
      items: items.slice(0, wanted),
      excluded: excluded.slice(0, 50),
      hasMore: rows.length >= (includeIncompatible ? wanted : Math.min(100, wanted * 2)),
      invalidSelections: resolved.errors.map((err) => ({
        slot: err.slot,
        productId: err.productId,
        message: err.message,
        messageEn: err.messageEn,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function validateBuild(req, res, next) {
  try {
    const template = await loadTemplate(req);
    if (!template) return res.status(404).json({ message: "Builder pawa jayni" });

    const resolved = await resolveSelections(req.publicStore._id, template, parseSelections(req.body));
    const { violations, missing } = violationsFor(template, resolved);
    const totals = totalsOf(resolved.items);

    res.json({
      ok: !violations.some((violation) => violation.level === "block"),
      violations,
      missing,
      items: resolved.items,
      totals,
    });
  } catch (err) {
    next(err);
  }
}

async function uniqueToken(storeId) {
  for (let i = 0; i < 5; i += 1) {
    const token = crypto.randomBytes(9).toString("base64url");
    const clash = await SavedBuild.findOne({ store: storeId, token }).select("_id").lean();
    if (!clash) return token;
  }
  throw Object.assign(new Error("Build save kora jayni, abar chesta korun"), { status: 503 });
}

async function saveBuild(req, res, next) {
  try {
    const template = await loadTemplate(req);
    if (!template) return res.status(404).json({ message: "Builder pawa jayni" });

    const selections = parseSelections(req.body);
    if (!selections.size) return res.status(400).json({ message: "Kam pokkhe ekta part select korun" });

    const resolved = await resolveSelections(req.publicStore._id, template, selections);
    if (resolved.errors.length) {
      return res.status(400).json({
        code: "build_invalid",
        message: resolved.errors[0].message,
        errors: resolved.errors,
      });
    }

    const { violations, missing } = violationsFor(template, resolved);
    const totals = totalsOf(resolved.items);
    const token = await uniqueToken(req.publicStore._id);

    const build = await SavedBuild.create({
      store: req.publicStore._id,
      template: template._id,
      token,
      name: text(req.body && req.body.name, 120) || template.name,
      user: (req.user && req.user.id) || null,
      sessionId: req.header("x-session-id") || null,
      selections: resolved.items.map((item) => ({
        slot: item.slot,
        product: item.id,
        quantity: item.quantity,
        title: item.title,
        image: item.image,
        price: item.price,
      })),
      subtotal: totals.subtotal,
      // sharing a partial build is fine; the cart endpoint refuses block-level issues
      violations: violations
        .filter((violation) => violation.level === "block")
        .map((violation) => ({
          rule: violation.rule,
          level: violation.level,
          message: violation.message,
          messageBn: violation.messageBn,
        })),
    });

    res.status(201).json({
      token,
      url: `/builder?build=${encodeURIComponent(token)}`,
      ok: !violations.some((violation) => violation.level === "block"),
      build: publicBuild(build, template),
      violations,
      missing,
    });
  } catch (err) {
    next(err);
  }
}

async function getBuild(req, res, next) {
  try {
    const token = text(req.params.token, 40);
    if (!token) return res.status(404).json({ message: "Build pawa jayni" });

    const build = await SavedBuild.findOne({ store: req.publicStore._id, token });
    if (!build) return res.status(404).json({ message: "Build pawa jayni" });

    const template = await BuilderTemplate.findOne({ _id: build.template, status: "published" });
    if (!template) return res.status(404).json({ message: "Builder pawa jayni" });

    const ids = (build.selections || []).map((row) => row.product);
    const products = ids.length
      ? await Product.find({ store: req.publicStore._id, _id: { $in: ids }, status: "published" })
      : [];
    const byId = new Map(products.map((product) => [String(product._id), product]));

    const items = (build.selections || []).map((row) => {
      const product = byId.get(String(row.product));
      const quantity = Number(row.quantity) || 1;
      return {
        slot: row.slot,
        productId: String(row.product),
        quantity,
        title: product ? product.title || product.name || "" : row.title || "",
        image: product ? imageOf(product) : row.image || "",
        price: product ? effectivePrice(product) : Number(row.price) || 0,
        available: !!product,
        inStock: !!product && (Number(product.stock) || 0) >= quantity,
        stock: product ? Number(product.stock) || 0 : 0,
      };
    });

    res.json({
      build: publicBuild(build, template),
      template: publicTemplate(template),
      items,
      totals: {
        count: items.reduce((sum, item) => sum + item.quantity, 0),
        subtotal: money(items.reduce((sum, item) => sum + item.price * item.quantity, 0)),
      },
    });
  } catch (err) {
    next(err);
  }
}

// Re-checks everything that can go stale between building and checkout:
// product still published, still inside the slot filter, compatible, in stock.
async function addBuildToCart(req, res, next) {
  try {
    const template = await loadTemplate(req);
    if (!template) return res.status(404).json({ message: "Builder pawa jayni" });

    let selections = parseSelections(req.body);
    let build = null;
    const token = text(req.body && req.body.token, 40);
    if (token) {
      build = await SavedBuild.findOne({ store: req.publicStore._id, token });
      if (!build || String(build.template) !== String(template._id)) {
        return res.status(404).json({ message: "Build pawa jayni" });
      }
      selections = new Map(
        (build.selections || []).map((row) => [
          row.slot,
          { id: String(row.product), quantity: Number(row.quantity) || 1 },
        ])
      );
    }
    if (!selections.size) return res.status(400).json({ message: "Kam pokkhe ekta part select korun" });

    const storeId = req.publicStore._id;
    const resolved = await resolveSelections(storeId, template, selections);
    if (resolved.errors.length) {
      return res.status(400).json({
        code: "build_invalid",
        message: resolved.errors[0].message,
        errors: resolved.errors,
      });
    }

    const slots = new Map((template.slots || []).map((slot) => [slot.key, slot]));
    for (const [slotKey, product] of Object.entries(resolved.products)) {
      const stillEligible = await productMatchesSlot(storeId, slots.get(slotKey), product);
      if (!stillEligible) {
        return res.status(409).json({
          code: "slot_changed",
          message: `${slots.get(slotKey).labelBn || slots.get(slotKey).label} — এই পণ্যটি আর এই স্লটের জন্য নেই`,
          slot: slotKey,
        });
      }
    }

    const { violations, missing } = violationsFor(template, resolved);
    const blocks = violations.filter((violation) => violation.level === "block");
    if (blocks.length) {
      return res.status(409).json({
        code: missing.length ? "build_incomplete" : "build_incompatible",
        message: blocks[0].messageBn || blocks[0].message,
        violations,
        missing,
      });
    }

    const lines = Object.entries(resolved.products).map(([slotKey, product]) => ({
      product,
      quantity: resolved.quantities[slotKey] || 1,
      build: build ? build._id : null,
    }));

    let cart;
    try {
      cart = await cartController.addBuilderLines(req, lines);
    } catch (err) {
      return res.status(err.status || 400).json({ message: err.message });
    }

    res.status(201).json({ token: build ? build.token : null, items: cart.items });
  } catch (err) {
    next(err);
  }
}

// Two events only: a shopper picked a part, or left with an unfinished build.
// Unknown names are ignored with 204 so a stale client never sees an error.
const TRACKED_EVENTS = new Set(["part_chosen", "build_abandoned"]);

async function trackEvent(req, res, next) {
  try {
    const template = await loadTemplate(req);
    if (!template) return res.status(404).json({ message: "Builder pawa jayni" });

    const name = text(req.body && req.body.event, 30);
    if (!TRACKED_EVENTS.has(name)) return res.status(204).end();

    const slotKey = text(req.body && req.body.slot, 40).toLowerCase();
    const knownSlot = (template.slots || []).some((slot) => slot.key === slotKey);
    const productId = req.body && req.body.productId;
    const rawParts = Number(req.body && req.body.parts);

    await BuilderEvent.create({
      store: req.publicStore._id,
      template: template._id,
      event: name,
      slot: knownSlot ? slotKey : "",
      product: mongoose.isValidObjectId(productId) ? productId : null,
      user: (req.user && req.user.id) || null,
      sessionId: req.header("x-session-id") || null,
      parts: Number.isFinite(rawParts) ? Math.min(Math.max(0, Math.round(rawParts)), 200) : 0,
    });

    res.status(202).json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  builderGate,
  listTemplates,
  getTemplate,
  slotProducts,
  validateBuild,
  saveBuild,
  getBuild,
  addBuildToCart,
  trackEvent,
  // shared with the admin sandbox so both use exactly the same resolver
  parseSelections,
  resolveSelections,
  violationsFor,
  totalsOf,
  effectivePrice,
};
