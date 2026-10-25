const path = require("path");
const mongoose = require("mongoose");
const Settings = require("../models/Settings");
const SocialLink = require("../models/SocialLink");
const ShopFavicon = require("../models/ShopFavicon");
const ShippingManual = require("../models/ShippingManual");
const ShippingArea = require("../models/ShippingArea");
const ShippingClass = require("../models/ShippingClass");
const ShippingInternational = require("../models/ShippingInternational");
const ShippingWeightDimension = require("../models/ShippingWeightDimension");
const PaymentMobileManual = require("../models/PaymentMobileManual");
const PaymentBankManual = require("../models/PaymentBankManual");
const PaymentGateway = require("../models/PaymentGateway");
const CheckoutField = require("../models/CheckoutField");
const EmailSetting = require("../models/EmailSetting");
const EmailTemplate = require("../models/EmailTemplate");
const SmsSetting = require("../models/SmsSetting");
const InvoiceSetting = require("../models/InvoiceSetting");
const User = require("../models/User");
const Category = require("../models/Category");
const Store = require("../models/Store");
const { getStoreId } = require("../lib/tenantContext");
const { buildTree } = require("../lib/categoryHelpers");
const { CHECKOUT_FIELDS, FIELD_KEYS } = require("../lib/checkoutFields");
const { encrypt, decrypt, maskSecret, isMasked } = require("../lib/secretBox");
const { DEFAULT_TEMPLATES, TEMPLATE_LABELS } = require("../lib/emailTemplates");
const { sendMail } = require("../lib/mailer");
const { sendSms } = require("../lib/sms");
const {
  buildInvoiceHtml,
  sampleOrder,
  sampleWholesaleOrder,
  sampleInternationalOrder,
} = require("../lib/invoice");

function storeIdOf(req) {
  if (req.store && req.store._id) return req.store._id;
  return getStoreId();
}

function normalizePhone(value) {
  let s = String(value || "").replace(/[^\d+]/g, "");
  if (s.startsWith("+880")) s = "0" + s.slice(4);
  return s;
}

const PROJECT_NAME = path.basename(path.join(__dirname, ".."));

const SETTING_KEYS = [
  "logo",
  "logo_width",
  "logo_height",
  "site_title",
  "favicon",
  "footer_copyright",
  "footer_logo",
  "attributes_enabled",
  "swatches_enabled",
  "shipping_manual_enabled",
  "shipping_area_enabled",
  "shipping_class_enabled",
  "shipping_intl_enabled",
  "shipping_wd_enabled",
  "shipping_area_note",
  "shipping_intl_note",
  // payment
  "cod_enabled",
  "cod_instruction",
  "mobile_banking_enabled",
  "banking_enabled",
  "mobile_banking_ask_sender",
  "api_mobile_enabled",
  "api_banking_enabled",
  // login / registration
  "login_registration_enabled",
  "login_email_enabled",
  "login_phone_enabled",
  // marketing
  "flash_sales_enabled",
];

const BOOL_KEYS = [
  "attributes_enabled",
  "swatches_enabled",
  "shipping_manual_enabled",
  "shipping_area_enabled",
  "shipping_class_enabled",
  "shipping_intl_enabled",
  "shipping_wd_enabled",
  "cod_enabled",
  "mobile_banking_enabled",
  "banking_enabled",
  "mobile_banking_ask_sender",
  "api_mobile_enabled",
  "api_banking_enabled",
  "login_registration_enabled",
  "login_email_enabled",
  "login_phone_enabled",
  "flash_sales_enabled",
];

const DEFAULTS = {
  logo: "",
  logo_width: "120",
  logo_height: "40",
  site_title: "",
  favicon: "",
  footer_copyright: "",
  footer_logo: "",
  attributes_enabled: "true",
  swatches_enabled: "true",
  shipping_manual_enabled: "true",
  shipping_area_enabled: "false",
  shipping_class_enabled: "false",
  shipping_intl_enabled: "false",
  shipping_wd_enabled: "false",
  shipping_area_note: "",
  shipping_intl_note: "",
  cod_enabled: "true",
  cod_instruction: "Pay in cash when your order is delivered.",
  mobile_banking_enabled: "false",
  banking_enabled: "false",
  mobile_banking_ask_sender: "true",
  api_mobile_enabled: "false",
  api_banking_enabled: "false",
  login_registration_enabled: "false",
  login_email_enabled: "true",
  login_phone_enabled: "false",
  flash_sales_enabled: "true",
};

async function getSettingsMap() {
  const docs = await Settings.find({ key: { $in: SETTING_KEYS } }).lean();
  const map = { ...DEFAULTS };
  docs.forEach((d) => { map[d.key] = d.value; });
  return map;
}

function boolOf(map, key) {
  return String(map[key]) === "true";
}

/* ------------------------------------------------------------------ *
 * Default seeds
 * ------------------------------------------------------------------ */
async function ensureManualDefaults() {
  const count = await ShippingManual.countDocuments({});
  if (count > 0) return;
  const storeId = getStoreId();
  if (!storeId) return;
  await ShippingManual.insertMany([
    { store: storeId, areaName: "Inside Dhaka", amount: 60, sortOrder: 0 },
    { store: storeId, areaName: "Outside Dhaka", amount: 120, sortOrder: 1 },
  ]);
}

async function ensurePaymentDefaults() {
  const storeId = getStoreId();
  if (!storeId) return;

  if ((await PaymentMobileManual.countDocuments({})) === 0) {
    await PaymentMobileManual.insertMany(
      ["bKash", "Nagad", "Upay"].map((name, i) => ({
        store: storeId,
        name,
        accountType: "Personal",
        number: "",
        instruction: "",
        sortOrder: i,
      }))
    );
  }

  if ((await PaymentGateway.countDocuments({})) === 0) {
    const mobile = ["bKash", "Nagad", "Upay"];
    const bank = ["SSLCommerz", "aamarPay"];
    await PaymentGateway.insertMany([
      ...mobile.map((name, i) => ({ store: storeId, type: "mobile", name, mode: "sandbox", active: false, sortOrder: i })),
      ...bank.map((name, i) => ({ store: storeId, type: "bank", name, mode: "sandbox", active: false, sortOrder: i })),
    ]);
  }
}

async function ensureCheckoutFields() {
  const existing = await CheckoutField.find({}).lean();
  const have = new Set(existing.map((f) => f.fieldKey));
  const storeId = getStoreId();
  if (!storeId) return existing;
  const missing = CHECKOUT_FIELDS.filter((f) => !have.has(f.key));
  if (missing.length) {
    await CheckoutField.insertMany(
      missing.map((f) => ({
        store: storeId,
        fieldKey: f.key,
        isShown: f.shown,
        isRequired: f.required,
        label: f.label,
        sortOrder: FIELD_KEYS.indexOf(f.key),
      }))
    );
    return CheckoutField.find({}).lean();
  }
  return existing;
}

/* ------------------------------------------------------------------ *
 * Email / SMS / Invoice default seeds (per store)
 * ------------------------------------------------------------------ */
async function ensureNotificationDefaults() {
  const storeId = getStoreId();
  if (!storeId) return;

  let email = await EmailSetting.findOne({ store: storeId });
  if (!email) await EmailSetting.create({ store: storeId });

  let sms = await SmsSetting.findOne({ store: storeId });
  if (!sms) await SmsSetting.create({ store: storeId });

  let invoice = await InvoiceSetting.findOne({ store: storeId });
  if (!invoice) await InvoiceSetting.create({ store: storeId });

  for (const key of Object.keys(DEFAULT_TEMPLATES)) {
    const exists = await EmailTemplate.findOne({ store: storeId, key });
    if (!exists) {
      await EmailTemplate.create({
        store: storeId,
        key,
        subject: DEFAULT_TEMPLATES[key].subject,
        body: DEFAULT_TEMPLATES[key].body,
        enabled: true,
      });
    }
  }
}

function emailView(setting, templates) {
  const s = setting || {};
  const tplMap = new Map((templates || []).map((t) => [t.key, t]));
  return {
    enabled: !!s.enabled,
    fromName: s.fromName || "",
    fromEmail: s.fromEmail || "",
    replyTo: s.replyTo || "",
    smtpHost: s.smtpHost || "",
    smtpPort: Number(s.smtpPort) || 587,
    smtpSecure: !!s.smtpSecure,
    smtpUser: s.smtpUser || "",
    smtpPassword: maskSecret(decrypt(s.smtpPassword || "").password || ""),
    orderEmail: s.orderEmail || "",
    cancelEmail: s.cancelEmail || "",
    adminEmail: s.adminEmail || "",
    notifyAdminNewOrder: s.notifyAdminNewOrder !== false,
    notifyCustomerNewOrder: s.notifyCustomerNewOrder !== false,
    notifyCustomerCancelled: s.notifyCustomerCancelled !== false,
    notifyCustomerStatus: s.notifyCustomerStatus !== false,
    templates: Object.keys(DEFAULT_TEMPLATES).map((key) => {
      const t = tplMap.get(key) || {};
      const def = DEFAULT_TEMPLATES[key];
      return {
        key,
        label: TEMPLATE_LABELS[key] || key,
        subject: t.subject || def.subject,
        body: t.body || def.body,
        enabled: t.enabled !== false,
      };
    }),
  };
}

function smsView(setting) {
  const s = setting || {};
  return {
    enabled: !!s.enabled,
    provider: s.provider || "bulksmsbd",
    apiKey: maskSecret(decrypt(s.apiKey || "").apiKey || ""),
    senderId: s.senderId || "",
    apiUrl: s.apiUrl || "",
    notifyOrder: s.notifyOrder !== false,
    notifyAdminOrder: !!s.notifyAdminOrder,
    adminPhone: s.adminPhone || "",
    orderTemplate: s.orderTemplate || "",
    otpEnabled: !!s.otpEnabled,
    otpLength: Number(s.otpLength) || 6,
    otpExpiryMinutes: Number(s.otpExpiryMinutes) || 5,
    otpTemplate: s.otpTemplate || "",
  };
}

function invoiceView(setting) {
  const s = setting || {};
  const prefix = s.prefix || "INV-";
  const last = Number(s.nextNumber) || 1000;
  return {
    enabled: s.enabled !== false,
    prefix,
    nextNumber: last,
    nextNumberPreview: prefix + String(last + 1).padStart(5, "0"),
    accentColor: s.accentColor || "#c9a961",
    paperSize: s.paperSize || "a4",
    copies: s.copies || "both",
    companyName: s.companyName || "",
    companyAddress: s.companyAddress || "",
    companyPhone: s.companyPhone || "",
    companyEmail: s.companyEmail || "",
    showLogo: s.showLogo !== false,
    showSignature: s.showSignature !== false,
    signatureLabel: s.signatureLabel || "Authorized signature",
    showVat: !!s.showVat,
    vatPercent: Number(s.vatPercent) || 0,
    binNumber: s.binNumber || "",
    footerNote: s.footerNote || "",
    terms: s.terms || "",
  };
}

// Order create er somoy atomic invoice number allocate kore.
async function allocateInvoiceNumber(storeId) {
  let setting = await InvoiceSetting.findOne({ store: storeId });
  if (!setting) setting = await InvoiceSetting.create({ store: storeId });
  if (setting.enabled === false) return "";
  const updated = await InvoiceSetting.findOneAndUpdate(
    { _id: setting._id },
    { $inc: { nextNumber: 1 } },
    { new: true }
  ).lean();
  const n = Math.max(1, Number(updated.nextNumber) || 1);
  return (updated.prefix || "INV-") + String(n).padStart(5, "0");
}


function gatewayView(g) {
  const creds = decrypt(g.credentials || "");
  const mobile = g.type === "mobile";
  return {
    _id: g._id,
    type: g.type,
    name: g.name,
    mode: g.mode,
    active: !!g.active,
    credentials: mobile
      ? {
          appKey: creds.appKey || "",
          appSecret: maskSecret(creds.appSecret),
          username: creds.username || "",
          password: maskSecret(creds.password),
        }
      : {
          storeId: creds.storeId || "",
          storePassword: maskSecret(creds.storePassword),
        },
  };
}

async function buildAdminPayload() {
  const storeId = getStoreId();
  const [settings, social, manual, areas, classes, intl, wd, cats, mobileManual, bankManual, gateways, fields,
    emailSetting, emailTemplates, smsSetting, invoiceSetting] =
    await Promise.all([
      getSettingsMap(),
      SocialLink.find({}).sort({ sortOrder: 1 }).lean(),
      ShippingManual.find({}).sort({ sortOrder: 1 }).lean(),
      ShippingArea.find({}).sort({ sortOrder: 1 }).lean(),
      ShippingClass.find({}).sort({ sortOrder: 1 }).lean(),
      ShippingInternational.find({}).sort({ sortOrder: 1 }).lean(),
      ShippingWeightDimension.find({}).sort({ sortOrder: 1 }).lean(),
      Category.find({}).sort({ order: 1 }).lean(),
      PaymentMobileManual.find({}).sort({ sortOrder: 1 }).lean(),
      PaymentBankManual.find({}).sort({ sortOrder: 1 }).lean(),
      PaymentGateway.find({}).sort({ sortOrder: 1 }).lean(),
      CheckoutField.find({}).sort({ sortOrder: 1 }).lean(),
      EmailSetting.findOne({ store: storeId }).lean(),
      EmailTemplate.find({ store: storeId }).lean(),
      SmsSetting.findOne({ store: storeId }).lean(),
      InvoiceSetting.findOne({ store: storeId }).lean(),
    ]);

  // field order always fixed
  const fieldMap = new Map(fields.map((f) => [f.fieldKey, f]));
  return {
    settings,
    social,
    shipping: { manual, areas, classes, intl, wd },
    categories: buildTree(cats),
    payments: {
      mobileManual,
      bankManual,
      gateways: gateways.map(gatewayView),
    },
    checkoutFields: FIELD_KEYS.map((key, i) => {
      const def = CHECKOUT_FIELDS[i];
      const f = fieldMap.get(key) || {};
      return {
        fieldKey: key,
        label: f.label || def.label,
        isShown: f.isShown !== undefined ? !!f.isShown : def.shown,
        isRequired: f.isRequired !== undefined ? !!f.isRequired : def.required,
        sortOrder: i,
      };
    }),
    email: emailView(emailSetting, emailTemplates),
    sms: smsView(smsSetting),
    invoice: invoiceView(invoiceSetting),
  };
}

/* ------------------------------------------------------------------ *
 * GET /api/settings — puro Settings page er data
 * ------------------------------------------------------------------ */
async function adminGet(req, res) {
  const storeId = storeIdOf(req);
  if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });

  await ensureManualDefaults();
  await ensurePaymentDefaults();
  await ensureCheckoutFields();
  await ensureNotificationDefaults();

  const payload = await buildAdminPayload();

  const stores = await Store.find({ owner: req.user.id }).select("name").lean();
  const favicons = await ShopFavicon.find({ store: { $in: stores.map((s) => s._id) } }).lean();
  const faviconMap = new Map(favicons.map((f) => [String(f.store), f.icon]));

  res.json({
    ...payload,
    stores,
    favicons: stores.map((s) => ({
      storeId: s._id,
      shopName: s.name,
      icon: faviconMap.get(String(s._id)) || "",
    })),
  });
}

/* ------------------------------------------------------------------ *
 * PUT /api/settings — Save changes (sob section ek sathe)
 * ------------------------------------------------------------------ */
async function adminSave(req, res) {
  const storeId = storeIdOf(req);
  if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });

  const body = req.body || {};
  const settings = body.settings || {};
  const shipping = body.shipping || {};
  const payments = body.payments || {};

  const current = await getSettingsMap();
  const nextEmail = settings.login_email_enabled === undefined
    ? boolOf(current, "login_email_enabled")
    : String(settings.login_email_enabled) === "true";
  const nextPhone = settings.login_phone_enabled === undefined
    ? boolOf(current, "login_phone_enabled")
    : String(settings.login_phone_enabled) === "true";
  if (!nextEmail && !nextPhone) {
    return res.status(400).json({ message: "Login method e Email ba Phone er ekta on rakhte hobe" });
  }

  // ---- settings (key/value) ----
  const ops = [];
  SETTING_KEYS.forEach((key) => {
    if (settings[key] === undefined) return;
    let value = settings[key];
    if (BOOL_KEYS.includes(key)) value = value === true || value === "true" ? "true" : "false";
    else value = String(value == null ? "" : value);
    if (["logo_width", "logo_height"].includes(key)) {
      const n = Number(value);
      value = Number.isFinite(n) && n > 0 ? String(Math.min(2000, Math.round(n))) : DEFAULTS[key];
    }
    ops.push({
      updateOne: { filter: { key }, update: { $set: { key, value } }, upsert: true },
    });
  });
  if (ops.length) await Settings.bulkWrite(ops);

  // ---- social links ----
  if (Array.isArray(body.social)) {
    await SocialLink.deleteMany({});
    const rows = body.social
      .map((r, i) => ({
        store: storeId,
        name: String(r.name || "").trim(),
        icon: String(r.icon || ""),
        url: String(r.url || "").trim(),
        sortOrder: i,
      }))
      .filter((r) => r.name || r.icon || r.url);
    if (rows.length) await SocialLink.insertMany(rows);
  }

  // ---- shop favicons (owner er sob shop) ----
  if (Array.isArray(body.favicons)) {
    const stores = await Store.find({ owner: req.user.id }).select("_id").lean();
    const allowed = new Set(stores.map((s) => String(s._id)));
    const incoming = body.favicons.filter((f) => f && f.storeId && allowed.has(String(f.storeId)));
    await ShopFavicon.deleteMany({ store: { $in: stores.map((s) => s._id) } });
    const rows = incoming
      .filter((f) => f.icon)
      .map((f) => ({ store: f.storeId, icon: String(f.icon) }));
    if (rows.length) await ShopFavicon.insertMany(rows);
  }

  // ---- shipping lists ----
  const replaceList = async (Model, list, mapper) => {
    if (!Array.isArray(list)) return [];
    await Model.deleteMany({});
    const rows = list
      .map((r, i) => mapper(r, i))
      .filter(Boolean);
    if (!rows.length) return [];
    return Model.insertMany(rows);
  };

  await replaceList(ShippingManual, shipping.manual, (r, i) => {
    const areaName = String(r.areaName || "").trim();
    if (!areaName) return null;
    return { store: storeId, areaName, amount: Math.max(0, Number(r.amount) || 0), sortOrder: i };
  });

  const savedClasses = await replaceList(ShippingClass, shipping.classes, (r, i) => {
    const name = String(r.name || "").trim();
    if (!name) return null;
    return { store: storeId, name, cost: Math.max(0, Number(r.cost) || 0), sortOrder: i };
  });
  const classByName = new Map(savedClasses.map((c) => [c.name.toLowerCase(), c._id]));

  await replaceList(ShippingArea, shipping.areas, (r, i) => {
    let shippingClass = null;
    const raw = String(r.shippingClass || "").trim();
    if (raw) {
      if (classByName.has(raw.toLowerCase())) shippingClass = classByName.get(raw.toLowerCase());
      else if (mongoose.isValidObjectId(raw)) shippingClass = raw;
    }
    return {
      store: storeId,
      district: String(r.district || "").trim(),
      area: String(r.area || "").trim(),
      shippingClass,
      price: Math.max(0, Number(r.price) || 0),
      sortOrder: i,
    };
  });

  await replaceList(ShippingInternational, shipping.intl, (r, i) => ({
    store: storeId,
    country: String(r.country || "").trim(),
    category: mongoose.isValidObjectId(r.category) ? r.category : null,
    minOrder: r.minOrder === "" || r.minOrder == null ? null : Math.max(0, Number(r.minOrder) || 0),
    maxOrder: r.maxOrder === "" || r.maxOrder == null ? null : Math.max(0, Number(r.maxOrder) || 0),
    price: Math.max(0, Number(r.price) || 0),
    sortOrder: i,
  }));

  await replaceList(ShippingWeightDimension, shipping.wd, (r, i) => ({
    store: storeId,
    category: mongoose.isValidObjectId(r.category) ? r.category : null,
    area: String(r.area || "").trim(),
    minWeight: Math.max(0, Number(r.minWeight) || 0),
    maxWeight: r.maxWeight === "" || r.maxWeight == null ? null : Math.max(0, Number(r.maxWeight) || 0),
    length: r.length === "" || r.length == null ? null : Math.max(0, Number(r.length) || 0),
    width: r.width === "" || r.width == null ? null : Math.max(0, Number(r.width) || 0),
    height: r.height === "" || r.height == null ? null : Math.max(0, Number(r.height) || 0),
    price: Math.max(0, Number(r.price) || 0),
    sortOrder: i,
  }));

  // ---- manual payment rows ----
  if (Array.isArray(payments.mobileManual)) {
    await replaceList(PaymentMobileManual, payments.mobileManual, (r, i) => {
      const name = String(r.name || "").trim();
      if (!name) return null;
      return {
        store: storeId,
        name,
        accountType: ["Personal", "Agent", "Merchant"].includes(r.accountType) ? r.accountType : "Personal",
        number: String(r.number || "").trim(),
        instruction: String(r.instruction || ""),
        sortOrder: i,
      };
    });
  }
  if (Array.isArray(payments.bankManual)) {
    await replaceList(PaymentBankManual, payments.bankManual, (r, i) => {
      const bankName = String(r.bankName || "").trim();
      if (!bankName) return null;
      return {
        store: storeId,
        bankName,
        accountName: String(r.accountName || "").trim(),
        accountNumber: String(r.accountNumber || "").trim(),
        branch: String(r.branch || "").trim(),
        instruction: String(r.instruction || ""),
        sortOrder: i,
      };
    });
  }

  // ---- API gateways (secrets merge + encrypt) ----
  if (Array.isArray(payments.gateways)) {
    const incoming = payments.gateways.filter((g) => g && g.type && g.name);
    const keep = new Set(incoming.map((g) => `${g.type}::${String(g.name).trim().toLowerCase()}`));
    const existingAll = await PaymentGateway.find({}).lean();
    for (const g of existingAll) {
      if (!keep.has(`${g.type}::${String(g.name).trim().toLowerCase()}`)) {
        await PaymentGateway.deleteOne({ _id: g._id });
      }
    }

    for (let i = 0; i < incoming.length; i++) {
      const g = incoming[i];
      const type = g.type === "bank" ? "bank" : "mobile";
      const name = String(g.name || "").trim();
      if (!name) continue;
      const existing = await PaymentGateway.findOne({ type, name }).lean();
      const creds = decrypt((existing && existing.credentials) || "");
      const input = g.credentials || {};
      Object.keys(input).forEach((k) => {
        const v = input[k];
        if (v === undefined || v === null) return;
        const s = String(v).trim();
        if (!s || isMasked(s)) return; // khali/masked = purono secret rakho
        creds[k] = s;
      });
      const doc = {
        store: storeId,
        type,
        name,
        mode: g.mode === "live" ? "live" : "sandbox",
        active: !!g.active,
        credentials: encrypt(creds),
        sortOrder: i,
      };
      if (existing) await PaymentGateway.updateOne({ _id: existing._id }, { $set: doc });
      else await PaymentGateway.create(doc);
    }
  }

  // ---- checkout fields ----
  if (Array.isArray(body.checkoutFields)) {
    const map = new Map(body.checkoutFields.map((f) => [f.fieldKey, f]));
    for (let i = 0; i < FIELD_KEYS.length; i++) {
      const key = FIELD_KEYS[i];
      const incoming = map.get(key) || {};
      const def = CHECKOUT_FIELDS[i];
      const isShown = incoming.isShown !== undefined ? !!incoming.isShown : def.shown;
      const isRequired = isShown && (incoming.isRequired !== undefined ? !!incoming.isRequired : def.required);
      const label = String(incoming.label || "").trim() || def.label;
      await CheckoutField.findOneAndUpdate(
        { fieldKey: key },
        { $set: { isShown, isRequired, label, sortOrder: i }, $setOnInsert: { store: storeId, fieldKey: key } },
        { upsert: true }
      );
    }
  }

  // ---- email / SMTP ----
  if (body.email && typeof body.email === "object") {
    const e = body.email;
    const existing = await EmailSetting.findOne({ store: storeId }).lean();
    const currentPass = decrypt((existing && existing.smtpPassword) || "").password || "";
    let nextPass = currentPass;
    if (e.smtpPassword !== undefined) {
      const raw = String(e.smtpPassword || "").trim();
      if (raw && !isMasked(raw)) nextPass = raw;
    }

    const emailDoc = {
      store: storeId,
      enabled: !!e.enabled,
      fromName: String(e.fromName || "").trim(),
      fromEmail: String(e.fromEmail || "").trim().toLowerCase(),
      replyTo: String(e.replyTo || "").trim(),
      smtpHost: String(e.smtpHost || "").trim(),
      smtpPort: Math.min(65535, Math.max(1, Number(e.smtpPort) || 587)),
      smtpSecure: !!e.smtpSecure,
      smtpUser: String(e.smtpUser || "").trim(),
      smtpPassword: nextPass ? encrypt({ password: nextPass }) : "",
      orderEmail: String(e.orderEmail || "").trim(),
      cancelEmail: String(e.cancelEmail || "").trim(),
      adminEmail: String(e.adminEmail || "").trim(),
      notifyAdminNewOrder: e.notifyAdminNewOrder !== false,
      notifyCustomerNewOrder: e.notifyCustomerNewOrder !== false,
      notifyCustomerCancelled: e.notifyCustomerCancelled !== false,
      notifyCustomerStatus: e.notifyCustomerStatus !== false,
    };

    const emailFields = ["fromEmail", "replyTo", "orderEmail", "cancelEmail", "adminEmail"];
    for (const f of emailFields) {
      const v = emailDoc[f];
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        return res.status(400).json({ message: `${f} valid email na` });
      }
    }

    if (existing) await EmailSetting.updateOne({ _id: existing._id }, { $set: emailDoc });
    else await EmailSetting.create(emailDoc);

    if (Array.isArray(e.templates)) {
      const allowed = new Set(Object.keys(DEFAULT_TEMPLATES));
      for (const t of e.templates) {
        if (!allowed.has(t.key)) continue;
        const doc = {
          subject: String(t.subject || "").slice(0, 300),
          body: String(t.body || ""),
          enabled: t.enabled !== false,
        };
        await EmailTemplate.findOneAndUpdate(
          { store: storeId, key: t.key },
          { $set: doc, $setOnInsert: { store: storeId, key: t.key } },
          { upsert: true }
        );
      }
    }
  }

  // ---- SMS / OTP ----
  if (body.sms && typeof body.sms === "object") {
    const s = body.sms;
    const existing = await SmsSetting.findOne({ store: storeId }).lean();
    const currentKey = decrypt((existing && existing.apiKey) || "").apiKey || "";
    let nextKey = currentKey;
    if (s.apiKey !== undefined) {
      const raw = String(s.apiKey || "").trim();
      if (raw && !isMasked(raw)) nextKey = raw;
    }

    const smsDoc = {
      store: storeId,
      enabled: !!s.enabled,
      provider: s.provider === "generic" ? "generic" : "bulksmsbd",
      apiKey: nextKey ? encrypt({ apiKey: nextKey }) : "",
      senderId: String(s.senderId || "").trim(),
      apiUrl: String(s.apiUrl || "").trim(),
      notifyOrder: s.notifyOrder !== false,
      notifyAdminOrder: !!s.notifyAdminOrder,
      adminPhone: normalizePhone(s.adminPhone),
      orderTemplate: String(s.orderTemplate || ""),
      otpEnabled: !!s.otpEnabled,
      otpLength: Math.min(8, Math.max(4, Number(s.otpLength) || 6)),
      otpExpiryMinutes: Math.min(30, Math.max(1, Number(s.otpExpiryMinutes) || 5)),
      otpTemplate: String(s.otpTemplate || ""),
    };

    if (existing) await SmsSetting.updateOne({ _id: existing._id }, { $set: smsDoc });
    else await SmsSetting.create(smsDoc);
  }

  // ---- invoice branding ----
  if (body.invoice && typeof body.invoice === "object") {
    const i = body.invoice;
    const existing = await InvoiceSetting.findOne({ store: storeId }).lean();
    const accent = /^#[0-9a-f]{3,8}$/i.test(String(i.accentColor || "")) ? String(i.accentColor) : "#c9a961";
    const invoiceDoc = {
      store: storeId,
      enabled: i.enabled !== false,
      prefix: String(i.prefix || "INV-").slice(0, 12),
      accentColor: accent,
      paperSize: ["a4", "a5", "thermal"].includes(i.paperSize) ? i.paperSize : "a4",
      copies: ["both", "customer", "admin"].includes(i.copies) ? i.copies : "both",
      companyName: String(i.companyName || "").trim(),
      companyAddress: String(i.companyAddress || "").trim(),
      companyPhone: String(i.companyPhone || "").trim(),
      companyEmail: String(i.companyEmail || "").trim(),
      showLogo: i.showLogo !== false,
      showSignature: i.showSignature !== false,
      signatureLabel: String(i.signatureLabel || "Authorized signature").trim(),
      showVat: !!i.showVat,
      vatPercent: Math.min(100, Math.max(0, Number(i.vatPercent) || 0)),
      binNumber: String(i.binNumber || "").trim(),
      footerNote: String(i.footerNote || "").trim(),
      terms: String(i.terms || "").trim(),
    };
    if (existing) {
      await InvoiceSetting.updateOne({ _id: existing._id }, { $set: invoiceDoc });
    } else {
      await InvoiceSetting.create({ ...invoiceDoc, nextNumber: 1000 });
    }
  }

  const payload = await buildAdminPayload();
  const stores = await Store.find({ owner: req.user.id }).select("name").lean();
  const favicons = await ShopFavicon.find({ store: { $in: stores.map((s) => s._id) } }).lean();
  const faviconMap = new Map(favicons.map((f) => [String(f.store), f.icon]));

  res.json({
    ok: true,
    ...payload,
    stores,
    favicons: stores.map((s) => ({
      storeId: s._id,
      shopName: s.name,
      icon: faviconMap.get(String(s._id)) || "",
    })),
  });
}

/* ------------------------------------------------------------------ *
 * GET /api/settings/site — logo/title/favicon/footer (dashboard chrome)
 * ------------------------------------------------------------------ */
async function siteGet(req, res) {
  const storeId = storeIdOf(req);
  const map = await getSettingsMap();
  let favicon = map.favicon;
  if (storeId) {
    const own = await ShopFavicon.findOne({ store: storeId }).lean();
    if (own && own.icon) favicon = own.icon;
  }
  res.json({
    logo: map.logo,
    logoWidth: Number(map.logo_width) || 120,
    logoHeight: Number(map.logo_height) || 40,
    siteTitle: map.site_title,
    siteTitleResolved: map.site_title.trim() || PROJECT_NAME,
    favicon,
    footerCopyright: map.footer_copyright || "© " + new Date().getFullYear() + " " + (map.site_title.trim() || PROJECT_NAME),
    footerLogo: map.footer_logo,
  });
}

/* ------------------------------------------------------------------ *
 * Shipping helpers
 * ------------------------------------------------------------------ */
async function getShippingConfig(storeId) {
  const map = await getSettingsMap();
  const [manual, areas, classes, intl, wd] = await Promise.all([
    ShippingManual.find({}).sort({ sortOrder: 1 }).lean(),
    ShippingArea.find({}).sort({ sortOrder: 1 }).lean(),
    ShippingClass.find({}).sort({ sortOrder: 1 }).lean(),
    ShippingInternational.find({}).sort({ sortOrder: 1 }).lean(),
    ShippingWeightDimension.find({}).sort({ sortOrder: 1 }).lean(),
  ]);
  return {
    enabled: {
      manual: boolOf(map, "shipping_manual_enabled"),
      area: boolOf(map, "shipping_area_enabled"),
      classes: boolOf(map, "shipping_class_enabled"),
      intl: boolOf(map, "shipping_intl_enabled"),
      wd: boolOf(map, "shipping_wd_enabled"),
    },
    notes: {
      area: map.shipping_area_note || "",
      intl: map.shipping_intl_note || "",
    },
    manual,
    areas,
    classes,
    intl,
    wd,
  };
}

async function shippingGet(req, res) {
  const storeId = storeIdOf(req);
  if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
  const cfg = await getShippingConfig(storeId);
  res.json(cfg);
}

/* ------------------------------------------------------------------ *
 * Shipping quote — customer pick from all enabled options
 * ------------------------------------------------------------------ */
function matchesCategory(ruleCategory, categoryIds) {
  if (!ruleCategory) return true;
  return (categoryIds || []).some((c) => String(c) === String(ruleCategory));
}

function quoteFromConfig(cfg, ctx) {
  const options = [];
  const categoryIds = (ctx.categoryIds || []).map(String);

  if (cfg.enabled.manual) {
    cfg.manual.forEach((r) => {
      options.push({ type: "manual", label: r.areaName, amount: Number(r.amount) || 0 });
    });
  }

  if (cfg.enabled.area) {
    cfg.areas
      .filter((r) => !ctx.district || !r.district || String(r.district).toLowerCase().includes(String(ctx.district).toLowerCase()))
      .forEach((r) => {
        options.push({
          type: "area",
          label: [r.district, r.area].filter(Boolean).join(" — ") || "Area shipping",
          amount: Number(r.price) || 0,
        });
      });
  }

  if (cfg.enabled.intl) {
    cfg.intl
      .filter((r) => {
        if (ctx.country && r.country && String(r.country).toLowerCase() !== String(ctx.country).toLowerCase()) return false;
        if (r.minOrder != null && ctx.orderTotal != null && Number(ctx.orderTotal) < Number(r.minOrder)) return false;
        if (r.maxOrder != null && ctx.orderTotal != null && Number(ctx.orderTotal) > Number(r.maxOrder)) return false;
        return matchesCategory(r.category, categoryIds);
      })
      .forEach((r) => {
        options.push({
          type: "international",
          label: "International — " + (r.country || "Any country"),
          amount: Number(r.price) || 0,
        });
      });
  }

  if (cfg.enabled.wd) {
    const weight = Number(ctx.weight) || 0;
    const rule = cfg.wd.find((r) => {
      if (!matchesCategory(r.category, categoryIds)) return false;
      if (r.area && ctx.areaName && String(r.area).toLowerCase() !== String(ctx.areaName).toLowerCase()) return false;
      if (weight < Number(r.minWeight || 0)) return false;
      if (r.maxWeight != null && weight > Number(r.maxWeight)) return false;
      if (r.length != null && ctx.length != null && Number(ctx.length) > Number(r.length)) return false;
      if (r.width != null && ctx.width != null && Number(ctx.width) > Number(r.width)) return false;
      if (r.height != null && ctx.height != null && Number(ctx.height) > Number(r.height)) return false;
      return true;
    });
    if (rule) {
      options.push({ type: "weight_dimension", label: "Weight & dimensions", amount: Number(rule.price) || 0 });
    }
  }

  return options;
}

async function shippingQuote(req, res) {
  const storeId = storeIdOf(req);
  if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
  const cfg = await getShippingConfig(storeId);
  res.json({ options: quoteFromConfig(cfg, req.body || {}) });
}

/* ------------------------------------------------------------------ *
 * GET /api/settings/checkout — public checkout page er config
 * ------------------------------------------------------------------ */
async function checkoutGet(req, res) {
  const storeId = storeIdOf(req);
  if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });

  const fields = await ensureCheckoutFields();
  const map = await getSettingsMap();
  const cfg = await getShippingConfig(storeId);

  const [mobileRows, bankRows, gateways] = await Promise.all([
    PaymentMobileManual.find({}).sort({ sortOrder: 1 }).lean(),
    PaymentBankManual.find({}).sort({ sortOrder: 1 }).lean(),
    PaymentGateway.find({ active: true }).sort({ sortOrder: 1 }).lean(),
  ]);

  const apiMobile = boolOf(map, "api_mobile_enabled");
  const apiBank = boolOf(map, "api_banking_enabled");

  const fieldMap = new Map(fields.map((f) => [f.fieldKey, f]));
  const shownFields = CHECKOUT_FIELDS.filter((def) => {
    const f = fieldMap.get(def.key);
    return f ? f.isShown : def.shown;
  }).map((def) => {
    const f = fieldMap.get(def.key);
    return {
      key: def.key,
      label: (f && f.label) || def.label,
      required: f ? !!(f.isShown && f.isRequired) : def.required,
    };
  });

  let prefill = {};
  if (req.user && req.user.id) {
    const user = await User.findById(req.user.id).select("name email phone shipping").lean();
    if (user) {
      const s = user.shipping || {};
      prefill = {
        name: s.name || user.name || "",
        phone: s.phone || user.phone || "",
        email: s.email || user.email || "",
        address: s.address || "",
        thana: s.thana || "",
        district: s.district || "",
        division: s.division || "",
        postCode: s.postCode || "",
        country: s.country || "",
      };
    }
  }

  res.json({
    site: {
      siteTitle: map.site_title.trim() || PROJECT_NAME,
      logo: map.logo,
      logoWidth: Number(map.logo_width) || 120,
      logoHeight: Number(map.logo_height) || 40,
    },
    fields: shownFields,
    login: {
      enabled: boolOf(map, "login_registration_enabled"),
      email: boolOf(map, "login_email_enabled"),
      phone: boolOf(map, "login_phone_enabled"),
    },
    prefill,
    payments: {
      cod: { enabled: boolOf(map, "cod_enabled"), instruction: map.cod_instruction || "" },
      mobileManual: boolOf(map, "mobile_banking_enabled")
        ? mobileRows.map((r) => ({
            name: r.name,
            accountType: r.accountType,
            number: r.number,
            instruction: r.instruction,
          }))
        : [],
      bankManual: boolOf(map, "banking_enabled")
        ? bankRows.map((r) => ({
            name: r.bankName,
            accountName: r.accountName,
            accountNumber: r.accountNumber,
            branch: r.branch,
            instruction: r.instruction,
          }))
        : [],
      apiGateways: gateways
        .filter((g) => (g.type === "mobile" ? apiMobile : apiBank))
        .map((g) => ({ type: g.type, name: g.name, mode: g.mode })),
      askSender: boolOf(map, "mobile_banking_ask_sender"),
    },
    shipping: {
      enabled: cfg.enabled,
      notes: cfg.notes,
      areas: cfg.areas.map((a) => ({ district: a.district, area: a.area, price: a.price })),
    },
  });
}

/* ------------------------------------------------------------------ *
 * POST /api/settings/email/test — SMTP test mail
 * ------------------------------------------------------------------ */
async function emailTest(req, res) {
  const storeId = storeIdOf(req);
  if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
  const to = String(req.body.to || "").trim();
  if (!to) return res.status(400).json({ message: "Test email address din" });

  const setting = await EmailSetting.findOne({ store: storeId }).lean();
  if (!setting || !setting.enabled) {
    return res.status(400).json({ message: "Prothome email enable kore SMTP save korun" });
  }

  try {
    const store = await Store.findById(storeId).select("name").lean();
    const result = await sendMail(storeId, {
      to,
      subject: `SMTP test — ${(store && store.name) || "Store"}`,
      html: `<div style="font-family:Arial,sans-serif"><h2>SMTP test successful</h2><p>Ei email ta apnar store er SMTP settings theke pathano hoyeche.</p></div>`,
    });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(400).json({ message: "Mail pathate parlam na: " + err.message });
  }
}

/* ------------------------------------------------------------------ *
 * POST /api/settings/sms/test — SMS test
 * ------------------------------------------------------------------ */
async function smsTest(req, res) {
  const storeId = storeIdOf(req);
  if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });
  const to = normalizePhone(req.body.to);
  if (!/^01[3-9]\d{8}$/.test(to)) {
    return res.status(400).json({ message: "Test phone number valid na (01XXXXXXXXX)" });
  }

  const setting = await SmsSetting.findOne({ store: storeId }).lean();
  if (!setting || !setting.enabled) {
    return res.status(400).json({ message: "Prothome SMS enable kore API key save korun" });
  }

  const store = await Store.findById(storeId).select("name").lean();
  const result = await sendSms(storeId, to, `Test SMS — ${(store && store.name) || "Store"}`);
  if (!result.ok) {
    return res.status(400).json({
      message: result.reason || result.error || "SMS pathate parlam na",
      detail: result,
    });
  }
  res.json({ ok: true, result });
}

/* ------------------------------------------------------------------ *
 * GET /api/settings/invoice/preview — sample double-copy invoice
 * ------------------------------------------------------------------ */
async function invoicePreview(req, res) {
  const storeId = storeIdOf(req);
  if (!storeId) return res.status(400).json({ message: "Store pawa jayni" });

  const [setting, map, store] = await Promise.all([
    InvoiceSetting.findOne({ store: storeId }).lean(),
    getSettingsMap(),
    Store.findById(storeId).select("name").lean(),
  ]);

  // Unsaved preview: dashboard theke current form state pathay
  const override = req.body && req.body.invoice && typeof req.body.invoice === "object" ? req.body.invoice : null;
  const merged = override ? { ...(setting || {}), ...override } : setting || {};
  if (merged.vatPercent !== undefined) merged.vatPercent = Math.min(100, Math.max(0, Number(merged.vatPercent) || 0));

  const rawMode = String((req.body && req.body.mode) || req.query.mode || "retail").toLowerCase();
  const mode = ["retail", "wholesale", "international"].includes(rawMode) ? rawMode : "retail";
  const order =
    mode === "wholesale" ? sampleWholesaleOrder() : mode === "international" ? sampleInternationalOrder() : sampleOrder();

  const html = buildInvoiceHtml({
    order,
    setting: merged,
    storeName: (store && store.name) || "Store",
    logo: map.logo || "",
    modes: { wholesale: mode === "wholesale", international: mode === "international" },
  });
  res.type("html").send(html);
}

module.exports = {
  adminGet,
  adminSave,
  siteGet,
  shippingGet,
  shippingQuote,
  checkoutGet,
  emailTest,
  smsTest,
  invoicePreview,
  getShippingConfig,
  quoteFromConfig,
  getSettingsMap,
  ensureCheckoutFields,
  ensureNotificationDefaults,
  allocateInvoiceNumber,
};
