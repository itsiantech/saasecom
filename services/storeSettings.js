const Store = require("../models/Store");
const StoreSettings = require("../models/StoreSettings");
const SiteSetting = require("../models/SiteSetting");
const ShopFavicon = require("../models/ShopFavicon");
const SocialLink = require("../models/SocialLink");
const { currencyByCode } = require("../lib/currencies");

/* ------------------------------------------------------------------ *
 * Store Settings page er bridge.
 *
 * Storefront branding/contact/social Store / SiteSetting / ShopFavicon /
 * SocialLink theke ashe, ar page ta StoreSettings e likhchilo — duita
 * alada. Ei service ek dike oi live docs theke view banay, onno dike form
 * save korle StoreSettings er sathe sathe live docs o update kore, jate
 * owner er change sathe sathe storefront e dekha jay.
 * ------------------------------------------------------------------ */

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_SHORT = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

const SOCIAL = [
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "twitter", label: "Twitter" },
  { key: "youtube", label: "YouTube" },
  { key: "linkedin", label: "LinkedIn" },
];

const LANGUAGES = ["bn", "en"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value, max = 200) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

// href e javascript: URL gele storefront e XSS — sudhu http(s), scheme chara dile https
function webUrl(value, max = 500) {
  const raw = text(value, max);
  if (!raw) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : "https://" + raw;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href.slice(0, max);
  } catch {
    return null;
  }
}

function decimalIn(value, min, max) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function clock(value) {
  const raw = text(value, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : "";
}

function hourWindow(row) {
  if (row.closed) return "closed";
  return (clock(row.open) || "09:00") + "-" + (clock(row.close) || "18:00");
}

// "Mon-Fri 10:00-19:00, Sat 11:00-15:00, Sun closed" — contact page ei ek line dekhay
function hoursSummary(rows) {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const parts = [];
  let i = 0;
  while (i < DAYS.length) {
    const row = byDay.get(DAYS[i]);
    if (!row) {
      i += 1;
      continue;
    }
    const window = hourWindow(row);
    let j = i + 1;
    while (j < DAYS.length) {
      const next = byDay.get(DAYS[j]);
      if (!next || hourWindow(next) !== window) break;
      j += 1;
    }
    const from = DAY_SHORT[DAYS[i]];
    const to = DAY_SHORT[DAYS[j - 1]];
    parts.push((i === j - 1 ? from : from + "-" + to) + " " + window);
    i = j;
  }
  return parts.join(", ").slice(0, 160);
}

function composeAddress(contact) {
  return [contact.address, contact.city, contact.state, contact.postalCode, contact.country]
    .map((part) => text(part, 120))
    .filter(Boolean)
    .join(", ")
    .slice(0, 300);
}

async function view(storeId) {
  const [store, site, faviconDoc, doc, social] = await Promise.all([
    Store.findById(storeId).lean(),
    SiteSetting.findOne({ store: storeId }).lean(),
    ShopFavicon.findOne({ store: storeId }).lean(),
    StoreSettings.findOne({ storeId }).lean(),
    SocialLink.find({ store: storeId }).sort({ sortOrder: 1, name: 1 }).lean(),
  ]);
  if (!store) return null;

  const contact = (doc && doc.contact) || {};
  const currency = (doc && doc.currency) || {};
  const location = (doc && doc.googleLocation) || {};
  const seo = (doc && doc.seo) || {};
  const storeContact = store.contact || {};
  const code = store.currency || "BDT";

  const socialMap = {};
  social.forEach((row) => {
    const key = text(row.name, 40).toLowerCase();
    if (SOCIAL.some((network) => network.key === key) && !socialMap[key]) {
      socialMap[key] = row.url || "";
    }
  });

  return {
    store: { id: store._id, name: store.name, slug: store.slug },
    websiteTitle: text(site && site.siteTitle) || store.name,
    storeTitle: store.name,
    logo: (site && site.logo) || (doc && doc.logo) || "",
    favicon: (faviconDoc && faviconDoc.icon) || (site && site.favicon) || (doc && doc.favicon) || "",
    googleLocation: {
      address: location.address || storeContact.address || "",
      latitude: location.latitude ?? null,
      longitude: location.longitude ?? null,
      embedUrl: location.embedUrl || storeContact.mapUrl || "",
    },
    currency: {
      code,
      symbol: currency.symbol || (currencyByCode(code) || {}).symbol || code,
      position: currency.position === "after" ? "after" : "before",
      autoCountry: currency.autoCountry !== false,
    },
    language: store.language || "bn",
    footerCopyright: (site && site.footerCopyright) || (doc && doc.footerCopyright) || "",
    contact: {
      phone: storeContact.phone || contact.phone || "",
      alternatePhone: contact.alternatePhone || "",
      email: storeContact.email || contact.email || "",
      alternateEmail: contact.alternateEmail || "",
      address: contact.address || storeContact.address || "",
      city: contact.city || "",
      state: contact.state || "",
      country: contact.country || "",
      postalCode: contact.postalCode || "",
      businessHours: Array.isArray(contact.businessHours)
        ? contact.businessHours.map((row) => ({
            day: row.day,
            open: row.open || "09:00",
            close: row.close || "18:00",
            closed: !!row.closed,
          }))
        : [],
    },
    social: SOCIAL.reduce((acc, network) => ({ ...acc, [network.key]: socialMap[network.key] || "" }), {}),
    seo: {
      metaTitle: seo.metaTitle || "",
      metaDescription: seo.metaDescription || "",
      metaKeywords: seo.metaKeywords || "",
    },
  };
}

// Notun StoreSettings doc banle schema default ("My Store", USD, © 2024) na
// boshiye store er asol man diye seed kori.
function baselineFromStore(store) {
  const code = String(store.currency || "BDT").trim().toUpperCase();
  const language = LANGUAGES.includes(store.language) ? store.language : "bn";
  return {
    websiteTitle: store.name,
    storeTitle: store.name,
    currency: {
      code,
      symbol: (currencyByCode(code) || {}).symbol || code,
      position: "before",
      autoCountry: true,
    },
    language,
    footerCopyright: "",
  };
}

function uncoveredBaseline(store, sets) {
  const paths = Object.keys(sets);
  const onInsert = {};
  for (const [key, value] of Object.entries(baselineFromStore(store))) {
    const covered = paths.some((path) => path === key || path.startsWith(key + "."));
    if (!covered) onInsert[key] = value;
  }
  return onInsert;
}

// Form er ek tab theke asha partial payload — je section ashe shudhu setai write hoy.
async function apply(storeId, body) {
  const input = body && typeof body === "object" ? body : {};
  const [store, existing] = await Promise.all([
    Store.findById(storeId).lean(),
    StoreSettings.findOne({ storeId }).lean(),
  ]);
  if (!store) return { error: "Store pawa jayni" };

  const sets = {};
  const siteSets = {};
  const storeSets = {};
  const socialOps = [];
  const fail = (message) => ({ error: message });

  if (input.websiteTitle !== undefined) {
    const title = text(input.websiteTitle, 160);
    const name = input.storeTitle !== undefined ? text(input.storeTitle, 160) : store.name;
    sets.websiteTitle = title;
    // title ar store name ek-i hole siteTitle pin na kore name fallback-i rakhi
    siteSets.siteTitle = title && title !== name ? title : "";
  }

  if (input.storeTitle !== undefined) {
    const name = text(input.storeTitle, 160);
    if (!name) return fail("Store title khali rakha jabe na");
    sets.storeTitle = name;
    storeSets.name = name;
  }

  if (input.googleLocation && typeof input.googleLocation === "object") {
    const location = input.googleLocation;
    if (location.address !== undefined) sets["googleLocation.address"] = text(location.address, 300);
    if (location.latitude !== undefined) sets["googleLocation.latitude"] = decimalIn(location.latitude, -90, 90);
    if (location.longitude !== undefined) sets["googleLocation.longitude"] = decimalIn(location.longitude, -180, 180);
    if (location.embedUrl !== undefined) {
      const url = webUrl(location.embedUrl, 500);
      if (url === null) return fail("Google Maps embed URL valid na");
      sets["googleLocation.embedUrl"] = url;
      storeSets["contact.mapUrl"] = url;
    }
  }

  if (input.currency && typeof input.currency === "object") {
    const currency = input.currency;
    if (currency.code !== undefined) {
      const code = String(currency.code == null ? "" : currency.code).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) return fail("Currency code 3 letter hote hobe (e.g. BDT)");
      sets["currency.code"] = code;
      storeSets.currency = code;
    }
    if (currency.symbol !== undefined) sets["currency.symbol"] = text(currency.symbol, 8);
    if (currency.position !== undefined) sets["currency.position"] = currency.position === "after" ? "after" : "before";
    if (currency.autoCountry !== undefined) sets["currency.autoCountry"] = !!currency.autoCountry;
  }

  if (input.language !== undefined) {
    const language = String(input.language == null ? "" : input.language).trim().toLowerCase();
    if (!LANGUAGES.includes(language)) return fail("Language bn ba en hote hobe");
    sets.language = language;
    storeSets.language = language;
  }

  if (input.footerCopyright !== undefined) {
    const value = text(input.footerCopyright, 200);
    sets.footerCopyright = value;
    siteSets.footerCopyright = value;
  }

  if (input.contact && typeof input.contact === "object") {
    const contact = input.contact;
    const merged = { ...((existing && existing.contact) || {}) };
    let addressTouched = false;

    if (contact.phone !== undefined) {
      const phone = text(contact.phone, 40);
      sets["contact.phone"] = phone;
      storeSets["contact.phone"] = phone;
    }
    if (contact.email !== undefined) {
      const email = text(contact.email, 160).toLowerCase();
      if (email && !EMAIL_RE.test(email)) return fail("Primary email valid na");
      sets["contact.email"] = email;
      storeSets["contact.email"] = email;
    }
    if (contact.alternatePhone !== undefined) sets["contact.alternatePhone"] = text(contact.alternatePhone, 40);
    if (contact.alternateEmail !== undefined) {
      const email = text(contact.alternateEmail, 160).toLowerCase();
      if (email && !EMAIL_RE.test(email)) return fail("Alternate email valid na");
      sets["contact.alternateEmail"] = email;
    }

    ["address", "city", "state", "country", "postalCode"].forEach((field) => {
      if (contact[field] === undefined) return;
      const value = text(contact[field], 120);
      sets["contact." + field] = value;
      merged[field] = value;
      addressTouched = true;
    });
    if (addressTouched) storeSets["contact.address"] = composeAddress(merged);

    if (Array.isArray(contact.businessHours)) {
      const rows = contact.businessHours
        .filter((row) => row && DAYS.includes(row.day))
        .map((row) => ({
          day: row.day,
          open: clock(row.open) || "09:00",
          close: clock(row.close) || "18:00",
          closed: !!row.closed,
        }));
      sets["contact.businessHours"] = rows;
      storeSets["contact.hours"] = hoursSummary(rows);
    }
  }

  if (input.social && typeof input.social === "object") {
    for (let i = 0; i < SOCIAL.length; i++) {
      const network = SOCIAL[i];
      if (input.social[network.key] === undefined) continue;
      const raw = text(input.social[network.key], 500);
      if (!raw) {
        socialOps.push({ remove: network.key });
        continue;
      }
      const url = webUrl(raw, 500);
      if (url === null) return fail(network.label + " link valid na");
      socialOps.push({ key: network.key, label: network.label, url, sortOrder: i });
    }
  }

  if (input.seo && typeof input.seo === "object") {
    if (input.seo.metaTitle !== undefined) sets["seo.metaTitle"] = text(input.seo.metaTitle, 120);
    if (input.seo.metaDescription !== undefined) sets["seo.metaDescription"] = text(input.seo.metaDescription, 320);
    if (input.seo.metaKeywords !== undefined) sets["seo.metaKeywords"] = text(input.seo.metaKeywords, 300);
  }

  if (Object.keys(sets).length) {
    await StoreSettings.findOneAndUpdate(
      { storeId },
      { $set: sets, $setOnInsert: uncoveredBaseline(store, sets) },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
  if (Object.keys(siteSets).length) {
    await SiteSetting.updateOne({ store: storeId }, { $set: siteSets }, { upsert: true });
  }
  if (Object.keys(storeSets).length) {
    await Store.updateOne({ _id: storeId }, { $set: storeSets }, { runValidators: true });
  }

  for (const op of socialOps) {
    if (op.remove) {
      await SocialLink.deleteMany({ store: storeId, name: new RegExp("^" + op.remove + "$", "i") });
      continue;
    }
    await SocialLink.findOneAndUpdate(
      { store: storeId, name: new RegExp("^" + op.key + "$", "i") },
      { $set: { name: op.label, url: op.url, sortOrder: op.sortOrder } },
      { upsert: true }
    );
  }

  return { settings: await view(storeId) };
}

async function setImage(storeId, field, url) {
  const key = field === "favicon" ? "favicon" : "logo";
  const update = { $set: { [key]: url } };
  if (storeId) {
    const store = await Store.findById(storeId).lean();
    if (store) update.$setOnInsert = uncoveredBaseline(store, update.$set);
  }
  await StoreSettings.findOneAndUpdate({ storeId }, update, { upsert: true, setDefaultsOnInsert: true });
  if (!storeId) return;

  await SiteSetting.updateOne({ store: storeId }, { $set: { [key]: url } }, { upsert: true });
  if (key === "favicon") {
    await ShopFavicon.findOneAndUpdate({ store: storeId }, { $set: { icon: url } }, { upsert: true });
  }
}

module.exports = { view, apply, setImage, hoursSummary };
