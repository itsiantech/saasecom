/* ==========================================================================
   Shared eligibility + quote builder for the retail EMI flow. Both the public
   quote endpoint and the application submit endpoint call this, so a client
   can never submit at a price the quote endpoint would not show.
   ========================================================================== */
const InstallmentOffer = require("../models/InstallmentOffer");
const { normalizeOffer, resolvePolicy, mergeTerms } = require("../lib/installmentSettings");
const { computeQuote, validateTerms, downPaymentFor, MIN_MONTHS } = require("./installmentPricing");
const { toPaisa } = require("../lib/money");

// A variation with no prices of its own sells at the parent product's price —
// same fallback the cart uses when it prices a line.
function pricesOf(source, parent) {
  const read = (row) => ({
    regular: Number(row && (row.regularPrice || row.price)) || 0,
    sale: Number(row && row.salePrice) || 0,
  });
  const own = read(source);
  let regular = own.regular;
  let sale = own.sale;
  if (!regular && !sale && parent) {
    const inherited = read(parent);
    regular = inherited.regular;
    sale = inherited.sale;
  }
  const cash = sale > 0 ? sale : regular;
  return {
    regularPaisa: toPaisa(regular),
    salePaisa: toPaisa(sale),
    cashPaisa: toPaisa(cash),
  };
}

function buildFor({ policy, settings, basePaisa, cashPaisa }) {
  return (offer, downPercent) => {
    const terms = mergeTerms(settings, { offer, policy: policy.policy, rule: policy.rule });
    const termsError = validateTerms(
      { ...terms, months: offer.months },
      { maxMonths: settings.maxMonths, maxAnnualRatePct: settings.maxAnnualRatePct }
    );
    if (termsError) return null;
    const minPercent = Math.min(99, Math.max(terms.minDownPaymentPercent, offer.downPaymentPercent));
    const percent = Math.min(99, Math.max(minPercent, Number(downPercent) || 0));
    const quote = computeQuote({
      basePaisa,
      cashPaisa,
      downPaymentPaisa: downPaymentFor(basePaisa, percent),
      months: offer.months,
      method: terms.method,
      annualRatePct: terms.annualRatePct,
      markupPct: terms.markupPct,
      serviceChargePercent: terms.serviceChargePercent,
      serviceChargeFlatPaisa: terms.serviceChargeFlatPaisa,
    });
    return { offer, terms, quote, minPercent };
  };
}

async function buildOffer({ storeId, product, variation, quantity, settings, offerId, months, downPaymentPercent }) {
  const policy = resolvePolicy(product, settings);
  const unit = pricesOf(variation || product, variation ? product : null);
  const stock = variation ? Number(variation.stock) || 0 : Number(product.stock) || 0;
  const cashPaisa = unit.cashPaisa * quantity;
  const baseUnitPaisa = settings.cashPriceIsSalePrice ? unit.regularPaisa || unit.cashPaisa : unit.cashPaisa;
  const basePaisa = baseUnitPaisa * quantity;

  const offerRows = await InstallmentOffer.find({ store: storeId, isActive: true })
    .sort({ sortOrder: 1, months: 1 })
    .lean();
  const restrictedMonths = (policy.policy && policy.policy.months) || [];
  const allOffers = offerRows
    .map(normalizeOffer)
    .filter((offer) => offer && offer.isActive && offer.months >= MIN_MONTHS && offer.months <= settings.maxMonths);

  const result = {
    policy,
    unit,
    stock,
    cashPaisa,
    baseUnitPaisa,
    basePaisa,
    allOffers,
    options: [],
    selected: null,
    reason: null,
  };

  if (!policy.allowed) {
    result.reason = "product_blocked";
    return result;
  }
  if (stock < quantity) {
    result.reason = "out_of_stock";
    return result;
  }

  const usable = allOffers.filter(
    (offer) =>
      offer.minProductPricePaisa <= basePaisa &&
      (!restrictedMonths.length || restrictedMonths.includes(offer.months))
  );
  if (!usable.length) {
    result.reason = "no_offer";
    return result;
  }

  const make = buildFor({ policy, settings, basePaisa, cashPaisa });
  for (const offer of usable) {
    const built = make(offer, null);
    if (built) result.options.push(built);
  }
  if (!result.options.length) {
    result.reason = "invalid_terms";
    return result;
  }

  const excludedReason = (offer) => {
    if (!offer) return "months_unavailable";
    const monthAllowed = !restrictedMonths.length || restrictedMonths.includes(offer.months);
    if (!monthAllowed) return "months_unavailable";
    return offer.minProductPricePaisa > basePaisa ? "below_min_price" : "months_unavailable";
  };

  let requested = null;
  if (offerId) {
    requested = usable.find((offer) => offer.id === String(offerId)) || null;
    if (!requested) {
      result.reason = excludedReason(allOffers.find((offer) => offer.id === String(offerId)));
      return result;
    }
  } else if (months !== undefined && months !== null && months !== "") {
    const wanted = Number(months);
    if (!Number.isFinite(wanted)) {
      result.reason = "months_unavailable";
      return result;
    }
    requested = usable.find((offer) => offer.months === Math.round(wanted)) || null;
    if (!requested) {
      result.reason = excludedReason(allOffers.find((offer) => offer.months === Math.round(wanted)));
      return result;
    }
  }

  if (requested) {
    result.selected = make(requested, downPaymentPercent);
    if (!result.selected) result.reason = "invalid_terms";
  }
  return result;
}

module.exports = { pricesOf, buildOffer };
