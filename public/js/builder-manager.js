/* ==========================================================================
   Product builder admin — templates, slots, rules, sandbox, saved builds.
   Exposes window.builderPage = { open } for dashboard.js.
   ========================================================================== */
(function () {
  "use strict";

  const ROOT_ID = "builderRoot";
  const RULE_TYPES = [
    ["equals", "must equal"],
    ["in", "must be one of"],
    ["set-membership", "must be supported by"],
    ["includes", "must include"],
    ["lte", "must be ≤"],
    ["gte", "must be ≥"],
    ["sum-lte", "sum must be ≤"],
  ];
  const ICONS = {
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
    builds: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/><circle cx="18" cy="18" r="2"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h8"/></svg>',
  };

  const state = {
    view: "list",
    templates: [],
    meta: null,
    editor: null,
    filterSlot: null,
    picker: null,
    products: null,
    tester: null,
    builds: null,
    analytics: null,
    storeUrl: "",
    appearance: null,
    query: "",
    loading: false,
  };

  let sandboxTimer = null;

  const $ = (id) => document.getElementById(id);

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function money(value) {
    return "৳ " + Number(value || 0).toLocaleString("en-IN");
  }

  function dateStr(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function notify(message, type) {
    if (typeof window.toast === "function") window.toast(message, type === "err" ? "err" : "ok");
    else console.log(message);
  }

  async function api(method, url, body) {
    const res = await window.ApiSession.request(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const safe = res || window.ApiSession.cancelled();
    const text = await safe.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!safe.ok) {
      const err = new Error((data && data.message) || "Request fail");
      err.data = data;
      throw err;
    }
    return data;
  }

  /* ---------------- data ---------------- */

  async function loadTemplates() {
    const data = await api("GET", "/api/builder/templates");
    state.templates = (data && data.templates) || [];
    return state.templates;
  }

  async function loadMeta() {
    if (state.meta) return state.meta;
    state.meta = await api("GET", "/api/builder/templates/meta");
    return state.meta;
  }

  async function loadStoreUrl() {
    if (state.storeUrl) return state.storeUrl;
    try {
      const store = await api("GET", "/api/stores/current");
      state.storeUrl = String((store && store.storefrontUrl) || "").replace(/\/$/, "");
    } catch {
      state.storeUrl = "";
    }
    return state.storeUrl;
  }

  // the builder renders only on a theme that opts into the module (Tech Store)
  async function loadAppearance() {
    if (state.appearance) return state.appearance;
    try {
      const data = await api("GET", "/api/appearance");
      state.appearance = (data && data.published) || null;
    } catch {
      state.appearance = null;
    }
    return state.appearance;
  }

  async function loadProducts() {
    if (state.products) return state.products;
    const data = await api("GET", "/api/products?limit=1000");
    state.products = Array.isArray(data) ? data : (data && data.products) || [];
    return state.products;
  }

  async function open() {
    state.view = "list";
    state.editor = null;
    state.tester = null;
    const root = $(ROOT_ID);
    if (root) root.innerHTML = '<div class="bld-empty">Loading…</div>';
    try {
      await Promise.all([loadTemplates(), loadStoreUrl(), loadAppearance()]);
      render();
    } catch (err) {
      if (root) root.innerHTML = `<div class="bld-empty">${esc(err.message)}</div>`;
    }
  }

  function normalizeEditor(template) {
    const rows = template || {};
    return {
      id: rows.id || rows._id || null,
      name: rows.name || "",
      slug: rows.slug || "",
      description: rows.description || "",
      status: rows.status || "draft",
      groups: (rows.groups || []).map((group, index) => ({
        key: group.key || "",
        name: group.name || "",
        nameBn: group.nameBn || "",
        sortOrder: Number(group.sortOrder) || index,
      })),
      slots: (rows.slots || []).map((slot, index) => ({
        key: slot.key || "",
        label: slot.label || "",
        labelBn: slot.labelBn || "",
        group: slot.group || "",
        required: !!slot.required,
        maxQty: Number(slot.maxQty) || 1,
        sortOrder: slot.sortOrder === undefined ? index : Number(slot.sortOrder) || 0,
        hint: slot.hint || "",
        hintBn: slot.hintBn || "",
        filter: {
          categories: ((slot.filter && slot.filter.categories) || []).map(String),
          brands: ((slot.filter && slot.filter.brands) || []).map(String),
          tags: ((slot.filter && slot.filter.tags) || []).map(String),
          products: ((slot.filter && slot.filter.products) || []).map(String),
        },
      })),
      rules: (rows.rules || []).map((rule) => ({
        key: rule.key || "",
        type: rule.type || "equals",
        level: rule.level || "block",
        message: rule.message || "",
        messageBn: rule.messageBn || "",
        left: { slot: (rule.left && rule.left.slot) || "", spec: (rule.left && rule.left.spec) || "" },
        right: rule.right && rule.right.slot ? { slot: rule.right.slot, spec: rule.right.spec || "" } : null,
        value: rule.value === null || rule.value === undefined ? undefined : rule.value,
        terms: (rule.terms || []).map((term) => ({
          slot: term.slot,
          spec: term.spec,
          multiplier: Number(term.multiplier) || 1,
        })),
        limit: rule.limit === null || rule.limit === undefined ? "" : rule.limit,
      })),
      settings: {
        showTotal: !(rows.settings && rows.settings.showTotal === false),
        stickyBar: !(rows.settings && rows.settings.stickyBar === false),
      },
    };
  }

  async function openEditor(id) {
    try {
      const [data] = await Promise.all([api("GET", "/api/builder/templates/" + id), loadMeta()]);
      state.editor = normalizeEditor(data.template);
      state.view = "edit";
      state.filterSlot = null;
      state.picker = null;
      state.tester = null;
      render();
    } catch (err) {
      notify(err.message, "err");
    }
  }

  function newTemplate() {
    state.editor = normalizeEditor({
      name: "",
      slug: "",
      status: "draft",
      slots: [{ key: "cpu", label: "CPU", maxQty: 1, required: true }],
      rules: [],
    });
    state.view = "edit";
    state.filterSlot = null;
    state.tester = null;
    loadMeta().catch(() => {});
    render();
    const name = $("bldName");
    if (name) name.focus();
  }

  async function createStarter() {
    try {
      const data = await api("POST", "/api/builder/templates/starter");
      notify("PC Builder template তৈরি হয়েছে");
      await loadTemplates();
      await openEditor(data.template.id);
    } catch (err) {
      notify(err.message, "err");
    }
  }

  async function saveEditor() {
    const editor = state.editor;
    if (!editor) return;
    if (!String(editor.name || "").trim()) return notify("Template name lagbe", "err");
    if (!String(editor.slug || "").trim()) return notify("Slug lagbe", "err");
    if (!editor.slots.length) return notify("Kam pokkhe ekta slot lagbe", "err");

    const payload = {
      name: editor.name.trim(),
      slug: editor.slug.trim(),
      description: editor.description || "",
      status: editor.status === "published" ? "published" : "draft",
      groups: editor.groups.map((group, index) => ({ ...group, sortOrder: index })),
      slots: editor.slots.map((slot, index) => ({
        key: slot.key,
        label: slot.label,
        labelBn: slot.labelBn,
        group: slot.group,
        required: !!slot.required,
        maxQty: slot.maxQty,
        sortOrder: index,
        hint: slot.hint,
        hintBn: slot.hintBn,
        filter: slot.filter,
      })),
      rules: rulesPayload(),
      settings: editor.settings,
    };

    const btn = $("bldSave");
    if (btn) btn.disabled = true;
    try {
      const data = editor.id
        ? await api("PUT", "/api/builder/templates/" + editor.id, payload)
        : await api("POST", "/api/builder/templates", payload);
      state.editor = normalizeEditor(data.template);
      notify("Template saved");
      render();
      loadTemplates().catch(() => {});
    } catch (err) {
      notify(err.message, "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function ruleValue(rule) {
    if (rule.type === "in" || rule.type === "includes") {
      if (Array.isArray(rule.value)) return rule.value;
      return String(rule.value == null ? "" : rule.value)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
    }
    if (rule.type === "lte" || rule.type === "gte") {
      const raw = String(rule.value == null ? "" : rule.value).trim();
      return raw === "" ? undefined : Number(raw);
    }
    return String(rule.value == null ? "" : rule.value).trim();
  }

  function rulesPayload() {
    return state.editor.rules.map((rule, index) => {
      const out = {
        key: String(rule.key || "").trim() || `rule-${index + 1}`,
        type: rule.type,
        level: rule.level === "warn" ? "warn" : "block",
        message: String(rule.message || "").trim(),
        messageBn: String(rule.messageBn || "").trim(),
      };
      if (rule.type === "sum-lte") {
        out.terms = (rule.terms || []).map((term) => ({
          slot: term.slot,
          spec: String(term.spec || "").trim(),
          multiplier: Number(term.multiplier) || 1,
        }));
        out.limit = String(rule.limit == null ? "" : rule.limit).trim() === "" ? undefined : Number(rule.limit);
      } else {
        out.left = { slot: rule.left.slot, spec: String(rule.left.spec || "").trim() };
        if (rule.value !== undefined) out.value = ruleValue(rule);
        else if (rule.right) out.right = { slot: rule.right.slot, spec: String(rule.right.spec || "").trim() };
      }
      return out;
    });
  }

  async function deleteTemplate(template) {
    const ok = typeof window.confirmDialog === "function"
      ? await window.confirmDialog({
          title: "Delete template?",
          text: `"${template.name}" এবং এর সব saved build muche jabe.`,
          okLabel: "Delete",
        })
      : window.confirm(`Delete "${template.name}"?`);
    if (!ok) return;
    try {
      await api("DELETE", "/api/builder/templates/" + template.id);
      notify("Template deleted");
      await loadTemplates();
      render();
    } catch (err) {
      notify(err.message, "err");
    }
  }

  async function openBuilds(template) {
    try {
      const data = await api("GET", `/api/builder/templates/${template.id}/builds?limit=100`);
      state.builds = { title: template.name, id: template.id, rows: data.builds || [], total: data.total || 0 };
      state.view = "builds";
      render();
    } catch (err) {
      notify(err.message, "err");
    }
  }

  async function openAnalytics(template) {
    try {
      const data = await api("GET", `/api/builder/templates/${template.id}/analytics`);
      state.analytics = { title: template.name, ...data.analytics };
      state.view = "analytics";
      render();
    } catch (err) {
      notify(err.message, "err");
    }
  }

  /* ---------------- list ---------------- */

  function themeNotice() {
    const theme = state.appearance;
    if (!theme) return "";
    if (Array.isArray(theme.modules) && theme.modules.includes("builder")) return "";
    return `<div class="bld-note">
      <strong>Theme support নেই।</strong>
      PC Builder মডিউলটি শুধু <b>Tech Store</b> থিমের সাথে কাজ করে। এখন সক্রিয় থিম:
      <b>${esc(theme.label || theme.theme || "—")}</b>। Appearance থেকে Tech Store বেছে নিলে storefront-এ builder দেখা যাবে।
    </div>`;
  }

  function renderList() {
    const q = state.query.trim().toLowerCase();
    const rows = state.templates.filter((template) => {
      if (!q) return true;
      return (
        String(template.name || "").toLowerCase().includes(q) ||
        String(template.slug || "").toLowerCase().includes(q)
      );
    });

    if (!state.templates.length) {
      return `
        <div class="bld-wrap">
          ${themeNotice()}
          <div class="bld-card bld-empty">
            <strong>এখনো কোনো builder template নেই</strong>
            PC Builder starter দিয়ে শুরু করুন, অথবা নিজের মতো নতুন template বানান।
            <div class="bld-toolbar" style="justify-content:center;margin-top:14px;">
              <button class="btn-gold" type="button" data-action="starter">Create PC Builder starter</button>
              <button class="btn-ghost" type="button" data-action="new">New template</button>
            </div>
          </div>
        </div>`;
    }

    return `
      <div class="bld-wrap">
        ${themeNotice()}
        <div class="bld-card">
          <div class="bld-toolbar">
            <input class="bld-input bld-search" id="bldSearch" type="search" placeholder="Search template..." value="${esc(state.query)}" aria-label="Search templates" />
            <span class="bld-count">${rows.length} template${rows.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div class="bld-card" style="padding:0;overflow:hidden;">
          <div class="bld-table-wrap">
            <table class="bld-table">
              <thead><tr>
                <th>Template</th><th>Status</th><th>Slots</th><th>Rules</th><th>Builds</th><th>Updated</th><th></th>
              </tr></thead>
              <tbody>
                ${rows
                  .map(
                    (template) => `
                  <tr>
                    <td>
                      <button class="bld-name-btn" type="button" data-action="edit" data-id="${esc(template.id)}">${esc(template.name)}</button>
                      <div class="bld-slug">/${esc(template.slug)}</div>
                    </td>
                    <td><span class="bld-pill ${template.status}">${esc(template.status)}</span></td>
                    <td>${template.slotCount}</td>
                    <td>${template.ruleCount}</td>
                    <td>${template.builds}</td>
                    <td>${esc(dateStr(template.updatedAt))}</td>
                    <td class="bld-actions">
                      <button class="icon-btn edit" type="button" data-action="edit" data-id="${esc(template.id)}" title="Edit template">${ICONS.edit}</button>
                      <button class="icon-btn" type="button" data-action="builds" data-id="${esc(template.id)}" title="Saved builds">${ICONS.builds}</button>
                      <button class="icon-btn" type="button" data-action="analytics" data-id="${esc(template.id)}" title="Analytics">${ICONS.chart}</button>
                      <button class="icon-btn del" type="button" data-action="delete" data-id="${esc(template.id)}" title="Delete">${ICONS.trash}</button>
                    </td>
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;
  }

  /* ---------------- editor ---------------- */

  function slotOptions(selected) {
    return state.editor.slots
      .map(
        (slot) =>
          `<option value="${esc(slot.key)}" ${String(selected || "") === String(slot.key) ? "selected" : ""}>${esc(slot.label || slot.key)}</option>`
      )
      .join("");
  }

  function groupOptions(selected) {
    const head = `<option value="">— No group —</option>`;
    return (
      head +
      state.editor.groups
        .map(
          (group) =>
            `<option value="${esc(group.key)}" ${String(selected || "") === String(group.key) ? "selected" : ""}>${esc(group.name || group.key)}</option>`
        )
        .join("")
    );
  }

  function categoryLabels(ids) {
    const byId = new Map(((state.meta && state.meta.categories) || []).map((cat) => [cat.id, cat.name]));
    return ids.map((id) => byId.get(id) || id.slice(-6));
  }

  function renderFilterPanel(slot, index) {
    const multi = (kind, items, selected) => `
      <label>${kind === "categories" ? "Categories" : kind === "brands" ? "Brands" : "Tags"}
        <select multiple size="5" data-slot="${index}" data-filter="${kind}">
          ${items
            .map(
              (item) =>
                `<option value="${esc(item.id)}" ${selected.includes(String(item.id)) ? "selected" : ""}>${esc(item.name)}</option>`
            )
            .join("")}
        </select>
      </label>`;
    const meta = state.meta || { categories: [], brands: [], tags: [] };
    const curated = slot.filter.products.length;
    const chips = curated
      ? `<div class="bld-chips">${slot.filter.products
          .map((id) => {
            const product = (state.products || []).find((row) => String(row._id) === id);
            const title = product ? product.title || product.name || id : id;
            return `<span class="bld-chip">${esc(title)}<button type="button" data-action="unpick" data-id="${esc(id)}" aria-label="Remove">&times;</button></span>`;
          })
          .join("")}</div>`
      : '<span class="bld-hint">No curated products — the slot shows everything that matches the filters above.</span>';

    return `
      <div class="bld-filters">
        <div class="bld-filters-grid">
          ${multi("categories", meta.categories || [], slot.filter.categories)}
          ${multi("brands", meta.brands || [], slot.filter.brands)}
          ${multi("tags", meta.tags || [], slot.filter.tags)}
          <label>Hint (English)
            <input class="bld-input" data-slot="${index}" data-field="hint" value="${esc(slot.hint)}" placeholder="e.g. Match the CPU socket" />
          </label>
          <label>Hint (বাংলা)
            <input class="bld-input" data-slot="${index}" data-field="hintBn" value="${esc(slot.hintBn)}" placeholder="যেমন: CPU সকেট মিলিয়ে নিন" />
          </label>
        </div>
        <div class="bld-filters-actions">
          <span class="bld-hint" style="margin:0">Curated products: ${curated ? curated + " selected" : "none"}</span>
          <button class="btn-ghost" type="button" data-action="pick-products">Pick products…</button>
          <button class="btn-ghost" type="button" data-action="close-filters">Done</button>
        </div>
        ${chips}
      </div>`;
  }

  function renderSlotRows() {
    return state.editor.slots
      .map(
        (slot, index) => `
        <tr data-slot-key="${esc(slot.key)}">
          <td class="bld-drag" title="Drag to reorder">⋮⋮</td>
          <td><input data-slot="${index}" data-field="key" value="${esc(slot.key)}" placeholder="cpu" aria-label="Slot key" /></td>
          <td class="bld-slot-label"><input data-slot="${index}" data-field="label" value="${esc(slot.label)}" placeholder="Processor" aria-label="Slot label" /></td>
          <td class="bld-slot-bn"><input data-slot="${index}" data-field="labelBn" value="${esc(slot.labelBn)}" placeholder="প্রসেসর" aria-label="Slot label Bengali" /></td>
          <td class="bld-group-select"><select data-slot="${index}" data-field="group">${groupOptions(slot.group)}</select></td>
          <td><label class="bld-check"><input type="checkbox" data-slot="${index}" data-field="required" ${slot.required ? "checked" : ""} /> Required</label></td>
          <td><input class="bld-mini" type="number" min="1" max="20" data-slot="${index}" data-field="maxQty" value="${slot.maxQty}" aria-label="Max quantity" /></td>
          <td>
            <button class="btn-ghost" type="button" data-action="filters" data-idx="${index}" style="padding:6px 10px;">
              Filters${slot.filter.categories.length + slot.filter.brands.length + slot.filter.tags.length + slot.filter.products.length ? " •" : ""}
            </button>
          </td>
          <td class="bld-actions">
            <button class="icon-btn del" type="button" data-action="del-slot" data-idx="${index}" title="Remove slot">${ICONS.trash}</button>
          </td>
        </tr>`
      )
      .join("");
  }

  function renderGroups() {
    return `
      <div class="bld-table-wrap">
        <table class="bld-table">
          <thead><tr><th>Key</th><th>Name</th><th>Name (বাংলা)</th><th></th></tr></thead>
          <tbody>
            ${state.editor.groups
              .map(
                (group, index) => `
              <tr>
                <td><input data-group="${index}" data-field="key" value="${esc(group.key)}" placeholder="core" /></td>
                <td><input data-group="${index}" data-field="name" value="${esc(group.name)}" placeholder="Core" /></td>
                <td><input data-group="${index}" data-field="nameBn" value="${esc(group.nameBn)}" placeholder="মূল অংশ" /></td>
                <td class="bld-actions"><button class="icon-btn del" type="button" data-action="del-group" data-idx="${index}" title="Remove group">${ICONS.trash}</button></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <button class="btn-ghost" type="button" data-action="add-group" style="margin-top:10px;">+ Add group</button>`;
  }

  function valueText(rule) {
    if (rule.value === undefined) return "";
    return Array.isArray(rule.value) ? rule.value.join(", ") : String(rule.value);
  }

  function specList() {
    const specs = (state.meta && state.meta.specs) || [];
    if (!specs.length) return "";
    return `<datalist id="bldSpecList">${specs
      .map(
        (spec) =>
          `<option value="${esc(spec.key)}">${esc(spec.label)}${spec.categoryName ? " · " + esc(spec.categoryName) : ""}</option>`
      )
      .join("")}</datalist>`;
  }

  function renderRule(rule, index) {
    const targetKind = rule.value !== undefined ? "value" : "spec";
    const isSum = rule.type === "sum-lte";
    const listy = rule.type === "in" || rule.type === "includes";

    const target = isSum
      ? `<div style="display:grid;gap:8px;">
          ${(rule.terms || [])
            .map(
              (term, termIndex) => `
            <div class="bld-term">
              <span class="bld-total">term ${termIndex + 1}</span>
              <select data-rule="${index}" data-term="${termIndex}" data-field="term.slot">${slotOptions(term.slot)}</select>
              <input class="bld-term-spec" data-rule="${index}" data-term="${termIndex}" data-field="term.spec" list="bldSpecList" value="${esc(term.spec)}" placeholder="tdp" />
              <span class="bld-total">×</span>
              <input class="bld-term-mult" type="number" step="0.1" min="0.1" max="20" data-rule="${index}" data-term="${termIndex}" data-field="term.multiplier" value="${term.multiplier}" />
              <button class="icon-btn del" type="button" data-action="del-term" data-idx="${index}" data-term="${termIndex}" title="Remove term">${ICONS.trash}</button>
            </div>`
            )
            .join("")}
          <div class="bld-term">
            <button class="btn-ghost" type="button" data-action="add-term" data-idx="${index}" style="padding:6px 10px;">+ term</button>
            <span class="bld-total">limit</span>
            <input class="bld-term-mult" type="number" min="0" step="1" data-rule="${index}" data-field="limit" value="${esc(rule.limit)}" placeholder="650" />
          </div>
        </div>`
      : `
        <div class="bld-rule-sentence">
          <select data-rule="${index}" data-field="targetKind">
            <option value="spec" ${targetKind === "spec" ? "selected" : ""}>another part's spec</option>
            <option value="value" ${targetKind === "value" ? "selected" : ""}>a fixed ${listy ? "list" : "value"}</option>
          </select>
          ${
            targetKind === "spec"
              ? `<select data-rule="${index}" data-field="right.slot">${slotOptions(rule.right ? rule.right.slot : "")}</select>
                 <input class="bld-spec" data-rule="${index}" data-field="right.spec" list="bldSpecList" value="${esc(rule.right ? rule.right.spec : "")}" placeholder="sockets" />`
              : `<input style="min-width:220px;" data-rule="${index}" data-field="value" value="${esc(valueText(rule))}" placeholder="${listy ? "am4, am5" : "am5"}" />`
          }
        </div>`;

    return `
      <div class="bld-rule">
        <div class="bld-rule-top">
          <span class="bld-total">Rule ${index + 1}</span>
          <select data-rule="${index}" data-field="level">
            <option value="block" ${rule.level === "block" ? "selected" : ""}>Block</option>
            <option value="warn" ${rule.level === "warn" ? "selected" : ""}>Warn</option>
          </select>
          <span class="bld-total">IF</span>
          <select data-rule="${index}" data-field="left.slot">${slotOptions(rule.left.slot)}</select>
          <input class="bld-spec" data-rule="${index}" data-field="left.spec" list="bldSpecList" value="${esc(rule.left.spec)}" placeholder="socket" />
          <select data-rule="${index}" data-field="type">
            ${RULE_TYPES.map(
              ([value, label]) => `<option value="${value}" ${rule.type === value ? "selected" : ""}>${label}</option>`
            ).join("")}
          </select>
        </div>
        ${target}
        <div class="bld-rule-msg">
          <input data-rule="${index}" data-field="messageBn" value="${esc(rule.messageBn)}" placeholder="বাংলা মেসেজ" />
          <input data-rule="${index}" data-field="message" value="${esc(rule.message)}" placeholder="English message" />
        </div>
        <div class="bld-rule-foot">
          <button class="icon-btn del" type="button" data-action="del-rule" data-idx="${index}" title="Remove rule">${ICONS.trash}</button>
        </div>
      </div>`;
  }

  function renderRules() {
    if (!state.editor.rules.length) {
      return '<p class="bld-hint">No rules yet. Rules block or warn when two chosen parts do not fit together.</p>';
    }
    return state.editor.rules.map(renderRule).join("");
  }

  function renderTester() {
    if (!state.editor.id) {
      return '<p class="bld-hint">Save the template once to unlock the sandbox.</p>';
    }
    if (!state.tester) {
      return '<button class="btn-ghost" type="button" data-action="open-tester">Load parts &amp; test</button>';
    }
    if (state.tester.loading) return '<p class="bld-hint">Loading parts…</p>';
    const slots = state.editor.slots;
    return `
      <div class="bld-tester-grid">
        ${slots
          .map((slot) => {
            const items = state.tester.candidates[slot.key] || [];
            const selected = state.tester.selections[slot.key] || "";
            return `<label class="bld-field">${esc(slot.label || slot.key)}
              <select data-tester="${esc(slot.key)}">
                <option value="">— none —</option>
                ${items
                  .map(
                    (item) =>
                      `<option value="${esc(item.id)}" ${selected === item.id ? "selected" : ""}>${item.compatible ? "" : "⚠ "}${esc(item.title)}${item.stock > 0 ? "" : " (out of stock)"}</option>`
                  )
                  .join("")}
              </select>
            </label>`;
          })
          .join("")}
      </div>
      <div class="bld-tester-result" id="bldTesterResult">${renderTesterResult()}</div>`;
  }

  function renderTesterResult() {
    const result = state.tester && state.tester.result;
    if (!result) return "";
    const parts = [];
    if (result.ok) {
      parts.push('<div class="bld-ok">✓ কোনো বাধা নেই — এই কম্বিনেশন ঠিক আছে।</div>');
    }
    (result.violations || []).forEach((violation) => {
      parts.push(`
        <div class="bld-vio ${violation.level}">
          ${esc(violation.messageBn || violation.message)}
          <small>${esc(violation.message || "")} · ${esc(violation.rule)} · ${violation.level}</small>
        </div>`);
    });
    if (result.totals) {
      parts.push(`<div class="bld-total">${result.totals.count} item${result.totals.count === 1 ? "" : "s"} · ${money(result.totals.subtotal)}</div>`);
    }
    return parts.join("");
  }

  function renderEditor() {
    const editor = state.editor;
    const filterIndex = state.filterSlot;
    const filterSlot = filterIndex !== null && editor.slots[filterIndex] ? editor.slots[filterIndex] : null;

    return `
      <div class="bld-wrap">
        ${specList()}
        <div class="bld-card">
          <div class="bld-head">
            <button class="bld-back" type="button" data-action="back">← Templates</button>
            <h2>${esc(editor.name || "New template")}</h2>
            <span class="bld-spacer"></span>
            <select class="bld-input" id="bldStatus" style="width:auto;" aria-label="Template status">
              <option value="draft" ${editor.status === "draft" ? "selected" : ""}>Draft</option>
              <option value="published" ${editor.status === "published" ? "selected" : ""}>Published</option>
            </select>
            <button class="btn-gold" type="button" id="bldSave" data-action="save">Save</button>
          </div>
        </div>

        <div class="bld-card">
          <h3>Basics</h3>
          <p class="bld-sub">শুধু published template স্টোরফ্রন্টে দেখা যায়।</p>
          <div class="bld-grid">
            <label>Name<input id="bldName" class="bld-input" data-basic="name" value="${esc(editor.name)}" placeholder="PC Builder" /></label>
            <label>Slug<input id="bldSlug" class="bld-input" data-basic="slug" value="${esc(editor.slug)}" placeholder="pc-builder" /></label>
            <label class="bld-span2">Description<textarea data-basic="description" placeholder="নিজের পিসি বানান...">${esc(editor.description)}</textarea></label>
          </div>
        </div>

        <div class="bld-card">
          <h3>Groups</h3>
          <p class="bld-sub">Slots-দের ভাগ করুন — Core, Cooling, Peripherals ইত্যাদি।</p>
          ${renderGroups()}
        </div>

        <div class="bld-card">
          <h3>Slots</h3>
          <p class="bld-sub">প্রতিটি slot = একটা পার্টের জায়গা। Drag করে সাজান, তারপর Filters দিয়ে ঠিক করুন কোন পণ্য আসবে।</p>
          <div class="bld-table-wrap">
            <table class="bld-table">
              <thead><tr>
                <th></th><th>Key</th><th>Label</th><th>Label (বাংলা)</th><th>Group</th><th>Required</th><th>Max qty</th><th>Filters</th><th></th>
              </tr></thead>
              <tbody id="bldSlotBody">${renderSlotRows()}</tbody>
            </table>
          </div>
          <button class="btn-ghost" type="button" data-action="add-slot" style="margin-top:10px;">+ Add slot</button>
          ${filterSlot ? `<div style="margin-top:12px;"><div class="bld-total" style="margin-bottom:6px;">Filters — ${esc(filterSlot.label || filterSlot.key)}</div>${renderFilterPanel(filterSlot, filterIndex)}</div>` : ""}
        </div>

        <div class="bld-card">
          <h3>Compatibility rules</h3>
          <p class="bld-sub">"IF cpu.socket must be supported by motherboard.sockets" ধাঁচে নিয়ম লিখুন। Product-এ spec না থাকলে নিয়ম চুপচাপ বাদ যায়।</p>
          ${renderRules()}
          <button class="btn-ghost" type="button" data-action="add-rule" style="margin-top:4px;">+ Add rule</button>
        </div>

        <div class="bld-card">
          <h3>Sandbox</h3>
          <p class="bld-sub">Save করা template-এ পার্ট বেছে নিয়েই নিয়মগুলো পরীক্ষা করুন — স্টোরে কিছুই যায় না।</p>
          ${renderTester()}
        </div>

        ${state.picker ? renderPicker() : ""}
      </div>`;
  }

  function renderPicker() {
    const picker = state.picker;
    const slot = state.editor.slots.find((row) => row.key === picker.slotKey);
    if (!slot) return "";
    const q = picker.q.trim().toLowerCase();
    const rows = (state.products || []).filter((product) => {
      if (!q) return true;
      return String(product.title || product.name || "").toLowerCase().includes(q) ||
        String(product.sku || "").toLowerCase().includes(q);
    });
    return `
      <div class="bld-overlay" data-action="picker-overlay">
        <div class="bld-modal" role="dialog" aria-modal="true" aria-label="Pick products">
          <div class="bld-modal-head">
            <h3>Pick products — ${esc(slot.label || slot.key)}</h3>
            <span class="bld-spacer" style="flex:1"></span>
            <button class="icon-btn" type="button" data-action="close-picker" aria-label="Close">&times;</button>
          </div>
          <div class="bld-modal-body">
            <input class="bld-input" id="bldPickSearch" type="search" placeholder="Search product..." value="${esc(picker.q)}" />
            <div class="bld-pick-list">
              ${rows.length
                ? rows
                    .map(
                      (product) => `
                  <label class="bld-pick">
                    <input type="checkbox" data-pick-id="${esc(product._id)}" ${picker.selected.has(String(product._id)) ? "checked" : ""} />
                    <img src="${esc((product.images && product.images[0]) || "")}" alt="" />
                    <span>${esc(product.title || product.name || "(untitled)")}</span>
                    <small>${esc(money(product.salePrice || product.regularPrice || product.price || 0))}</small>
                  </label>`
                    )
                    .join("")
                : '<p class="bld-hint">No products found.</p>'}
            </div>
          </div>
          <div class="bld-modal-foot">
            <button class="btn-ghost" type="button" data-action="close-picker">Cancel</button>
            <button class="btn-gold" type="button" data-action="save-picker">Use selection</button>
          </div>
        </div>
      </div>`;
  }

  /* ---------------- builds + analytics ---------------- */

  function renderBuilds() {
    const data = state.builds;
    return `
      <div class="bld-wrap">
        <div class="bld-card">
          <div class="bld-head">
            <button class="bld-back" type="button" data-action="back">← Templates</button>
            <h2>Saved builds — ${esc(data.title)}</h2>
            <span class="bld-spacer"></span>
            <span class="bld-count">${data.total} total</span>
          </div>
        </div>
        <div class="bld-card" style="padding:0;overflow:hidden;">
          ${
            data.rows.length
              ? `<div class="bld-table-wrap"><table class="bld-table">
                  <thead><tr><th>Date</th><th>Name</th><th>Parts</th><th>Subtotal</th><th>Issues</th><th>Who</th><th>Share</th></tr></thead>
                  <tbody>${data.rows
                    .map(
                      (row) => `
                    <tr>
                      <td>${esc(dateStr(row.createdAt))}</td>
                      <td>${esc(row.name || "—")}</td>
                      <td>${row.items}</td>
                      <td>${esc(money(row.subtotal))}</td>
                      <td>${row.violations ? `<span class="bld-badge">${row.violations} block</span>` : "—"}</td>
                      <td>${row.guest ? "Guest" : "Customer"}</td>
                      <td>
                        <button class="icon-btn" type="button" data-action="copy" data-url="${esc(row.url)}" title="Copy share link">${ICONS.copy}</button>
                      </td>
                    </tr>`
                    )
                    .join("")}</tbody>
                </table></div>`
              : '<div class="bld-empty"><strong>No saved builds yet</strong>শপাররা সাইটে build সেভ করলে এখানে দেখা যাবে।</div>'
          }
        </div>
      </div>`;
  }

  function renderAnalytics() {
    const data = state.analytics;
    return `
      <div class="bld-wrap">
        <div class="bld-card">
          <div class="bld-head">
            <button class="bld-back" type="button" data-action="back">← Templates</button>
            <h2>Analytics — ${esc(data.title)}</h2>
          </div>
        </div>
        <div class="bld-card">
          <div class="bld-stats">
            <div class="bld-stat"><span>Total builds</span><strong>${data.totalBuilds}</strong></div>
            <div class="bld-stat"><span>Last 7 days</span><strong>${data.last7}</strong></div>
            <div class="bld-stat"><span>Last 30 days</span><strong>${data.last30}</strong></div>
            <div class="bld-stat"><span>Blocked builds</span><strong>${data.blockedBuilds}</strong></div>
            <div class="bld-stat"><span>Avg subtotal</span><strong>${esc(money(data.averageSubtotal))}</strong></div>
            <div class="bld-stat"><span>Build value</span><strong>${esc(money(data.potentialRevenue))}</strong></div>
            <div class="bld-stat"><span>Parts chosen</span><strong>${data.partsChosen || 0}</strong></div>
            <div class="bld-stat"><span>Abandoned builds</span><strong>${data.abandonedBuilds || 0}</strong></div>
            <div class="bld-stat"><span>Abandoned (30d)</span><strong>${data.abandoned30 || 0}</strong></div>
          </div>
        </div>
        <div class="bld-card">
          <h3>Most chosen parts</h3>
          ${data.topParts.length
            ? `<div class="bld-top-parts">${data.topParts
                .map(
                  (row) => `
                <div class="bld-top-part">
                  ${row.image ? `<img src="${esc(row.image)}" alt="" />` : '<img alt="" />'}
                  <div class="bld-top-meta">
                    <strong>${esc(row.title)}</strong>
                    <small>${esc(row.slot)} · ${row.count} build${row.count === 1 ? "" : "s"}</small>
                  </div>
                </div>`
                )
                .join("")}</div>`
            : '<p class="bld-hint">No parts chosen yet.</p>'}
        </div>
      </div>`;
  }

  /* ---------------- render root ---------------- */

  function render() {
    const root = $(ROOT_ID);
    if (!root) return;
    const starterBtn = $("builderStarterBtn");
    const newBtn = $("builderNewBtn");
    const onList = state.view === "list";
    if (starterBtn) starterBtn.hidden = !onList;
    if (newBtn) newBtn.hidden = !onList;
    if (state.view === "list") root.innerHTML = renderList();
    else if (state.view === "edit") root.innerHTML = renderEditor();
    else if (state.view === "builds") root.innerHTML = renderBuilds();
    else root.innerHTML = renderAnalytics();
    if (state.view === "edit") initSlotSortable();
  }

  /* ---------------- tester ---------------- */

  async function openTester() {
    const editor = state.editor;
    if (!editor || !editor.id) return;
    state.tester = { candidates: {}, selections: {}, result: null, loading: true };
    render();
    try {
      const slots = editor.slots;
      const lists = await Promise.all(
        slots.map((slot) =>
          api("POST", `/api/builder/templates/${editor.id}/slots/${slot.key}/products`, { limit: 100 })
            .then((data) => ({ key: slot.key, items: (data && data.items) || [] }))
            .catch(() => ({ key: slot.key, items: [] }))
        )
      );
      const candidates = {};
      lists.forEach((row) => { candidates[row.key] = row.items; });
      state.tester = { candidates, selections: state.tester.selections, result: null, loading: false };
      render();
      runSandbox();
    } catch (err) {
      state.tester = null;
      render();
      notify(err.message, "err");
    }
  }

  function scheduleSandbox() {
    clearTimeout(sandboxTimer);
    sandboxTimer = setTimeout(runSandbox, 400);
  }

  async function runSandbox() {
    const editor = state.editor;
    const tester = state.tester;
    if (!editor || !editor.id || !tester || tester.loading) return;
    const host = $("bldTesterResult");
    if (host) host.innerHTML = '<div class="bld-hint">Testing…</div>';
    try {
      const result = await api("POST", `/api/builder/templates/${editor.id}/sandbox`, {
        selections: tester.selections,
      });
      tester.result = result;
      const target = $("bldTesterResult");
      if (target) target.innerHTML = renderTesterResult();
    } catch (err) {
      notify(err.message, "err");
    }
  }

  /* ---------------- drag reorder ---------------- */

  function initSlotSortable() {
    const tbody = $("bldSlotBody");
    if (!tbody || !window.Sortable) return;
    window.Sortable.create(tbody, {
      handle: ".bld-drag",
      animation: 150,
      onEnd: () => {
        const keys = [...tbody.querySelectorAll("tr[data-slot-key]")].map((tr) => tr.dataset.slotKey);
        const byKey = new Map(state.editor.slots.map((slot) => [slot.key, slot]));
        state.editor.slots = keys.map((key) => byKey.get(key)).filter(Boolean);
        render();
      },
    });
  }

  /* ---------------- events ---------------- */

  function firstSlotKey() {
    return (state.editor.slots[0] && state.editor.slots[0].key) || "";
  }

  function applyRuleType(rule) {
    if (rule.type === "sum-lte") {
      rule.terms = rule.terms && rule.terms.length ? rule.terms : [{ slot: firstSlotKey(), spec: "", multiplier: 1 }];
      rule.limit = rule.limit === "" || rule.limit === undefined ? 650 : rule.limit;
      rule.value = undefined;
      rule.right = null;
    } else {
      rule.terms = [];
      rule.limit = "";
      rule.left = rule.left && rule.left.slot ? rule.left : { slot: firstSlotKey(), spec: "" };
      if (rule.value === undefined) {
        rule.right = rule.right && rule.right.slot ? rule.right : { slot: firstSlotKey(), spec: "" };
      }
    }
  }

  function renameSlotReferences(oldKey, newKey) {
    if (!oldKey || !newKey || oldKey === newKey) return;
    state.editor.rules.forEach((rule) => {
      if (rule.left && rule.left.slot === oldKey) rule.left.slot = newKey;
      if (rule.right && rule.right.slot === oldKey) rule.right.slot = newKey;
      (rule.terms || []).forEach((term) => {
        if (term.slot === oldKey) term.slot = newKey;
      });
    });
    if (state.tester) {
      if (state.tester.selections[oldKey] !== undefined) {
        state.tester.selections[newKey] = state.tester.selections[oldKey];
        delete state.tester.selections[oldKey];
      }
      if (state.tester.candidates[oldKey]) {
        state.tester.candidates[newKey] = state.tester.candidates[oldKey];
        delete state.tester.candidates[oldKey];
      }
    }
    if (state.filterSlot !== null) {
      const slot = state.editor.slots[state.filterSlot];
      if (slot && slot.key === newKey) {
        /* index-based panel stays on the same slot */
      }
    }
  }

  function handleBasic(el) {
    const field = el.dataset.basic;
    if (!state.editor || !field) return;
    state.editor[field] = el.value;
  }

  function handleSlotField(el) {
    const index = Number(el.dataset.slot);
    const field = el.dataset.field;
    const slot = state.editor && state.editor.slots[index];
    if (!slot || !field) return;
    if (field === "required") slot.required = el.checked;
    else if (field === "maxQty") slot.maxQty = Math.max(1, Math.min(20, Number(el.value) || 1));
    else if (field === "key") {
      const next = String(el.value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (next === slot.key) {
        el.value = next;
        return;
      }
      renameSlotReferences(slot.key, next);
      slot.key = next;
      el.value = next;
      // row dataset + rule slot selects carry the key, so rebuild after rename
      render();
    } else if (field === "group") {
      slot.group = el.value;
    } else {
      slot[field] = el.value;
    }
  }

  function handleGroupField(el) {
    const index = Number(el.dataset.group);
    const field = el.dataset.field;
    const group = state.editor && state.editor.groups[index];
    if (!group || !field) return;
    group[field] = el.value;
  }

  function handleRuleField(el) {
    const index = Number(el.dataset.rule);
    const rule = state.editor && state.editor.rules[index];
    if (!rule) return;
    const field = el.dataset.field;

    if (field === "level") {
      rule.level = el.value === "warn" ? "warn" : "block";
      return;
    }
    if (field === "type") {
      rule.type = el.value;
      applyRuleType(rule);
      render();
      return;
    }
    if (field === "targetKind") {
      if (el.value === "value") {
        rule.value = rule.type === "in" || rule.type === "includes" ? [] : "";
        rule.right = null;
      } else {
        rule.value = undefined;
        rule.right = rule.right && rule.right.slot ? rule.right : { slot: firstSlotKey(), spec: "" };
      }
      render();
      return;
    }
    if (field === "left.slot") rule.left.slot = el.value;
    else if (field === "left.spec") rule.left.spec = el.value;
    else if (field === "right.slot") { rule.right = rule.right || { slot: "", spec: "" }; rule.right.slot = el.value; }
    else if (field === "right.spec") { rule.right = rule.right || { slot: "", spec: "" }; rule.right.spec = el.value; }
    else if (field === "value") rule.value = el.value;
    else if (field === "limit") rule.limit = el.value;
    else if (field === "message") rule.message = el.value;
    else if (field === "messageBn") rule.messageBn = el.value;
    else if (field.indexOf("term.") === 0) {
      const term = rule.terms[Number(el.dataset.term)];
      if (!term) return;
      const kind = field.slice(5);
      term[kind] = kind === "multiplier" ? Number(el.value) || 1 : el.value;
    }
  }

  function handleFilterChange(el) {
    const index = Number(el.dataset.slot);
    const kind = el.dataset.filter;
    const slot = state.editor && state.editor.slots[index];
    if (!slot || !kind) return;
    slot.filter[kind] = [...el.selectedOptions].map((option) => option.value);
  }

  async function handleAction(action, el) {
    const editor = state.editor;
    switch (action) {
      case "starter":
        return createStarter();
      case "new":
        return newTemplate();
      case "edit":
        return openEditor(el.dataset.id);
      case "delete": {
        const template = state.templates.find((row) => String(row.id) === el.dataset.id);
        if (template) return deleteTemplate(template);
        return;
      }
      case "builds": {
        const template = state.templates.find((row) => String(row.id) === el.dataset.id);
        if (template) return openBuilds(template);
        return;
      }
      case "analytics": {
        const template = state.templates.find((row) => String(row.id) === el.dataset.id);
        if (template) return openAnalytics(template);
        return;
      }
      case "back":
        state.view = "list";
        state.editor = null;
        state.tester = null;
        state.builds = null;
        state.analytics = null;
        loadTemplates().catch(() => {});
        return render();
      case "save":
        return saveEditor();
      case "add-group":
        editor.groups.push({ key: `group-${editor.groups.length + 1}`, name: "", nameBn: "", sortOrder: editor.groups.length });
        return render();
      case "del-group": {
        const index = Number(el.dataset.idx);
        const group = editor.groups[index];
        if (!group) return;
        editor.groups.splice(index, 1);
        editor.slots.forEach((slot) => { if (slot.group === group.key) slot.group = ""; });
        return render();
      }
      case "add-slot":
        editor.slots.push({
          key: `slot-${editor.slots.length + 1}`,
          label: "",
          labelBn: "",
          group: editor.groups[0] ? editor.groups[0].key : "",
          required: false,
          maxQty: 1,
          sortOrder: editor.slots.length,
          hint: "",
          hintBn: "",
          filter: { categories: [], brands: [], tags: [], products: [] },
        });
        return render();
      case "del-slot": {
        const index = Number(el.dataset.idx);
        const slot = editor.slots[index];
        if (slot) {
          editor.slots.splice(index, 1);
          editor.rules = editor.rules.filter(
            (rule) =>
              (rule.left && rule.left.slot) !== slot.key &&
              (!rule.right || rule.right.slot !== slot.key) &&
              !(rule.terms || []).some((term) => term.slot === slot.key)
          );
        }
        state.filterSlot = null;
        return render();
      }
      case "filters": {
        const index = Number(el.dataset.idx);
        state.filterSlot = state.filterSlot === index ? null : index;
        if (state.filterSlot !== null) {
          loadProducts().catch(() => {});
          loadMeta().then(render).catch(() => {});
        }
        return render();
      }
      case "close-filters":
        state.filterSlot = null;
        return render();
      case "pick-products": {
        const slot = editor.slots[state.filterSlot];
        if (!slot) return;
        state.picker = { slotKey: slot.key, selected: new Set(slot.filter.products), q: "" };
        try {
          await loadProducts();
        } catch (err) {
          notify(err.message, "err");
        }
        return render();
      }
      case "close-picker":
        state.picker = null;
        return render();
      case "picker-overlay":
        if (el === el.target) {
          state.picker = null;
          return render();
        }
        return;
      case "save-picker": {
        const slot = editor.slots.find((row) => row.key === (state.picker && state.picker.slotKey));
        if (slot) slot.filter.products = [...state.picker.selected];
        state.picker = null;
        return render();
      }
      case "unpick": {
        const slot = editor.slots[state.filterSlot];
        if (!slot) return;
        slot.filter.products = slot.filter.products.filter((id) => id !== el.dataset.id);
        return render();
      }
      case "add-rule": {
        editor.rules.push({
          key: `rule-${editor.rules.length + 1}`,
          type: "equals",
          level: "block",
          message: "",
          messageBn: "",
          left: { slot: firstSlotKey(), spec: "" },
          right: { slot: firstSlotKey(), spec: "" },
          value: undefined,
          terms: [],
          limit: "",
        });
        return render();
      }
      case "del-rule": {
        editor.rules.splice(Number(el.dataset.idx), 1);
        return render();
      }
      case "add-term": {
        const rule = editor.rules[Number(el.dataset.idx)];
        if (!rule) return;
        rule.terms = rule.terms || [];
        rule.terms.push({ slot: firstSlotKey(), spec: "", multiplier: 1 });
        return render();
      }
      case "del-term": {
        const rule = editor.rules[Number(el.dataset.idx)];
        if (!rule) return;
        rule.terms.splice(Number(el.dataset.term), 1);
        return render();
      }
      case "open-tester":
        return openTester();
      case "copy": {
        const url = shareUrl(el.dataset.url);
        try {
          await navigator.clipboard.writeText(url);
          const previous = el.innerHTML;
          el.innerHTML = "✓";
          setTimeout(() => { el.innerHTML = previous; }, 1200);
        } catch {
          notify(url);
        }
        return;
      }
      default:
        return;
    }
  }

  function shareUrl(path) {
    if (!path) return "";
    if (/^https?:/i.test(path)) return path;
    const base = state.storeUrl || location.origin;
    return base.replace(/\/$/, "") + path;
  }

  /* ---------------- delegated events ---------------- */

  function bind() {
    const root = $(ROOT_ID);
    if (!root) return;

    root.addEventListener("click", (event) => {
      const hit = event.target.closest("[data-action]");
      if (!hit || !root.contains(hit)) return;
      const action = hit.dataset.action;
      if (action === "picker-overlay" && hit !== event.target) return;
      if (hit.tagName === "A") event.preventDefault();
      handleAction(action, hit).catch((err) => notify(err.message, "err"));
    });

    root.addEventListener("change", (event) => {
      const el = event.target;
      if (el.id === "bldStatus") {
        state.editor.status = el.value === "published" ? "published" : "draft";
        return;
      }
      if (el.dataset.basic) return handleBasic(el);
      if (el.dataset.group !== undefined) return handleGroupField(el);
      if (el.dataset.rule !== undefined) return handleRuleField(el);
      if (el.dataset.filter) return handleFilterChange(el);
      if (el.dataset.pickId) {
        if (!state.picker) return;
        if (el.checked) state.picker.selected.add(el.dataset.pickId);
        else state.picker.selected.delete(el.dataset.pickId);
        return;
      }
      if (el.dataset.tester) {
        if (!state.tester) return;
        if (el.value) state.tester.selections[el.dataset.tester] = el.value;
        else delete state.tester.selections[el.dataset.tester];
        scheduleSandbox();
        return;
      }
      if (el.dataset.slot !== undefined) return handleSlotField(el);
    });

    root.addEventListener("input", (event) => {
      const el = event.target;
      if (el.id === "bldSearch") {
        state.query = el.value;
        render();
        const again = $("bldSearch");
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
        return;
      }
      if (el.id === "bldPickSearch") {
        if (!state.picker) return;
        state.picker.q = el.value;
        const position = el.selectionStart;
        render();
        const again = $("bldPickSearch");
        if (again) {
          again.focus();
          again.setSelectionRange(position, position);
        }
        return;
      }
      if (el.dataset.basic) return handleBasic(el);
      if (el.dataset.group !== undefined) return handleGroupField(el);
      if (el.dataset.rule !== undefined) return handleRuleField(el);
      if (el.dataset.slot !== undefined) return handleSlotField(el);
    });
  }

  function bindTopbar() {
    const starter = $("builderStarterBtn");
    if (starter && !starter.dataset.bound) {
      starter.dataset.bound = "1";
      starter.addEventListener("click", () => createStarter());
    }
    const create = $("builderNewBtn");
    if (create && !create.dataset.bound) {
      create.dataset.bound = "1";
      create.addEventListener("click", () => newTemplate());
    }
  }

  bind();
  bindTopbar();
  window.builderPage = { open };
})();
