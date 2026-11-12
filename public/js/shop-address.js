/* ==========================================================================
   Shop address (subdomain label) rules — ONE implementation shared by the
   browser (window.ShopAddress) and the API (require("../public/js/shop-address")).
   Do not fork these rules: the live check, store creation and tenant routing
   must all agree on what a valid label is.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ShopAddress = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MIN = 3;
  const MAX = 63;

  // platform settings (super admin) can replace this list; these are the defaults
  const DEFAULT_RESERVED = [
    "www", "admin", "api", "app", "mail", "smtp", "ftp", "blog", "support", "help",
    "dashboard", "store", "shop", "demo", "test", "static", "cdn", "assets", "status",
    "billing", "login", "signup", "superadmin",
  ];

  const BN_DIGITS = {
    "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
    "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
  };

  // characters that look like a-z but are not — folded before validation so
  // "аdmin" (Cyrillic а) cannot slip past the reserved list
  const LOOKALIKES = {
    а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c",
    т: "t", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", ԁ: "d", ɡ: "g", ӏ: "l",
    ԝ: "w", ѵ: "v", һ: "h",
    α: "a", β: "b", γ: "y", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p",
    τ: "t", υ: "u", χ: "x", ω: "w",
    ı: "i", ł: "l", ø: "o", đ: "d", ħ: "h", ſ: "s", ß: "ss", æ: "ae", œ: "oe",
  };

  // dashes/separators typed from phones and word processors
  const SEPARATORS = {
    "–": "-", "—": "-", "‐": "-", "‑": "-", "−": "-", "_": "-", "﹘": "-",
  };

  const BANGLA = {
    অ: "o", আ: "a", ই: "i", ঈ: "i", উ: "u", ঊ: "u", ঋ: "ri", এ: "e",
    ঐ: "oi", ও: "o", ঔ: "ou",
    "া": "a", "ি": "i", "ী": "i", "ু": "u", "ূ": "u", "ৃ": "ri", "ে": "e",
    "ৈ": "oi", "ো": "o", "ৌ": "ou",
    ক: "k", খ: "kh", গ: "g", ঘ: "gh", ঙ: "ng",
    চ: "ch", ছ: "chh", জ: "j", ঝ: "jh", ঞ: "n",
    ট: "t", ঠ: "th", ড: "d", ঢ: "dh", ণ: "n",
    ত: "t", থ: "th", দ: "d", ধ: "dh", ন: "n",
    প: "p", ফ: "ph", ব: "b", ভ: "bh", ম: "m",
    য: "j", র: "r", ল: "l", শ: "sh", ষ: "sh", স: "s", হ: "h",
    "ড়": "r", "ঢ়": "rh", "য়": "y",
    "ৎ": "t", "ং": "ng", "ঃ": "h", "ঁ": "", "্": "", "়": "",
  };

  const MESSAGES = {
    empty: {
      bn: "দোকানের ঠিকানা লিখুন",
      en: "Enter a shop address",
    },
    length: {
      bn: "ঠিকানা " + MIN + "–" + MAX + " অক্ষরের হতে হবে",
      en: "Address must be " + MIN + "–" + MAX + " characters",
    },
    charset: {
      bn: "শুধু ছোট হাতের a–z, 0–9 আর hyphen (-) ব্যবহার করুন",
      en: "Use only lowercase a–z, 0–9 and hyphen (-)",
    },
    edge: {
      bn: "শুরু ও শেষে অবশ্যই অক্ষর বা সংখ্যা থাকতে হবে",
      en: "Must start and end with a letter or digit",
    },
    "double-hyphen": {
      bn: "পরপর দুইটি hyphen (-) রাখা যাবে না",
      en: "Consecutive hyphens are not allowed",
    },
    "digits-only": {
      bn: "শুধু সংখ্যা দিয়ে ঠিকানা হতে পারে না",
      en: "The address cannot be all digits",
    },
    "punycode-prefix": {
      bn: "\u201cxn--\u201d দিয়ে ঠিকানা শুরু হতে পারে না",
      en: 'The address cannot start with "xn--"',
    },
    reserved: {
      bn: "এই ঠিকানা সংরক্ষিত — অন্য নাম নিন",
      en: "This address is reserved — pick another name",
    },
    taken: {
      bn: "এই ঠিকানা আগেই নেওয়া হয়েছে",
      en: "This address is already taken",
    },
  };

  const RULE_TEXT = {
    bn:
      MIN + "–" + MAX + " অক্ষর · ছোট হাতের a–z, 0–9, hyphen (-) · " +
      "শুরু ও শেষে অক্ষর/সংখ্যা · পরপর দুই hyphen নয় · শুধু সংখ্যা নয় · xn-- দিয়ে শুরু নয়",
    en:
      MIN + "–" + MAX + " chars · lowercase a–z, 0–9, hyphen (-) · " +
      "start/end with a letter or digit · no double hyphen · not all digits · no leading xn--",
  };

  function text(value) {
    return String(value == null ? "" : value);
  }

  function normalize(input) {
    let s = text(input);
    if (s.normalize) s = s.normalize("NFKC");
    s = s.replace(/[\u09E6-\u09EF]/g, function (ch) {
      return BN_DIGITS[ch];
    });
    // strip accents: "café" and "cafe" are the same shop name
    if (s.normalize) s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    s = s.toLowerCase();
    let out = "";
    for (const ch of s) {
      out += Object.prototype.hasOwnProperty.call(LOOKALIKES, ch)
        ? LOOKALIKES[ch]
        : Object.prototype.hasOwnProperty.call(SEPARATORS, ch)
        ? SEPARATORS[ch]
        : ch;
    }
    return out.trim();
  }

  const BANGLA_VOWEL_SIGNS = { "া": 1, "ি": 1, "ী": 1, "ু": 1, "ূ": 1, "ৃ": 1, "ে": 1, "ৈ": 1, "ো": 1, "ৌ": 1 };
  const BANGLA_CONSONANT_RE = /^[\u0995-\u09B9\u09DC-\u09DF\u09CE]$/;

  function transliterateBangla(input) {
    let s = text(input);
    // NFKC splits ড়/ঢ়/য় into base + nukta; rebuild the letters first
    s = s
      .replace(/\u09A1\u09BC/g, "\u09DC")
      .replace(/\u09A2\u09BC/g, "\u09DD")
      .replace(/\u09AF\u09BC/g, "\u09DF");
    // same for the nukta on other letters — it carries no sound of its own
    s = s.replace(/\u09BC/g, "");
    const chars = Array.from(s);
    let out = "";
    for (let i = 0; i < chars.length; i += 1) {
      const ch = chars[i];
      if (BANGLA_CONSONANT_RE.test(ch)) {
        out += BANGLA[ch] || "";
        // an inherent vowel sits between two consonants: শ+প = "shop"
        const next = chars[i + 1] || "";
        if (
          next &&
          !BANGLA_VOWEL_SIGNS[next] &&
          next !== "\u09CD" &&
          (BANGLA_CONSONANT_RE.test(next) || next === "\u0982" || next === "\u0983")
        ) {
          out += "o";
        }
      } else {
        out += Object.prototype.hasOwnProperty.call(BANGLA, ch) ? BANGLA[ch] : ch;
      }
    }
    return out;
  }

  function reservedSet(list) {
    const set = new Set();
    (Array.isArray(list) ? list : DEFAULT_RESERVED).forEach(function (item) {
      const value = normalize(item);
      if (value) set.add(value);
    });
    return set;
  }

  function fail(reason, opts) {
    const lang = opts && opts.lang === "en" ? "en" : "bn";
    return {
      ok: false,
      value: opts && opts.value ? opts.value : "",
      reason: reason,
      apiReason: reason === "reserved" ? "reserved" : "invalid",
      message: MESSAGES[reason] ? MESSAGES[reason][lang] : RULE_TEXT[lang],
    };
  }

  /**
   * Validate a shop address label (the part before .PLATFORM_DOMAIN).
   * opts.reserved — list of reserved labels (defaults to DEFAULT_RESERVED)
   * opts.lang     — "bn" | "en" for the message
   */
  function validate(input, opts) {
    const value = normalize(input);
    const reserved = reservedSet(opts && opts.reserved);
    if (!value) return fail("empty", { lang: opts && opts.lang, value: value });
    if (value.length < MIN || value.length > MAX) return fail("length", { lang: opts && opts.lang, value: value });
    if (!/^[a-z0-9-]+$/.test(value)) return fail("charset", { lang: opts && opts.lang, value: value });
    if (value.charAt(0) === "-" || value.charAt(value.length - 1) === "-") {
      return fail("edge", { lang: opts && opts.lang, value: value });
    }
    if (value.indexOf("xn--") === 0) return fail("punycode-prefix", { lang: opts && opts.lang, value: value });
    if (value.indexOf("--") !== -1) return fail("double-hyphen", { lang: opts && opts.lang, value: value });
    if (/^[0-9]+$/.test(value)) return fail("digits-only", { lang: opts && opts.lang, value: value });
    if (reserved.has(value)) return fail("reserved", { lang: opts && opts.lang, value: value });
    return { ok: true, value: value, reason: null, apiReason: null, message: "" };
  }

  // "আমার দোকান" → "amar-dokan", "Aarong Style" → "aarong-style"
  function slugify(input) {
    let s = transliterateBangla(input);
    s = normalize(s);
    s = s.replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
    s = s.slice(0, MAX).replace(/-+$/g, "");
    if (/^[0-9]+$/.test(s)) s = ("shop-" + s).slice(0, MAX).replace(/-+$/g, "");
    if (s.indexOf("xn--") === 0) s = s.slice(4);
    return s;
  }

  function joinSuffix(base, suffix) {
    const room = MAX - suffix.length - 1;
    const head = base.slice(0, Math.max(room, 0)).replace(/-+$/g, "");
    return (head ? head + "-" : "") + suffix;
  }

  // three extra names to offer when the chosen one is taken/invalid
  function alternatives(input, count) {
    const want = count || 3;
    const base = slugify(input) || "shop";
    const suffixes = ["shop", "store", "bd", "online"];
    const out = [];
    suffixes.forEach(function (suffix) {
      if (out.length >= want) return;
      const candidate = validate(joinSuffix(base, suffix));
      if (candidate.ok && out.indexOf(candidate.value) === -1) out.push(candidate.value);
    });
    for (let i = 2; out.length < want && i <= 20; i += 1) {
      const candidate = validate(joinSuffix(base, String(i)));
      if (candidate.ok && out.indexOf(candidate.value) === -1) out.push(candidate.value);
    }
    return out.slice(0, want);
  }

  // full address shown under the input — never hardcode the platform domain
  function fullAddress(label, platformDomain) {
    const value = normalize(label);
    const domain = text(platformDomain).trim().toLowerCase().replace(/^\.+/, "");
    if (!value || !domain) return "";
    return value + "." + domain;
  }

  return {
    MIN: MIN,
    MAX: MAX,
    DEFAULT_RESERVED: DEFAULT_RESERVED,
    MESSAGES: MESSAGES,
    RULE_TEXT: RULE_TEXT,
    normalize: normalize,
    transliterateBangla: transliterateBangla,
    reservedSet: reservedSet,
    validate: validate,
    slugify: slugify,
    alternatives: alternatives,
    fullAddress: fullAddress,
  };
});
