/* Courier API settings — pure helpers for Pathao / Steadfast.
 * Storage + encryption live in services/courierSettings.js; network calls in
 * lib/couriers/*. Secrets never leave the server unmasked. */

const PROVIDERS = ["pathao", "steadfast"];

const PROVIDER_LABELS = { pathao: "Pathao", steadfast: "Steadfast" };

const COURIER_DEFAULTS = {
  courier_enabled: "false",
  courier_default: "pathao",
  // due = order total − paid amount, total = full order total, none = prepaid
  courier_cod_mode: "due",
  courier_weight: "0.5",
  courier_sender_name: "",
  courier_sender_phone: "",
  // Pathao Merchant API
  courier_pathao_enabled: "false",
  courier_pathao_env: "live",
  courier_pathao_store_id: "",
  courier_pathao_client_id: "",
  courier_pathao_client_secret: "",
  courier_pathao_username: "",
  courier_pathao_password: "",
  courier_pathao_city_id: "",
  courier_pathao_zone_id: "",
  // Steadfast API
  courier_steadfast_enabled: "false",
  courier_steadfast_api_key: "",
  courier_steadfast_secret_key: "",
};

const BOOL_FIELDS = ["courier_enabled", "courier_pathao_enabled", "courier_steadfast_enabled"];

const SECRET_FIELDS = [
  "courier_pathao_client_secret",
  "courier_pathao_password",
  "courier_steadfast_api_key",
  "courier_steadfast_secret_key",
];

const COD_MODES = ["due", "total", "none"];
const ENVS = ["live", "sandbox"];

function isSecretKey(key) {
  return SECRET_FIELDS.includes(key);
}

function boolOf(map, key) {
  return String(map[key]) === "true";
}

function normalizeCourierValue(key, value) {
  const text = String(value == null ? "" : value).trim();
  if (key === "courier_default") return PROVIDERS.includes(text) ? text : COURIER_DEFAULTS[key];
  if (key === "courier_cod_mode") return COD_MODES.includes(text) ? text : COURIER_DEFAULTS[key];
  if (key === "courier_pathao_env") return ENVS.includes(text) ? text : COURIER_DEFAULTS[key];
  if (key === "courier_weight") {
    const n = Number(text);
    return Number.isFinite(n) && n > 0
      ? String(Math.min(50, Math.round(n * 100) / 100))
      : COURIER_DEFAULTS[key];
  }
  if (["courier_pathao_store_id", "courier_pathao_city_id", "courier_pathao_zone_id"].includes(key)) {
    return text.replace(/[^\d]/g, "").slice(0, 12);
  }
  if (key === "courier_sender_phone") {
    let s = text.replace(/[^\d+]/g, "");
    if (s.startsWith("+880")) s = "0" + s.slice(4);
    if (s.startsWith("880") && s.length === 13) s = "0" + s.slice(3);
    return s.slice(0, 15);
  }
  return text.slice(0, 300);
}

/* Validation only covers enabled providers — a store may keep the other
 * provider's half-filled form while it is switched off. */
function courierErrors(values) {
  if (boolOf(values, "courier_pathao_enabled")) {
    if (!values.courier_pathao_store_id) return "Pathao Merchant Store ID din";
    if (!values.courier_pathao_client_id) return "Pathao Client ID din";
    if (!values.courier_pathao_client_secret) return "Pathao Client Secret din";
    if (!values.courier_pathao_username) return "Pathao Username din";
    if (!values.courier_pathao_password) return "Pathao Password din";
  }
  if (boolOf(values, "courier_steadfast_enabled")) {
    if (!values.courier_steadfast_api_key) return "Steadfast API Key din";
    if (!values.courier_steadfast_secret_key) return "Steadfast Secret Key din";
  }
  return "";
}

function enabledProviders(values) {
  return PROVIDERS.filter((provider) =>
    provider === "pathao" ? boolOf(values, "courier_pathao_enabled") : boolOf(values, "courier_steadfast_enabled")
  );
}

/* The default courier must be an enabled one; falls back to the first. */
function resolveDefaultProvider(values) {
  const list = enabledProviders(values);
  const wanted = normalizeCourierValue("courier_default", values.courier_default);
  return list.includes(wanted) ? wanted : list[0] || "";
}

module.exports = {
  PROVIDERS,
  PROVIDER_LABELS,
  COURIER_DEFAULTS,
  BOOL_FIELDS,
  SECRET_FIELDS,
  COD_MODES,
  isSecretKey,
  boolOf,
  normalizeCourierValue,
  courierErrors,
  enabledProviders,
  resolveDefaultProvider,
};
