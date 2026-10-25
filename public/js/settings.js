/* ==========================================================================
   Settings page controller — dashboard er bhitorei pane switching,
   dynamic rows, image upload, Save changes + unsaved-changes warning.
   ========================================================================== */
(function () {
  "use strict";

  const TOKEN_KEY = "luxe_token";
  const token = localStorage.getItem(TOKEN_KEY);
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const INTERNATIONAL_DEFAULTS = {
    enabled: false,
    advancePercent: 30,
    codPercent: 70,
    air: { label: "Air Shipping", minDays: 7, maxDays: 15 },
    sea: { label: "Sea Shipping", minDays: 25, maxDays: 45 },
    labels: { shippingCharge: "Shipping Charge", chinaCourier: "China Courier Fee" },
  };

  const WHOLESALE_DEFAULTS = {
    enabled: false,
    badgeText: "Wholesale",
    moq: 1,
    buyers: "all",
    showRetailPrice: true,
    vehicleOverflowRule: "cheapest",
    partialPaymentEnabled: false,
    lateFeePaisa: 0,
    lateFeeType: "flat",
    graceDays: 3,
    maxOpenInstallmentOrders: 0,
    goodsReleaseRule: "after_advance",
    installmentBuyers: "approved",
    shippingInFirstInstallment: true,
    overdueAction: "hold",
    overdueDays: 7,
    refundType: "full",
    refundPercent: 100,
  };

  const state = {
    ready: false,
    loading: false,
    dirty: false,
    settings: {},
    social: [],
    favicons: [],
    stores: [],
    categories: [],
    shipping: { manual: [], areas: [], classes: [], intl: [], wd: [] },
    payments: { mobileManual: [], bankManual: [], gateways: [] },
    checkoutFields: [],
    email: { enabled: false, smtpPort: 587, templates: [] },
    sms: { enabled: false, provider: "bulksmsbd", otpLength: 6, otpExpiryMinutes: 5 },
    invoice: { enabled: true, paperSize: "a4", copies: "both", accentColor: "#c9a961" },
    invoicePreviewMode: "retail",
    international: JSON.parse(JSON.stringify(INTERNATIONAL_DEFAULTS)),
    internationalLoaded: false,
    internationalLoadError: "",
    wholesale: {
      ...JSON.parse(JSON.stringify(WHOLESALE_DEFAULTS)),
      rules: [],
      vehicles: [],
      speeds: [],
      plans: [],
      buyerList: [],
      buyerSearch: "",
    },
    wholesaleLoaded: false,
    wholesaleLoading: false,
    wholesaleLoadError: "",
    wholesaleEdit: { rule: null, vehicle: null, speed: null, plan: null },
  };

  /* ------------------------------------------------------------------ *
   * Form data lists
   * ------------------------------------------------------------------ */
  const DISTRICTS = [
    "Dhaka", "Gazipur", "Narayanganj", "Tangail", "Kishoreganj", "Manikganj", "Munshiganj", "Narsingdi",
    "Faridpur", "Gopalganj", "Madaripur", "Rajbari", "Shariatpur", "Chattogram", "Cox's Bazar", "Cumilla",
    "Brahmanbaria", "Chandpur", "Feni", "Lakshmipur", "Noakhali", "Rangamati", "Khagrachhari", "Bandarban",
    "Sylhet", "Habiganj", "Moulvibazar", "Sunamganj", "Rajshahi", "Bogura", "Joypurhat", "Naogaon",
    "Natore", "Chapainawabganj", "Pabna", "Sirajganj", "Khulna", "Bagerhat", "Chuadanga", "Jashore",
    "Jhenaidah", "Kushtia", "Magura", "Meherpur", "Narail", "Satkhira", "Barishal", "Barguna",
    "Bhola", "Jhalokati", "Patuakhali", "Pirojpur", "Rangpur", "Dinajpur", "Gaibandha", "Kurigram",
    "Lalmonirhat", "Nilphamari", "Panchagarh", "Thakurgaon", "Mymensingh", "Jamalpur", "Netrokona", "Sherpur",
  ];

  const COUNTRIES = [
    "Bangladesh", "India", "Pakistan", "Nepal", "Bhutan", "Sri Lanka", "Maldives", "Afghanistan",
    "United States", "Canada", "United Kingdom", "Ireland", "Germany", "France", "Italy", "Spain",
    "Netherlands", "Belgium", "Switzerland", "Austria", "Sweden", "Norway", "Denmark", "Finland",
    "Poland", "Portugal", "Greece", "Turkey", "Russia", "Ukraine", "United Arab Emirates", "Saudi Arabia",
    "Qatar", "Kuwait", "Bahrain", "Oman", "Jordan", "Lebanon", "Israel", "Egypt",
    "South Africa", "Nigeria", "Kenya", "Ghana", "Morocco", "China", "Japan", "South Korea",
    "Singapore", "Malaysia", "Thailand", "Vietnam", "Indonesia", "Philippines", "Australia", "New Zealand",
    "Brazil", "Argentina", "Chile", "Mexico", "Colombia", "Peru",
  ];

  const ENABLE_KEY = {
    manual: "shipping_manual_enabled",
    area: "shipping_area_enabled",
    classes: "shipping_class_enabled",
    intl: "shipping_intl_enabled",
    wd: "shipping_wd_enabled",
  };
  const TOGGLE_ID = {
    manual: "shipManualEnabled",
    area: "shipAreaEnabled",
    classes: "shipClassEnabled",
    intl: "shipIntlEnabled",
    wd: "shipWdEnabled",
  };
  const BODY_ID = {
    manual: "manualBody",
    area: "areaBody",
    classes: "classesBody",
    intl: "intlBody",
    wd: "wdBody",
  };

  // Payment card switches — prottek card er nijer on/off
  const PAY_TOGGLE = {
    cod: { toggle: "codEnabled", body: "codBody", key: "cod_enabled" },
    mobile: { toggle: "mobileBankingEnabled", body: "mobileBankingBody", key: "mobile_banking_enabled" },
    bank: { toggle: "bankingEnabled", body: "bankingBody", key: "banking_enabled" },
    apiMobile: { toggle: "apiMobileEnabled", body: "apiMobileBody", key: "api_mobile_enabled" },
    apiBank: { toggle: "apiBankEnabled", body: "apiBankBody", key: "api_banking_enabled" },
  };

  const CHECKOUT_FIELD_ORDER = [
    "name", "phone", "email", "address", "thana", "district", "division", "postCode", "country",
  ];
  const CHECKOUT_FIELD_TITLES = {
    name: "Name",
    phone: "Phone number",
    email: "Email",
    address: "Address",
    thana: "Thana",
    district: "District",
    division: "Division",
    postCode: "Post code",
    country: "Country",
  };
  const CHECKOUT_FIELD_DEFAULTS = {
    name: { label: "Name", shown: true, required: true },
    phone: { label: "Phone number", shown: true, required: true },
    email: { label: "Email", shown: true, required: false },
    address: { label: "Address", shown: true, required: true },
    thana: { label: "Thana", shown: false, required: false },
    district: { label: "District", shown: true, required: false },
    division: { label: "Division", shown: false, required: false },
    postCode: { label: "Post code", shown: false, required: false },
    country: { label: "Country", shown: true, required: false },
  };

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function toast(msg, type) {
    if (typeof window.toast === "function") window.toast(msg, type === "err" ? "err" : "ok");
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem(TOKEN_KEY);
      location.href = "/login.html";
      return null;
    }
    return res;
  }

  async function uploadImage(file) {
    const fd = new FormData();
    fd.append("image", file);
    const res = await fetch("/api/settings/upload", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: fd,
    });
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem(TOKEN_KEY);
      location.href = "/login.html";
      return "";
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Upload fail hoyeche");
    return data.path || "";
  }

  function markDirty() {
    state.dirty = true;
  }

  function setPreview(el, src, emptyText) {
    if (!el) return;
    el.innerHTML = src
      ? `<img src="${esc(src)}" alt="" />`
      : `<span>${esc(emptyText || "No image")}</span>`;
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function categoryOptionsHtml(selected, allLabel) {
    let html = `<option value="">${esc(allLabel || "All categories")}</option>`;
    const walk = (nodes, depth) => {
      (nodes || []).forEach((n) => {
        html += `<option value="${esc(n._id)}" ${String(selected || "") === String(n._id) ? "selected" : ""}>${esc("› ".repeat(depth) + n.name)}</option>`;
        if (n.children && n.children.length) walk(n.children, depth + 1);
      });
    };
    walk(state.categories, 0);
    return html;
  }

  function classOptionsHtml(selectedName) {
    let html = `<option value="">None</option>`;
    state.shipping.classes.forEach((c) => {
      if (!c.name) return;
      html += `<option value="${esc(c.name)}" ${String(selectedName || "") === String(c.name) ? "selected" : ""}>${esc(c.name)}</option>`;
    });
    return html;
  }

  function areaOptionsHtml(selectedName) {
    let html = `<option value="">Any area</option>`;
    state.shipping.manual.forEach((m) => {
      if (!m.areaName) return;
      html += `<option value="${esc(m.areaName)}" ${String(selectedName || "") === String(m.areaName) ? "selected" : ""}>${esc(m.areaName)}</option>`;
    });
    return html;
  }

  function classIdToName(id) {
    if (!id) return "";
    const found = state.shipping.classes.find((c) => String(c._id) === String(id));
    return found ? found.name : "";
  }

  /* ------------------------------------------------------------------ *
   * Datalists
   * ------------------------------------------------------------------ */
  function fillDatalists() {
    const d = $("districtList");
    if (d) d.innerHTML = DISTRICTS.map((x) => `<option value="${esc(x)}"></option>`).join("");
    const c = $("countryList");
    if (c) c.innerHTML = COUNTRIES.map((x) => `<option value="${esc(x)}"></option>`).join("");
  }

  /* ------------------------------------------------------------------ *
   * Pane switching
   * ------------------------------------------------------------------ */
  function showPane(name) {
    document.querySelectorAll("#settingsMenu .settings-menu-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.pane === name);
    });
    document.querySelectorAll(".settings-panes .settings-pane").forEach((p) => {
      p.classList.toggle("active", p.dataset.pane === name);
    });
  }

  document.querySelectorAll("#settingsMenu .settings-menu-item").forEach((btn) => {
    btn.addEventListener("click", () => showPane(btn.dataset.pane));
  });

  /* ------------------------------------------------------------------ *
   * Static fields
   * ------------------------------------------------------------------ */
  const STATIC_FIELDS = {
    logoWidth: "logo_width",
    logoHeight: "logo_height",
    siteTitle: "site_title",
    footerCopyright: "footer_copyright",
    areaNote: "shipping_area_note",
    intlNote: "shipping_intl_note",
    codInstruction: "cod_instruction",
  };

  Object.entries(STATIC_FIELDS).forEach(([id, key]) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      state.settings[key] = el.value;
      markDirty();
    });
  });

  const IMAGE_FIELDS = [
    { key: "logo", uploadBtn: "logoUploadBtn", file: "logoFile", preview: "logoPreview", clearBtn: "logoClearBtn", empty: "No logo" },
    { key: "favicon", uploadBtn: "faviconUploadBtn", file: "faviconFile", preview: "faviconPreview", clearBtn: "faviconClearBtn", empty: "No icon" },
    { key: "footer_logo", uploadBtn: "footerLogoUploadBtn", file: "footerLogoFile", preview: "footerLogoPreview", clearBtn: "footerLogoClearBtn", empty: "No logo" },
  ];

  IMAGE_FIELDS.forEach((f) => {
    const btn = $(f.uploadBtn);
    const input = $(f.file);
    const clear = $(f.clearBtn);
    if (btn && input) {
      btn.addEventListener("click", () => input.click());
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        input.value = "";
        if (!file) return;
        try {
          btn.disabled = true;
          const path = await uploadImage(file);
          if (!path) return;
          state.settings[f.key] = path;
          setPreview($(f.preview), path, f.empty);
          markDirty();
          toast("Image upload hoyeche");
        } catch (e) {
          toast(e.message, "err");
        } finally {
          btn.disabled = false;
        }
      });
    }
    if (clear) {
      clear.addEventListener("click", () => {
        state.settings[f.key] = "";
        setPreview($(f.preview), "", f.empty);
        markDirty();
      });
    }
  });

  /* ------------------------------------------------------------------ *
   * Product settings switches
   * ------------------------------------------------------------------ */
  $("setAttributes").addEventListener("change", (e) => {
    state.settings.attributes_enabled = e.target.checked ? "true" : "false";
    markDirty();
  });
  $("setSwatches").addEventListener("change", (e) => {
    state.settings.swatches_enabled = e.target.checked ? "true" : "false";
    markDirty();
  });

  /* ------------------------------------------------------------------ *
   * International Import Mode
   * ------------------------------------------------------------------ */
  function intlNumberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function intlLabelOr(value, fallback) {
    const label = String(value == null ? "" : value).trim();
    return label || fallback;
  }

  function applyInternational(settings, loaded) {
    const input = settings || {};
    const air = input.air || {};
    const sea = input.sea || {};
    const labels = input.labels || {};
    state.international = {
      enabled: input.enabled === true,
      advancePercent: intlNumberOr(input.advancePercent, INTERNATIONAL_DEFAULTS.advancePercent),
      codPercent: intlNumberOr(input.codPercent, INTERNATIONAL_DEFAULTS.codPercent),
      air: {
        label: intlLabelOr(air.label, INTERNATIONAL_DEFAULTS.air.label),
        minDays: intlNumberOr(air.minDays, INTERNATIONAL_DEFAULTS.air.minDays),
        maxDays: intlNumberOr(air.maxDays, INTERNATIONAL_DEFAULTS.air.maxDays),
      },
      sea: {
        label: intlLabelOr(sea.label, INTERNATIONAL_DEFAULTS.sea.label),
        minDays: intlNumberOr(sea.minDays, INTERNATIONAL_DEFAULTS.sea.minDays),
        maxDays: intlNumberOr(sea.maxDays, INTERNATIONAL_DEFAULTS.sea.maxDays),
      },
      labels: {
        shippingCharge: intlLabelOr(labels.shippingCharge, INTERNATIONAL_DEFAULTS.labels.shippingCharge),
        chinaCourier: intlLabelOr(labels.chinaCourier, INTERNATIONAL_DEFAULTS.labels.chinaCourier),
      },
    };
    state.internationalLoaded = loaded !== false;
    if (state.internationalLoaded) state.internationalLoadError = "";
  }

  function applyInternationalEnabled() {
    const toggle = $("intlEnabled");
    if (!toggle) return;
    toggle.checked = state.international.enabled === true;
    toggle.disabled = !!state.internationalLoadError;

    const disabled = !toggle.checked || !!state.internationalLoadError;
    const body = $("intlRules");
    if (body) {
      body.classList.toggle("is-off", disabled);
      body.querySelectorAll("input, select, textarea, button").forEach((el) => {
        el.disabled = disabled;
      });
    }

    const badge = document.querySelector("[data-international-off]");
    if (badge) badge.hidden = toggle.checked;

    const status = $("intlModeStatus");
    if (status) {
      status.textContent = toggle.checked
        ? "Mode ON — international import fields Add Product form e dekhabe."
        : "Mode OFF — purono product form-i cholbe.";
    }
  }

  function updateInternationalHint() {
    const hint = $("intlSplitHint");
    if (!hint) return;
    const advance = Number(state.international.advancePercent);
    const cod = Number(state.international.codPercent);
    const total = Math.round((advance + cod + Number.EPSILON) * 100) / 100;
    if (total === 100) {
      hint.textContent = `Advance ${advance}% + COD ${cod}% = 100%`;
      hint.classList.add("is-ok");
      hint.classList.remove("is-error");
    } else {
      hint.textContent = `Advance ${advance}% + COD ${cod}% = ${total}% — total 100% hote hobe`;
      hint.classList.add("is-error");
      hint.classList.remove("is-ok");
    }
  }

  function renderInternational() {
    const toggle = $("intlEnabled");
    if (!toggle) return;
    const setValue = (id, value) => {
      const el = $(id);
      if (el) el.value = value;
    };
    toggle.checked = state.international.enabled === true;
    setValue("intlAdvancePercent", state.international.advancePercent);
    setValue("intlCodPercent", state.international.codPercent);
    setValue("intlAirLabel", state.international.air.label);
    setValue("intlAirMinDays", state.international.air.minDays);
    setValue("intlAirMaxDays", state.international.air.maxDays);
    setValue("intlSeaLabel", state.international.sea.label);
    setValue("intlSeaMinDays", state.international.sea.minDays);
    setValue("intlSeaMaxDays", state.international.sea.maxDays);
    setValue("intlShippingChargeLabel", state.international.labels.shippingCharge);
    setValue("intlChinaCourierLabel", state.international.labels.chinaCourier);

    const error = $("intlLoadError");
    if (error) {
      error.hidden = !state.internationalLoadError;
      error.textContent = state.internationalLoadError || "";
    }

    applyInternationalEnabled();
    updateInternationalHint();
  }

  function validateInternational() {
    if (!state.internationalLoaded) {
      return "International settings load hoyni — page reload korun";
    }

    const advance = Number(state.international.advancePercent);
    const cod = Number(state.international.codPercent);
    if (
      !Number.isFinite(advance) ||
      !Number.isFinite(cod) ||
      advance < 0 ||
      advance > 100 ||
      cod < 0 ||
      cod > 100
    ) {
      return "Advance/COD percentage 0 theke 100 er moddhe hote hobe";
    }
    const total = Math.round((advance + cod + Number.EPSILON) * 100) / 100;
    if (total !== 100) return "Advance + COD percentage 100 hote hobe";

    const rules = [
      ["Air", state.international.air],
      ["Sea", state.international.sea],
    ];
    for (const [name, rule] of rules) {
      if (
        !Number.isInteger(rule.minDays) ||
        !Number.isInteger(rule.maxDays) ||
        rule.minDays < 0 ||
        rule.maxDays > 365 ||
        rule.minDays > rule.maxDays
      ) {
        return `${name} delivery days 0-365 er moddhe puro number ebong min <= max hote hobe`;
      }
    }

    const labels = state.international.labels;
    if (
      !state.international.air.label.trim() ||
      !state.international.sea.label.trim() ||
      !labels.shippingCharge.trim() ||
      !labels.chinaCourier.trim()
    ) {
      return "Shipping/courier label khali rakha jabe na";
    }
    return "";
  }

  function internationalPayload() {
    return {
      enabled: state.international.enabled === true,
      advancePercent: Number(state.international.advancePercent),
      codPercent: Number(state.international.codPercent),
      air: {
        label: state.international.air.label,
        minDays: Number(state.international.air.minDays),
        maxDays: Number(state.international.air.maxDays),
      },
      sea: {
        label: state.international.sea.label,
        minDays: Number(state.international.sea.minDays),
        maxDays: Number(state.international.sea.maxDays),
      },
      labels: {
        shippingCharge: state.international.labels.shippingCharge,
        chinaCourier: state.international.labels.chinaCourier,
      },
    };
  }

  const INTL_NUMBER_FIELDS = [
    ["intlAdvancePercent", (value) => { state.international.advancePercent = value; }],
    ["intlCodPercent", (value) => { state.international.codPercent = value; }],
    ["intlAirMinDays", (value) => { state.international.air.minDays = value; }],
    ["intlAirMaxDays", (value) => { state.international.air.maxDays = value; }],
    ["intlSeaMinDays", (value) => { state.international.sea.minDays = value; }],
    ["intlSeaMaxDays", (value) => { state.international.sea.maxDays = value; }],
  ];
  INTL_NUMBER_FIELDS.forEach(([id, set]) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      const n = Number(el.value);
      set(Number.isFinite(n) ? n : 0);
      updateInternationalHint();
      markDirty();
    });
  });

  const INTL_TEXT_FIELDS = [
    ["intlAirLabel", (value) => { state.international.air.label = value; }],
    ["intlSeaLabel", (value) => { state.international.sea.label = value; }],
    ["intlShippingChargeLabel", (value) => { state.international.labels.shippingCharge = value; }],
    ["intlChinaCourierLabel", (value) => { state.international.labels.chinaCourier = value; }],
  ];
  INTL_TEXT_FIELDS.forEach(([id, set]) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      set(el.value);
      markDirty();
    });
  });

  const intlToggle = $("intlEnabled");
  if (intlToggle) {
    intlToggle.addEventListener("change", (e) => {
      if (state.internationalLoadError) return;
      state.international.enabled = e.target.checked;
      applyInternationalEnabled();
      markDirty();
    });
  }

  /* ------------------------------------------------------------------ *
   * Marketing — flash sales global on/off
   * ------------------------------------------------------------------ */
  function applyFlashSalesUi() {
    const enabled = String(state.settings.flash_sales_enabled) !== "false";
    const toggle = $("flashSalesEnabled");
    if (toggle) toggle.checked = enabled;
    const status = $("flashSalesStatus");
    if (status) {
      status.textContent = enabled
        ? "Flash sales ON — sidebar e menu dekhabe."
        : "Flash sales OFF — sidebar theke menu hide ache.";
    }
    document.querySelectorAll("[data-flash-off]").forEach((badge) => {
      badge.hidden = enabled;
    });
    if (typeof window.applyFlashSalesStatus === "function") {
      window.applyFlashSalesStatus(enabled);
    }
  }

  const flashSalesToggle = $("flashSalesEnabled");
  if (flashSalesToggle) {
    flashSalesToggle.addEventListener("change", (e) => {
      state.settings.flash_sales_enabled = e.target.checked ? "true" : "false";
      applyFlashSalesUi();
      markDirty();
    });
  }

  /* ------------------------------------------------------------------ *
   * Wholesale mode + partial payment
   * ------------------------------------------------------------------ */
  const WS_CHARGE_LABEL = { per_piece: "Per piece", per_kg: "Per kg", flat: "Flat" };
  const WS_GOODS_LABEL = {
    after_advance: "After advance",
    after_half: "After 50% paid",
    after_full: "After full payment",
  };

  function wsNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function wsTaka(paisa) {
    return (Math.round(Number(paisa) || 0) / 100).toString();
  }

  function wsPaisa(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  }

  function wsMoney(paisa) {
    return "৳ " + (Math.round(Number(paisa) || 0) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function wsPercent(basisPoints) {
    const n = Math.round(Number(basisPoints) || 0) / 100;
    return `${n}%`;
  }

  function wsDate(date) {
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function wsSetValue(id, value) {
    const el = $(id);
    if (el) el.value = value;
  }

  function wsSetError(id, message) {
    const el = $(id);
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || "";
  }

  function normalizeWholesaleSettings(input) {
    const src = input || {};
    const d = WHOLESALE_DEFAULTS;
    const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
    return {
      enabled: src.enabled === true,
      badgeText:
        String(src.badgeText == null ? "" : src.badgeText).trim().slice(0, 40) || d.badgeText,
      moq: wsNumber(src.moq, d.moq),
      buyers: pick(src.buyers, ["all", "approved"], d.buyers),
      showRetailPrice: src.showRetailPrice !== false,
      vehicleOverflowRule: pick(
        src.vehicleOverflowRule,
        ["cheapest", "largest_first"],
        d.vehicleOverflowRule
      ),
      partialPaymentEnabled: src.partialPaymentEnabled === true,
      lateFeePaisa: wsNumber(src.lateFeePaisa, d.lateFeePaisa),
      lateFeeType: pick(src.lateFeeType, ["flat", "percent"], d.lateFeeType),
      graceDays: wsNumber(src.graceDays, d.graceDays),
      maxOpenInstallmentOrders: wsNumber(
        src.maxOpenInstallmentOrders,
        d.maxOpenInstallmentOrders
      ),
      goodsReleaseRule: pick(
        src.goodsReleaseRule,
        ["after_advance", "after_half", "after_full"],
        d.goodsReleaseRule
      ),
      installmentBuyers: pick(
        src.installmentBuyers,
        ["approved", "all"],
        d.installmentBuyers
      ),
      shippingInFirstInstallment: src.shippingInFirstInstallment !== false,
      overdueAction: pick(src.overdueAction, ["hold", "cancel"], d.overdueAction),
      overdueDays: wsNumber(src.overdueDays, d.overdueDays),
      refundType: pick(src.refundType, ["full", "percent", "none"], d.refundType),
      refundPercent: wsNumber(src.refundPercent, d.refundPercent),
    };
  }

  function applyWholesaleSettings(settings) {
    state.wholesale = {
      ...normalizeWholesaleSettings(settings),
      rules: state.wholesale.rules,
      vehicles: state.wholesale.vehicles,
      speeds: state.wholesale.speeds,
      plans: state.wholesale.plans,
      buyerList: state.wholesale.buyerList,
      buyerSearch: state.wholesale.buyerSearch,
    };
    state.wholesaleLoaded = true;
    state.wholesaleLoadError = "";
  }

  function applyWholesaleEnabled() {
    const toggle = $("wholesaleEnabled");
    if (!toggle) return;
    const loadError = !!state.wholesaleLoadError && !state.wholesaleLoaded;
    const intlOn = state.internationalLoaded && state.international.enabled === true;

    toggle.checked = state.wholesale.enabled === true;
    toggle.disabled = loadError || intlOn;

    const body = $("wholesaleBody");
    const off = !toggle.checked || loadError;
    if (body) {
      body.classList.toggle("is-off", off);
      body.querySelectorAll("input, select, textarea, button").forEach((el) => {
        el.disabled = off;
      });
    }

    const badge = document.querySelector("[data-wholesale-off]");
    if (badge) badge.hidden = toggle.checked;

    const status = $("wholesaleModeStatus");
    if (status) {
      if (loadError) {
        status.textContent = "Wholesale settings load hoyni — page reload korun.";
      } else {
        status.textContent = toggle.checked
          ? "Wholesale ON — retail single-item buying bondho, tier price cholche."
          : "Wholesale OFF — retail flow ager motoi cholche.";
      }
    }

    const conflict = $("wholesaleConflictWarn");
    if (conflict) conflict.hidden = !intlOn;

    const error = $("wholesaleLoadError");
    if (error) {
      error.hidden = !state.wholesaleLoadError;
      error.textContent = state.wholesaleLoadError || "";
    }

    const intlToggle = $("intlEnabled");
    if (intlToggle && state.internationalLoaded && !state.internationalLoadError) {
      intlToggle.disabled = toggle.checked;
    }
    const intlWarn = $("intlWholesaleWarn");
    if (intlWarn) intlWarn.hidden = !toggle.checked;

    applyPartialEnabled();
  }

  function applyPartialEnabled() {
    const toggle = $("partialEnabled");
    if (!toggle) return;
    const loadError = !!state.wholesaleLoadError && !state.wholesaleLoaded;
    const wholesaleOn = state.wholesaleLoaded && state.wholesale.enabled === true;

    toggle.checked = state.wholesale.partialPaymentEnabled === true;
    toggle.disabled = loadError || !wholesaleOn;

    const body = $("partialBody");
    const active = wholesaleOn && toggle.checked;
    if (body) {
      body.classList.toggle("is-off", !active);
      body.querySelectorAll("input, select, textarea, button").forEach((el) => {
        el.disabled = !active;
      });
    }

    const badge = document.querySelector("[data-partial-off]");
    if (badge) badge.hidden = active;

    const status = $("partialModeStatus");
    if (status) {
      if (loadError) {
        status.textContent = "Wholesale settings load hoyni — page reload korun.";
      } else if (!wholesaleOn) {
        status.textContent = "Wholesale OFF — partial payment inactive, checkout e full payment cholbe.";
      } else if (toggle.checked) {
        status.textContent = "Partial payment ON — eligible wholesale checkout e plans dekhabe.";
      } else {
        status.textContent = "Partial payment OFF — wholesale checkout e full payment cholbe.";
      }
    }

    const warn = $("partialWholesaleWarn");
    if (warn) warn.hidden = wholesaleOn || loadError;
  }

  function wsCategoryOptions(selected) {
    let html = `<option value="">Select category</option>`;
    const walk = (nodes, depth) => {
      (nodes || []).forEach((node) => {
        html += `<option value="${esc(node._id)}" ${
          String(selected || "") === String(node._id) ? "selected" : ""
        }>${esc("› ".repeat(depth) + node.name)}</option>`;
        if (node.children && node.children.length) walk(node.children, depth + 1);
      });
    };
    walk(state.categories, 0);
    return html;
  }

  function wsCategoryName(id) {
    let name = "";
    const walk = (nodes) => {
      (nodes || []).forEach((node) => {
        if (String(node._id) === String(id)) name = node.name;
        if (node.children && node.children.length) walk(node.children);
      });
    };
    walk(state.categories);
    return name || "(deleted category)";
  }

  function updatePartialUnits() {
    const lateType = $("partialLateFeeType") ? $("partialLateFeeType").value : "flat";
    const unit = $("partialLateFeeUnit");
    if (unit) unit.textContent = lateType === "percent" ? "(%)" : "(৳)";
    const refundField = $("partialRefundPercentField");
    if (refundField) {
      refundField.hidden = !$("partialRefundType") || $("partialRefundType").value !== "percent";
    }
  }

  function updatePlanUnits() {
    const advType = $("planAdvanceType") ? $("planAdvanceType").value : "percent";
    const advUnit = $("planAdvanceUnit");
    if (advUnit) advUnit.textContent = advType === "percent" ? "(%)" : "(৳)";
    const feeType = $("planFeeType") ? $("planFeeType").value : "none";
    const feeUnit = $("planFeeUnit");
    if (feeUnit) feeUnit.textContent = feeType === "percent" ? "(%)" : feeType === "fixed" ? "(৳)" : "";
  }

  function renderWholesale() {
    const w = state.wholesale;
    wsSetValue("wholesaleBadgeText", w.badgeText);
    wsSetValue("wholesaleMoq", w.moq);
    wsSetValue("wholesaleBuyers", w.buyers);
    wsSetValue("wholesaleOverflowRule", w.vehicleOverflowRule);
    const showRetail = $("wholesaleShowRetail");
    if (showRetail) showRetail.checked = w.showRetailPrice === true;

    renderWsRules();
    renderWsVehicles();
    renderWsSpeeds();
    renderWsBuyers();
    applyWholesaleEnabled();
  }

  function renderPartial() {
    const w = state.wholesale;
    wsSetValue("partialLateFeeType", w.lateFeeType);
    wsSetValue("partialLateFeeValue", wsTaka(w.lateFeePaisa));
    wsSetValue("partialGraceDays", w.graceDays);
    wsSetValue("partialMaxOpen", w.maxOpenInstallmentOrders);
    wsSetValue("partialGoodsRelease", w.goodsReleaseRule);
    wsSetValue("partialBuyers", w.installmentBuyers);
    wsSetValue("partialOverdueAction", w.overdueAction);
    wsSetValue("partialOverdueDays", w.overdueDays);
    wsSetValue("partialRefundType", w.refundType);
    wsSetValue("partialRefundPercent", w.refundPercent);
    const shipFirst = $("partialShipFirst");
    if (shipFirst) shipFirst.checked = w.shippingInFirstInstallment === true;

    updatePartialUnits();
    renderPlanRows();
    renderPreviewPlanOptions();
    updateSchedulePreview();
    applyPartialEnabled();
  }

  function renderWsRules() {
    const tbody = $("wsRuleRows");
    if (!tbody) return;
    const rows = state.wholesale.rules || [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="settings-empty">Ekhono kono category shipping rule nei.</td></tr>`;
    } else {
      tbody.innerHTML = rows
        .map(
          (rule) => `<tr>
            <td>${esc(wsCategoryName(rule.category))}</td>
            <td>${esc(WS_CHARGE_LABEL[rule.chargeType] || rule.chargeType)}</td>
            <td>${esc(wsMoney(rule.ratePaisa))}</td>
            <td><div class="ws-table-actions">
              <button class="pf-btn-sm" type="button" data-ws-action="rule-edit" data-id="${esc(rule._id)}">Edit</button>
              <button class="pf-btn-sm pf-btn-danger" type="button" data-ws-action="rule-delete" data-id="${esc(rule._id)}">Remove</button>
            </div></td>
          </tr>`
        )
        .join("");
    }
    const select = $("wsRuleCategory");
    if (select) {
      const selected = state.wholesaleEdit.rule ? state.wholesaleEdit.rule.category : "";
      select.innerHTML = wsCategoryOptions(selected);
    }
  }

  function renderWsVehicles() {
    const tbody = $("wsVehicleRows");
    if (!tbody) return;
    const rows = state.wholesale.vehicles || [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="settings-empty">Ekhono kono vehicle nei.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map(
        (vehicle) => `<tr>
          <td>${esc(vehicle.name)}</td>
          <td>${esc(vehicle.maxWeightKg)} kg</td>
          <td>${esc(wsMoney(vehicle.chargePaisa))}</td>
          <td><div class="ws-table-actions">
            <button class="pf-btn-sm" type="button" data-ws-action="vehicle-edit" data-id="${esc(vehicle._id)}">Edit</button>
            <button class="pf-btn-sm pf-btn-danger" type="button" data-ws-action="vehicle-delete" data-id="${esc(vehicle._id)}">Remove</button>
          </div></td>
        </tr>`
      )
      .join("");
  }

  function renderWsSpeeds() {
    const tbody = $("wsSpeedRows");
    if (!tbody) return;
    const rows = state.wholesale.speeds || [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="settings-empty">Ekhono kono delivery speed nei.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map((speed) => {
        const extra =
          speed.extraType === "percent"
            ? wsPercent(speed.extraValue)
            : wsMoney(speed.extraValue);
        return `<tr>
          <td>${esc(speed.name)}</td>
          <td>${esc(speed.etaDays)} days</td>
          <td>${esc(extra)}</td>
          <td><div class="ws-table-actions">
            <button class="pf-btn-sm" type="button" data-ws-action="speed-edit" data-id="${esc(speed._id)}">Edit</button>
            <button class="pf-btn-sm pf-btn-danger" type="button" data-ws-action="speed-delete" data-id="${esc(speed._id)}">Remove</button>
          </div></td>
        </tr>`;
      })
      .join("");
  }

  function renderWsBuyers() {
    const tbody = $("wsBuyerRows");
    if (!tbody) return;
    const query = String(state.wholesale.buyerSearch || "").trim().toLowerCase();
    const rows = (state.wholesale.buyerList || []).filter((buyer) => {
      if (!query) return true;
      return [buyer.name, buyer.email, buyer.phone].some((value) =>
        String(value || "").toLowerCase().includes(query)
      );
    });
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="settings-empty">${
        query ? "Ei search e kono buyer pawa jayni." : "Kono buyer pawa jayni."
      }</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map((buyer) => {
        const approved = buyer.wholesaleApproved === true;
        const contact = [buyer.email, buyer.phone].filter(Boolean).join(" · ") || "—";
        return `<tr>
          <td>${esc(buyer.name || "—")}</td>
          <td>${esc(contact)}</td>
          <td><span class="ws-chip ${approved ? "is-on" : ""}">${approved ? "Approved" : "Not approved"}</span></td>
          <td><button class="pf-btn-sm ${
            approved ? "pf-btn-danger" : "ws-primary"
          }" type="button" data-ws-action="buyer-toggle" data-id="${esc(buyer._id)}">${
          approved ? "Revoke" : "Approve"
        }</button></td>
        </tr>`;
      })
      .join("");
  }

  function renderPlanRows() {
    const tbody = $("partialPlanRows");
    if (!tbody) return;
    const rows = state.wholesale.plans || [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="settings-empty">Ekhono kono installment plan nei.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map((plan) => {
        const advance =
          plan.advanceType === "percent" ? wsPercent(plan.advanceValue) : wsMoney(plan.advanceValue);
        const fee =
          plan.feeType === "percent"
            ? wsPercent(plan.feeValue)
            : plan.feeType === "fixed"
            ? wsMoney(plan.feeValue)
            : "—";
        const minimum = plan.minOrderAmountPaisa ? wsMoney(plan.minOrderAmountPaisa) : "—";
        const active = plan.isActive !== false;
        return `<tr>
          <td class="ws-strong">${esc(plan.name)}</td>
          <td>${esc(plan.installmentsCount)}</td>
          <td>${esc(advance)}</td>
          <td>${esc(plan.gapDays)} days</td>
          <td>${esc(minimum)}</td>
          <td>${esc(fee)}</td>
          <td><span class="ws-chip ${active ? "is-on" : "is-off"}">${active ? "Active" : "Inactive"}</span></td>
          <td><div class="ws-table-actions">
            <button class="pf-btn-sm" type="button" data-ws-action="plan-edit" data-id="${esc(plan._id)}">Edit</button>
            <button class="pf-btn-sm pf-btn-danger" type="button" data-ws-action="plan-delete" data-id="${esc(plan._id)}">Remove</button>
          </div></td>
        </tr>`;
      })
      .join("");
  }

  function renderPreviewPlanOptions() {
    const select = $("previewPlan");
    if (!select) return;
    const current = select.value;
    const plans = state.wholesale.plans || [];
    if (!plans.length) {
      select.innerHTML = `<option value="">No plan</option>`;
      return;
    }
    select.innerHTML = plans
      .map(
        (plan) =>
          `<option value="${esc(plan._id)}">${esc(plan.name)}${
            plan.isActive === false ? " (inactive)" : ""
          }</option>`
      )
      .join("");
    if (current && plans.some((plan) => String(plan._id) === String(current))) {
      select.value = current;
    }
  }

  function updateSchedulePreview() {
    const tbody = $("previewScheduleRows");
    const summary = $("previewSummary");
    if (!tbody) return;

    const planId = $("previewPlan") ? $("previewPlan").value : "";
    const plan = (state.wholesale.plans || []).find(
      (row) => String(row._id) === String(planId)
    );
    const items = wsPaisa($("previewAmount") ? $("previewAmount").value : 0);
    const shipping = wsPaisa($("previewShipping") ? $("previewShipping").value : 0);

    tbody.innerHTML = "";
    wsSetError("previewError", "");
    if (summary) summary.textContent = "";

    if (!plan) {
      wsSetError("previewError", "Age ekta installment plan add korun.");
      return;
    }
    if (!Number.isInteger(items) || items <= 0) {
      wsSetError("previewError", "Order amount 0 er beshi hote hobe.");
      return;
    }
    if (!Number.isInteger(shipping) || shipping < 0) {
      wsSetError("previewError", "Shipping amount valid hote hobe.");
      return;
    }
    if (plan.minOrderAmountPaisa && items < plan.minOrderAmountPaisa) {
      wsSetError("previewError", `Ei plan er minimum order ${wsMoney(plan.minOrderAmountPaisa)}.`);
      return;
    }
    if (plan.advanceType === "fixed" && plan.advanceValue > items) {
      wsSetError("previewError", "Advance order amount er cheye beshi hote parbe na.");
      return;
    }

    const advance =
      plan.advanceType === "fixed"
        ? Number(plan.advanceValue)
        : Math.round((items * Number(plan.advanceValue)) / 10000);
    let fee = 0;
    if (plan.feeType === "percent") {
      fee = Math.round(((items - advance) * Number(plan.feeValue)) / 10000);
    } else if (plan.feeType === "fixed") {
      fee = Number(plan.feeValue);
    }

    const shipFirst = state.wholesale.shippingInFirstInstallment === true;
    const first = advance + (shipFirst ? shipping : 0);
    const restTotal = items - advance + fee + (shipFirst ? 0 : shipping);
    const restCount = Number(plan.installmentsCount) - 1;
    const share = Math.floor(restTotal / restCount);
    const rest = Array.from({ length: restCount }, (_, index) =>
      index === restCount - 1 ? restTotal - share * (restCount - 1) : share
    );
    const amounts = [first, ...rest];
    const total = items + shipping + fee;
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    tbody.innerHTML = amounts
      .map((amount, index) => {
        const due = new Date(start.getTime() + index * Number(plan.gapDays) * 86400000);
        return `<tr>
          <td>${index + 1}</td>
          <td>${esc(wsDate(due))}</td>
          <td>${esc(wsMoney(amount))}</td>
          <td class="ws-muted">${index === 0 ? "Advance" : "Installment"}</td>
        </tr>`;
      })
      .join("");

    if (summary) {
      summary.innerHTML =
        `Advance ${esc(wsMoney(advance))} · Fee ${esc(wsMoney(fee))} · ` +
        `Shipping ${esc(wsMoney(shipping))} (${shipFirst ? "first" : "last"} installment) · ` +
        `<span class="ws-preview-advance">Total ${esc(wsMoney(total))}</span>`;
    }
    const foot = $("previewFootnote");
    if (foot) {
      foot.textContent =
        "Baki amount equal bhabe bage hoy; leftover paisa last installment e jay. Ei preview approximate — checkout e final schedule snapshot hobe.";
    }
  }

  async function wsJson(url, options) {
    const res = await api(url, options);
    if (!res) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Request fail hoyeche");
    return data;
  }

  async function refreshWholesaleList(kind) {
    const paths = {
      rules: "/api/wholesale/shipping-rules",
      vehicles: "/api/wholesale/vehicles",
      speeds: "/api/wholesale/speeds",
      plans: "/api/wholesale/plans",
      buyers: "/api/wholesale/buyers",
    };
    try {
      const data = await wsJson(paths[kind]);
      if (!data) return;
      if (kind === "rules") {
        state.wholesale.rules = data.rules || [];
        renderWsRules();
      } else if (kind === "vehicles") {
        state.wholesale.vehicles = data.vehicles || [];
        renderWsVehicles();
      } else if (kind === "speeds") {
        state.wholesale.speeds = data.speeds || [];
        renderWsSpeeds();
      } else if (kind === "plans") {
        state.wholesale.plans = data.plans || [];
        renderPlanRows();
        renderPreviewPlanOptions();
        updateSchedulePreview();
      } else if (kind === "buyers") {
        state.wholesale.buyerList = data.buyers || [];
        renderWsBuyers();
      }
      applyWholesaleEnabled();
    } catch (e) {
      toast(e.message, "err");
    }
  }

  async function loadWholesale() {
    if (state.wholesaleLoading) return;
    state.wholesaleLoading = true;
    try {
      const [settings, rules, vehicles, speeds, plans, buyers] = await Promise.all([
        wsJson("/api/wholesale/settings"),
        wsJson("/api/wholesale/shipping-rules"),
        wsJson("/api/wholesale/vehicles"),
        wsJson("/api/wholesale/speeds"),
        wsJson("/api/wholesale/plans"),
        wsJson("/api/wholesale/buyers"),
      ]);
      if (!settings) return;
      state.wholesale = {
        ...normalizeWholesaleSettings(settings.settings),
        rules: (rules && rules.rules) || [],
        vehicles: (vehicles && vehicles.vehicles) || [],
        speeds: (speeds && speeds.speeds) || [],
        plans: (plans && plans.plans) || [],
        buyerList: (buyers && buyers.buyers) || [],
        buyerSearch: state.wholesale.buyerSearch,
      };
      state.wholesaleLoaded = true;
      state.wholesaleLoadError = "";
      renderWholesale();
      renderPartial();
    } catch (e) {
      state.wholesaleLoadError =
        e.message || "Wholesale settings load hoyni — server restart ba page reload korun";
      renderWholesale();
      renderPartial();
    } finally {
      state.wholesaleLoading = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Wholesale form bindings
   * ------------------------------------------------------------------ */
  const wsTextBindings = [
    ["wholesaleBadgeText", (value) => { state.wholesale.badgeText = value; }],
  ];
  wsTextBindings.forEach(([id, set]) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      set(el.value);
      markDirty();
    });
  });

  const wsNumberBindings = [
    ["wholesaleMoq", (value) => { state.wholesale.moq = value; }],
    ["partialGraceDays", (value) => { state.wholesale.graceDays = value; }],
    ["partialMaxOpen", (value) => { state.wholesale.maxOpenInstallmentOrders = value; }],
    ["partialOverdueDays", (value) => { state.wholesale.overdueDays = value; }],
    ["partialRefundPercent", (value) => { state.wholesale.refundPercent = value; }],
  ];
  wsNumberBindings.forEach(([id, set]) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => {
      set(el.value === "" ? NaN : Number(el.value));
      markDirty();
    });
  });

  const wsSelectBindings = [
    ["wholesaleBuyers", (value) => { state.wholesale.buyers = value; }],
    ["wholesaleOverflowRule", (value) => { state.wholesale.vehicleOverflowRule = value; }],
    ["partialGoodsRelease", (value) => { state.wholesale.goodsReleaseRule = value; }],
    ["partialBuyers", (value) => { state.wholesale.installmentBuyers = value; }],
    ["partialOverdueAction", (value) => { state.wholesale.overdueAction = value; }],
  ];
  wsSelectBindings.forEach(([id, set]) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("change", () => {
      set(el.value);
      markDirty();
    });
  });

  const lateFeeValue = $("partialLateFeeValue");
  if (lateFeeValue) {
    lateFeeValue.addEventListener("input", () => {
      const paisa = wsPaisa(lateFeeValue.value);
      state.wholesale.lateFeePaisa = Number.isFinite(paisa) ? paisa : 0;
      markDirty();
    });
  }

  const lateFeeType = $("partialLateFeeType");
  if (lateFeeType) {
    lateFeeType.addEventListener("change", () => {
      state.wholesale.lateFeeType = lateFeeType.value;
      if (state.wholesale.lateFeeType === "percent" && state.wholesale.lateFeePaisa > 10000) {
        state.wholesale.lateFeePaisa = 0;
        wsSetValue("partialLateFeeValue", 0);
      }
      updatePartialUnits();
      markDirty();
    });
  }

  const refundType = $("partialRefundType");
  if (refundType) {
    refundType.addEventListener("change", () => {
      state.wholesale.refundType = refundType.value;
      updatePartialUnits();
      markDirty();
    });
  }

  const showRetail = $("wholesaleShowRetail");
  if (showRetail) {
    showRetail.addEventListener("change", () => {
      state.wholesale.showRetailPrice = showRetail.checked;
      markDirty();
    });
  }

  const partialShipFirst = $("partialShipFirst");
  if (partialShipFirst) {
    partialShipFirst.addEventListener("change", () => {
      state.wholesale.shippingInFirstInstallment = partialShipFirst.checked;
      updateSchedulePreview();
      markDirty();
    });
  }

  const wholesaleToggle = $("wholesaleEnabled");
  if (wholesaleToggle) {
    wholesaleToggle.addEventListener("change", () => {
      state.wholesale.enabled = wholesaleToggle.checked;
      applyWholesaleEnabled();
      markDirty();
    });
  }

  const partialToggle = $("partialEnabled");
  if (partialToggle) {
    partialToggle.addEventListener("change", () => {
      state.wholesale.partialPaymentEnabled = partialToggle.checked;
      applyPartialEnabled();
      markDirty();
    });
  }

  if (intlToggle) {
    intlToggle.addEventListener("change", () => {
      applyWholesaleEnabled();
    });
  }

  const buyerSearch = $("wsBuyerSearch");
  if (buyerSearch) {
    buyerSearch.addEventListener("input", () => {
      state.wholesale.buyerSearch = buyerSearch.value;
      renderWsBuyers();
      applyWholesaleEnabled();
    });
  }

  /* ------------------------------------------------------------------ *
   * Wholesale CRUD editors
   * ------------------------------------------------------------------ */
  function resetRuleForm() {
    state.wholesaleEdit.rule = null;
    wsSetValue("wsRuleCategory", "");
    wsSetValue("wsRuleChargeType", "per_piece");
    wsSetValue("wsRuleRate", "");
    wsSetError("wsRuleError", "");
    const submit = $("wsRuleSubmit");
    if (submit) submit.textContent = "+ Add rule";
    const cancel = $("wsRuleCancel");
    if (cancel) cancel.hidden = true;
    renderWsRules();
    applyWholesaleEnabled();
  }

  function editRule(id) {
    const rule = state.wholesale.rules.find((row) => String(row._id) === String(id));
    if (!rule) return;
    state.wholesaleEdit.rule = rule;
    renderWsRules();
    wsSetValue("wsRuleCategory", rule.category);
    wsSetValue("wsRuleChargeType", rule.chargeType);
    wsSetValue("wsRuleRate", wsTaka(rule.ratePaisa));
    wsSetError("wsRuleError", "");
    const submit = $("wsRuleSubmit");
    if (submit) submit.textContent = "Update rule";
    const cancel = $("wsRuleCancel");
    if (cancel) cancel.hidden = false;
    const editor = $("wsRuleEditor");
    if (editor) editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function submitRule() {
    const categoryId = $("wsRuleCategory").value;
    const chargeType = $("wsRuleChargeType").value;
    const ratePaisa = wsPaisa($("wsRuleRate").value);
    if (!categoryId) return wsSetError("wsRuleError", "Category select korun.");
    if (!["per_piece", "per_kg", "flat"].includes(chargeType)) {
      return wsSetError("wsRuleError", "Charge type valid na.");
    }
    if (!Number.isInteger(ratePaisa) || ratePaisa < 0) {
      return wsSetError("wsRuleError", "Rate 0 ba tar beshi hote hobe.");
    }
    wsSetError("wsRuleError", "");
    const editing = state.wholesaleEdit.rule;
    try {
      const data = await wsJson(
        editing ? `/api/wholesale/shipping-rules/${editing._id}` : "/api/wholesale/shipping-rules",
        {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify({ categoryId, chargeType, ratePaisa }),
        }
      );
      if (!data) return;
      resetRuleForm();
      await refreshWholesaleList("rules");
      toast(editing ? "Shipping rule update hoyeche" : "Shipping rule add hoyeche");
    } catch (e) {
      wsSetError("wsRuleError", e.message);
    }
  }

  function resetVehicleForm() {
    state.wholesaleEdit.vehicle = null;
    wsSetValue("wsVehicleName", "");
    wsSetValue("wsVehicleMaxKg", "");
    wsSetValue("wsVehicleCharge", "");
    wsSetError("wsVehicleError", "");
    const submit = $("wsVehicleSubmit");
    if (submit) submit.textContent = "+ Add vehicle";
    const cancel = $("wsVehicleCancel");
    if (cancel) cancel.hidden = true;
  }

  function editVehicle(id) {
    const vehicle = state.wholesale.vehicles.find((row) => String(row._id) === String(id));
    if (!vehicle) return;
    state.wholesaleEdit.vehicle = vehicle;
    wsSetValue("wsVehicleName", vehicle.name);
    wsSetValue("wsVehicleMaxKg", vehicle.maxWeightKg);
    wsSetValue("wsVehicleCharge", wsTaka(vehicle.chargePaisa));
    wsSetError("wsVehicleError", "");
    const submit = $("wsVehicleSubmit");
    if (submit) submit.textContent = "Update vehicle";
    const cancel = $("wsVehicleCancel");
    if (cancel) cancel.hidden = false;
    const editor = $("wsVehicleEditor");
    if (editor) editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function submitVehicle() {
    const name = String($("wsVehicleName").value || "").trim();
    const maxWeightKg = Number($("wsVehicleMaxKg").value);
    const chargePaisa = wsPaisa($("wsVehicleCharge").value);
    if (!name) return wsSetError("wsVehicleError", "Vehicle name lagbe.");
    if (!Number.isInteger(maxWeightKg) || maxWeightKg < 1) {
      return wsSetError("wsVehicleError", "Max load 1 kg ba tar beshi puro number hote hobe.");
    }
    if (!Number.isInteger(chargePaisa) || chargePaisa < 0) {
      return wsSetError("wsVehicleError", "Vehicle charge valid amount hote hobe.");
    }
    wsSetError("wsVehicleError", "");
    const editing = state.wholesaleEdit.vehicle;
    try {
      const data = await wsJson(
        editing ? `/api/wholesale/vehicles/${editing._id}` : "/api/wholesale/vehicles",
        { method: editing ? "PUT" : "POST", body: JSON.stringify({ name, maxWeightKg, chargePaisa }) }
      );
      if (!data) return;
      resetVehicleForm();
      await refreshWholesaleList("vehicles");
      toast(editing ? "Vehicle update hoyeche" : "Vehicle add hoyeche");
    } catch (e) {
      wsSetError("wsVehicleError", e.message);
    }
  }

  function resetSpeedForm() {
    state.wholesaleEdit.speed = null;
    wsSetValue("wsSpeedName", "");
    wsSetValue("wsSpeedEtaDays", "");
    wsSetValue("wsSpeedExtraType", "flat");
    wsSetValue("wsSpeedExtraValue", "");
    const unit = $("wsSpeedValueUnit");
    if (unit) unit.textContent = "(৳)";
    wsSetError("wsSpeedError", "");
    const submit = $("wsSpeedSubmit");
    if (submit) submit.textContent = "+ Add speed";
    const cancel = $("wsSpeedCancel");
    if (cancel) cancel.hidden = true;
  }

  function editSpeed(id) {
    const speed = state.wholesale.speeds.find((row) => String(row._id) === String(id));
    if (!speed) return;
    state.wholesaleEdit.speed = speed;
    wsSetValue("wsSpeedName", speed.name);
    wsSetValue("wsSpeedEtaDays", speed.etaDays);
    wsSetValue("wsSpeedExtraType", speed.extraType);
    wsSetValue("wsSpeedExtraValue", wsTaka(speed.extraValue));
    const unit = $("wsSpeedValueUnit");
    if (unit) unit.textContent = speed.extraType === "percent" ? "(%)" : "(৳)";
    wsSetError("wsSpeedError", "");
    const submit = $("wsSpeedSubmit");
    if (submit) submit.textContent = "Update speed";
    const cancel = $("wsSpeedCancel");
    if (cancel) cancel.hidden = false;
    const editor = $("wsSpeedEditor");
    if (editor) editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function submitSpeed() {
    const name = String($("wsSpeedName").value || "").trim();
    const etaDays = Number($("wsSpeedEtaDays").value);
    const extraType = $("wsSpeedExtraType").value;
    const rawValue = Number($("wsSpeedExtraValue").value);
    if (!name) return wsSetError("wsSpeedError", "Speed name lagbe.");
    if (!Number.isInteger(etaDays) || etaDays < 0 || etaDays > 365) {
      return wsSetError("wsSpeedError", "Delivery days 0-365 er moddhe hote hobe.");
    }
    if (!Number.isFinite(rawValue) || rawValue < 0) {
      return wsSetError("wsSpeedError", "Extra charge valid value hote hobe.");
    }
    if (extraType === "percent" && rawValue > 100) {
      return wsSetError("wsSpeedError", "Percent extra 0-100% er moddhe hote hobe.");
    }
    const extraValue = Math.round(rawValue * 100);
    wsSetError("wsSpeedError", "");
    const editing = state.wholesaleEdit.speed;
    try {
      const data = await wsJson(
        editing ? `/api/wholesale/speeds/${editing._id}` : "/api/wholesale/speeds",
        { method: editing ? "PUT" : "POST", body: JSON.stringify({ name, etaDays, extraType, extraValue }) }
      );
      if (!data) return;
      resetSpeedForm();
      await refreshWholesaleList("speeds");
      toast(editing ? "Delivery speed update hoyeche" : "Delivery speed add hoyeche");
    } catch (e) {
      wsSetError("wsSpeedError", e.message);
    }
  }

  const speedExtraType = $("wsSpeedExtraType");
  if (speedExtraType) {
    speedExtraType.addEventListener("change", () => {
      const unit = $("wsSpeedValueUnit");
      if (unit) unit.textContent = speedExtraType.value === "percent" ? "(%)" : "(৳)";
      const value = Number($("wsSpeedExtraValue").value);
      if (speedExtraType.value === "percent" && value > 100) {
        wsSetValue("wsSpeedExtraValue", 0);
      }
    });
  }

  function resetPlanForm() {
    state.wholesaleEdit.plan = null;
    wsSetValue("planName", "");
    wsSetValue("planInstallments", 3);
    wsSetValue("planAdvanceType", "percent");
    wsSetValue("planAdvanceValue", 30);
    wsSetValue("planGapDays", 30);
    wsSetValue("planMinOrder", 0);
    wsSetValue("planFeeType", "none");
    wsSetValue("planFeeValue", 0);
    const active = $("planActive");
    if (active) active.checked = true;
    updatePlanUnits();
    wsSetError("planError", "");
    const submit = $("planSubmitBtn");
    if (submit) submit.textContent = "+ Add plan";
    const cancel = $("planCancelBtn");
    if (cancel) cancel.hidden = true;
  }

  function editPlan(id) {
    const plan = state.wholesale.plans.find((row) => String(row._id) === String(id));
    if (!plan) return;
    state.wholesaleEdit.plan = plan;
    wsSetValue("planName", plan.name);
    wsSetValue("planInstallments", plan.installmentsCount);
    wsSetValue("planAdvanceType", plan.advanceType);
    wsSetValue("planAdvanceValue", wsTaka(plan.advanceValue));
    wsSetValue("planGapDays", plan.gapDays);
    wsSetValue("planMinOrder", wsTaka(plan.minOrderAmountPaisa));
    wsSetValue("planFeeType", plan.feeType || "none");
    wsSetValue("planFeeValue", wsTaka(plan.feeValue));
    const active = $("planActive");
    if (active) active.checked = plan.isActive !== false;
    updatePlanUnits();
    wsSetError("planError", "");
    const submit = $("planSubmitBtn");
    if (submit) submit.textContent = "Update plan";
    const cancel = $("planCancelBtn");
    if (cancel) cancel.hidden = false;
    const editor = $("partialPlanEditor");
    if (editor) editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function readPlanForm() {
    const name = String($("planName").value || "").trim();
    if (!name) return { error: "Plan name lagbe." };
    const count = Number($("planInstallments").value);
    if (!Number.isInteger(count) || count < 2 || count > 60) {
      return { error: "Installment count 2-60 er moddhe hote hobe." };
    }
    const advanceType = $("planAdvanceType").value;
    const advanceRaw = Number($("planAdvanceValue").value);
    if (!Number.isFinite(advanceRaw) || advanceRaw < 0) {
      return { error: "Advance value valid hote hobe." };
    }
    if (advanceType === "percent" && advanceRaw > 100) {
      return { error: "Advance percent 0-100% er moddhe hote hobe." };
    }
    const gapDays = Number($("planGapDays").value);
    if (!Number.isInteger(gapDays) || gapDays < 0 || gapDays > 365) {
      return { error: "Gap days 0-365 er moddhe hote hobe." };
    }
    const minOrderRaw = Number($("planMinOrder").value);
    if (!Number.isFinite(minOrderRaw) || minOrderRaw < 0) {
      return { error: "Minimum order amount valid hote hobe." };
    }
    const feeType = $("planFeeType").value;
    const feeRaw = Number($("planFeeValue").value);
    if (!Number.isFinite(feeRaw) || feeRaw < 0) {
      return { error: "Fee value valid hote hobe." };
    }
    if (feeType === "percent" && feeRaw > 100) {
      return { error: "Fee percent 0-100% er moddhe hote hobe." };
    }
    return {
      value: {
        name,
        installmentsCount: count,
        advanceType,
        advanceValue: Math.round(advanceRaw * 100),
        gapDays,
        minOrderAmountPaisa: Math.round(minOrderRaw * 100),
        feeType,
        feeValue: feeType === "none" ? 0 : Math.round(feeRaw * 100),
        isActive: $("planActive").checked === true,
      },
    };
  }

  async function submitPlan() {
    const parsed = readPlanForm();
    if (parsed.error) return wsSetError("planError", parsed.error);
    wsSetError("planError", "");
    const editing = state.wholesaleEdit.plan;
    try {
      const data = await wsJson(
        editing ? `/api/wholesale/plans/${editing._id}` : "/api/wholesale/plans",
        { method: editing ? "PUT" : "POST", body: JSON.stringify(parsed.value) }
      );
      if (!data) return;
      resetPlanForm();
      await refreshWholesaleList("plans");
      toast(editing ? "Installment plan update hoyeche" : "Installment plan create hoyeche");
    } catch (e) {
      wsSetError("planError", e.message);
    }
  }

  const planAdvanceType = $("planAdvanceType");
  if (planAdvanceType) {
    planAdvanceType.addEventListener("change", () => {
      if (planAdvanceType.value === "percent") {
        const value = Number($("planAdvanceValue").value);
        if (value > 100) wsSetValue("planAdvanceValue", 0);
      }
      updatePlanUnits();
    });
  }
  const planFeeType = $("planFeeType");
  if (planFeeType) {
    planFeeType.addEventListener("change", updatePlanUnits);
  }

  ["previewPlan", "previewAmount", "previewShipping"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", updateSchedulePreview);
    el.addEventListener("change", updateSchedulePreview);
  });

  async function toggleBuyer(id) {
    const buyer = (state.wholesale.buyerList || []).find(
      (row) => String(row._id) === String(id)
    );
    if (!buyer) return;
    const approved = buyer.wholesaleApproved !== true;
    wsSetError("wsBuyerError", "");
    try {
      const data = await wsJson(`/api/wholesale/buyers/${id}/approval`, {
        method: "PATCH",
        body: JSON.stringify({ approved }),
      });
      if (!data) return;
      if (data.buyer) {
        buyer.wholesaleApproved = data.buyer.wholesaleApproved === true;
      }
      renderWsBuyers();
      applyWholesaleEnabled();
      toast(approved ? "Buyer approve hoyeche" : "Buyer approval revoke hoyeche");
    } catch (e) {
      wsSetError("wsBuyerError", e.message);
    }
  }

  async function deleteWholesaleRow(kind, id) {
    const labels = { rule: "shipping rule", vehicle: "vehicle", speed: "delivery speed", plan: "installment plan" };
    if (!window.confirm(`Ei ${labels[kind]} delete korben?`)) return;
    const paths = {
      rule: "/api/wholesale/shipping-rules",
      vehicle: "/api/wholesale/vehicles",
      speed: "/api/wholesale/speeds",
      plan: "/api/wholesale/plans",
    };
    try {
      const data = await wsJson(`${paths[kind]}/${id}`, { method: "DELETE" });
      if (!data) return;
      if (kind === "rule" && state.wholesaleEdit.rule && String(state.wholesaleEdit.rule._id) === String(id)) {
        resetRuleForm();
      }
      if (kind === "vehicle" && state.wholesaleEdit.vehicle && String(state.wholesaleEdit.vehicle._id) === String(id)) {
        resetVehicleForm();
      }
      if (kind === "speed" && state.wholesaleEdit.speed && String(state.wholesaleEdit.speed._id) === String(id)) {
        resetSpeedForm();
      }
      if (kind === "plan" && state.wholesaleEdit.plan && String(state.wholesaleEdit.plan._id) === String(id)) {
        resetPlanForm();
      }
      await refreshWholesaleList({ rule: "rules", vehicle: "vehicles", speed: "speeds", plan: "plans" }[kind]);
      toast(`${labels[kind].charAt(0).toUpperCase()}${labels[kind].slice(1)} delete hoyeche`);
    } catch (e) {
      toast(e.message, "err");
    }
  }

  const wsRowBodies = ["wsRuleRows", "wsVehicleRows", "wsSpeedRows", "partialPlanRows", "wsBuyerRows"];
  wsRowBodies.forEach((id) => {
    const tbody = $(id);
    if (!tbody) return;
    tbody.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-ws-action]");
      if (!button) return;
      const action = button.dataset.wsAction;
      const rowId = button.dataset.id;
      if (action === "rule-edit") editRule(rowId);
      else if (action === "rule-delete") deleteWholesaleRow("rule", rowId);
      else if (action === "vehicle-edit") editVehicle(rowId);
      else if (action === "vehicle-delete") deleteWholesaleRow("vehicle", rowId);
      else if (action === "speed-edit") editSpeed(rowId);
      else if (action === "speed-delete") deleteWholesaleRow("speed", rowId);
      else if (action === "plan-edit") editPlan(rowId);
      else if (action === "plan-delete") deleteWholesaleRow("plan", rowId);
      else if (action === "buyer-toggle") toggleBuyer(rowId);
    });
  });

  $("wsRuleSubmit") && $("wsRuleSubmit").addEventListener("click", submitRule);
  $("wsRuleCancel") && $("wsRuleCancel").addEventListener("click", resetRuleForm);
  $("wsVehicleSubmit") && $("wsVehicleSubmit").addEventListener("click", submitVehicle);
  $("wsVehicleCancel") && $("wsVehicleCancel").addEventListener("click", resetVehicleForm);
  $("wsSpeedSubmit") && $("wsSpeedSubmit").addEventListener("click", submitSpeed);
  $("wsSpeedCancel") && $("wsSpeedCancel").addEventListener("click", resetSpeedForm);
  $("planSubmitBtn") && $("planSubmitBtn").addEventListener("click", submitPlan);
  $("planCancelBtn") && $("planCancelBtn").addEventListener("click", resetPlanForm);

  resetRuleForm();
  resetVehicleForm();
  resetSpeedForm();
  resetPlanForm();

  function validateWholesaleSettings() {
    if (!state.wholesaleLoaded) return "";
    const w = state.wholesale;
    if (w.enabled && state.internationalLoaded && state.international.enabled) {
      return "International import mode ON ache — age seta OFF korun";
    }
    if (!String(w.badgeText || "").trim()) {
      return "Wholesale badge text khali rakha jabe na";
    }
    if (!Number.isInteger(Number(w.moq)) || Number(w.moq) < 1) {
      return "MOQ 1 ba tar beshi puro number hote hobe";
    }
    if (!Number.isInteger(Number(w.lateFeePaisa)) || Number(w.lateFeePaisa) < 0) {
      return "Late fee valid hote hobe";
    }
    if (w.lateFeeType === "percent" && Number(w.lateFeePaisa) > 10000) {
      return "Late fee percent 0-100% er moddhe hote hobe";
    }
    if (!Number.isInteger(Number(w.graceDays)) || Number(w.graceDays) < 0 || Number(w.graceDays) > 365) {
      return "Grace days 0-365 er moddhe hote hobe";
    }
    if (
      !Number.isInteger(Number(w.maxOpenInstallmentOrders)) ||
      Number(w.maxOpenInstallmentOrders) < 0
    ) {
      return "Max open installment orders 0 ba tar beshi hote hobe";
    }
    if (
      !Number.isInteger(Number(w.overdueDays)) ||
      Number(w.overdueDays) < 0 ||
      Number(w.overdueDays) > 365
    ) {
      return "Overdue days 0-365 er moddhe hote hobe";
    }
    if (
      !Number.isInteger(Number(w.refundPercent)) ||
      Number(w.refundPercent) < 0 ||
      Number(w.refundPercent) > 100
    ) {
      return "Refund percent 0-100 er moddhe hote hobe";
    }
    return "";
  }

  function wholesaleSettingsPayload() {
    const w = state.wholesale;
    return {
      enabled: w.enabled === true,
      badgeText: String(w.badgeText || "").trim(),
      moq: Math.round(Number(w.moq) || 0),
      buyers: w.buyers,
      showRetailPrice: w.showRetailPrice === true,
      vehicleOverflowRule: w.vehicleOverflowRule,
      partialPaymentEnabled: w.partialPaymentEnabled === true,
      lateFeePaisa: Math.round(Number(w.lateFeePaisa) || 0),
      lateFeeType: w.lateFeeType,
      graceDays: Math.round(Number(w.graceDays) || 0),
      maxOpenInstallmentOrders: Math.round(Number(w.maxOpenInstallmentOrders) || 0),
      goodsReleaseRule: w.goodsReleaseRule,
      installmentBuyers: w.installmentBuyers,
      shippingInFirstInstallment: w.shippingInFirstInstallment === true,
      overdueAction: w.overdueAction,
      overdueDays: Math.round(Number(w.overdueDays) || 0),
      refundType: w.refundType,
      refundPercent: Math.round(Number(w.refundPercent) || 0),
    };
  }

  /* ------------------------------------------------------------------ *
   * Shipping enable switches
   * ------------------------------------------------------------------ */
  function applyEnabled(key) {
    const toggle = $(TOGGLE_ID[key]);
    if (!toggle) return;
    const on = toggle.checked;
    state.settings[ENABLE_KEY[key]] = on ? "true" : "false";

    const body = $(BODY_ID[key]);
    if (body) {
      body.classList.toggle("is-off", !on);
      body.querySelectorAll("input, select, textarea, button").forEach((el) => {
        el.disabled = !on;
      });
    }
    const badge = document.querySelector(`.off-badge[data-off="${key}"]`);
    if (badge) badge.hidden = on;
  }

  Object.keys(TOGGLE_ID).forEach((key) => {
    const toggle = $(TOGGLE_ID[key]);
    if (!toggle) return;
    toggle.addEventListener("change", () => {
      applyEnabled(key);
      markDirty();
    });
  });

  /* ------------------------------------------------------------------ *
   * Payment card switches (each card er nijer on/off)
   * ------------------------------------------------------------------ */
  function applyPayEnabled(key) {
    const conf = PAY_TOGGLE[key];
    if (!conf) return;
    const toggle = $(conf.toggle);
    if (!toggle) return;
    const on = toggle.checked;
    state.settings[conf.key] = on ? "true" : "false";
    const body = $(conf.body);
    if (body) {
      body.classList.toggle("is-off", !on);
      body.querySelectorAll("input, select, textarea, button").forEach((el) => {
        el.disabled = !on;
      });
    }
  }

  Object.keys(PAY_TOGGLE).forEach((key) => {
    const toggle = $(PAY_TOGGLE[key].toggle);
    if (!toggle) return;
    toggle.addEventListener("change", () => {
      applyPayEnabled(key);
      markDirty();
    });
  });

  $("mobileAskSender").addEventListener("change", (e) => {
    state.settings.mobile_banking_ask_sender = e.target.checked ? "true" : "false";
    markDirty();
  });

  /* ------------------------------------------------------------------ *
   * Login and registration
   * ------------------------------------------------------------------ */
  function updateLoginStatus() {
    const on = $("loginRegEnabled").checked;
    const status = $("loginRegStatus");
    if (status) {
      status.textContent = on
        ? "Customer ke checkout er age login ba register korte hobe."
        : "Guest checkout cholche — customer login charao order dite parbe.";
    }
  }

  function loginMethodState() {
    return {
      email: $("loginEmailEnabled").checked,
      phone: $("loginPhoneEnabled").checked,
    };
  }

  function renderLoginPreview() {
    const { email, phone } = loginMethodState();
    const lp = $("loginPreview");
    if (lp) {
      const idLabel = email && phone ? "Email or phone" : email ? "Email" : "Phone number";
      const idPlaceholder = email && phone ? "you@example.com ba 01XXXXXXXXX" : email ? "you@example.com" : "01XXXXXXXXX";
      lp.innerHTML = `
        <h4>Login</h4>
        <div class="preview-field"><label>${esc(idLabel)}</label><input disabled placeholder="${esc(idPlaceholder)}" /></div>
        <div class="preview-field"><label>Password</label><input type="password" disabled placeholder="••••••••" /></div>
        <button type="button" class="preview-btn" disabled>Login</button>
        <p class="preview-note">Password always required.</p>`;
    }
    const rp = $("registerPreview");
    if (rp) {
      let fields = `<div class="preview-field"><label>Full name</label><input disabled placeholder="Your name" /></div>`;
      if (email) fields += `<div class="preview-field"><label>Email</label><input disabled placeholder="you@example.com" /></div>`;
      if (phone) fields += `<div class="preview-field"><label>Phone number</label><input disabled placeholder="01XXXXXXXXX" /></div>`;
      fields += `<div class="preview-field"><label>Password</label><input type="password" disabled placeholder="••••••••" /></div>`;
      rp.innerHTML = `<h4>Register</h4>${fields}<button type="button" class="preview-btn" disabled>Create account</button>`;
    }
  }

  function syncLoginMethods(changed) {
    const emailEl = $("loginEmailEnabled");
    const phoneEl = $("loginPhoneEnabled");
    const warn = $("loginMethodWarn");
    // At least one method always on — last method uncheck korle setai revert hoy
    if (!emailEl.checked && !phoneEl.checked) {
      if (changed === "email") emailEl.checked = true;
      else phoneEl.checked = true;
      if (warn) {
        warn.hidden = false;
        clearTimeout(syncLoginMethods._t);
        syncLoginMethods._t = setTimeout(() => (warn.hidden = true), 4000);
      }
    } else if (warn) {
      warn.hidden = true;
    }
    state.settings.login_email_enabled = emailEl.checked ? "true" : "false";
    state.settings.login_phone_enabled = phoneEl.checked ? "true" : "false";
    renderLoginPreview();
    markDirty();
  }

  $("loginRegEnabled").addEventListener("change", (e) => {
    state.settings.login_registration_enabled = e.target.checked ? "true" : "false";
    updateLoginStatus();
    markDirty();
  });
  $("loginEmailEnabled").addEventListener("change", () => syncLoginMethods("email"));
  $("loginPhoneEnabled").addEventListener("change", () => syncLoginMethods("phone"));

  /* ------------------------------------------------------------------ *
   * Shop favicons
   * ------------------------------------------------------------------ */
  const faviconBody = $("shopFaviconRows");

  function renderFavicons() {
    if (!faviconBody) return;
    const rows = state.favicons.filter((f) => !f.hidden);
    if (!rows.length) {
      faviconBody.innerHTML = `<tr><td colspan="3" class="settings-empty">No shops added yet.</td></tr>`;
      return;
    }
    faviconBody.innerHTML = rows
      .map(
        (f) => `
        <tr>
          <td>
            <button type="button" class="settings-mini-img" data-favicon-pick="${esc(f.storeId)}" title="Upload icon">
              ${f.icon ? `<img src="${esc(f.icon)}" alt="" />` : "Icon"}
            </button>
            <input type="file" accept="image/*" hidden data-favicon-file="${esc(f.storeId)}" />
          </td>
          <td>${esc(f.shopName)}</td>
          <td><button type="button" class="pf-btn-sm pf-btn-danger" data-favicon-remove="${esc(f.storeId)}">Remove</button></td>
        </tr>`
      )
      .join("");
  }

  if (faviconBody) {
    faviconBody.addEventListener("click", (e) => {
      const pick = e.target.closest("[data-favicon-pick]");
      if (pick) {
        const input = faviconBody.querySelector(`[data-favicon-file="${CSS.escape(pick.dataset.faviconPick)}"]`);
        if (input) input.click();
        return;
      }
      const rm = e.target.closest("[data-favicon-remove]");
      if (rm) {
        const f = state.favicons.find((x) => String(x.storeId) === String(rm.dataset.faviconRemove));
        if (f) {
          f.icon = "";
          f.hidden = true;
          renderFavicons();
          markDirty();
        }
      }
    });

    faviconBody.addEventListener("change", async (e) => {
      const input = e.target.closest("[data-favicon-file]");
      if (!input) return;
      const file = input.files && input.files[0];
      const storeId = input.dataset.faviconFile;
      input.value = "";
      if (!file) return;
      try {
        const path = await uploadImage(file);
        const f = state.favicons.find((x) => String(x.storeId) === String(storeId));
        if (f && path) {
          f.icon = path;
          renderFavicons();
          markDirty();
          toast("Shop icon upload hoyeche");
        }
      } catch (err) {
        toast(err.message, "err");
      }
    });
  }

  $("addShopIconBtn").addEventListener("click", () => {
    const hidden = state.favicons.filter((f) => f.hidden);
    if (!hidden.length) {
      toast("Sob shop already table e ache");
      return;
    }
    hidden.forEach((f) => (f.hidden = false));
    renderFavicons();
    markDirty();
  });

  /* ------------------------------------------------------------------ *
   * Social rows
   * ------------------------------------------------------------------ */
  const socialBody = $("socialRows");

  function renderSocial() {
    if (!socialBody) return;
    if (!state.social.length) {
      socialBody.innerHTML = `<tr><td colspan="4" class="settings-empty">No social media added yet.</td></tr>`;
      return;
    }
    socialBody.innerHTML = state.social
      .map(
        (s, i) => `
        <tr>
          <td>
            <button type="button" class="settings-mini-img" data-social-pick="${i}" title="Upload icon">
              ${s.icon ? `<img src="${esc(s.icon)}" alt="" />` : "Icon"}
            </button>
            <input type="file" accept="image/*" hidden data-social-file="${i}" />
          </td>
          <td><input class="settings-input" data-social-field="name" data-index="${i}" value="${esc(s.name)}" placeholder="Facebook" /></td>
          <td><input class="settings-input" data-social-field="url" data-index="${i}" value="${esc(s.url)}" placeholder="https://facebook.com/..." /></td>
          <td><button type="button" class="pf-btn-sm pf-btn-danger" data-social-remove="${i}">Remove</button></td>
        </tr>`
      )
      .join("");
  }

  if (socialBody) {
    socialBody.addEventListener("click", (e) => {
      const pick = e.target.closest("[data-social-pick]");
      if (pick) {
        const input = socialBody.querySelector(`[data-social-file="${pick.dataset.socialPick}"]`);
        if (input) input.click();
        return;
      }
      const rm = e.target.closest("[data-social-remove]");
      if (rm) {
        state.social.splice(Number(rm.dataset.socialRemove), 1);
        renderSocial();
        markDirty();
      }
    });

    socialBody.addEventListener("input", (e) => {
      const input = e.target.closest("[data-social-field]");
      if (!input) return;
      const row = state.social[Number(input.dataset.index)];
      if (row) {
        row[input.dataset.socialField] = input.value;
        markDirty();
      }
    });

    socialBody.addEventListener("change", async (e) => {
      const input = e.target.closest("[data-social-file]");
      if (!input) return;
      const file = input.files && input.files[0];
      const index = Number(input.dataset.socialFile);
      input.value = "";
      if (!file) return;
      try {
        const path = await uploadImage(file);
        if (state.social[index] && path) {
          state.social[index].icon = path;
          renderSocial();
          markDirty();
        }
      } catch (err) {
        toast(err.message, "err");
      }
    });
  }

  $("addSocialBtn").addEventListener("click", () => {
    state.social.push({ icon: "", name: "", url: "" });
    renderSocial();
    markDirty();
  });

  /* ------------------------------------------------------------------ *
   * Shipping tables
   * ------------------------------------------------------------------ */
  const manualBody = $("manualRows");
  const areaBody = $("areaRows");
  const classBody = $("classRows");
  const intlBody = $("intlRows");
  const wdBody = $("wdRows");

  function emptyRow(cols, text) {
    return `<tr><td colspan="${cols}" class="settings-empty">${esc(text)}</td></tr>`;
  }

  function renderManual() {
    if (!manualBody) return;
    if (!state.shipping.manual.length) {
      manualBody.innerHTML = emptyRow(3, "No area yet.");
      return;
    }
    manualBody.innerHTML = state.shipping.manual
      .map(
        (r, i) => `
        <tr>
          <td><input class="settings-input" data-manual-field="areaName" data-index="${i}" value="${esc(r.areaName)}" placeholder="Inside Dhaka" /></td>
          <td><input class="settings-input" type="number" min="0" step="0.01" data-manual-field="amount" data-index="${i}" value="${esc(r.amount)}" placeholder="60" /></td>
          <td><button type="button" class="pf-btn-sm pf-btn-danger" data-manual-remove="${i}">Remove</button></td>
        </tr>`
      )
      .join("");
  }

  function renderAreas() {
    if (!areaBody) return;
    if (!state.shipping.areas.length) {
      areaBody.innerHTML = emptyRow(5, "No area shipping row yet.");
      return;
    }
    areaBody.innerHTML = state.shipping.areas
      .map((r, i) => {
        const clsName = classIdToName(r.shippingClass) || r.shippingClass || "";
        return `
        <tr>
          <td><input class="settings-input" list="districtList" data-area-field="district" data-index="${i}" value="${esc(r.district)}" placeholder="Dhaka" /></td>
          <td><input class="settings-input" data-area-field="area" data-index="${i}" value="${esc(r.area)}" placeholder="Dhanmondi" /></td>
          <td><select class="settings-input" data-area-field="shippingClass" data-index="${i}">${classOptionsHtml(clsName)}</select></td>
          <td><input class="settings-input" type="number" min="0" step="0.01" data-area-field="price" data-index="${i}" value="${esc(r.price)}" placeholder="80" /></td>
          <td><button type="button" class="pf-btn-sm pf-btn-danger" data-area-remove="${i}">Remove</button></td>
        </tr>`;
      })
      .join("");
  }

  function renderClasses() {
    if (!classBody) return;
    if (!state.shipping.classes.length) {
      classBody.innerHTML = emptyRow(3, "No shipping class yet.");
      return;
    }
    classBody.innerHTML = state.shipping.classes
      .map(
        (r, i) => `
        <tr>
          <td><input class="settings-input" data-class-field="name" data-index="${i}" value="${esc(r.name)}" placeholder="Free shipping" /></td>
          <td><input class="settings-input" type="number" min="0" step="0.01" data-class-field="cost" data-index="${i}" value="${esc(r.cost)}" placeholder="0" /></td>
          <td><button type="button" class="pf-btn-sm pf-btn-danger" data-class-remove="${i}">Remove</button></td>
        </tr>`
      )
      .join("");
  }

  function renderIntl() {
    if (!intlBody) return;
    if (!state.shipping.intl.length) {
      intlBody.innerHTML = emptyRow(6, "No international rule yet.");
      return;
    }
    intlBody.innerHTML = state.shipping.intl
      .map(
        (r, i) => `
        <tr>
          <td><input class="settings-input" list="countryList" data-intl-field="country" data-index="${i}" value="${esc(r.country)}" placeholder="Country" /></td>
          <td><select class="settings-input" data-intl-field="category" data-index="${i}">${categoryOptionsHtml(r.category)}</select></td>
          <td><input class="settings-input" type="number" min="0" step="0.01" data-intl-field="minOrder" data-index="${i}" value="${r.minOrder == null ? "" : esc(r.minOrder)}" placeholder="0" /></td>
          <td><input class="settings-input" type="number" min="0" step="0.01" data-intl-field="maxOrder" data-index="${i}" value="${r.maxOrder == null ? "" : esc(r.maxOrder)}" placeholder="—" /></td>
          <td><input class="settings-input" type="number" min="0" step="0.01" data-intl-field="price" data-index="${i}" value="${esc(r.price)}" placeholder="0" /></td>
          <td><button type="button" class="pf-btn-sm pf-btn-danger" data-intl-remove="${i}">Remove</button></td>
        </tr>`
      )
      .join("");
  }

  function renderWd() {
    if (!wdBody) return;
    if (!state.shipping.wd.length) {
      wdBody.innerHTML = emptyRow(7, "No weight & dimension rule yet.");
      return;
    }
    wdBody.innerHTML = state.shipping.wd
      .map(
        (r, i) => `
        <tr>
          <td><select class="settings-input" data-wd-field="category" data-index="${i}">${categoryOptionsHtml(r.category)}</select></td>
          <td><select class="settings-input" data-wd-field="area" data-index="${i}">${areaOptionsHtml(r.area)}</select></td>
          <td><input class="settings-input" type="number" min="0" step="0.01" data-wd-field="minWeight" data-index="${i}" value="${esc(r.minWeight)}" placeholder="0" /></td>
          <td><input class="settings-input" type="number" min="0" step="0.01" data-wd-field="maxWeight" data-index="${i}" value="${r.maxWeight == null ? "" : esc(r.maxWeight)}" placeholder="—" /></td>
          <td>
            <div class="settings-dims">
              <input class="settings-input" type="number" min="0" step="0.1" data-wd-field="length" data-index="${i}" value="${r.length == null ? "" : esc(r.length)}" placeholder="L" />
              <input class="settings-input" type="number" min="0" step="0.1" data-wd-field="width" data-index="${i}" value="${r.width == null ? "" : esc(r.width)}" placeholder="W" />
              <input class="settings-input" type="number" min="0" step="0.1" data-wd-field="height" data-index="${i}" value="${r.height == null ? "" : esc(r.height)}" placeholder="H" />
            </div>
          </td>
          <td><input class="settings-input" type="number" min="0" step="0.01" data-wd-field="price" data-index="${i}" value="${esc(r.price)}" placeholder="0" /></td>
          <td><button type="button" class="pf-btn-sm pf-btn-danger" data-wd-remove="${i}">Remove</button></td>
        </tr>`
      )
      .join("");
  }

  // Generic row editing (input/change) + remove (click) for all shipping tables
  function bindShippingTable(tbody, collection, fields, removeAttr) {
    if (!tbody) return;
    tbody.addEventListener("input", (e) => {
      const input = e.target.closest("[data-index]");
      if (!input) return;
      const row = state.shipping[collection][Number(input.dataset.index)];
      const field = input.dataset[fields];
      if (!row || !field) return;
      row[field] = input.value;
      markDirty();
    });
    tbody.addEventListener("change", (e) => {
      const input = e.target.closest("[data-index]");
      if (!input) return;
      const row = state.shipping[collection][Number(input.dataset.index)];
      const field = input.dataset[fields];
      if (!row || !field) return;
      row[field] = input.value;
      markDirty();
    });
    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest(`[${removeAttr}]`);
      if (!btn) return;
      state.shipping[collection].splice(Number(btn.getAttribute(removeAttr)), 1);
      renderShipping();
      markDirty();
    });
  }

  bindShippingTable(manualBody, "manual", "manualField", "data-manual-remove");
  bindShippingTable(areaBody, "areas", "areaField", "data-area-remove");
  bindShippingTable(classBody, "classes", "classField", "data-class-remove");
  bindShippingTable(intlBody, "intl", "intlField", "data-intl-remove");
  bindShippingTable(wdBody, "wd", "wdField", "data-wd-remove");

  function renderShipping() {
    renderManual();
    renderAreas();
    renderClasses();
    renderIntl();
    renderWd();
  }

  document.querySelectorAll("[data-add-row]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.addRow;
      if (key === "manual") state.shipping.manual.push({ areaName: "", amount: 0 });
      else if (key === "area") state.shipping.areas.push({ district: "", area: "", shippingClass: "", price: 0 });
      else if (key === "classes") state.shipping.classes.push({ name: "", cost: 0 });
      else if (key === "intl")
        state.shipping.intl.push({ country: "", category: "", minOrder: null, maxOrder: null, price: 0 });
      else if (key === "wd")
        state.shipping.wd.push({
          category: "",
          area: "",
          minWeight: 0,
          maxWeight: null,
          length: null,
          width: null,
          height: null,
          price: 0,
        });
      else if (key === "mobileManual")
        state.payments.mobileManual.push({ name: "", accountType: "Personal", number: "", instruction: "" });
      else if (key === "bankManual")
        state.payments.bankManual.push({ bankName: "", accountName: "", accountNumber: "", branch: "", instruction: "" });
      renderShipping();
      renderPayments();
      markDirty();
    });
  });

  /* ------------------------------------------------------------------ *
   * Payment tables (manual + API gateways)
   * ------------------------------------------------------------------ */
  const mobileManualBody = $("mobileManualRows");
  const bankManualBody = $("bankManualRows");
  const apiMobileBody = $("apiMobileRows");
  const apiBankBody = $("apiBankRows");

  function accountTypeOptions(selected) {
    return ["Personal", "Agent", "Merchant"]
      .map((t) => `<option value="${t}" ${selected === t ? "selected" : ""}>${t}</option>`)
      .join("");
  }

  function modeOptions(selected) {
    return ["sandbox", "live"]
      .map((m) => `<option value="${m}" ${selected === m ? "selected" : ""}>${m === "live" ? "Live" : "Sandbox"}</option>`)
      .join("");
  }

  function renderMobileManual() {
    if (!mobileManualBody) return;
    if (!state.payments.mobileManual.length) {
      mobileManualBody.innerHTML = emptyRow(5, "No mobile banking row yet.");
      return;
    }
    mobileManualBody.innerHTML = state.payments.mobileManual
      .map(
        (r, i) => `
        <tr>
          <td><input class="settings-input" data-mobile-field="name" data-index="${i}" value="${esc(r.name)}" placeholder="bKash" /></td>
          <td><select class="settings-input" data-mobile-field="accountType" data-index="${i}">${accountTypeOptions(r.accountType)}</select></td>
          <td><input class="settings-input" data-mobile-field="number" data-index="${i}" value="${esc(r.number)}" placeholder="01XXXXXXXXX" /></td>
          <td><input class="settings-input" data-mobile-field="instruction" data-index="${i}" value="${esc(r.instruction)}" placeholder="Instruction" /></td>
          <td><button type="button" class="pf-btn-sm pf-btn-danger" data-mobile-remove="${i}">Remove</button></td>
        </tr>`
      )
      .join("");
  }

  function renderBankManual() {
    if (!bankManualBody) return;
    if (!state.payments.bankManual.length) {
      bankManualBody.innerHTML = emptyRow(6, "No bank row yet.");
      return;
    }
    bankManualBody.innerHTML = state.payments.bankManual
      .map(
        (r, i) => `
        <tr>
          <td><input class="settings-input" data-bank-field="bankName" data-index="${i}" value="${esc(r.bankName)}" placeholder="City Bank" /></td>
          <td><input class="settings-input" data-bank-field="accountName" data-index="${i}" value="${esc(r.accountName)}" placeholder="Account name" /></td>
          <td><input class="settings-input" data-bank-field="accountNumber" data-index="${i}" value="${esc(r.accountNumber)}" placeholder="Account number" /></td>
          <td><input class="settings-input" data-bank-field="branch" data-index="${i}" value="${esc(r.branch)}" placeholder="Branch / routing" /></td>
          <td><input class="settings-input" data-bank-field="instruction" data-index="${i}" value="${esc(r.instruction)}" placeholder="Instruction" /></td>
          <td><button type="button" class="pf-btn-sm pf-btn-danger" data-bank-remove="${i}">Remove</button></td>
        </tr>`
      )
      .join("");
  }

  function secretPlaceholder(value) {
    return value ? "Saved " + value : "Not set";
  }

  function renderGateways() {
    const mobile = [];
    const bank = [];
    state.payments.gateways.forEach((g, i) => {
      if (g.type === "mobile") mobile.push({ g, i });
      else if (g.type === "bank") bank.push({ g, i });
    });

    if (apiMobileBody) {
      apiMobileBody.innerHTML = mobile.length
        ? mobile
            .map(
              ({ g, i }) => `
          <tr>
            <td class="settings-provider">${esc(g.name)}</td>
            <td><select class="settings-input" data-gw-field="mode" data-index="${i}">${modeOptions(g.mode)}</select></td>
            <td><input class="settings-input" data-gw-cred="appKey" data-index="${i}" value="${esc(g.credentials.appKey || "")}" placeholder="App key" autocomplete="off" /></td>
            <td><input class="settings-input" type="password" data-gw-cred="appSecret" data-index="${i}" value="" placeholder="${esc(secretPlaceholder(g.credentials.appSecret))}" autocomplete="new-password" /></td>
            <td><input class="settings-input" data-gw-cred="username" data-index="${i}" value="${esc(g.credentials.username || "")}" placeholder="Username" autocomplete="off" /></td>
            <td><input class="settings-input" type="password" data-gw-cred="password" data-index="${i}" value="" placeholder="${esc(secretPlaceholder(g.credentials.password))}" autocomplete="new-password" /></td>
            <td><input type="checkbox" data-gw-field="active" data-index="${i}" ${g.active ? "checked" : ""} aria-label="Active" /></td>
          </tr>`
            )
            .join("")
        : emptyRow(7, "No mobile gateway yet.");
    }

    if (apiBankBody) {
      apiBankBody.innerHTML = bank.length
        ? bank
            .map(
              ({ g, i }) => `
          <tr>
            <td class="settings-provider">${esc(g.name)}</td>
            <td><select class="settings-input" data-gw-field="mode" data-index="${i}">${modeOptions(g.mode)}</select></td>
            <td><input class="settings-input" data-gw-cred="storeId" data-index="${i}" value="${esc(g.credentials.storeId || "")}" placeholder="Store ID" autocomplete="off" /></td>
            <td><input class="settings-input" type="password" data-gw-cred="storePassword" data-index="${i}" value="" placeholder="${esc(secretPlaceholder(g.credentials.storePassword))}" autocomplete="new-password" /></td>
            <td><input type="checkbox" data-gw-field="active" data-index="${i}" ${g.active ? "checked" : ""} aria-label="Active" /></td>
          </tr>`
            )
            .join("")
        : emptyRow(5, "No bank gateway yet.");
    }
  }

  function bindManualTable(tbody, collection, fieldAttr, removeAttr) {
    if (!tbody) return;
    const update = (e) => {
      const el = e.target.closest("[data-index]");
      if (!el) return;
      const row = state.payments[collection][Number(el.dataset.index)];
      const field = el.dataset[fieldAttr];
      if (!row || !field) return;
      row[field] = el.value;
      markDirty();
    };
    tbody.addEventListener("input", update);
    tbody.addEventListener("change", update);
    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest(`[${removeAttr}]`);
      if (!btn) return;
      state.payments[collection].splice(Number(btn.getAttribute(removeAttr)), 1);
      renderPayments();
      markDirty();
    });
  }

  function bindGatewayTable(tbody) {
    if (!tbody) return;
    const update = (e) => {
      const el = e.target.closest("[data-index]");
      if (!el) return;
      const g = state.payments.gateways[Number(el.dataset.index)];
      if (!g) return;
      if (el.dataset.gwField) {
        g[el.dataset.gwField] = el.type === "checkbox" ? el.checked : el.value;
        markDirty();
      } else if (el.dataset.gwCred) {
        g.credentials = g.credentials || {};
        g.credentials[el.dataset.gwCred] = el.value;
        markDirty();
      }
    };
    tbody.addEventListener("input", update);
    tbody.addEventListener("change", update);
  }

  bindManualTable(mobileManualBody, "mobileManual", "mobileField", "data-mobile-remove");
  bindManualTable(bankManualBody, "bankManual", "bankField", "data-bank-remove");
  bindGatewayTable(apiMobileBody);
  bindGatewayTable(apiBankBody);

  function renderPayments() {
    renderMobileManual();
    renderBankManual();
    renderGateways();
    Object.keys(PAY_TOGGLE).forEach((key) => applyPayEnabled(key));
  }

  /* ------------------------------------------------------------------ *
   * Checkout fields (show / required / label + presets + preview)
   * ------------------------------------------------------------------ */
  const checkoutFieldBody = $("checkoutFieldRows");

  function normalizeCheckoutFields(list) {
    const map = new Map((list || []).map((f) => [f.fieldKey, f]));
    return CHECKOUT_FIELD_ORDER.map((key) => {
      const def = CHECKOUT_FIELD_DEFAULTS[key];
      const f = map.get(key) || {};
      const isShown = f.isShown !== undefined ? !!f.isShown : def.shown;
      return {
        fieldKey: key,
        label: String(f.label || "").trim() || def.label,
        isShown,
        isRequired: isShown && (f.isRequired !== undefined ? !!f.isRequired : def.required),
      };
    });
  }

  function updateCheckoutWarn() {
    const phone = state.checkoutFields.find((f) => f.fieldKey === "phone");
    const email = state.checkoutFields.find((f) => f.fieldKey === "email");
    const warn = $("checkoutWarn");
    if (warn) warn.hidden = !!((phone && phone.isShown) || (email && email.isShown));
  }

  function renderCheckoutPreview() {
    const el = $("checkoutPreview");
    if (!el) return;
    const shown = state.checkoutFields.filter((f) => f.isShown);
    const fields = shown
      .map(
        (f) => `
        <div class="preview-field">
          <label>${esc(f.label)}${f.isRequired ? ' <span class="preview-required">*</span>' : ""}</label>
          <input disabled placeholder="${esc(f.label)}" />
        </div>`
      )
      .join("");
    el.innerHTML = `<h4>Checkout</h4>${fields || '<p class="preview-note">No field shown.</p>'}<button type="button" class="preview-btn" disabled>Place order</button>`;
  }

  function renderCheckoutFields() {
    if (!checkoutFieldBody) return;
    checkoutFieldBody.innerHTML = state.checkoutFields
      .map(
        (f, i) => `
        <tr>
          <td class="settings-field-key">${esc(CHECKOUT_FIELD_TITLES[f.fieldKey] || f.fieldKey)}</td>
          <td><label class="pf-switch"><input type="checkbox" data-cf-field="isShown" data-index="${i}" ${f.isShown ? "checked" : ""} aria-label="Show ${esc(f.label)}" /><span class="slider"></span></label></td>
          <td><input type="checkbox" data-cf-field="isRequired" data-index="${i}" ${f.isRequired ? "checked" : ""} ${f.isShown ? "" : "disabled"} aria-label="Required ${esc(f.label)}" /></td>
          <td><input class="settings-input" data-cf-field="label" data-index="${i}" value="${esc(f.label)}" ${f.isShown ? "" : "disabled"} placeholder="${esc(CHECKOUT_FIELD_DEFAULTS[f.fieldKey].label)}" /></td>
        </tr>`
      )
      .join("");
    updateCheckoutWarn();
    renderCheckoutPreview();
  }

  if (checkoutFieldBody) {
    checkoutFieldBody.addEventListener("change", (e) => {
      const el = e.target.closest("[data-cf-field]");
      if (!el) return;
      const row = state.checkoutFields[Number(el.dataset.index)];
      if (!row) return;
      const field = el.dataset.cfField;
      if (field === "isShown") {
        row.isShown = el.checked;
        if (!row.isShown) row.isRequired = false;
        renderCheckoutFields();
      } else if (field === "isRequired") {
        row.isRequired = el.checked;
        renderCheckoutPreview();
      }
      markDirty();
    });

    checkoutFieldBody.addEventListener("input", (e) => {
      const el = e.target.closest('[data-cf-field="label"]');
      if (!el) return;
      const row = state.checkoutFields[Number(el.dataset.index)];
      if (!row) return;
      row.label = el.value;
      renderCheckoutPreview();
      markDirty();
    });
  }

  function applyCheckoutPreset(kind) {
    state.checkoutFields.forEach((f) => {
      if (kind === "simple") {
        const on = ["name", "phone", "address"].includes(f.fieldKey);
        f.isShown = on;
        f.isRequired = on;
      } else {
        f.isShown = true;
        f.isRequired = ["name", "phone", "address", "district"].includes(f.fieldKey);
      }
    });
    renderCheckoutFields();
    markDirty();
  }

  $("presetSimple").addEventListener("click", () => applyCheckoutPreset("simple"));
  $("presetFull").addEventListener("click", () => applyCheckoutPreset("full"));


  /* ------------------------------------------------------------------ *
   * Email / SMTP
   * ------------------------------------------------------------------ */
  const EMAIL_DEFS = [
    ["emailEnabled", "enabled", "bool"],
    ["emailFromName", "fromName"],
    ["emailFromEmail", "fromEmail"],
    ["emailReplyTo", "replyTo"],
    ["smtpHost", "smtpHost"],
    ["smtpPort", "smtpPort", "number"],
    ["smtpUser", "smtpUser"],
    ["smtpPassword", "smtpPassword"],
    ["smtpSecure", "smtpSecure", "bool"],
    ["emailOrderEmail", "orderEmail"],
    ["emailCancelEmail", "cancelEmail"],
    ["emailAdminEmail", "adminEmail"],
    ["notifyAdminNewOrder", "notifyAdminNewOrder", "bool"],
    ["notifyCustomerNewOrder", "notifyCustomerNewOrder", "bool"],
    ["notifyCustomerCancelled", "notifyCustomerCancelled", "bool"],
    ["notifyCustomerStatus", "notifyCustomerStatus", "bool"],
  ];

  const SMS_DEFS = [
    ["smsEnabled", "enabled", "bool"],
    ["smsProvider", "provider", "select"],
    ["smsSenderId", "senderId"],
    ["smsApiKey", "apiKey"],
    ["smsApiUrl", "apiUrl"],
    ["smsNotifyOrder", "notifyOrder", "bool"],
    ["smsNotifyAdminOrder", "notifyAdminOrder", "bool"],
    ["smsAdminPhone", "adminPhone"],
    ["smsOrderTemplate", "orderTemplate"],
    ["smsOtpEnabled", "otpEnabled", "bool"],
    ["smsOtpLength", "otpLength", "number"],
    ["smsOtpExpiry", "otpExpiryMinutes", "number"],
    ["smsOtpTemplate", "otpTemplate"],
  ];

  const INVOICE_DEFS = [
    ["invoiceEnabled", "enabled", "bool"],
    ["invoiceCompanyName", "companyName"],
    ["invoiceBin", "binNumber"],
    ["invoiceCompanyAddress", "companyAddress"],
    ["invoiceCompanyPhone", "companyPhone"],
    ["invoiceCompanyEmail", "companyEmail"],
    ["invoicePrefix", "prefix"],
    ["invoiceAccent", "accentColor"],
    ["invoicePaper", "paperSize", "select"],
    ["invoiceCopies", "copies", "select"],
    ["invoiceShowLogo", "showLogo", "bool"],
    ["invoiceShowSignature", "showSignature", "bool"],
    ["invoiceSignatureLabel", "signatureLabel"],
    ["invoiceShowVat", "showVat", "bool"],
    ["invoiceVat", "vatPercent", "number"],
    ["invoiceFooterNote", "footerNote"],
    ["invoiceTerms", "terms"],
  ];

  let currentTemplateKey = "order_new_customer";

  function setSectionEnabled(bodyId, on) {
    const body = $(bodyId);
    if (!body) return;
    body.classList.toggle("is-off", !on);
    body.querySelectorAll("input, select, textarea, button").forEach((el) => {
      el.disabled = !on;
    });
  }

  function applyEmailEnabled() {
    setSectionEnabled("emailBody", !!state.email.enabled);
  }

  function applySmsEnabled() {
    setSectionEnabled("smsBody", !!state.sms.enabled);
    setSectionEnabled("smsOtpBody", !!state.sms.enabled);
    setSectionEnabled("smsProcessBody", !!state.sms.enabled);
  }

  function applyInvoiceEnabled() {
    setSectionEnabled("invoiceBody", state.invoice.enabled !== false);
  }

  function bindSettingsInputs(defs, section, after) {
    defs.forEach(([id, key, kind]) => {
      const el = $(id);
      if (!el) return;
      const apply = () => {
        state[section][key] = kind === "bool" ? el.checked : el.value;
        markDirty();
        if (after) after(key, el);
      };
      el.addEventListener(kind === "bool" || kind === "select" ? "change" : "input", apply);
    });
  }

  function renderTokens(str, ctx) {
    return String(str || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) =>
      ctx[key] == null ? "" : ctx[key]
    );
  }

  function sampleMailContext() {
    return {
      store_name: state.settings.site_title || "LUXE Store",
      order_number: "ORD-DEMO-1001",
      invoice_number: "INV-01001",
      customer_name: "Demo Customer",
      items:
        '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<tr><td style="padding:7px 0;border-bottom:1px solid #eee">Premium Leather Wallet</td>' +
        '<td style="text-align:right;padding:7px 0;border-bottom:1px solid #eee">৳2,500</td></tr>' +
        '<tr><td style="padding:7px 0">Shipping</td>' +
        '<td style="text-align:right;padding:7px 0">৳60</td></tr></table>',
      subtotal: "৳2,500",
      shipping: "৳60",
      total: "৳2,560",
      payment_method: "Cash on delivery",
      shipping_address: "House 12, Road 5, Dhanmondi, Dhaka",
      status: "pending",
      year: new Date().getFullYear(),
      code: "482913",
      minutes: state.sms.otpExpiryMinutes || 5,
    };
  }

  /* ---------------- email ---------------- */
  function renderEmailTemplates() {
    const sel = $("emailTemplateSelect");
    if (!sel) return;
    const list = state.email.templates || [];
    sel.innerHTML = list
      .map((t) => `<option value="${esc(t.key)}">${esc(t.label || t.key)}</option>`)
      .join("");
    if (!list.some((t) => t.key === currentTemplateKey)) {
      currentTemplateKey = list.length ? list[0].key : "";
    }
    sel.value = currentTemplateKey;
    const t = list.find((x) => x.key === currentTemplateKey) || {};
    $("emailTemplateSubject").value = t.subject || "";
    $("emailTemplateBodyInput").value = t.body || "";
    $("emailTemplateEnabled").checked = t.enabled !== false;
  }

  function commitEmailTemplate() {
    const t = (state.email.templates || []).find((x) => x.key === currentTemplateKey);
    if (!t) return;
    t.subject = $("emailTemplateSubject").value;
    t.body = $("emailTemplateBodyInput").value;
    t.enabled = $("emailTemplateEnabled").checked;
  }

  function updateEmailPreview() {
    const preview = $("emailPreview");
    if (!preview) return;
    const t = (state.email.templates || []).find((x) => x.key === currentTemplateKey);
    preview.innerHTML = t ? renderTokens(t.body, sampleMailContext()) : "";
  }

  function renderEmail() {
    const e = state.email;
    $("emailEnabled").checked = !!e.enabled;
    $("emailFromName").value = e.fromName || "";
    $("emailFromEmail").value = e.fromEmail || "";
    $("emailReplyTo").value = e.replyTo || "";
    $("smtpHost").value = e.smtpHost || "";
    $("smtpPort").value = e.smtpPort || 587;
    $("smtpUser").value = e.smtpUser || "";
    $("smtpPassword").value = "";
    $("smtpPassword").placeholder = e.smtpPassword || "Not set";
    $("smtpSecure").checked = !!e.smtpSecure;
    $("emailOrderEmail").value = e.orderEmail || "";
    $("emailCancelEmail").value = e.cancelEmail || "";
    $("emailAdminEmail").value = e.adminEmail || "";
    $("notifyAdminNewOrder").checked = e.notifyAdminNewOrder !== false;
    $("notifyCustomerNewOrder").checked = e.notifyCustomerNewOrder !== false;
    $("notifyCustomerCancelled").checked = e.notifyCustomerCancelled !== false;
    $("notifyCustomerStatus").checked = e.notifyCustomerStatus !== false;
    renderEmailTemplates();
    applyEmailEnabled();
    updateEmailPreview();
  }

  /* ---------------- sms / otp ---------------- */
  function renderSms() {
    const s = state.sms;
    $("smsEnabled").checked = !!s.enabled;
    $("smsProvider").value = s.provider === "generic" ? "generic" : "bulksmsbd";
    $("smsSenderId").value = s.senderId || "";
    $("smsApiKey").value = "";
    $("smsApiKey").placeholder = s.apiKey || "Not set";
    $("smsApiUrl").value = s.apiUrl || "";
    $("smsApiUrlWrap").hidden = s.provider !== "generic";
    $("smsNotifyOrder").checked = s.notifyOrder !== false;
    $("smsNotifyAdminOrder").checked = !!s.notifyAdminOrder;
    $("smsAdminPhone").value = s.adminPhone || "";
    $("smsOrderTemplate").value = s.orderTemplate || "";
    $("smsOtpEnabled").checked = !!s.otpEnabled;
    $("smsOtpLength").value = s.otpLength || 6;
    $("smsOtpExpiry").value = s.otpExpiryMinutes || 5;
    $("smsOtpTemplate").value = s.otpTemplate || "";
    applySmsEnabled();
    updateSmsPreview();
  }

  function updateSmsPreview() {
    const el = $("smsPreview");
    if (!el) return;
    el.textContent = renderTokens(state.sms.orderTemplate || "", sampleMailContext());
  }

  /* ---------------- invoice ---------------- */
  function updateInvoiceNext() {
    const el = $("invoiceNextNumber");
    if (!el) return;
    const last = Number(state.invoice.nextNumber) || 1000;
    const prefix = state.invoice.prefix || "INV-";
    el.textContent = prefix + String(last + 1).padStart(5, "0");
  }

  function renderInvoice() {
    const i = state.invoice;
    $("invoiceEnabled").checked = i.enabled !== false;
    $("invoiceCompanyName").value = i.companyName || "";
    $("invoiceBin").value = i.binNumber || "";
    $("invoiceCompanyAddress").value = i.companyAddress || "";
    $("invoiceCompanyPhone").value = i.companyPhone || "";
    $("invoiceCompanyEmail").value = i.companyEmail || "";
    $("invoicePrefix").value = i.prefix || "INV-";
    $("invoiceAccent").value = /^#[0-9a-f]{6}$/i.test(i.accentColor || "")
      ? i.accentColor
      : "#c9a961";
    $("invoicePaper").value = i.paperSize || "a4";
    $("invoiceCopies").value = i.copies || "both";
    $("invoiceShowLogo").checked = i.showLogo !== false;
    $("invoiceShowSignature").checked = i.showSignature !== false;
    $("invoiceSignatureLabel").value = i.signatureLabel || "Authorized signature";
    $("invoiceShowVat").checked = !!i.showVat;
    $("invoiceVat").value = i.vatPercent || 0;
    $("invoiceFooterNote").value = i.footerNote || "";
    $("invoiceTerms").value = i.terms || "";
    updateInvoiceNext();
    applyInvoiceEnabled();
  }

  /* ---------------- test + preview actions ---------------- */
  function setTestStatus(id, msg, kind) {
    const el = $(id);
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.className = "settings-test-status" + (kind ? " is-" + kind : "");
  }

  async function testEmail() {
    const to = $("emailTestTo").value.trim();
    if (!to) return setTestStatus("emailTestStatus", "Test email address din", "err");
    if (state.dirty) return setTestStatus("emailTestStatus", "Prothome Save changes korun, tarpor test korun.", "err");
    const btn = $("emailTestBtn");
    btn.disabled = true;
    btn.textContent = "Sending…";
    setTestStatus("emailTestStatus", "", "");
    try {
      const res = await api("/api/settings/email/test", {
        method: "POST",
        body: JSON.stringify({ to }),
      });
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Test email fail");
      setTestStatus("emailTestStatus", "Test email pathano hoyeche — inbox/spam check korun.", "ok");
    } catch (e) {
      setTestStatus("emailTestStatus", e.message, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "Send test email";
    }
  }

  async function testSms() {
    const to = $("smsTestTo").value.trim();
    if (!/^01[3-9]\d{8}$/.test(to)) {
      return setTestStatus("smsTestStatus", "Phone number valid na (01XXXXXXXXX)", "err");
    }
    if (state.dirty) return setTestStatus("smsTestStatus", "Prothome Save changes korun, tarpor test korun.", "err");
    const btn = $("smsTestBtn");
    btn.disabled = true;
    btn.textContent = "Sending…";
    setTestStatus("smsTestStatus", "", "");
    try {
      const res = await api("/api/settings/sms/test", {
        method: "POST",
        body: JSON.stringify({ to }),
      });
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Test SMS fail");
      setTestStatus("smsTestStatus", "Test SMS pathano hoyeche.", "ok");
    } catch (e) {
      setTestStatus("smsTestStatus", e.message, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "Send test SMS";
    }
  }

  function setInvoicePreviewMode(mode) {
    state.invoicePreviewMode = ["retail", "wholesale", "international"].includes(mode) ? mode : "retail";
    document.querySelectorAll("[data-inv-mode]").forEach((el) => {
      const active = el.dataset.invMode === state.invoicePreviewMode;
      el.classList.toggle("is-active", active);
      el.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  async function previewInvoice(mode) {
    if (mode) setInvoicePreviewMode(mode);
    const btn = $("invoicePreviewBtn");
    btn.disabled = true;
    btn.textContent = "Loading…";
    try {
      const res = await api("/api/settings/invoice/preview", {
        method: "POST",
        body: JSON.stringify({ invoice: state.invoice, mode: state.invoicePreviewMode }),
      });
      if (!res) return;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Preview fail");
      }
      const html = await res.text();
      $("invoicePreviewCard").hidden = false;
      $("invoicePreviewFrame").srcdoc = html;
      $("invoicePreviewCard").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      toast(e.message, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "Preview & print invoice";
    }
  }

  // bind email
  bindSettingsInputs(EMAIL_DEFS, "email", (key) => {
    if (key === "enabled") applyEmailEnabled();
  });
  $("emailTemplateSelect").addEventListener("change", () => {
    commitEmailTemplate();
    currentTemplateKey = $("emailTemplateSelect").value;
    renderEmailTemplates();
    updateEmailPreview();
    markDirty();
  });
  ["emailTemplateSubject", "emailTemplateBodyInput"].forEach((id) =>
    $(id).addEventListener("input", () => {
      commitEmailTemplate();
      markDirty();
      updateEmailPreview();
    })
  );
  $("emailTemplateEnabled").addEventListener("change", () => {
    commitEmailTemplate();
    markDirty();
    updateEmailPreview();
  });
  $("emailTestBtn").addEventListener("click", testEmail);

  // bind sms
  bindSettingsInputs(SMS_DEFS, "sms", (key, el) => {
    if (key === "enabled") applySmsEnabled();
    if (key === "provider") $("smsApiUrlWrap").hidden = el.value !== "generic";
    if (key === "orderTemplate") updateSmsPreview();
  });
  $("smsTestBtn").addEventListener("click", testSms);

  // bind invoice
  bindSettingsInputs(INVOICE_DEFS, "invoice", (key) => {
    if (key === "enabled") applyInvoiceEnabled();
    if (key === "prefix") updateInvoiceNext();
  });
  document.querySelectorAll("[data-inv-mode]").forEach((el) =>
    el.addEventListener("click", () => previewInvoice(el.dataset.invMode))
  );
  $("invoicePreviewBtn").addEventListener("click", () => previewInvoice());

  function renderAll() {
    // header + footer
    Object.entries(STATIC_FIELDS).forEach(([id, key]) => {
      const el = $(id);
      if (el) el.value = state.settings[key] == null ? "" : state.settings[key];
    });
    setPreview($("logoPreview"), state.settings.logo, "No logo");
    setPreview($("faviconPreview"), state.settings.favicon, "No icon");
    setPreview($("footerLogoPreview"), state.settings.footer_logo, "No logo");

    // product settings
    $("setAttributes").checked = String(state.settings.attributes_enabled) !== "false";
    $("setSwatches").checked = String(state.settings.swatches_enabled) !== "false";

    // shipping enable switches + dim state (render er por, karon notun row
    // render hole tar input gulo abar disable korte hoy)
    Object.keys(TOGGLE_ID).forEach((key) => {
      const toggle = $(TOGGLE_ID[key]);
      if (!toggle) return;
      toggle.checked = String(state.settings[ENABLE_KEY[key]]) === "true";
    });

    // payment switches
    Object.keys(PAY_TOGGLE).forEach((key) => {
      const toggle = $(PAY_TOGGLE[key].toggle);
      if (!toggle) return;
      toggle.checked = String(state.settings[PAY_TOGGLE[key].key]) === "true";
    });
    $("mobileAskSender").checked = String(state.settings.mobile_banking_ask_sender) !== "false";

    // login & registration
    $("loginRegEnabled").checked = String(state.settings.login_registration_enabled) === "true";
    $("loginEmailEnabled").checked = String(state.settings.login_email_enabled) !== "false";
    $("loginPhoneEnabled").checked = String(state.settings.login_phone_enabled) === "true";
    updateLoginStatus();
    renderLoginPreview();

    renderFavicons();
    renderSocial();
    renderShipping();
    renderPayments();
    renderCheckoutFields();
    renderEmail();
    renderSms();
    renderInvoice();
    renderInternational();
    applyFlashSalesUi();

    Object.keys(TOGGLE_ID).forEach((key) => applyEnabled(key));
    Object.keys(PAY_TOGGLE).forEach((key) => applyPayEnabled(key));
    renderWholesale();
    renderPartial();
  }

  /* ------------------------------------------------------------------ *
   * Load
   * ------------------------------------------------------------------ */
  function applyData(data) {
    state.settings = { ...(data.settings || {}) };
    state.social = (data.social || []).map((s) => ({ icon: s.icon || "", name: s.name || "", url: s.url || "" }));
    state.stores = data.stores || [];
    state.favicons = (data.favicons || []).map((f) => ({
      storeId: f.storeId,
      shopName: f.shopName,
      icon: f.icon || "",
      hidden: false,
    }));
    state.categories = data.categories || [];
    state.shipping = {
      manual: (data.shipping && data.shipping.manual) || [],
      areas: (data.shipping && data.shipping.areas) || [],
      classes: (data.shipping && data.shipping.classes) || [],
      intl: (data.shipping && data.shipping.intl) || [],
      wd: (data.shipping && data.shipping.wd) || [],
    };
    state.payments = {
      mobileManual: ((data.payments && data.payments.mobileManual) || []).map((r) => ({
        name: r.name || "",
        accountType: r.accountType || "Personal",
        number: r.number || "",
        instruction: r.instruction || "",
      })),
      bankManual: ((data.payments && data.payments.bankManual) || []).map((r) => ({
        bankName: r.bankName || "",
        accountName: r.accountName || "",
        accountNumber: r.accountNumber || "",
        branch: r.branch || "",
        instruction: r.instruction || "",
      })),
      gateways: ((data.payments && data.payments.gateways) || []).map((g) => ({
        type: g.type,
        name: g.name,
        mode: g.mode || "sandbox",
        active: !!g.active,
        credentials: { ...(g.credentials || {}) },
      })),
    };
    state.checkoutFields = normalizeCheckoutFields(data.checkoutFields);

    const email = data.email || {};
    state.email = {
      enabled: !!email.enabled,
      fromName: email.fromName || "",
      fromEmail: email.fromEmail || "",
      replyTo: email.replyTo || "",
      smtpHost: email.smtpHost || "",
      smtpPort: Number(email.smtpPort) || 587,
      smtpSecure: !!email.smtpSecure,
      smtpUser: email.smtpUser || "",
      smtpPassword: email.smtpPassword || "",
      orderEmail: email.orderEmail || "",
      cancelEmail: email.cancelEmail || "",
      adminEmail: email.adminEmail || "",
      notifyAdminNewOrder: email.notifyAdminNewOrder !== false,
      notifyCustomerNewOrder: email.notifyCustomerNewOrder !== false,
      notifyCustomerCancelled: email.notifyCustomerCancelled !== false,
      notifyCustomerStatus: email.notifyCustomerStatus !== false,
      templates: (email.templates || []).map((t) => ({
        key: t.key,
        label: t.label || t.key,
        subject: t.subject || "",
        body: t.body || "",
        enabled: t.enabled !== false,
      })),
    };

    const sms = data.sms || {};
    state.sms = {
      enabled: !!sms.enabled,
      provider: sms.provider === "generic" ? "generic" : "bulksmsbd",
      apiKey: sms.apiKey || "",
      senderId: sms.senderId || "",
      apiUrl: sms.apiUrl || "",
      notifyOrder: sms.notifyOrder !== false,
      notifyAdminOrder: !!sms.notifyAdminOrder,
      adminPhone: sms.adminPhone || "",
      orderTemplate: sms.orderTemplate || "",
      otpEnabled: !!sms.otpEnabled,
      otpLength: Number(sms.otpLength) || 6,
      otpExpiryMinutes: Number(sms.otpExpiryMinutes) || 5,
      otpTemplate: sms.otpTemplate || "",
    };

    const invoice = data.invoice || {};
    state.invoice = {
      enabled: invoice.enabled !== false,
      prefix: invoice.prefix || "INV-",
      nextNumber: Number(invoice.nextNumber) || 1000,
      nextNumberPreview: invoice.nextNumberPreview || "",
      accentColor: invoice.accentColor || "#c9a961",
      paperSize: invoice.paperSize || "a4",
      copies: invoice.copies || "both",
      companyName: invoice.companyName || "",
      companyAddress: invoice.companyAddress || "",
      companyPhone: invoice.companyPhone || "",
      companyEmail: invoice.companyEmail || "",
      showLogo: invoice.showLogo !== false,
      showSignature: invoice.showSignature !== false,
      signatureLabel: invoice.signatureLabel || "Authorized signature",
      showVat: !!invoice.showVat,
      vatPercent: Number(invoice.vatPercent) || 0,
      binNumber: invoice.binNumber || "",
      footerNote: invoice.footerNote || "",
      terms: invoice.terms || "",
    };
  }

  async function load() {
    state.loading = true;
    const [res, intlRes] = await Promise.all([
      api("/api/settings"),
      api("/api/international/settings"),
    ]);
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    const intlData = intlRes ? await intlRes.json().catch(() => ({})) : {};
    state.loading = false;
    if (!res.ok) {
      toast(data.message || "Settings load hoyni", "err");
      return;
    }
    applyData(data);
    const intlOk = !!(intlRes && intlRes.ok && intlData.settings);
    if (intlOk) {
      applyInternational(intlData.settings, true);
    } else {
      applyInternational(INTERNATIONAL_DEFAULTS, false);
      state.internationalLoadError =
        (intlData && intlData.message) ||
        "International settings load hoyni — server restart ba page reload korun";
    }
    renderAll();
    state.dirty = false;
    state.ready = true;
  }

  /* ------------------------------------------------------------------ *
   * Save
   * ------------------------------------------------------------------ */
  async function save() {
    const btn = $("settingsSaveBtn");
    if (!btn) return;

    let intlPayload = null;
    if (state.internationalLoaded) {
      const intlError = validateInternational();
      if (intlError) {
        showPane("international");
        toast(intlError, "err");
        return;
      }
      intlPayload = internationalPayload();
    }

    let wholesalePayload = null;
    if (state.wholesaleLoaded) {
      const wholesaleError = validateWholesaleSettings();
      if (wholesaleError) {
        showPane("wholesale");
        toast(wholesaleError, "err");
        return;
      }
      wholesalePayload = wholesaleSettingsPayload();
    }

    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const payload = {
        settings: state.settings,
        social: state.social,
        favicons: state.favicons.map((f) => ({ storeId: f.storeId, icon: f.icon })),
        shipping: {
          manual: state.shipping.manual,
          areas: state.shipping.areas,
          classes: state.shipping.classes,
          intl: state.shipping.intl,
          wd: state.shipping.wd,
        },
        payments: {
          mobileManual: state.payments.mobileManual,
          bankManual: state.payments.bankManual,
          gateways: state.payments.gateways,
        },
        checkoutFields: state.checkoutFields.map((f) => ({
          fieldKey: f.fieldKey,
          isShown: f.isShown,
          isRequired: f.isRequired,
          label: f.label,
        })),
      };

      const [res, intlRes] = await Promise.all([
        api("/api/settings", { method: "PUT", body: JSON.stringify(payload) }),
        intlPayload
          ? api("/api/international/settings", { method: "PUT", body: JSON.stringify(intlPayload) })
          : Promise.resolve(null),
      ]);
      if (!res) return;
      if (intlPayload && !intlRes) return;

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Save hoyni");

      let intlData = null;
      if (intlRes) {
        intlData = await intlRes.json().catch(() => ({}));
        if (!intlRes.ok) throw new Error(intlData.message || "International settings save hoyni");
      }

      let wholesaleData = null;
      if (wholesalePayload) {
        const wholesaleRes = await api("/api/wholesale/settings", {
          method: "PUT",
          body: JSON.stringify(wholesalePayload),
        });
        if (!wholesaleRes) return;
        wholesaleData = await wholesaleRes.json().catch(() => ({}));
        if (!wholesaleRes.ok) {
          throw new Error(wholesaleData.message || "Wholesale settings save hoyni");
        }
      }

      applyData(data);
      if (intlData && intlData.settings) applyInternational(intlData.settings, true);
      if (wholesaleData && wholesaleData.settings) applyWholesaleSettings(wholesaleData.settings);
      renderAll();
      state.dirty = false;
      toast(
        state.internationalLoaded
          ? "Settings saved"
          : "Settings saved — international part load hoyni"
      );
      // Add Product form er toggles live update
      window.dispatchEvent(new CustomEvent("settings:saved", { detail: { settings: data.settings } }));
    } catch (e) {
      toast(e.message, "err");
    } finally {
      btn.disabled = false;
      btn.textContent = "Save changes";
    }
  }

  $("settingsSaveBtn").addEventListener("click", save);

  /* ------------------------------------------------------------------ *
   * Unsaved changes warning
   * ------------------------------------------------------------------ */
  window.addEventListener("beforeunload", (e) => {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // Dashboard er onno view e jaoar somoy-o warn (capture = age chole)
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener(
      "click",
      (e) => {
        const view = document.getElementById("view-settings");
        const inSettings = view && !view.hidden;
        if (!inSettings || !state.dirty) return;
        if (!window.confirm("Unsaved settings changes ache. Tumi ki leave korte chao?")) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true
    );
  });

  /* ------------------------------------------------------------------ *
   * Public hook — dashboard.js switchView theke call hoy
   * ------------------------------------------------------------------ */
  fillDatalists();
  window.settingsPage = {
    open() {
      if (!state.ready && !state.loading) load();
      if (!state.wholesaleLoaded && !state.wholesaleLoading) loadWholesale();
    },
  };
})();
