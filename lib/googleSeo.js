/* Google SEO integration settings — flat settings keys so they ride the
 * existing per-store Settings collection (store:<id>:seo_*). The storefront
 * only ever sees the normalized object from buildGoogleSeo(). */

const GOOGLE_SEO_DEFAULTS = {
  seo_google_enabled: "false",
  seo_search_console_enabled: "true",
  seo_search_console_code: "",
  seo_ga4_enabled: "true",
  seo_ga4_id: "",
  seo_gtm_enabled: "true",
  seo_gtm_id: "",
  seo_sitemap_enabled: "true",
  seo_robots_enabled: "true",
  seo_robots_text: "",
  seo_schema_enabled: "true",
};

const BOOL_FIELDS = [
  "seo_google_enabled",
  "seo_search_console_enabled",
  "seo_ga4_enabled",
  "seo_gtm_enabled",
  "seo_sitemap_enabled",
  "seo_robots_enabled",
  "seo_schema_enabled",
];

const GA4_RE = /^G-[A-Z0-9]{4,20}$/;
const GTM_RE = /^GTM-[A-Z0-9]{4,20}$/;
const SEARCH_CONSOLE_RE = /^[A-Za-z0-9_-]{8,120}$/;
const ROBOTS_MAX = 4000;

const LABELS = {
  seo_search_console_code: "Search Console verification code",
  seo_ga4_id: "Analytics 4 measurement ID (G-XXXXXXX)",
  seo_gtm_id: "Tag Manager container ID (GTM-XXXXXXX)",
};

function normalizeSeoValue(key, value) {
  const text = String(value == null ? "" : value).trim();
  if (key === "seo_search_console_code") return text.slice(0, 120);
  if (key === "seo_ga4_id") return text.toUpperCase().slice(0, 32);
  if (key === "seo_gtm_id") return text.toUpperCase().slice(0, 32);
  if (key === "seo_robots_text") return text.replace(/\r\n?/g, "\n").slice(0, ROBOTS_MAX);
  return text;
}

/* Returns a human message for the first bad value, or "" when all are fine.
 * Empty is always allowed — a toggle with no ID simply does nothing. */
function googleSeoError(settings) {
  const code = normalizeSeoValue("seo_search_console_code", settings.seo_search_console_code);
  if (code && !SEARCH_CONSOLE_RE.test(code)) return `${LABELS.seo_search_console_code} thik nei`;
  const ga4 = normalizeSeoValue("seo_ga4_id", settings.seo_ga4_id);
  if (ga4 && !GA4_RE.test(ga4)) return `${LABELS.seo_ga4_id} thik nei (example: G-ABC123XYZ)`;
  const gtm = normalizeSeoValue("seo_gtm_id", settings.seo_gtm_id);
  if (gtm && !GTM_RE.test(gtm)) return `${LABELS.seo_gtm_id} thik nei (example: GTM-ABC1234)`;
  return "";
}

function boolOf(map, key) {
  return String(map[key]) === "true";
}

function buildGoogleSeo(map) {
  const master = boolOf(map, "seo_google_enabled");
  // re-check formats on read too: a row written outside adminSave must never
  // reach the storefront's inline scripts or meta tags
  const consoleCode = normalizeSeoValue("seo_search_console_code", map.seo_search_console_code);
  const ga4Id = normalizeSeoValue("seo_ga4_id", map.seo_ga4_id);
  const gtmId = normalizeSeoValue("seo_gtm_id", map.seo_gtm_id);
  return {
    enabled: master,
    searchConsole: {
      enabled: master && boolOf(map, "seo_search_console_enabled"),
      code: SEARCH_CONSOLE_RE.test(consoleCode) ? consoleCode : "",
    },
    ga4: {
      enabled: master && boolOf(map, "seo_ga4_enabled"),
      id: GA4_RE.test(ga4Id) ? ga4Id : "",
    },
    gtm: {
      enabled: master && boolOf(map, "seo_gtm_enabled"),
      id: GTM_RE.test(gtmId) ? gtmId : "",
    },
    sitemap: { enabled: master && boolOf(map, "seo_sitemap_enabled") },
    robots: {
      enabled: master && boolOf(map, "seo_robots_enabled"),
      text: normalizeSeoValue("seo_robots_text", map.seo_robots_text),
    },
    schema: { enabled: master && boolOf(map, "seo_schema_enabled") },
  };
}

module.exports = {
  GOOGLE_SEO_DEFAULTS,
  BOOL_FIELDS,
  ROBOTS_MAX,
  normalizeSeoValue,
  googleSeoError,
  buildGoogleSeo,
};
