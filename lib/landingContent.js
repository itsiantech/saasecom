const Settings = require("../models/Settings");

const SETTINGS_KEY = "landingContent";

const CAPS = {
  links: 10,
  chips: 3,
  features: 12,
  plans: 4,
  planFeatures: 20,
  steps: 10,
  ticks: 10,
  cardLines: 6,
  designs: 16,
  partners: 24,
  faq: 30,
  extras: 12,
};

const TEXT = 240;
const TITLE = 140;
const BODY = 1600;
const URL_MAX = 600;

const HREF_RE = /^(#[\w-]*|\/(?!\/)[^\s"'<>]{0,500}|https?:\/\/[^\s"'<>]{1,500}|mailto:[^\s"'<>]{1,200}|tel:\+?[0-9 ()-]{3,30})$/i;
const IMAGE_RE = /^(https?:\/\/[^\s"'<>]{1,500}|\/uploads\/(?:landing|branding)\/[A-Za-z0-9._-]{1,200})$/i;
const COLOR_RE = /^#[0-9a-f]{3,8}$/i;

function text(value, max = TEXT) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);
}

function block(value, max = BODY) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function href(value, fallback) {
  const raw = text(value, URL_MAX);
  if (!raw) return fallback;
  return HREF_RE.test(raw) ? raw : fallback;
}

function image(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  return IMAGE_RE.test(raw) ? raw : "";
}

function color(value, fallback) {
  const raw = typeof value === "string" ? value.trim() : "";
  return COLOR_RE.test(raw) ? raw : fallback;
}

function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function list(value, cap) {
  return Array.isArray(value) ? value.slice(0, cap) : [];
}

function strOr(value, fallback, max = TEXT) {
  if (typeof value !== "string") return fallback;
  return text(value, max) || fallback;
}

function link(raw, fallback) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    label: strOr(src.label, fallback.label, 80),
    href: href(src.href, fallback.href),
  };
}

function links(value, fallback) {
  const items = list(value, CAPS.links);
  if (!items.length) return fallback.map((l) => ({ ...l }));
  return items.map((item, i) => link(item, fallback[i] || fallback[fallback.length - 1]));
}

function defaults() {
  return {
    version: 1,
    brand: { name: "Amar", accent: "Bazaar", logo: "", favicon: "" },
    meta: {
      title: "Amar Bazaar — আপনার নিজের ঠিকানায় অনলাইন দোকান",
      description:
        "আপনার দোকান, আপনার নিজের ঠিকানায়। প্যাকেজ বেছে নিন, দোকানের নাম লিখুন — প্রোডাক্ট, অর্ডার, কাস্টমার, রিপোর্ট সব এক জায়গায়।",
    },
    whatsapp: {
      enabled: true,
      number: "",
      text: "আমি Amar Bazaar সম্পর্কে জানতে চাই",
      label: "চ্যাট করুন",
    },
    nav: {
      enabled: true,
      links: [
        { label: "ফিচার", href: "#features" },
        { label: "প্যাকেজ", href: "#pricing" },
        { label: "দোকানের ঠিকানা", href: "#address" },
        { label: "প্রশ্নোত্তর", href: "#faq" },
      ],
      showLogin: true,
      loginLabel: "লগ-ইন",
      loginHref: "/login.html",
      ctaLabel: "দোকান খুলুন",
      ctaHref: "/login.html?next=%2Fportal.html",
    },
    hero: {
      enabled: true,
      eyebrow: "SaaS স্টোর প্ল্যাটফর্ম",
      title: "আপনার দোকান,",
      accent: "আপনার নিজের ঠিকানায়।",
      subtitle:
        "প্যাকেজ বেছে নিন, দোকানের নাম লিখুন — ব্যস। প্রোডাক্ট, অর্ডার, কাস্টমার, রিপোর্ট সব এক জায়গায়। কোডিং লাগবে না, সার্ভার ভাড়া লাগবে না।",
      primaryLabel: "ফ্রি দোকান খুলুন",
      primaryHref: "/login.html?next=%2Fportal.html",
      secondaryLabel: "প্যাকেজ দেখুন",
      secondaryHref: "#pricing",
      note: "ফ্রি প্যাকেজে শুরু করুন — যেকোনো সময় আপগ্রেড।",
      mockUrl: "luxe.shop/amar-dokan",
      badge: "আপনার ঠিকানা প্রস্তুত",
      chips: [
        { label: "bKash", color: "#e2136e" },
        { label: "Pathao", color: "#ff3b30" },
        { label: "Steadfast", color: "#23b26d" },
      ],
    },
    features: {
      enabled: true,
      eyebrow: "ফিচার",
      title: "একটি প্ল্যাটফর্মে",
      accent: "সবকিছু",
      subtitle: "দোকান চালাতে যা যা লাগে — সব হাতের মুঠোয়।",
      items: [
        { title: "Product Management", text: "প্রোডাক্ট, ভ্যারিয়েন্ট ও ক্যাটাগরি পরিচালনা।", wide: false },
        { title: "Order & Delivery", text: "অর্ডার, কুরিয়ার ও ডেলিভারি ট্র্যাক করুন।", wide: false },
        { title: "Marketing Tools", text: "কুপন, ক্যাম্পেইন ও কাস্টমার সেগমেন্ট।", wide: false },
        { title: "Landing Page", text: "ল্যান্ডিং পেইজ ম্যানেজমেন্ট।", wide: false },
        { title: "Account & Inventory", text: "একাউন্ট ও ইনভেন্টরি ম্যানেজমেন্ট।", wide: false },
        { title: "Sales & Reports", text: "বিক্রি, প্রফিট ও স্টক রিপোর্ট রিয়েল টাইমে।", wide: false },
        { title: "Integrations", text: "পেমেন্ট, এসএমএস ও কুরিয়ার কানেক্ট করুন।", wide: true },
      ],
    },
    pricing: {
      enabled: true,
      eyebrow: "প্যাকেজ",
      title: "আপনার কাজের মাপে",
      accent: "বেছে নিন",
      subtitle: "সব প্যাকেজেই অসীম কাস্টমার, অর্ডার প্রসেসিং আর মোবাইল-ফ্রেন্ডলি দোকান।",
      plans: [
        {
          tag: "শুরু করুন",
          name: "Free",
          price: "৳ 0",
          per: "/মাস",
          featured: false,
          ctaLabel: "ফ্রি দোকান খুলুন",
          ctaHref: "/login.html?next=%2Fportal.html",
          features: [
            { text: "প্রোডাক্ট: 10টি", on: true },
            { text: "মাসে অর্ডার: 50টি", on: true },
            { text: "স্টাফ অ্যাকাউন্ট: 1জন", on: true },
            { text: "স্টোরেজ: 100MB", on: true },
            { text: "কাস্টম ডোমেইন", on: false },
            { text: "বিক্রি অ্যানালিটিক্স", on: false },
            { text: "API অ্যাক্সেস", on: false },
            { text: "প্রায়োরিটি সাপোর্ট", on: false },
          ],
        },
        {
          tag: "সবচেয়ে বেশি ফিচার",
          name: "Pro",
          price: "৳ 400",
          per: "/মাস",
          featured: true,
          ctaLabel: "এই প্যাকেজ নিন",
          ctaHref: "/plan-checkout.html?plan=pro",
          features: [
            { text: "প্রোডাক্ট: 100টি", on: true },
            { text: "মাসে অর্ডার: 1,000টি", on: true },
            { text: "স্টাফ অ্যাকাউন্ট: 10জন", on: true },
            { text: "স্টোরেজ: 20,000MB", on: true },
            { text: "কাস্টম ডোমেইন", on: true },
            { text: "বিক্রি অ্যানালিটিক্স", on: true },
            { text: "API অ্যাক্সেস", on: true },
            { text: "প্রায়োরিটি সাপোর্ট", on: false },
          ],
        },
      ],
      footer: "যেকোনো প্যাকেজে শুরু করে পরে আপগ্রেড করা যায় — দোকানের ডেটা ঠিক থাকে।",
    },
    steps: {
      enabled: true,
      eyebrow: "কীভাবে শুরু করবেন",
      title: "মাত্র",
      accent: "৫ ধাপে",
      titleEnd: "দোকান চালু",
      subtitle: "কয়েক মিনিটেই আপনার অনলাইন দোকান রেডি।",
      items: [
        { title: "দোকান খুলুন ক্লিক", text: "হোমপেজ থেকে বাটনে ক্লিক করুন" },
        { title: "সাইন আপ", text: "নাম, ইমেইল ও পাসওয়ার্ড দিন" },
        { title: "নাম ও slug", text: "দোকানের নাম ও ঠিকানা লিখুন" },
        { title: "প্যাকেজ সিলেক্ট", text: "Free বা Pro বেছে নিন" },
        {
          title: "সাবডোমেইন তৈরি",
          text: "নিজস্ব ডোমেইনও যোগ করুন, তারপর অ্যাডমিন প্যানেলে যান",
        },
      ],
    },
    address: {
      enabled: true,
      eyebrow: "দোকানের ঠিকানা",
      title: "প্রতিটি দোকান পায়",
      accent: "নিজস্ব ঠিকানা",
      subtitle:
        "দোকান খুললেই [[luxe.shop/আপনার-নাম]] ধরনের একটা ঠিকানা পাবেন — কাস্টমার সেই লিংক দিয়েই আপনার প্রোডাক্ট দেখবে, কার্টে দেবে, অর্ডার করবে। পেছনে প্রতিটি দোকানের ডেটা আলাদা থাকে, অন্য দোকানে কিছুই দেখে না।",
      ticks: [
        "আপনার পছন্দের slug (যেমন: [[sadia-fashion]])",
        "প্রোডাক্ট, অর্ডার, কাস্টমার — সব আলাদা দোকানে আলাদা",
        "একই অ্যাকাউন্টে একাধিক দোকান",
      ],
      cardLabel: "যেমন",
      cardLines: [
        { prefix: "luxe.shop/", name: "sadia-fashion" },
        { prefix: "luxe.shop/", name: "karigar-hat" },
        { prefix: "luxe.shop/", name: "tech-bazar" },
      ],
      cardNote: "প্রতিটি = আলাদা দোকান, আলাদা মালিক",
    },
    designs: {
      enabled: true,
      eyebrow: "ডিজাইন",
      title: "আমাদের",
      accent: "ডিজাইন সমূহ",
      subtitle: "রেডিমেড থিম বেছে নিন, এক ক্লিকে নিজের করে নিন। (কার্ডে মাউস নিলে পুরো পেজ স্ক্রল হয়ে দেখা যাবে)",
      items: [
        { name: "Tech & Gadgets", scene: "ev", image: "", alt: "" },
        { name: "Organic Food", scene: "of", image: "", alt: "" },
        { name: "Fashion Wear", scene: "fw", image: "", alt: "" },
        { name: "Perfume & Attar", scene: "pf", image: "", alt: "" },
      ],
    },
    partners: {
      enabled: true,
      eyebrow: "Integrated Partners",
      title: "সব সার্ভিস",
      accent: "একসাথে",
      subtitle:
        "পেমেন্ট, কুরিয়ার, এসএমএস, লজিস্টিকস এবং আরও অনেক সার্ভিস—সবই Amar Bazaar-এর সাথে ইন্টিগ্রেটেড।",
      items: ["Meta", "bKash", "Steadfast", "Obiram", "SSLCommerz", "Pathao", "DGPay", "RedX"],
    },
    faq: {
      enabled: true,
      eyebrow: "FAQ",
      title: "Frequently asked questions",
      accent: "",
      subtitle: "",
      items: [
        {
          q: "Can I get Amarbazaar Free?",
          a: "হ্যাঁ। Free প্যাকেজে ১০টি প্রোডাক্ট ও মাসে ৫০টি অর্ডার পর্যন্ত বিনামূল্যে চালাতে পারবেন, কার্ড লাগবে না।",
        },
        {
          q: "What is Amarbazaar?",
          a: "Amar Bazaar একটি SaaS স্টোর প্ল্যাটফর্ম, যেখানে কোডিং ছাড়াই নিজের অনলাইন দোকান খুলে প্রোডাক্ট, অর্ডার ও রিপোর্ট ম্যানেজ করা যায়।",
        },
        {
          q: "Can I use my own domain and branding?",
          a: "Pro প্যাকেজে নিজের কাস্টম ডোমেইন যোগ করে নিজের ব্র্যান্ডিংয়ে দোকান চালাতে পারবেন।",
        },
        {
          q: "Can Amarbazaar grow with my business?",
          a: "অবশ্যই। যেকোনো সময় প্যাকেজ আপগ্রেড করা যায় এবং আপনার দোকানের সব ডেটা ঠিক থাকে।",
        },
      ],
    },
    cta: {
      enabled: true,
      title: "এখনই শুরু করুন আপনার",
      accent: "অনলাইন স্টোর",
      subtitle: "ফ্রি ট্রায়ালে সেটআপ দেখে নিন। কার্ড লাগবে না।",
      primaryLabel: "Start Free Trial →",
      primaryHref: "/login.html?next=%2Fportal.html",
      secondaryLabel: "Request a demo",
      secondaryHref: "/login.html?next=%2Fportal.html",
    },
    footer: {
      enabled: true,
      tagline: "ছোট ব্যবসার জন্য সহজ অনলাইন দোকান।",
      links: [
        { label: "প্যাকেজ", href: "#pricing" },
        { label: "দোকানের ঠিকানা", href: "#address" },
        { label: "লগ-ইন", href: "/login.html" },
        { label: "দোকান খুলুন", href: "/login.html?next=%2Fportal.html" },
        { label: "প্ল্যাটফর্ম অ্যাডমিন", href: "/admin-login.html" },
      ],
      copyright: "© 2026 Amar Bazaar — সর্বস্বত্ব সংরক্ষিত",
      note: "Made for small shops in Bangladesh",
    },
    extras: [],
  };
}

function head(src, base) {
  const raw = src && typeof src === "object" ? src : {};
  return {
    enabled: bool(raw.enabled, base.enabled),
    eyebrow: text(raw.eyebrow, 80) || base.eyebrow,
    title: strOr(raw.title, base.title, TITLE),
    accent: typeof raw.accent === "string" ? text(raw.accent, TITLE) : base.accent,
    ...(base.titleEnd !== undefined
      ? { titleEnd: typeof raw.titleEnd === "string" ? text(raw.titleEnd, TITLE) : base.titleEnd }
      : {}),
    subtitle: typeof raw.subtitle === "string" ? text(raw.subtitle, 400) : base.subtitle,
  };
}

function normalizeContent(raw) {
  const d = defaults();
  const src = raw && typeof raw === "object" ? raw : {};

  const brandSrc = src.brand && typeof src.brand === "object" ? src.brand : {};
  const metaSrc = src.meta && typeof src.meta === "object" ? src.meta : {};
  const waSrc = src.whatsapp && typeof src.whatsapp === "object" ? src.whatsapp : {};
  const navSrc = src.nav && typeof src.nav === "object" ? src.nav : {};
  const heroSrc = src.hero && typeof src.hero === "object" ? src.hero : {};
  const featSrc = src.features && typeof src.features === "object" ? src.features : {};
  const priceSrc = src.pricing && typeof src.pricing === "object" ? src.pricing : {};
  const stepSrc = src.steps && typeof src.steps === "object" ? src.steps : {};
  const addrSrc = src.address && typeof src.address === "object" ? src.address : {};
  const designSrc = src.designs && typeof src.designs === "object" ? src.designs : {};
  const partnerSrc = src.partners && typeof src.partners === "object" ? src.partners : {};
  const faqSrc = src.faq && typeof src.faq === "object" ? src.faq : {};
  const ctaSrc = src.cta && typeof src.cta === "object" ? src.cta : {};
  const footSrc = src.footer && typeof src.footer === "object" ? src.footer : {};

  const chips = list(heroSrc.chips, CAPS.chips);
  const features = list(featSrc.items, CAPS.features);
  const plans = list(priceSrc.plans, CAPS.plans);
  const steps = list(stepSrc.items, CAPS.steps);
  const ticks = list(addrSrc.ticks, CAPS.ticks);
  const cardLines = list(addrSrc.cardLines, CAPS.cardLines);
  const designs = list(designSrc.items, CAPS.designs);
  const partners = list(partnerSrc.items, CAPS.partners);
  const faqItems = list(faqSrc.items, CAPS.faq);
  const extras = list(src.extras, CAPS.extras);

  return {
    version: 1,
    brand: {
      name: strOr(brandSrc.name, d.brand.name, 60),
      accent: typeof brandSrc.accent === "string" ? text(brandSrc.accent, 60) : d.brand.accent,
      logo: image(brandSrc.logo),
      favicon: image(brandSrc.favicon),
    },
    meta: {
      title: strOr(metaSrc.title, d.meta.title, TITLE),
      description: typeof metaSrc.description === "string" ? text(metaSrc.description, 400) : d.meta.description,
    },
    whatsapp: (function () {
      const digits = text(waSrc.number, 24).replace(/[^\d+]/g, "");
      return {
        enabled: bool(waSrc.enabled, d.whatsapp.enabled),
        number: digits.replace(/\D/g, "").length >= 8 ? digits.replace(/\D/g, "") : "",
        text: typeof waSrc.text === "string" ? text(waSrc.text, 300) : d.whatsapp.text,
        label: strOr(waSrc.label, d.whatsapp.label, 40),
      };
    })(),
    nav: {
      enabled: bool(navSrc.enabled, d.nav.enabled),
      links: links(navSrc.links, d.nav.links),
      showLogin: bool(navSrc.showLogin, d.nav.showLogin),
      loginLabel: strOr(navSrc.loginLabel, d.nav.loginLabel, 40),
      loginHref: href(navSrc.loginHref, d.nav.loginHref),
      ctaLabel: strOr(navSrc.ctaLabel, d.nav.ctaLabel, 40),
      ctaHref: href(navSrc.ctaHref, d.nav.ctaHref),
    },
    hero: {
      ...head({ ...heroSrc, enabled: heroSrc.enabled, subtitle: heroSrc.subtitle }, {
        enabled: d.hero.enabled,
        eyebrow: d.hero.eyebrow,
        title: d.hero.title,
        accent: d.hero.accent,
        subtitle: d.hero.subtitle,
      }),
      primaryLabel: strOr(heroSrc.primaryLabel, d.hero.primaryLabel, 60),
      primaryHref: href(heroSrc.primaryHref, d.hero.primaryHref),
      secondaryLabel: strOr(heroSrc.secondaryLabel, d.hero.secondaryLabel, 60),
      secondaryHref: href(heroSrc.secondaryHref, d.hero.secondaryHref),
      note: typeof heroSrc.note === "string" ? text(heroSrc.note, 240) : d.hero.note,
      mockUrl: strOr(heroSrc.mockUrl, d.hero.mockUrl, 120),
      badge: strOr(heroSrc.badge, d.hero.badge, 80),
      chips: chips.length
        ? chips.map((chip, i) => ({
            label: strOr(chip && chip.label, d.hero.chips[i] ? d.hero.chips[i].label : "Chip", 30),
            color: color(chip && chip.color, d.hero.chips[i] ? d.hero.chips[i].color : "#00cfc4"),
          }))
        : d.hero.chips.map((c) => ({ ...c })),
    },
    features: {
      ...head(featSrc, d.features),
      items: features.length
        ? features.map((item, i) => ({
            title: strOr(item && item.title, d.features.items[i] ? d.features.items[i].title : "Feature", 80),
            text: typeof (item && item.text) === "string" ? text(item.text, 200) : "",
            wide: bool(item && item.wide, false),
          }))
        : d.features.items.map((x) => ({ ...x })),
    },
    pricing: {
      ...head(priceSrc, d.pricing),
      footer: typeof priceSrc.footer === "string" ? text(priceSrc.footer, 240) : d.pricing.footer,
      plans: plans.length
        ? plans.map((plan, i) => {
            const base = d.pricing.plans[i] || d.pricing.plans[d.pricing.plans.length - 1];
            const p = plan && typeof plan === "object" ? plan : {};
            const rows = list(p.features, CAPS.planFeatures);
            return {
              tag: typeof p.tag === "string" ? text(p.tag, 80) : base.tag,
              name: strOr(p.name, base.name, 60),
              price: strOr(p.price, base.price, 40),
              per: typeof p.per === "string" ? text(p.per, 20) : base.per,
              featured: bool(p.featured, false),
              ctaLabel: strOr(p.ctaLabel, base.ctaLabel, 60),
              ctaHref: href(p.ctaHref, base.ctaHref),
              features: rows.length
                ? rows.map((row, j) => ({
                    text: strOr(row && row.text, base.features[j] ? base.features[j].text : "", 120),
                    on: bool(row && row.on, base.features[j] ? base.features[j].on : true),
                  }))
                : base.features.map((x) => ({ ...x })),
            };
          })
        : d.pricing.plans.map((plan) => ({ ...plan, features: plan.features.map((x) => ({ ...x })) })),
    },
    steps: {
      ...head(stepSrc, d.steps),
      items: steps.length
        ? steps.map((item, i) => ({
            title: strOr(item && item.title, d.steps.items[i] ? d.steps.items[i].title : "Step", 80),
            text: typeof (item && item.text) === "string" ? text(item.text, 240) : "",
          }))
        : d.steps.items.map((x) => ({ ...x })),
    },
    address: {
      ...head(addrSrc, d.address),
      ticks: ticks.length
        ? ticks.map((t) => text(t, 240)).filter(Boolean)
        : d.address.ticks.slice(),
      cardLabel: strOr(addrSrc.cardLabel, d.address.cardLabel, 40),
      cardLines: cardLines.length
        ? cardLines.map((line, i) => ({
            prefix: strOr(line && line.prefix, d.address.cardLines[i] ? d.address.cardLines[i].prefix : "luxe.shop/", 120),
            name: strOr(line && line.name, d.address.cardLines[i] ? d.address.cardLines[i].name : "shop", 80),
          }))
        : d.address.cardLines.map((x) => ({ ...x })),
      cardNote: typeof addrSrc.cardNote === "string" ? text(addrSrc.cardNote, 160) : d.address.cardNote,
    },
    designs: {
      ...head(designSrc, d.designs),
      items: designs.length
        ? designs.map((item, i) => {
            const base = d.designs.items[i] || d.designs.items[0];
            const it = item && typeof item === "object" ? item : {};
            const scene = typeof it.scene === "string" && /^(ev|of|fw|pf)$/.test(it.scene) ? it.scene : base.scene;
            return {
              name: strOr(it.name, base.name, 80),
              scene,
              image: image(it.image),
              alt: typeof it.alt === "string" ? text(it.alt, 120) : "",
            };
          })
        : d.designs.items.map((x) => ({ ...x })),
    },
    partners: {
      ...head(partnerSrc, d.partners),
      items: partners.length
        ? partners.map((p) => text(p, 60)).filter(Boolean)
        : d.partners.items.slice(),
    },
    faq: {
      ...head(faqSrc, d.faq),
      items: faqItems.length
        ? faqItems.map((item, i) => ({
            q: strOr(item && item.q, d.faq.items[i] ? d.faq.items[i].q : "প্রশ্ন", 240),
            a: typeof (item && item.a) === "string" ? text(item.a, 1000) : "",
          }))
        : d.faq.items.map((x) => ({ ...x })),
    },
    cta: {
      ...head({ ...ctaSrc, eyebrow: "", subtitle: ctaSrc.subtitle }, {
        enabled: d.cta.enabled,
        eyebrow: "",
        title: d.cta.title,
        accent: d.cta.accent,
        subtitle: d.cta.subtitle,
      }),
      primaryLabel: strOr(ctaSrc.primaryLabel, d.cta.primaryLabel, 60),
      primaryHref: href(ctaSrc.primaryHref, d.cta.primaryHref),
      secondaryLabel: strOr(ctaSrc.secondaryLabel, d.cta.secondaryLabel, 60),
      secondaryHref: href(ctaSrc.secondaryHref, d.cta.secondaryHref),
    },
    footer: {
      enabled: bool(footSrc.enabled, d.footer.enabled),
      tagline: typeof footSrc.tagline === "string" ? text(footSrc.tagline, 240) : d.footer.tagline,
      links: links(footSrc.links, d.footer.links),
      copyright: typeof footSrc.copyright === "string" ? text(footSrc.copyright, 240) : d.footer.copyright,
      note: typeof footSrc.note === "string" ? text(footSrc.note, 240) : d.footer.note,
    },
    extras: extras.length
      ? extras.map((item, i) => {
          const it = item && typeof item === "object" ? item : {};
          const after = text(it.after, 30);
          const allowed = ["start", "hero", "features", "pricing", "steps", "address", "designs", "partners", "faq", "cta", "end"];
          return {
            id: /^[a-z0-9-]{1,40}$/.test(it.id || "") ? it.id : "x" + i,
            enabled: bool(it.enabled, true),
            after: allowed.includes(after) ? after : "end",
            title: typeof it.title === "string" ? text(it.title, TITLE) : "",
            body: typeof it.body === "string" ? block(it.body, 2000) : "",
            image: image(it.image),
            alt: typeof it.alt === "string" ? text(it.alt, 120) : "",
            buttonLabel: typeof it.buttonLabel === "string" ? text(it.buttonLabel, 60) : "",
            buttonHref: href(it.buttonHref, ""),
          };
        })
      : [],
  };
}

function parseContent(value) {
  try {
    return normalizeContent(JSON.parse(value || "{}"));
  } catch {
    return defaults();
  }
}

async function getContent() {
  const doc = await Settings.findOne({ key: SETTINGS_KEY });
  return doc ? parseContent(doc.value) : defaults();
}

function merge(base, patch) {
  if (!patch || typeof patch !== "object") return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const key of Object.keys(patch)) {
    const next = patch[key];
    if (Array.isArray(next)) {
      out[key] = next.slice();
    } else if (next && typeof next === "object") {
      out[key] = merge(base && typeof base[key] === "object" && !Array.isArray(base[key]) ? base[key] : {}, next);
    } else {
      out[key] = next;
    }
  }
  return out;
}

async function saveContent(patch) {
  const current = await getContent();
  const next = normalizeContent(merge(current, patch));
  await Settings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: { value: JSON.stringify(next) } },
    { upsert: true }
  );
  return next;
}

module.exports = {
  SETTINGS_KEY,
  CAPS,
  defaults,
  normalizeContent,
  parseContent,
  getContent,
  saveContent,
};