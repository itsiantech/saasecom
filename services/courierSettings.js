/* Courier API service — per-store config storage (secrets encrypted),
 * connection tests and Pathao city/zone lookups. Mirrors services/serverTracking. */
const Settings = require("../models/Settings");
const { scopedKey, keysForStore, isScopedKey, unscopeKey } = require("../lib/settingsScope");
const { encrypt, decrypt, maskSecret, isMasked } = require("../lib/secretBox");
const courier = require("../lib/courierSettings");
const pathao = require("../lib/couriers/pathao");
const steadfast = require("../lib/couriers/steadfast");

const COURIER_KEYS = Object.keys(courier.COURIER_DEFAULTS);

function decryptSecret(map, key) {
  return String(decrypt((map && map[key]) || "").value || "");
}

/* DB rows (secrets encrypted) -> flat plaintext values. */
async function loadValues(storeId) {
  const docs = await Settings.find({ key: { $in: keysForStore(storeId, COURIER_KEYS) } }).lean();
  const rows = { ...courier.COURIER_DEFAULTS };
  docs.forEach((d) => {
    if (isScopedKey(storeId, d.key)) rows[unscopeKey(storeId, d.key)] = d.value;
  });
  docs.forEach((d) => {
    if (!isScopedKey(storeId, d.key)) rows[d.key] = d.value;
  });
  const values = {};
  COURIER_KEYS.forEach((key) => {
    const v = rows[key];
    values[key] = String(v == null ? courier.COURIER_DEFAULTS[key] : v);
  });
  courier.SECRET_FIELDS.forEach((key) => {
    values[key] = decryptSecret(rows, key);
  });
  return values;
}

/* Merge a partial admin form over stored values. Masked/blank secrets keep
 * whatever is already stored, so the dashboard never needs the plaintext. */
function resolveValues(current, input = {}) {
  const values = { ...courier.COURIER_DEFAULTS };
  COURIER_KEYS.forEach((key) => {
    if (current && current[key] !== undefined && current[key] !== null) values[key] = String(current[key]);
  });
  courier.SECRET_FIELDS.forEach((key) => {
    if (!current) return;
    const raw = String(current[key] || "");
    values[key] = raw.startsWith("v1:") ? decryptSecret(current, key) : raw;
  });
  COURIER_KEYS.forEach((key) => {
    if (input[key] === undefined) return;
    if (courier.isSecretKey(key)) {
      const raw = String(input[key] == null ? "" : input[key]).trim();
      if (raw && !isMasked(raw)) values[key] = raw;
      return;
    }
    values[key] = courier.normalizeCourierValue(key, input[key]);
  });
  return values;
}

/* GET /api/settings view: plaintext secrets replaced with ••••last4. */
function adminSettings(current) {
  const values = resolveValues(current || {}, {});
  courier.SECRET_FIELDS.forEach((key) => {
    values[key] = maskSecret(values[key]);
  });
  const out = { ...(current || {}) };
  COURIER_KEYS.forEach((key) => {
    out[key] = values[key];
  });
  return out;
}

/* Validate + build upserts for the keys present in the admin form. */
function prepareSave(storeId, current, input = {}) {
  const values = resolveValues(current || {}, input);
  const error = courier.courierErrors(values);
  if (error) return { error };

  const ops = [];
  COURIER_KEYS.forEach((key) => {
    if (input[key] === undefined) return;
    let value;
    if (courier.isSecretKey(key)) {
      const raw = String(input[key] == null ? "" : input[key]).trim();
      if (!raw || isMasked(raw)) return; // empty/masked = keep stored secret
      value = encrypt({ value: raw });
    } else {
      value = String(values[key] == null ? "" : values[key]);
    }
    const storageKey = scopedKey(storeId, key);
    ops.push({
      updateOne: { filter: { key: storageKey }, update: { $set: { key: storageKey, value } }, upsert: true },
    });
  });
  return { ops, values };
}

function pathaoConfig(values) {
  return {
    env: values.courier_pathao_env,
    clientId: values.courier_pathao_client_id,
    clientSecret: values.courier_pathao_client_secret,
    username: values.courier_pathao_username,
    password: values.courier_pathao_password,
    storeId: values.courier_pathao_store_id,
    cityId: values.courier_pathao_city_id,
    zoneId: values.courier_pathao_zone_id,
  };
}

function steadfastConfig(values) {
  return {
    apiKey: values.courier_steadfast_api_key,
    secretKey: values.courier_steadfast_secret_key,
  };
}

async function resolveConfig(storeId, input = {}) {
  const current = await loadValues(storeId);
  return resolveValues(current, input || {});
}

async function testConnection(storeId, provider, input = {}) {
  if (!courier.PROVIDERS.includes(provider)) return { ok: false, message: "Courier chena jayni" };
  try {
    const values = await resolveConfig(storeId, input);
    if (provider === "pathao") {
      if (!values.courier_pathao_client_id || !values.courier_pathao_client_secret) {
        return { ok: false, message: "Pathao Client ID ar Client Secret din" };
      }
      if (!values.courier_pathao_username || !values.courier_pathao_password) {
        return { ok: false, message: "Pathao Username ar Password din" };
      }
      await pathao.issueToken(pathaoConfig(values));
      return { ok: true, message: "Pathao connected — token OK" };
    }
    if (!values.courier_steadfast_api_key || !values.courier_steadfast_secret_key) {
      return { ok: false, message: "Steadfast API Key ar Secret Key din" };
    }
    const balance = await steadfast.getBalance(steadfastConfig(values));
    return { ok: true, message: `Steadfast connected — balance ৳${balance.toLocaleString("en-US")}` };
  } catch (err) {
    return { ok: false, message: `${courier.PROVIDER_LABELS[provider]} test fail: ${err.message}` };
  }
}

async function pathaoCities(storeId, input = {}) {
  const values = await resolveConfig(storeId, input);
  const cities = await pathao.listCities(pathaoConfig(values));
  return { ok: true, cities };
}

async function pathaoZones(storeId, cityId, input = {}) {
  const values = await resolveConfig(storeId, input);
  const zones = await pathao.listZones(pathaoConfig(values), String(cityId || ""));
  return { ok: true, zones };
}

module.exports = {
  COURIER_KEYS,
  loadValues,
  resolveValues,
  adminSettings,
  prepareSave,
  pathaoConfig,
  steadfastConfig,
  testConnection,
  pathaoCities,
  pathaoZones,
};
