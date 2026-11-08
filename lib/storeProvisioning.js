/* ==========================================================================
   Creating a store and moving it between plans — shared by setup, payment
   approval and plan changes so all three agree on dates and limits.
   ========================================================================== */
const Store = require("../models/Store");
const Subscription = require("../models/Subscription");
const { uniqueSlug } = require("./storeSlug");

function addDays(date, days) {
  const n = Number(days) > 0 ? Number(days) : 30;
  return new Date(date.getTime() + n * 24 * 60 * 60 * 1000);
}

function periodFor(plan, endBase) {
  return {
    status: plan.trialDays > 0 ? "trial" : "active",
    endDate: addDays(endBase, plan.durationDays),
    trialEndsAt: plan.trialDays > 0 ? addDays(endBase, plan.trialDays) : null,
  };
}

async function createStoreWithSubscription({ ownerId, name, slug, plan, startedAt, attempt }) {
  const start = startedAt || new Date();
  const tryNo = attempt || 0;
  const finalSlug = await uniqueSlug(tryNo === 0 ? slug : slug + "-" + Math.random().toString(36).slice(2, 5));

  let store;
  try {
    store = await Store.create({ name, slug: finalSlug, owner: ownerId, plan: plan._id });
  } catch (err) {
    // parallel creation e slug dhore phele — notun suffix diye abar cheshta
    if (err && err.code === 11000 && tryNo < 3) {
      return createStoreWithSubscription({ ownerId, name, slug, plan, startedAt: start, attempt: tryNo + 1 });
    }
    throw err;
  }

  try {
    const subscription = await Subscription.create({
      store: store._id,
      plan: plan._id,
      startDate: start,
      ...periodFor(plan, start),
      lastPaymentAt: start,
    });
    return { store, subscription };
  } catch (err) {
    await Store.deleteOne({ _id: store._id });
    throw err;
  }
}

// plan e feature na thakle oi entitlement (custom domain) store theke chere dite hobe
async function syncFeatureEntitlements(store, plan) {
  if (plan.features && plan.features.customDomain) return;
  if (!store.customDomain && !store.domainToken) return;
  store.customDomain = undefined;
  store.customDomainStatus = "none";
  store.domainToken = null;
  store.domainCheckedAt = null;
  await store.save();
}

// extend=true → chalu period shesh hobar por theke gonona (renewal)
async function applyPlanToStore({ store, plan, startedAt, extend }) {
  const start = startedAt || new Date();
  const existing = await Subscription.findOne({ store: store._id });
  const base = extend && existing && existing.endDate > start ? new Date(existing.endDate) : start;
  const period = periodFor(plan, base);

  let subscription;
  if (existing) {
    existing.plan = plan._id;
    existing.status = period.status;
    existing.startDate = start;
    existing.endDate = period.endDate;
    existing.trialEndsAt = period.trialEndsAt;
    existing.cancelledAt = null;
    existing.autoRenew = true;
    existing.lastPaymentAt = start;
    subscription = await existing.save();
  } else {
    subscription = await Subscription.create({
      store: store._id,
      plan: plan._id,
      startDate: start,
      ...period,
      lastPaymentAt: start,
    });
  }

  await syncFeatureEntitlements(store, plan);
  await Store.findByIdAndUpdate(store._id, { $set: { plan: plan._id } });
  return subscription;
}

module.exports = { addDays, periodFor, createStoreWithSubscription, applyPlanToStore, syncFeatureEntitlements };
