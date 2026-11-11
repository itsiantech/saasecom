// Store admin → Style Settings.
// Loads in <head> so the cached palette is applied before first paint; the
// panel itself is built on DOMContentLoaded.
(function () {
  "use strict";

  const TOKEN_KEY = "luxe_token";
  const CACHE_KEY = "luxe_dash_style";
  const STYLE_KEYS = [
    "bodyBg",
    "bodyText",
    "fontFamily",
    "buttonColor",
    "sidebarBg",
    "menuBg",
    "iconColor",
    "activeBg",
    "activeText",
    "activeIcon",
    "activeFont",
    "activeWeight",
  ];

  const EMPTY = {
    bodyBg: "",
    bodyText: "",
    fontFamily: "",
    buttonColor: "",
    sidebarBg: "",
    menuBg: "",
    iconColor: "",
    activeBg: "",
    activeText: "",
    activeIcon: "",
    activeFont: "",
    activeWeight: "",
  };

  const FONT_STACKS = {
    inter: '"Inter", "Segoe UI", system-ui, sans-serif',
    playfair: '"Playfair Display", Georgia, serif',
    georgia: 'Georgia, "Times New Roman", serif',
    system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    mono: '"Consolas", "SFMono-Regular", Menlo, monospace',
  };

  const FONT_FALLBACK = [
    { key: "inter", label: "Inter — modern sans" },
    { key: "playfair", label: "Playfair Display — serif" },
    { key: "georgia", label: "Georgia — classic serif" },
    { key: "system", label: "System UI" },
    { key: "mono", label: "Consolas — monospace" },
  ];

  const WEIGHT_LABELS = { 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra bold" };

  const GROUPS = [
    {
      title: "Body & text",
      hint: "পুরো ড্যাশবোর্ডের পেছনের রঙ, লেখার রঙ, লেখার স্টাইল আর বাটনের রঙ।",
      fields: [
        { key: "bodyBg", type: "color", label: "Page background" },
        { key: "bodyText", type: "color", label: "Text colour", auto: true },
        { key: "fontFamily", type: "font", label: "Text style (font family)", wide: true },
        { key: "buttonColor", type: "color", label: "Button colour", wide: true },
      ],
    },
    {
      title: "Sidebar menu",
      hint: "সাইডবার, প্রতিটি মেনু আইটেমের পেছনের রঙ আর আইকনের রঙ।",
      fields: [
        { key: "sidebarBg", type: "color", label: "Sidebar background" },
        { key: "menuBg", type: "color", label: "Menu item background" },
        { key: "iconColor", type: "color", label: "Menu icon colour", wide: true },
      ],
    },
    {
      title: "Active menu",
      hint: "যে মেনুটি খোলা আছে তার পিল, লেখা, আইকন আর ফন্ট।",
      fields: [
        { key: "activeBg", type: "color", label: "Active background" },
        { key: "activeText", type: "color", label: "Active text colour", auto: true },
        { key: "activeIcon", type: "color", label: "Active icon colour", auto: true },
        { key: "activeFont", type: "font", label: "Active text style", active: true },
        { key: "activeWeight", type: "weight", label: "Active font weight" },
      ],
    },
  ];

  const state = {
    style: { ...EMPTY },
    options: null,
    dirty: false,
    applied: [],
    loaded: false,
  };

  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  /* ------------------------------------------------------- theme helpers */

  function currentTheme() {
    return document.documentElement.dataset.theme === "light" ? "light" : "dark";
  }

  function themePalette() {
    if (currentTheme() === "light") {
      return {
        bg: "#f7f5f0",
        side: "#efece4",
        text: "#1d1a15",
        muted: "#6c6558",
        gold: "#8a6a33",
        font: FONT_STACKS.inter,
      };
    }
    return {
      bg: "#0a0a10",
      side: "#0e0e16",
      text: "#ece9e2",
      muted: "#98917f",
      gold: "#d4af7a",
      font: FONT_STACKS.inter,
    };
  }

  function expandHex(value) {
    const raw = String(value == null ? "" : value).trim();
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(raw)) {
      const c = raw.slice(1).toLowerCase();
      return `#${c[0]}${c[0]}${c[1]}${c[1]}${c[2]}${c[2]}`;
    }
    return "";
  }

  function hexToRgb(hex) {
    const value = expandHex(hex);
    if (!value) return [0, 0, 0];
    return [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
  }

  function rgba(hex, alpha) {
    const [r, g, b] = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function mix(from, to, weight) {
    const a = hexToRgb(from);
    const b = hexToRgb(to);
    const w = Math.max(0, Math.min(1, Number(weight) || 0));
    const channel = (index) => Math.round(a[index] * (1 - w) + b[index] * w);
    return `#${[0, 1, 2].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
  }

  function shade(hex, amount) {
    return mix(hex, amount < 0 ? "#000000" : "#ffffff", Math.abs(amount));
  }

  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastRatio(a, b) {
    const light = Math.max(luminance(a), luminance(b));
    const dark = Math.min(luminance(a), luminance(b));
    return (light + 0.05) / (dark + 0.05);
  }

  function readableOn(bg) {
    return contrastRatio(bg, "#ffffff") >= contrastRatio(bg, "#15110a") ? "#ffffff" : "#15110a";
  }

  function fontStack(key) {
    return FONT_STACKS[key] || "";
  }

  function currentSlug() {
    return (
      new URLSearchParams(location.search).get("store") ||
      localStorage.getItem("luxe_store_slug") ||
      ""
    );
  }

  function apiUrl() {
    const slug = currentSlug();
    return "/api/settings/dashboard-style" + (slug ? "?store=" + encodeURIComponent(slug) : "");
  }

  function readCache() {
    try {
      const map = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
      return map[currentSlug()] || null;
    } catch {
      return null;
    }
  }

  function writeCache(style) {
    try {
      const map = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
      map[currentSlug()] = style;
      localStorage.setItem(CACHE_KEY, JSON.stringify(map));
    } catch {
      /* private mode — cache is optional */
    }
  }

  /* ------------------------------------------------------- live variables */

  function computeVars(style) {
    const theme = themePalette();
    const pageBg = style.bodyBg || theme.bg;
    const vars = {};

    if (style.bodyBg) vars["--bg"] = style.bodyBg;
    if (style.bodyText) {
      vars["--text"] = style.bodyText;
      vars["--muted"] = mix(style.bodyText, pageBg, 0.42);
      vars["--line-soft"] = rgba(style.bodyText, 0.13);
    }
    if (style.fontFamily) vars["--dash-font"] = fontStack(style.fontFamily);
    if (style.buttonColor) {
      vars["--gold"] = style.buttonColor;
      vars["--gold-2"] = shade(style.buttonColor, -0.2);
      vars["--gold-soft"] = rgba(style.buttonColor, 0.14);
    }
    if (style.sidebarBg) vars["--bg-2"] = style.sidebarBg;
    if (style.menuBg) vars["--nav-menu-bg"] = style.menuBg;
    if (style.iconColor) vars["--nav-icon"] = style.iconColor;
    if (style.activeBg) vars["--nav-active-bg"] = style.activeBg;
    if (style.activeText) vars["--nav-active-text"] = style.activeText;
    if (style.activeIcon) vars["--nav-active-icon"] = style.activeIcon;
    if (style.activeFont) vars["--nav-active-font"] = fontStack(style.activeFont);
    if (style.activeWeight) vars["--nav-active-weight"] = style.activeWeight;
    return vars;
  }

  function applyStyle(style) {
    const root = document.documentElement;
    for (const key of state.applied.splice(0)) root.style.removeProperty(key);

    const active = STYLE_KEYS.some((key) => style && style[key]);
    if (!active) {
      root.removeAttribute("data-dash-style");
      root.removeAttribute("data-dash-bg");
      root.removeAttribute("data-dash-font");
      return;
    }

    root.setAttribute("data-dash-style", "on");
    if (style.bodyBg) root.setAttribute("data-dash-bg", "on");
    else root.removeAttribute("data-dash-bg");
    if (style.fontFamily) root.setAttribute("data-dash-font", "on");
    else root.removeAttribute("data-dash-font");
    for (const [key, value] of Object.entries(computeVars(style))) {
      root.style.setProperty(key, value);
      state.applied.push(key);
    }
  }

  /* ------------------------------------------------------- panel: fields */

  function fieldInput(selector) {
    return document.querySelector(`#ssFormGroups ${selector}`);
  }

  function fieldPicker(key) {
    return fieldInput(`input[data-color="${key}"]`);
  }

  function fieldHex(key) {
    return fieldInput(`input[data-hex="${key}"]`);
  }

  function themeValue(key) {
    const theme = themePalette();
    const map = {
      bodyBg: theme.bg,
      bodyText: theme.text,
      buttonColor: theme.gold,
      sidebarBg: theme.side,
      menuBg: theme.side,
      iconColor: theme.muted,
      activeBg: theme.bg,
      activeText: theme.gold,
      activeIcon: theme.gold,
    };
    return map[key] || theme.gold;
  }

  function renderPresets() {
    const box = $("ssPresets");
    if (!box) return;
    const presets = (state.options && state.options.presets) || [];
    if (!presets.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = presets
      .map(
        (preset) => `
        <button type="button" class="ss-preset" data-preset="${esc(preset.key)}">
          <span class="dot" style="background:${esc(preset.swatch || "#888888")}"></span>
          ${esc(preset.label)}
        </button>`
      )
      .join("");
    updatePresetState();
  }

  function renderField(field) {
    if (field.type === "color") {
      return `
        <div class="ss-field${field.wide ? " ss-field-wide" : ""}" data-field="${esc(field.key)}">
          <label for="ss-${esc(field.key)}">${esc(field.label)}</label>
          <div class="ss-color-row">
            <input class="ss-swatch" type="color" id="ss-${esc(field.key)}" data-color="${esc(field.key)}" value="${esc(
              themeValue(field.key)
            )}" />
            <input class="ss-hex" type="text" data-hex="${esc(field.key)}" maxlength="7" spellcheck="false" placeholder="Theme default" />
            ${field.auto ? '<button type="button" class="ss-mini-btn" data-auto="' + esc(field.key) + '" title="Auto readable colour">Auto</button>' : ""}
            <button type="button" class="ss-mini-btn" data-clear="${esc(field.key)}" title="Use theme colour">Clear</button>
          </div>
        </div>`;
    }

    if (field.type === "weight") {
      const weights = (state.options && state.options.weights) || ["400", "500", "600", "700", "800"];
      return `
        <div class="ss-field${field.wide ? " ss-field-wide" : ""}" data-field="${esc(field.key)}">
          <label for="ss-${esc(field.key)}">${esc(field.label)}</label>
          <select id="ss-${esc(field.key)}" data-select="${esc(field.key)}">
            <option value="">Theme default</option>
            ${weights
              .map((weight) => `<option value="${esc(weight)}">${esc(WEIGHT_LABELS[weight] || weight)} (${esc(weight)})</option>`)
              .join("")}
          </select>
        </div>`;
    }

    const fonts = (state.options && state.options.fonts) || FONT_FALLBACK;
    const emptyLabel = field.active ? "Same as page text" : "Theme default (Inter)";
    return `
      <div class="ss-field${field.wide ? " ss-field-wide" : ""}" data-field="${esc(field.key)}">
        <label for="ss-${esc(field.key)}">${esc(field.label)}</label>
        <select id="ss-${esc(field.key)}" data-select="${esc(field.key)}">
          <option value="">${esc(emptyLabel)}</option>
          ${fonts.map((font) => `<option value="${esc(font.key)}">${esc(font.label)}</option>`).join("")}
        </select>
      </div>`;
  }

  function renderForm() {
    const box = $("ssFormGroups");
    if (!box) return;
    box.innerHTML = GROUPS.map(
      (group) => `
      <section class="ss-card">
        <h3>${esc(group.title)}</h3>
        <p>${esc(group.hint)}</p>
        <div class="ss-grid">${group.fields.map(renderField).join("")}</div>
      </section>`
    ).join("");
    syncForm();
  }

  function syncForm() {
    if (!$("ssFormGroups")) return;
    for (const key of STYLE_KEYS) {
      const picker = fieldPicker(key);
      const hex = fieldHex(key);
      const select = fieldInput(`select[data-select="${key}"]`);
      if (picker) picker.value = state.style[key] || themeValue(key);
      if (hex) hex.value = state.style[key] || "";
      if (select) select.value = state.style[key] || "";
    }
  }

  function updatePresetState() {
    const box = $("ssPresets");
    if (!box || !state.options) return;
    for (const preset of state.options.presets || []) {
      const button = box.querySelector(`[data-preset="${preset.key}"]`);
      if (!button) continue;
      const match = STYLE_KEYS.every((key) => (preset.style[key] || "") === (state.style[key] || ""));
      button.classList.toggle("on", match);
    }
  }

  function setStatus(message, kind) {
    const el = $("ssStatus");
    if (!el) return;
    el.textContent = message || "";
    el.className = "ss-status" + (kind ? " " + kind : "");
  }

  function updateStateChip() {
    const chip = $("ssStateChip");
    if (!chip) return;
    chip.textContent = state.dirty ? "Unsaved" : "Saved";
    chip.className = "ss-chip " + (state.dirty ? "dirty" : "ok");
  }

  function markDirty() {
    state.dirty = true;
    updateStateChip();
    setStatus("বদল সেভ হয়নি — পুরো ড্যাশবোর্ডে রাখতে Save style চাপুন।", "warn");
  }

  function afterChange() {
    applyStyle(state.style);
    updatePreview();
    updatePresetState();
    markDirty();
  }

  /* ------------------------------------------------------- panel: preview */

  function updatePreview() {
    const preview = $("ssPreview");
    if (!preview) return;
    const style = state.style;
    const theme = themePalette();
    const pageBg = style.bodyBg || theme.bg;
    const side = style.sidebarBg || theme.side;
    const text = style.bodyText || theme.text;
    const muted = style.bodyText ? mix(style.bodyText, pageBg, 0.42) : theme.muted;
    const gold = style.buttonColor || theme.gold;
    const menu = style.menuBg || side;
    const active = style.activeBg || pageBg;
    const activeText = style.activeText || gold;
    const activeIcon = style.activeIcon || style.iconColor || activeText;
    const icon = style.iconColor || muted;
    const font = fontStack(style.fontFamily) || theme.font;
    const activeFont = fontStack(style.activeFont) || font;

    const set = (name, value) => preview.style.setProperty(name, value);
    set("--pv-bg", pageBg);
    set("--pv-side", side);
    set("--pv-menu", menu);
    set("--pv-icon", icon);
    set("--pv-active", active);
    set("--pv-active-text", activeText);
    set("--pv-active-icon", activeIcon);
    set("--pv-text", text);
    set("--pv-muted", muted);
    set("--pv-gold", gold);
    set("--pv-btn-text", readableOn(gold));
    set("--pv-font", font);
    set("--pv-active-font", activeFont);
    set("--pv-active-weight", style.activeWeight || "400");

    updateContrast({ pageBg, text, active, activeText, activeIcon, gold });
  }

  function grade(ratio) {
    if (ratio >= 7) return { label: "AAA", pass: true };
    if (ratio >= 4.5) return { label: "AA", pass: true };
    if (ratio >= 3) return { label: "AA large", pass: false };
    return { label: "Low", pass: false };
  }

  function updateContrast({ pageBg, text, active, activeText, activeIcon, gold }) {
    const list = $("ssContrast");
    if (!list) return;
    const rows = [
      { label: "Page text", fg: text, bg: pageBg },
      { label: "Active text", fg: activeText, bg: active },
      { label: "Active icon", fg: activeIcon, bg: active },
      { label: "Button label", fg: readableOn(gold), bg: gold },
    ];
    list.innerHTML = rows
      .map((row) => {
        const ratio = contrastRatio(row.fg, row.bg);
        const verdict = grade(ratio);
        return `<li><span>${esc(row.label)}</span><span>${ratio.toFixed(1)}:1 <b class="${
          verdict.pass ? "pass" : "fail"
        }">${verdict.label}</b></span></li>`;
      })
      .join("");
  }

  /* ------------------------------------------------------- panel: actions */

  function handleColorInput(input) {
    const key = input.dataset.hex;
    const raw = input.value.trim();
    if (!raw) {
      state.style[key] = "";
      const picker = fieldPicker(key);
      if (picker) picker.value = themeValue(key);
      afterChange();
      return;
    }
    const hex = expandHex(raw);
    if (!hex) return; // still typing
    state.style[key] = hex;
    const picker = fieldPicker(key);
    if (picker) picker.value = hex;
    afterChange();
  }

  function handlePickerInput(input) {
    const key = input.dataset.color;
    const hex = expandHex(input.value) || input.value;
    state.style[key] = hex;
    const text = fieldHex(key);
    if (text) text.value = hex;
    afterChange();
  }

  function handleHexBlur(input) {
    const key = input.dataset.hex;
    const hex = expandHex(input.value);
    if (hex) {
      input.value = hex;
      state.style[key] = hex;
    } else if (!input.value.trim()) {
      input.value = "";
      state.style[key] = "";
    } else {
      input.value = state.style[key] || "";
    }
    applyStyle(state.style);
    updatePreview();
  }

  function handleAuto(key) {
    const bg = key === "bodyText" ? state.style.bodyBg || themePalette().bg : state.style.activeBg || themePalette().bg;
    const hex = readableOn(bg);
    state.style[key] = hex;
    const text = fieldHex(key);
    const picker = fieldPicker(key);
    if (text) text.value = hex;
    if (picker) picker.value = hex;
    afterChange();
  }

  function handleClear(key) {
    state.style[key] = "";
    const text = fieldHex(key);
    const picker = fieldPicker(key);
    if (text) text.value = "";
    if (picker) picker.value = themeValue(key);
    afterChange();
  }

  function applyPreset(key) {
    const preset = ((state.options && state.options.presets) || []).find((row) => row.key === key);
    if (!preset) return;
    state.style = { ...EMPTY, ...preset.style };
    syncForm();
    afterChange();
  }

  function bindPanel() {
    const box = $("ssFormGroups");
    if (!box) return;

    box.addEventListener("input", (event) => {
      const target = event.target;
      if (target.matches("input[data-color]")) handlePickerInput(target);
      else if (target.matches("input[data-hex]")) handleColorInput(target);
    });

    box.addEventListener("change", (event) => {
      const target = event.target;
      if (target.matches("input[data-hex]")) handleHexBlur(target);
      else if (target.matches("select[data-select]")) {
        state.style[target.dataset.select] = target.value;
        afterChange();
      }
    });

    box.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-auto], button[data-clear]");
      if (!button) return;
      if (button.dataset.auto) handleAuto(button.dataset.auto);
      else if (button.dataset.clear !== undefined) handleClear(button.dataset.clear);
    });

    const presets = $("ssPresets");
    if (presets) {
      presets.addEventListener("click", (event) => {
        const button = event.target.closest("[data-preset]");
        if (button) applyPreset(button.dataset.preset);
      });
    }

    const save = $("ssSaveBtn");
    if (save) save.addEventListener("click", saveStyle);
    const reset = $("ssResetAll");
    if (reset) {
      reset.addEventListener("click", () => {
        if (!window.confirm("সব কাস্টম রঙ মুছে থিমের ডিফল্ট স্টাইলে ফিরবেন?")) return;
        state.style = { ...EMPTY };
        syncForm();
        saveStyle();
      });
    }
  }

  async function load() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    try {
      const res = await window.ApiSession.request(apiUrl(), {
        headers: { "Content-Type": "application/json" },
      });
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || "স্টাইল লোড হয়নি — আরেকবার চেষ্টা করুন।", "err");
        return;
      }
      state.options = data.options || {};
      if (state.dirty) {
        // slow GET must not wipe colours the owner already started picking
        renderPresets();
        updatePresetState();
        return;
      }
      state.style = { ...EMPTY, ...(data.style || {}) };
      state.loaded = true;
      state.dirty = false;
      renderPresets();
      renderForm();
      applyStyle(state.style);
      updatePreview();
      updateStateChip();
      setStatus("সেভ করা স্টাইল লোড হয়েছে।", "");
    } catch {
      setStatus("স্টাইল লোড হয়নি — ইন্টারনেট সংযোগ দেখুন।", "err");
    }
  }

  async function saveStyle() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setStatus("সেভ করতে আগে লগইন করুন।", "err");
      return;
    }
    const save = $("ssSaveBtn");
    if (save) save.disabled = true;
    setStatus("সেভ হচ্ছে…", "");
    try {
      const style = { ...EMPTY, ...state.style };
      const res = await window.ApiSession.request(apiUrl(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ style }),
      });
      if (!res) {
        setStatus("সেশন শেষ — আবার লগইন করুন।", "err");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.message || "সেভ হয়নি — আরেকবার চেষ্টা করুন।", "err");
        return;
      }
      state.style = { ...EMPTY, ...(data.style || style) };
      state.dirty = false;
      writeCache(state.style);
      syncForm();
      applyStyle(state.style);
      updatePreview();
      updatePresetState();
      updateStateChip();
      setStatus("সেভ হয়েছে — পুরো ড্যাশবোর্ডে এই স্টাইল এখন চালু আছে।", "ok");
    } catch {
      setStatus("সেভ হয়নি — ইন্টারনেট সংযোগ দেখুন।", "err");
    } finally {
      if (save) save.disabled = false;
    }
  }

  /* ------------------------------------------------------- boot */

  const cached = readCache();
  if (cached) {
    state.style = { ...EMPTY, ...cached };
    applyStyle(state.style);
  }

  function observeTheme() {
    const root = document.documentElement;
    new MutationObserver(() => {
      syncForm();
      applyStyle(state.style);
      updatePreview();
    }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  }

  function boot() {
    if (!$("view-style-settings")) return;
    renderPresets();
    renderForm();
    applyStyle(state.style);
    updatePreview();
    updateStateChip();
    bindPanel();
    observeTheme();

    const nav = document.querySelector('.nav-item[data-view="style-settings"]');
    if (nav) nav.addEventListener("click", () => {
      syncForm();
      updatePreview();
      updateStateChip();
      if (nav.scrollIntoView) nav.scrollIntoView({ block: "nearest" });
    });

    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
})();
