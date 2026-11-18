const mongoose = require("mongoose");
const crypto = require("crypto");
const Product = require("../models/Product");
const ProductVariation = require("../models/ProductVariation");
const InstallmentApplication = require("../models/InstallmentApplication");
const { featuresForStore } = require("../lib/features");
const { getInstallmentSettings, defaultTerms } = require("../lib/installmentSettings");
const { buildOffer } = require("../services/installmentOffers");
const { fromPaisa } = require("../lib/money");
const { encrypt } = require("../lib/secretBox");
const { validateApplicant } = require("../lib/installmentApplicant");
const documents = require("../services/installmentDocuments");

/* ------------------------------------------------------------------ *
 * /api/public/installments/* — cash + EMI offer for the product page.
 * publicStore already ran (store + tenant storage). Every price below is
 * recomputed from the DB; the client only chooses months / down payment.
 * ------------------------------------------------------------------ */

async function installmentsGate(req, res, next) {
  try {
    const access = await featuresForStore(req.publicStore);
    if (!access.features.installments) {
      return res.status(404).json({ message: "Installment pawa jayni" });
    }
    req.installmentAccess = access;
    next();
  } catch (err) {
    next(err);
  }
}

function intArg(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function text(value, max = 200) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function quoteView(quote) {
  return {
    method: quote.method,
    months: quote.months,
    annualRatePct: quote.annualRatePct,
    markupPct: quote.markupPct,
    serviceChargePercent: quote.serviceChargePercent,
    basePaisa: quote.basePaisa,
    base: fromPaisa(quote.basePaisa),
    cashPaisa: quote.cashPaisa,
    cash: fromPaisa(quote.cashPaisa),
    downPaymentPaisa: quote.downPaymentPaisa,
    downPayment: fromPaisa(quote.downPaymentPaisa),
    downPaymentPercent: quote.downPaymentPercent,
    financedPaisa: quote.financedPaisa,
    financed: fromPaisa(quote.financedPaisa),
    profitPaisa: quote.profitPaisa,
    profit: fromPaisa(quote.profitPaisa),
    serviceChargePaisa: quote.serviceChargePaisa,
    serviceCharge: fromPaisa(quote.serviceChargePaisa),
    installmentTotalPaisa: quote.installmentTotalPaisa,
    installmentTotal: fromPaisa(quote.installmentTotalPaisa),
    totalPayablePaisa: quote.totalPayablePaisa,
    totalPayable: fromPaisa(quote.totalPayablePaisa),
    monthlyPaisa: quote.monthlyPaisa,
    monthly: fromPaisa(quote.monthlyPaisa),
    lastPaisa: quote.lastPaisa,
    last: fromPaisa(quote.lastPaisa),
    effectiveAnnualRatePct: quote.effectiveAnnualRatePct,
    schedule: quote.schedule.map((row) => ({
      number: row.number,
      amountPaisa: row.amountPaisa,
      amount: fromPaisa(row.amountPaisa),
    })),
  };
}

function optionView(built) {
  return {
    offerId: built.offer.id,
    name: built.offer.name,
    months: built.offer.months,
    minDownPaymentPercent: built.minPercent,
    downPaymentPaisa: built.quote.downPaymentPaisa,
    downPayment: fromPaisa(built.quote.downPaymentPaisa),
    monthlyPaisa: built.quote.monthlyPaisa,
    monthly: fromPaisa(built.quote.monthlyPaisa),
    lastPaisa: built.quote.lastPaisa,
    totalPayablePaisa: built.quote.totalPayablePaisa,
    totalPayable: fromPaisa(built.quote.totalPayablePaisa),
    effectiveAnnualRatePct: built.quote.effectiveAnnualRatePct,
  };
}

function settingsView(store, settings) {
  return {
    enabled: settings.enabled === true,
    cashPriceIsSalePrice: settings.cashPriceIsSalePrice,
    maxMonths: settings.maxMonths,
    applicant: settings.applicant,
    lateFee: settings.lateFee,
    reminderDays: settings.reminderDays,
    cardEmi: settings.cardEmi,
    // the store — not the platform — owns collection; owner can override this
    terms: settings.terms || defaultTerms(store.name),
  };
}

const BLOCKED_MESSAGES = {
  store_disabled: "এই দোকানে কিস্তি সুবিধা চালু নেই",
  product_blocked: "এই পণ্যে কিস্তি সুবিধা প্রযোজ্য নয়",
  out_of_stock: "স্টকে পর্যাপ্ত পণ্য নেই",
  no_offer: "এই পণ্যের জন্য কোনো কিস্তি প্ল্যান নেই",
  months_unavailable: "এই সংখ্যক কিস্তি পাওয়া যাচ্ছে না",
  below_min_price: "পণ্যটি এই প্ল্যানের ন্যূনতম দামের চেয়ে কম",
  invalid_terms: "কিস্তির হিসাব কনফিগার করা যায়নি",
  plan_required: "কিস্তি প্ল্যান বেছে নিন",
};

function blocked(reason) {
  return {
    eligible: false,
    reason,
    message: BLOCKED_MESSAGES[reason] || "কিস্তি পাওয়া যাচ্ছে না",
  };
}

async function findProduct(storeId, key) {
  const filter = mongoose.isValidObjectId(key)
    ? { store: storeId, status: "published", _id: key }
    : { store: storeId, status: "published", slug: key.toLowerCase() };
  return Product.findOne(filter).lean();
}

async function pickVariation(storeId, product, variationId) {
  if (!product.hasVariations) return { variation: null };
  const rows = await ProductVariation.find({ store: storeId, product: product._id })
    .sort({ createdAt: 1 })
    .lean();
  if (variationId) {
    const match = rows.find((row) => String(row._id) === String(variationId));
    return match ? { variation: match } : { error: "এই ভ্যারিয়েন্ট পাওয়া যায়নি" };
  }
  return { variation: rows.find((row) => Number(row.stock) > 0) || rows[0] || null };
}

async function getConfig(req, res, next) {
  try {
    const settings = await getInstallmentSettings(req.publicStore._id);
    res.json(settingsView(req.publicStore, settings));
  } catch (err) {
    next(err);
  }
}

async function quote(req, res, next) {
  try {
    const store = req.publicStore;
    const body = req.body || {};
    const settings = await getInstallmentSettings(store._id);
    const config = settingsView(store, settings);

    if (!settings.enabled) {
      return res.json({ enabled: false, ...blocked("store_disabled"), config });
    }

    const key = text(body.productId || body.slug || body.productSlug, 200);
    if (!key) return res.status(400).json({ message: "productId বা slug দিতে হবে" });

    const product = await findProduct(store._id, key);
    if (!product) return res.status(404).json({ message: "পণ্য পাওয়া যায়নি" });

    const quantity = intArg(body.quantity, 1, 999, 1);
    const picked = await pickVariation(store._id, product, body.variationId);
    if (picked.error) return res.status(404).json({ message: picked.error });
    const variation = picked.variation;

    const offer = await buildOffer({
      storeId: store._id,
      product,
      variation,
      quantity,
      settings,
      offerId: body.offerId,
      months: body.months,
      downPaymentPercent: body.downPaymentPercent,
    });

    const productView = {
      id: String(product._id),
      title: product.title || product.name || "",
      slug: product.slug || String(product._id),
      image: (product.images || [])[0] || "",
      quantity,
      stock: offer.stock,
      variation: variation
        ? { id: String(variation._id), name: variation.termName || "", stock: Number(variation.stock) || 0 }
        : null,
    };
    const cashView = {
      unitPaisa: offer.unit.cashPaisa,
      unit: fromPaisa(offer.unit.cashPaisa),
      totalPaisa: offer.cashPaisa,
      total: fromPaisa(offer.cashPaisa),
      regularUnitPaisa: offer.unit.regularPaisa,
      saleUnitPaisa: offer.unit.salePaisa,
    };
    const policyView = {
      source: offer.policy.source,
      note: (offer.policy.policy && offer.policy.policy.note) || "",
    };

    if (offer.reason) {
      const payload = {
        enabled: true,
        ...blocked(offer.reason),
        product: productView,
        cash: cashView,
        config,
      };
      if (offer.reason === "product_blocked") payload.policy = policyView;
      return res.json(payload);
    }

    const options = offer.options.map(optionView);
    const selected = offer.selected
      ? { offerId: offer.selected.offer.id, name: offer.selected.offer.name, ...quoteView(offer.selected.quote) }
      : null;

    res.json({
      enabled: true,
      eligible: true,
      reason: null,
      policy: policyView,
      product: productView,
      cash: cashView,
      installment: {
        baseUnitPaisa: offer.baseUnitPaisa,
        baseUnit: fromPaisa(offer.baseUnitPaisa),
        basePaisa: offer.basePaisa,
        base: fromPaisa(offer.basePaisa),
        maxMonths: Math.max(...options.map((option) => option.months)),
        minDownPaymentPercent: Math.min(...options.map((option) => option.minDownPaymentPercent)),
        options,
        selected,
      },
      config,
    });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * POST /apply — the shopper commits to one plan. Everything the client
 * sent about money is ignored; the same buildOffer() that powered the
 * visible quote is recomputed here. Stock is reserved atomically before
 * the application row is written (same guarded update as cart checkout).
 * ------------------------------------------------------------------ */

function newNumber() {
  return "EMI-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

async function releaseStock(target, targetId, storeId, quantity) {
  await target
    .updateOne({ _id: targetId, store: storeId }, { $inc: { stock: quantity } })
    .catch((err) => console.error("emi stock release:", err.message));
}

function applicationView(doc) {
  const quoteRow = doc.quote || {};
  const item = (doc.items || [])[0] || {};
  return {
    id: String(doc._id),
    number: doc.number,
    status: doc.status,
    createdAt: doc.createdAt,
    product: {
      title: item.title || "",
      slug: item.slug || "",
      image: item.image || "",
      quantity: item.quantity || 1,
    },
    months: quoteRow.months || 0,
    cashPaisa: doc.cashPaisa,
    cash: fromPaisa(doc.cashPaisa),
    basePaisa: doc.basePaisa,
    base: fromPaisa(doc.basePaisa),
    downPaymentPaisa: quoteRow.downPaymentPaisa || 0,
    downPayment: fromPaisa(quoteRow.downPaymentPaisa),
    monthlyPaisa: quoteRow.monthlyPaisa || 0,
    monthly: fromPaisa(quoteRow.monthlyPaisa),
    lastPaisa: quoteRow.lastPaisa || 0,
    last: fromPaisa(quoteRow.lastPaisa),
    serviceChargePaisa: quoteRow.serviceChargePaisa || 0,
    serviceCharge: fromPaisa(quoteRow.serviceChargePaisa),
    totalPayablePaisa: quoteRow.totalPayablePaisa || 0,
    totalPayable: fromPaisa(quoteRow.totalPayablePaisa),
  };
}

async function apply(req, res, next) {
  try {
    const store = req.publicStore;
    const body = req.body || {};
    const settings = await getInstallmentSettings(store._id);

    if (!settings.enabled) {
      return res.status(400).json({ code: "store_disabled", ...blocked("store_disabled") });
    }

    const idempotencyKey = text(body.idempotencyKey, 80);
    if (idempotencyKey.length < 8) {
      return res.status(400).json({ code: "idempotency_required", message: "অনুরোধটি আবার পাঠান (request key missing)" });
    }

    // A retried submit must never reserve stock twice.
    const existing = await InstallmentApplication.findOne({ store: store._id, idempotencyKey }).lean();
    if (existing) {
      return res.json({ ok: true, duplicate: true, application: applicationView(existing) });
    }

    if (body.termsAccepted !== true) {
      return res.status(400).json({ code: "terms_required", message: "শর্তাবলীতে সম্মতি দেওয়া লাগবে" });
    }

    const key = text(body.productId || body.slug || body.productSlug, 200);
    if (!key) return res.status(400).json({ message: "productId বা slug দিতে হবে" });

    const product = await findProduct(store._id, key);
    if (!product) return res.status(404).json({ message: "পণ্য পাওয়া যায়নি" });

    const quantity = intArg(body.quantity, 1, 999, 1);
    const picked = await pickVariation(store._id, product, body.variationId);
    if (picked.error) return res.status(404).json({ message: picked.error });
    const variation = picked.variation;

    const offer = await buildOffer({
      storeId: store._id,
      product,
      variation,
      quantity,
      settings,
      offerId: body.offerId,
      months: body.months,
      downPaymentPercent: body.downPaymentPercent,
    });

    if (offer.reason) {
      return res.status(400).json({ code: offer.reason, ...blocked(offer.reason) });
    }
    if (!offer.selected) {
      return res.status(400).json({ code: "plan_required", ...blocked("plan_required") });
    }

    const checked = validateApplicant(body.applicant || {}, settings);
    if (checked.error) {
      return res.status(400).json({ code: "invalid_applicant", message: checked.error });
    }
    const applicant = checked.value;

    // Tokens were issued by /documents; resolve them before touching stock.
    let claimedDocs = [];
    try {
      claimedDocs = await documents.claimTokens({ storeId: store._id, tokens: body.documents });
      documents.assertRequiredTypes(claimedDocs, settings);
    } catch (err) {
      return res.status(err.status || 400).json({
        code: "documents_required",
        message: err.message,
      });
    }

    const target = variation ? ProductVariation : Product;
    const targetId = (variation || product)._id;
    const reserved = await target.findOneAndUpdate(
      { _id: targetId, store: store._id, stock: { $gte: quantity } },
      { $inc: { stock: -quantity } },
      { returnDocument: "after" }
    );
    if (!reserved) {
      return res.status(400).json({ code: "out_of_stock", ...blocked("out_of_stock") });
    }

    const snapshot = { ...offer.selected.offer, terms: offer.selected.terms };
    const doc = {
      store: store._id,
      user: req.user && req.user.id ? req.user.id : null,
      applicant: { ...applicant, nidEnc: applicant.nid ? encrypt({ nid: applicant.nid }) : "" },
      items: [
        {
          product: product._id,
          variation: variation ? variation._id : null,
          title: product.title || product.name || "",
          slug: product.slug || "",
          image: (variation && variation.image) || (product.images || [])[0] || "",
          quantity,
          unitBasePaisa: offer.baseUnitPaisa,
          lineBasePaisa: offer.basePaisa,
        },
      ],
      cashPaisa: offer.cashPaisa,
      basePaisa: offer.basePaisa,
      offer: mongoose.isValidObjectId(offer.selected.offer.id) ? offer.selected.offer.id : null,
      offerSnapshot: snapshot,
      quote: offer.selected.quote,
      status: settings.review.approvalRequired ? "pending_review" : "approved",
      stockReserved: true,
      termsAcceptedAt: new Date(),
      idempotencyKey,
    };

    let created = null;
    let lastError = null;
    for (let attempt = 0; attempt < 4 && !created; attempt += 1) {
      try {
        created = await InstallmentApplication.create({ ...doc, number: newNumber() });
      } catch (err) {
        lastError = err;
        if (!err || err.code !== 11000) break;
        if (err.keyPattern && err.keyPattern.idempotencyKey) {
          await releaseStock(target, targetId, store._id, quantity);
          const first = await InstallmentApplication.findOne({ store: store._id, idempotencyKey }).lean();
          if (first) return res.json({ ok: true, duplicate: true, application: applicationView(first) });
          break;
        }
      }
    }

    if (!created) {
      await releaseStock(target, targetId, store._id, quantity);
      throw lastError || new Error("Application save failed");
    }

    if (claimedDocs.length) {
      try {
        await documents.attachDocuments({
          storeId: store._id,
          applicationId: created._id,
          rows: claimedDocs,
        });
      } catch (err) {
        await InstallmentApplication.deleteOne({ _id: created._id, store: store._id }).catch(() => {});
        await releaseStock(target, targetId, store._id, quantity);
        throw err;
      }
    }

    // Stores that skip manual review get a live installment order immediately;
    // the application still exists for the audit trail.
    if (settings.review.approvalRequired === false) {
      try {
        const { approveApplication } = require("../services/retailInstallmentOrders");
        await approveApplication({ applicationId: created._id, storeId: store._id, actorUserId: null });
        created = await InstallmentApplication.findById(created._id);
      } catch (err) {
        console.error("retail emi auto-approve:", err.message);
      }
    }

    res.status(201).json({ ok: true, application: applicationView(created) });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ *
 * POST /documents — one file per request, base64 JSON so the Next proxy
 * keeps working unchanged. The response token is the only handle the
 * shopper needs; the file itself never gets a public URL.
 * ------------------------------------------------------------------ */
async function uploadDocument(req, res, next) {
  try {
    const store = req.publicStore;
    const body = req.body || {};
    const result = await documents.uploadDocument({
      storeId: store._id,
      type: body.type,
      filename: body.filename,
      data: body.data,
    });
    res.status(201).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
}

module.exports = { installmentsGate, getConfig, quote, apply, uploadDocument };
