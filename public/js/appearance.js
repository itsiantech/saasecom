// Appearance: theme + design-token draft, publish, revisions, storefront preview.
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = "luxe_token";
  const esc = (value) =>
    String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const LABELS = {
    colorPrimary: "Primary",
    colorPrimaryDark: "Primary dark",
    colorAccent: "Accent",
    colorAnnouncementBg: "Announcement bar",
    colorAnnouncementText: "Announcement text",
    colorBg: "Page background",
    colorSurface: "Card surface",
    colorInk: "Text",
    colorMuted: "Muted text",
    colorLine: "Border line",
    colorSuccess: "Success",
    colorFooterBg: "Footer background",
    colorFooterText: "Footer text",
    searchFieldRadius: "Search field radius (9999px = round, 0 = square)",
    searchFieldBg: "Search field background",
    searchFieldIconColor: "Search icon color",
    searchFieldIconBg: "Search icon background",
    searchFieldPlaceholder: "Search placeholder color",
    imageSearchIconColor: "Image search icon color",
    imageSearchBg: "Image search background",
    accountIconColor: "Account icon color",
    accountTextColor: "Account text color",
    accountBg: "Account background (transparent = none)",
    wishIconColor: "Wishlist icon color",
    wishTextColor: "Wishlist text color",
    wishBg: "Wishlist background (transparent = none)",
    cartIconColor: "Cart icon color",
    cartTextColor: "Cart text color",
    cartBg: "Cart background (transparent = none)",
    radiusCard: "Card radius",
    radiusControl: "Button radius",
    fontBody: "Body font",
    fontHeading: "Heading font",
    containerWidth: "Container width",
    headerSticky: "Sticky header (1/0)",
    cardShadow: "Card shadow",
  };

  // Colours don't always start with "color" (searchFieldBg, accountBg,
  // searchFieldPlaceholder), so decide by suffix as well.
  const COLOR_KEY = /color|bg$|placeholder/i;
  const HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

  function hexForPicker(value) {
    const text = String(value || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(text)) return text;
    if (/^#[0-9a-f]{3}$/i.test(text)) return "#" + text.slice(1).split("").map((ch) => ch + ch).join("");
    return "#ffffff";
  }

  let storeSlug = new URLSearchParams(location.search).get("store") || localStorage.getItem("luxe_store_slug") || "";

  const state = {
    themes: [],
    draft: null,
    published: null,
    revisions: [],
    theme: "",
    localDirty: false,
  };

  async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (storeSlug) headers["x-store-slug"] = storeSlug;
    const res = await window.ApiSession.request("/api/appearance" + path, { ...options, headers });
    if (!res) {
      const fallback = window.ApiSession.cancelled();
      const data = await fallback.json();
      return { res: fallback, data };
    }
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function setStatus(message, kind = "") {
    const el = $("apStatus");
    if (!el) return;
    el.textContent = message || "";
    el.className = "ap-status" + (kind ? " ap-" + kind : "");
  }

  function themeMeta(name) {
    return state.themes.find((row) => row.name === name) || { name, label: name, tokens: {} };
  }

  function themeDefaults() {
    return themeMeta(state.theme).tokens || {};
  }

  /* ---------------- theme picker ---------------- */
  function renderThemes() {
    const box = $("themeChoices");
    if (!state.themes.length) {
      box.innerHTML = '<p class="ap-hint">কোনো থিম পাওয়া যায়নি।</p>';
      return;
    }
    box.innerHTML = state.themes
      .map(
        (theme) => `
        <label class="theme-choice${theme.name === state.theme ? " selected" : ""}">
          <input type="radio" name="apTheme" value="${esc(theme.name)}"${theme.name === state.theme ? " checked" : ""} />
          <span>
            <b>${esc(theme.label)}</b>
            <small>${esc(theme.description || "")}</small>
            <em>${esc(theme.name)}</em>
          </span>
        </label>`
      )
      .join("");

    box.querySelectorAll('input[name="apTheme"]').forEach((input) => {
      input.addEventListener("change", () => selectTheme(input.value));
    });
  }

  function selectTheme(name) {
    if (name === state.theme) return;
    state.theme = name;
    state.localDirty = true;
    renderThemes();
    renderTokens({});
    applyPreview();
    setStatus("থিম বদলেছে — Save draft চাপুন।", "warn");
  }

  /* ---------------- token editor ---------------- */
  function renderTokens(overrides) {
    const defs = themeDefaults();
    const box = $("tokenFields");
    const keys = Object.keys(defs);
    if (!keys.length) {
      box.innerHTML = '<p class="ap-hint">এই থিমে কোনো টোকেন নেই।</p>';
      return;
    }
    const saved = overrides || (state.draft && state.draft.theme === state.theme ? state.draft.overrides || {} : {});
    box.innerHTML = keys
      .map((key) => {
        const fallback = defs[key] == null ? "" : String(defs[key]);
        const value = saved[key] != null ? String(saved[key]) : fallback;
        const label = LABELS[key] || key;
        const labelHtml = `<span class="token-label">${esc(label)}<em>${esc(key)}</em></span>`;
        if (COLOR_KEY.test(key)) {
          return `
            <div class="token-field token-color">
              ${labelHtml}
              <div class="token-row">
                <input type="color" data-color-for="${esc(key)}" value="${esc(hexForPicker(value))}" />
                <input type="text" data-token="${esc(key)}" value="${esc(value)}" spellcheck="false" />
              </div>
            </div>`;
        }
        return `
          <div class="token-field">
            ${labelHtml}
            <input type="text" data-token="${esc(key)}" value="${esc(value)}" spellcheck="false" />
          </div>`;
      })
      .join("");
  }

  function colorSync(event) {
    const target = event.target;
    if (!target || !target.matches("input")) return;
    if (target.dataset.colorFor) {
      const text = $("tokenFields").querySelector(`input[data-token="${target.dataset.colorFor}"]`);
      if (text) text.value = target.value;
    } else if (target.dataset.token && COLOR_KEY.test(target.dataset.token) && HEX_RE.test(target.value.trim())) {
      const picker = $("tokenFields").querySelector(`input[data-color-for="${target.dataset.token}"]`);
      if (picker) picker.value = hexForPicker(target.value);
    }
    state.localDirty = true;
    applyPreview();
  }

  // Only values that differ from the theme's own theme.json are stored, so a
  // later change to the theme defaults still reaches stores that never changed it.
  function currentOverrides() {
    const defs = themeDefaults();
    const tokens = {};
    $("tokenFields")
      .querySelectorAll("input[data-token]")
      .forEach((input) => {
        const key = input.dataset.token;
        const value = input.value.trim();
        if (!value) return;
        if (defs[key] != null && String(defs[key]).trim() === value) return;
        tokens[key] = value;
      });
    return tokens;
  }

  /* ---------------- live preview ---------------- */
  function applyPreview() {
    const el = $("apPreview");
    if (!el) return;
    const tokens = { ...themeDefaults(), ...currentOverrides() };
    const set = (name, value) => value && el.style.setProperty(name, value);
    set("--pv-primary", tokens.colorPrimary);
    set("--pv-primary-dark", tokens.colorPrimaryDark || tokens.colorPrimary);
    set("--pv-accent", tokens.colorAccent || tokens.colorPrimary);
    set("--pv-announce-bg", tokens.colorAnnouncementBg);
    set("--pv-announce-text", tokens.colorAnnouncementText || "#ffffff");
    set("--pv-bg", tokens.colorBg);
    set("--pv-surface", tokens.colorSurface || "#ffffff");
    set("--pv-ink", tokens.colorInk);
    set("--pv-muted", tokens.colorMuted);
    set("--pv-line", tokens.colorLine);
    set("--pv-search-bg", tokens.searchFieldBg || tokens.colorSurface);
    set("--pv-search-radius", tokens.searchFieldRadius || tokens.radiusControl);
    set("--pv-search-icon", tokens.searchFieldIconColor || tokens.colorPrimary);
    set("--pv-search-icon-bg", tokens.searchFieldIconBg || tokens.colorBg);
    set("--pv-search-ph", tokens.searchFieldPlaceholder || tokens.colorMuted);
    set("--pv-image-icon", tokens.imageSearchIconColor || tokens.colorPrimary);
    set("--pv-image-bg", tokens.imageSearchBg || tokens.colorSurface);
    set("--pv-account-icon", tokens.accountIconColor || "#ffffff");
    set("--pv-account-text", tokens.accountTextColor || "#ffffff");
    set("--pv-account-bg", tokens.accountBg || "transparent");
    set("--pv-wish-icon", tokens.wishIconColor || "#ffffff");
    set("--pv-wish-text", tokens.wishTextColor || "#ffffff");
    set("--pv-wish-bg", tokens.wishBg || "transparent");
    set("--pv-cart-icon", tokens.cartIconColor || "#ffffff");
    set("--pv-cart-text", tokens.cartTextColor || "#ffffff");
    set("--pv-cart-bg", tokens.cartBg || "transparent");
    set("--pv-radius", tokens.radiusCard);
    set("--pv-radius-control", tokens.radiusControl);
    set("--pv-font", tokens.fontBody);
    set("--pv-heading", tokens.fontHeading || tokens.fontBody);
    set("--pv-shadow", tokens.cardShadow);
    el.style.fontFamily = "var(--pv-font)";
  }

  /* ---------------- revisions ---------------- */
  function renderRevisions() {
    const list = $("apRevisionList");
    if (!state.revisions.length) {
      list.innerHTML = '<li class="ap-empty">এখনো কোনো পাবলিশ হয়নি।</li>';
      return;
    }
    list.innerHTML = state.revisions
      .map(
        (row) => `
        <li>
          <div>
            <b>${esc(row.label)}</b>
            <span>${esc(formatDate(row.publishedAt))}${row.publishedBy ? " · " + esc(row.publishedBy) : ""}</span>
          </div>
          <button type="button" class="btn-ghost" data-restore="${esc(row.id)}">Restore</button>
        </li>`
      )
      .join("");

    list.querySelectorAll("[data-restore]").forEach((btn) => {
      btn.addEventListener("click", () => restore(btn.dataset.restore));
    });
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  /* ---------------- actions ---------------- */
  async function saveDraft() {
    const { res, data } = await api("/draft", {
      method: "PUT",
      body: JSON.stringify({ theme: state.theme, tokens: currentOverrides() }),
    });
    if (!res.ok) {
      setStatus(data.message || "Draft save হলো না।", "error");
      return false;
    }
    state.draft = data.draft;
    state.localDirty = false;
    setStatus("Draft save হয়েছে। Publish করলে দোকানে দেখা যাবে।", "ok");
    return true;
  }

  async function publish() {
    if (!window.confirm("এই ড্রাফট এখনই দোকানে লাইভ হবে। পাবলিশ করবেন?")) return;
    if (state.localDirty && !(await saveDraft())) return;
    const { res, data } = await api("/publish", { method: "POST" });
    if (!res.ok) {
      setStatus(data.message || "Publish হলো না।", "error");
      return;
    }
    await load();
    setStatus("Publish হয়েছে — এখন দোকানে এই থিম দেখা যাবে।", "ok");
  }

  async function resetDraft() {
    if (!window.confirm("ড্রাফট published থিমে ফিরিয়ে নেবেন?")) return;
    const { res, data } = await api("/draft/reset", { method: "POST" });
    if (!res.ok) {
      setStatus(data.message || "Reset হলো না।", "error");
      return;
    }
    state.draft = data.draft;
    state.theme = data.draft.theme;
    state.localDirty = false;
    renderThemes();
    renderTokens();
    applyPreview();
    setStatus("ড্রাফট published থিমে ফেরানো হয়েছে।", "ok");
  }

  async function preview() {
    if (state.localDirty && !(await saveDraft())) return;
    const { res, data } = await api("/preview", { method: "POST" });
    if (!res.ok) {
      setStatus(data.message || "Preview খোলা গেল না।", "error");
      return;
    }
    window.open(data.url, "_blank", "noopener");
    setStatus(`প্রিভিউ নতুন ট্যাবে খোলা হয়েছে (${data.minutes} মিনিটের জন্য)।`, "ok");
  }

  async function restore(id) {
    if (!window.confirm("এই revision টি ড্রাফটে ফিরিয়ে আনবেন? Publish না করা পর্যন্ত দোকানে বদলাবে না।")) return;
    const { res, data } = await api(`/revisions/${encodeURIComponent(id)}/restore`, { method: "POST" });
    if (!res.ok) {
      setStatus(data.message || "Restore হলো না।", "error");
      return;
    }
    state.draft = data.draft;
    state.theme = data.draft.theme;
    state.localDirty = true;
    renderThemes();
    renderTokens();
    applyPreview();
    setStatus("Revision ড্রাফটে এসেছে — দেখে নিয়ে Publish করুন।", "warn");
  }

  /* ---------------- boot ---------------- */
  async function load() {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setStatus("Appearance দেখতে আগে লগইন করুন।", "warn");
      return;
    }
    const { res, data } = await api("");
    if (res.status === 401) {
      setStatus("Session শেষ — আবার লগইন করুন।", "error");
      return;
    }
    if (!res.ok) {
      setStatus(data.message || "Appearance লোড হলো না।", "error");
      return;
    }
    state.themes = data.themes || [];
    state.draft = data.draft;
    state.published = data.published;
    state.revisions = data.revisions || [];
    state.theme = data.draft.theme;
    state.localDirty = false;

    renderThemes();
    renderTokens();
    renderRevisions();
    applyPreview();

    if (data.dirty) {
      setStatus("সেভ করা ড্রাফট এখনো পাবলিশ হয়নি।", "warn");
    } else {
      setStatus(`লাইভ থিম: ${data.published.label}`, "");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("appearance")) return;
    $("apSaveBtn").addEventListener("click", saveDraft);
    $("apPublishBtn").addEventListener("click", publish);
    $("apResetBtn").addEventListener("click", resetDraft);
    $("apPreviewBtn").addEventListener("click", preview);
    $("tokenFields").addEventListener("input", colorSync);
    load();
  });
})();
