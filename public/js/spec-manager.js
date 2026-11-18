/* ==========================================================================
   Spec Manager — product builder spec definitions per category.
   Exposes window.specManagerPage = { open } for dashboard.js.
   ========================================================================== */
(function () {
  "use strict";

  const ROOT_ID = "specManagerRoot";
  const TYPES = [
    ["text", "Text"],
    ["number", "Number"],
    ["enum", "Enum (one)"],
    ["multi-enum", "Multi enum"],
    ["boolean", "Yes / No"],
  ];

  const ICONS = {
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  };

  const state = {
    definitions: [],
    categories: [],
    filter: { category: "", q: "", active: "" },
    editing: null,
    importPreview: null,
    loading: false,
  };

  const $ = (id) => document.getElementById(id);

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function notify(message, type) {
    if (typeof window.toast === "function") window.toast(message, type === "err" ? "err" : "ok");
    else console.log(message);
  }

  async function api(method, url, body, headers) {
    const res = await window.ApiSession.request(url, {
      method,
      headers: headers || undefined,
      body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
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
  async function loadCategories() {
    const res = await window.ApiSession.request("/api/categories");
    const safe = res || window.ApiSession.cancelled();
    const data = await safe.json().catch(() => null);
    if (!safe.ok) throw new Error((data && data.message) || "Categories load hoyni");
    return Array.isArray(data) ? data : (data.categories || []);
  }

  function queryString() {
    const params = new URLSearchParams();
    if (state.filter.category) params.set("category", state.filter.category);
    if (state.filter.q) params.set("q", state.filter.q);
    if (state.filter.active) params.set("active", state.filter.active);
    const qs = params.toString();
    return qs ? "?" + qs : "";
  }

  async function loadDefinitions() {
    const data = await api("GET", "/api/specs" + queryString());
    return (data && data.definitions) || [];
  }

  async function reload() {
    if (state.loading) return;
    state.loading = true;
    const root = $(ROOT_ID);
    try {
      state.definitions = await loadDefinitions();
      render();
    } catch (err) {
      if (root) root.innerHTML = `<div class="spec-empty">${esc(err.message)}</div>`;
    } finally {
      state.loading = false;
    }
  }

  async function open() {
    const root = $(ROOT_ID);
    if (!root) return;
    root.innerHTML = '<div class="spec-empty">Loading...</div>';
    try {
      const [defs, cats] = await Promise.all([loadDefinitions(), loadCategories()]);
      state.definitions = defs;
      state.categories = cats;
      render();
    } catch (err) {
      root.innerHTML = `<div class="spec-empty">${esc(err.message)}</div>`;
    }
  }

  /* ---------------- rendering ---------------- */
  function categoryOptions(selected, withAll) {
    const rows = [...state.categories].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    const head = withAll ? '<option value="">All categories</option>' : '<option value="">All categories (store-wide)</option>';
    return (
      head +
      rows
        .map(
          (c) =>
            `<option value="${esc(c._id)}" ${String(selected || "") === String(c._id) ? "selected" : ""}>${esc(c.name || "Unnamed")}</option>`
        )
        .join("")
    );
  }

  function typeLabel(type) {
    const hit = TYPES.find(([key]) => key === type);
    return hit ? hit[1] : type || "Text";
  }

  function valueSummary(def) {
    if (def.type === "enum" || def.type === "multi-enum") {
      const values = (def.enumValues || []).map((v) => v.value);
      return values.length ? values.map(esc).join(", ") : "—";
    }
    if (def.type === "number") return def.unit ? "Unit: " + esc(def.unit) : "Number";
    if (def.type === "boolean") return "Yes / No";
    return def.unit ? "Unit: " + esc(def.unit) : "Free text";
  }

  function flag(on, label) {
    return `<span class="spec-flag ${on ? "on" : "off"}">${label}${on ? "" : ": off"}</span>`;
  }

  function renderFilters() {
    return `
      <div class="spec-toolbar">
        <div class="spec-toolbar-filters">
          <select id="specCatFilter" aria-label="Filter by category">${categoryOptions(state.filter.category, true)}</select>
          <input type="search" id="specSearch" placeholder="Search key or label..." aria-label="Search specs" value="${esc(state.filter.q)}" />
          <select id="specActiveFilter" aria-label="Filter by status">
            <option value="" ${!state.filter.active ? "selected" : ""}>All statuses</option>
            <option value="true" ${state.filter.active === "true" ? "selected" : ""}>Active</option>
            <option value="false" ${state.filter.active === "false" ? "selected" : ""}>Hidden</option>
          </select>
        </div>
        <div class="spec-count">${state.definitions.length} spec${state.definitions.length === 1 ? "" : "s"}</div>
      </div>`;
  }

  function renderEditor() {
    const row = state.editing || null;
    const isNew = !row || !row._id;
    const enumText = row
      ? (row.enumValues || [])
          .map((v) => (v.label && v.label !== v.value ? `${v.value}:${v.label}` : v.value))
          .join(", ")
      : "";
    return `
      <div class="spec-editor" id="specEditor" ${row ? "" : "hidden"}>
        <div class="spec-editor-head">
          <h3>${isNew ? "New spec" : "Edit spec"}</h3>
          <button type="button" class="spec-x" id="specEdClose" aria-label="Close">&times;</button>
        </div>
        <div class="spec-grid">
          <label>Category<select id="specEdCategory">${categoryOptions(row ? row.category : "", false)}</select></label>
          <label>Key<input id="specEdKey" type="text" placeholder="cpu_socket" value="${esc(row ? row.key : "")}" /></label>
          <label>Label<input id="specEdLabel" type="text" placeholder="CPU socket" value="${esc(row ? row.label : "")}" /></label>
          <label>Label (বাংলা)<input id="specEdLabelBn" type="text" value="${esc(row ? row.labelBn : "")}" /></label>
          <label>Type<select id="specEdType">
            ${TYPES.map(([key, label]) => `<option value="${key}" ${String(row && row.type) === key ? "selected" : ""}>${label}</option>`).join("")}
          </select></label>
          <label>Unit<input id="specEdUnit" type="text" placeholder="W, GB, mm" value="${esc(row ? row.unit : "")}" /></label>
          <label class="spec-span2" id="specEdEnumWrap" ${row && (row.type === "enum" || row.type === "multi-enum") ? "" : "hidden"}>Values
            <input id="specEdEnums" type="text" placeholder="intel:Intel, amd:AMD" value="${esc(enumText)}" />
            <span class="spec-hint">Comma separated. Optional label after a colon.</span>
          </label>
          <label>Sort order<input id="specEdSort" type="number" step="1" value="${esc(row ? row.sortOrder : 0)}" /></label>
          <div class="spec-checks">
            <label class="spec-check"><input type="checkbox" id="specEdFilterable" ${!row || row.filterable !== false ? "checked" : ""} /> Filterable</label>
            <label class="spec-check"><input type="checkbox" id="specEdList" ${row && row.showInList ? "checked" : ""} /> Show in product list</label>
            <label class="spec-check"><input type="checkbox" id="specEdActive" ${!row || row.active !== false ? "checked" : ""} /> Active</label>
          </div>
        </div>
        <p class="spec-error" id="specEdError" role="alert"></p>
        <div class="spec-editor-actions">
          <button type="button" class="btn-ghost" id="specEdCancel">Cancel</button>
          <button type="button" class="btn-gold" id="specEdSave">Save spec</button>
        </div>
      </div>`;
  }

  function renderTable() {
    if (!state.definitions.length) {
      return '<div class="spec-empty">No specs yet. Create one, or import a CSV.</div>';
    }
    const rows = state.definitions
      .map(
        (def) => `
        <tr data-id="${esc(def._id)}">
          <td class="spec-drag" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</td>
          <td>${def.category ? esc(def.categoryName || def.categorySlug || "Category") : '<span class="spec-store-wide">All categories</span>'}</td>
          <td><code>${esc(def.key)}</code></td>
          <td>
            <div class="spec-label">${esc(def.label)}</div>
            ${def.labelBn ? `<div class="spec-sub">${esc(def.labelBn)}</div>` : ""}
          </td>
          <td><span class="spec-type">${esc(typeLabel(def.type))}</span></td>
          <td class="spec-values">${valueSummary(def)}</td>
          <td>
            ${flag(def.filterable !== false, "Filter")}
            ${flag(def.showInList === true, "List")}
            ${flag(def.active !== false, "Active")}
          </td>
          <td class="spec-actions">
            <button type="button" class="icon-btn edit" data-edit="${esc(def._id)}" title="Edit">${ICONS.edit}</button>
            <button type="button" class="icon-btn del" data-del="${esc(def._id)}" title="Delete">${ICONS.trash}</button>
          </td>
        </tr>`
      )
      .join("");
    return `
      <div class="spec-table-wrap">
        <table class="spec-table">
          <thead><tr>
            <th></th><th>Category</th><th>Key</th><th>Label</th><th>Type</th><th>Values</th><th>Flags</th><th>Action</th>
          </tr></thead>
          <tbody id="specTableBody">${rows}</tbody>
        </table>
      </div>`;
  }

  function renderImport() {
    const preview = state.importPreview;
    if (!preview) return "";
    const errors = preview.errors || [];
    return `
      <div class="spec-import">
        <div class="spec-import-head">
          <h3>CSV import preview</h3>
          <button type="button" class="spec-x" id="specImportClose" aria-label="Close">&times;</button>
        </div>
        <p class="spec-import-summary">
          ${preview.total} row${preview.total === 1 ? "" : "s"} ·
          ${preview.creates} new · ${preview.updates} update
          ${errors.length ? `· <b class="spec-err-count">${errors.length} error${errors.length === 1 ? "" : "s"}</b>` : ""}
        </p>
        ${errors.length
          ? `<ul class="spec-errors">${errors.map((e) => `<li>Line ${e.line}: ${esc(e.message)}</li>`).join("")}</ul>`
          : ""}
        ${preview.preview.length
          ? `<div class="spec-table-wrap"><table class="spec-table">
              <thead><tr><th>Line</th><th>Action</th><th>Category</th><th>Key</th><th>Label</th><th>Type</th></tr></thead>
              <tbody>${preview.preview
                .map(
                  (r) => `<tr>
                    <td>${r.line}</td>
                    <td><span class="spec-action ${r.action}">${r.action}</span></td>
                    <td>${r.category ? esc(r.category) : "All"}</td>
                    <td><code>${esc(r.key)}</code></td>
                    <td>${esc(r.label)}</td>
                    <td>${esc(typeLabel(r.type))}</td>
                  </tr>`
                )
                .join("")}</tbody>
            </table></div>`
          : ""}
        <div class="spec-editor-actions">
          <button type="button" class="btn-ghost" id="specImportCancel">Cancel</button>
          <button type="button" class="btn-gold" id="specImportApply" ${errors.length || !preview.total ? "disabled" : ""}>Apply import</button>
        </div>
      </div>`;
  }

  function render() {
    const root = $(ROOT_ID);
    if (!root) return;
    root.innerHTML = renderFilters() + renderEditor() + renderImport() + renderTable();
    bind();
    initSortable();
  }

  /* ---------------- events ---------------- */
  function bind() {
    const catFilter = $("specCatFilter");
    if (catFilter) {
      catFilter.addEventListener("change", () => {
        state.filter.category = catFilter.value;
        reload();
      });
    }

    const activeFilter = $("specActiveFilter");
    if (activeFilter) {
      activeFilter.addEventListener("change", () => {
        state.filter.active = activeFilter.value;
        reload();
      });
    }

    const search = $("specSearch");
    if (search) {
      let deb = null;
      search.addEventListener("input", () => {
        clearTimeout(deb);
        deb = setTimeout(() => {
          state.filter.q = search.value.trim();
          reload();
        }, 300);
      });
    }

    document.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.editing = state.definitions.find((d) => String(d._id) === btn.dataset.edit) || null;
        render();
        $("specEdLabel")?.focus();
      });
    });

    document.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => deleteSpec(btn.dataset.del));
    });

    const saveBtn = $("specEdSave");
    if (saveBtn) saveBtn.addEventListener("click", saveSpec);
    ["specEdCancel", "specEdClose"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("click", closeEditor);
    });

    const typeSel = $("specEdType");
    if (typeSel) {
      typeSel.addEventListener("change", () => {
        const wrap = $("specEdEnumWrap");
        if (wrap) wrap.hidden = !(typeSel.value === "enum" || typeSel.value === "multi-enum");
      });
    }

    const importClose = $("specImportClose");
    if (importClose) importClose.addEventListener("click", () => { state.importPreview = null; render(); });
    const importCancel = $("specImportCancel");
    if (importCancel) importCancel.addEventListener("click", () => { state.importPreview = null; render(); });
    const importApply = $("specImportApply");
    if (importApply) importApply.addEventListener("click", applyImport);
  }

  function closeEditor() {
    state.editing = null;
    render();
  }

  function parseEnums(text) {
    return String(text || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [value, ...rest] = part.split(":");
        const clean = String(value || "").trim();
        const label = rest.join(":").trim() || clean;
        return { value: clean, label };
      })
      .filter((v) => v.value);
  }

  async function saveSpec() {
    const errorEl = $("specEdError");
    if (errorEl) errorEl.textContent = "";
    const type = $("specEdType").value;
    const payload = {
      category: $("specEdCategory").value || null,
      key: $("specEdKey").value.trim(),
      label: $("specEdLabel").value.trim(),
      labelBn: $("specEdLabelBn").value.trim(),
      type,
      unit: $("specEdUnit").value.trim(),
      enumValues: type === "enum" || type === "multi-enum" ? parseEnums($("specEdEnums").value) : [],
      filterable: $("specEdFilterable").checked,
      showInList: $("specEdList").checked,
      active: $("specEdActive").checked,
      sortOrder: Number($("specEdSort").value) || 0,
    };
    const btn = $("specEdSave");
    if (btn) btn.disabled = true;
    try {
      if (state.editing && state.editing._id) {
        await api("PUT", "/api/specs/" + state.editing._id, payload);
      } else {
        await api("POST", "/api/specs", payload);
      }
      state.editing = null;
      notify("Spec saved");
      await reload();
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function deleteSpec(id) {
    const def = state.definitions.find((d) => String(d._id) === id);
    const ok = typeof window.confirmDialog === "function"
      ? await window.confirmDialog({
          title: "Delete spec?",
          text: def ? `"${def.label}" products er spec value o theke jabe.` : "Ei spec delete hobe.",
          okLabel: "Delete",
        })
      : window.confirm("Delete this spec?");
    if (!ok) return;
    try {
      await api("DELETE", "/api/specs/" + id);
      notify("Spec deleted");
      await reload();
    } catch (err) {
      notify(err.message, "err");
    }
  }

  /* ---------------- drag reorder ---------------- */
  function initSortable() {
    const tbody = $("specTableBody");
    if (!tbody || !window.Sortable) return;
    if (state.filter.q || state.filter.active) return; // filtered subset e order elomelo hobe
    window.Sortable.create(tbody, {
      handle: ".spec-drag",
      animation: 150,
      onEnd: async () => {
        const ids = [...tbody.querySelectorAll("tr[data-id]")].map((tr) => tr.dataset.id);
        try {
          await api("POST", "/api/specs/reorder", { ids });
          const byId = new Map(state.definitions.map((d) => [String(d._id), d]));
          state.definitions = ids.map((id) => byId.get(id)).filter(Boolean);
          notify("Order saved");
        } catch (err) {
          notify(err.message, "err");
          await reload();
        }
      },
    });
  }

  /* ---------------- CSV import / export ---------------- */
  let pendingCsv = "";

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("File pora jayni"));
      reader.readAsText(file);
    });
  }

  async function previewCsv() {
    try {
      state.importPreview = await api("POST", "/api/specs/import?dryRun=1", pendingCsv, {
        "Content-Type": "text/csv",
      });
    } catch (err) {
      if (err.data && err.data.errors) {
        state.importPreview = { preview: [], total: 0, creates: 0, updates: 0, errors: err.data.errors };
      } else {
        notify(err.message, "err");
        return;
      }
    }
    render();
  }

  async function applyImport() {
    const btn = $("specImportApply");
    if (btn) btn.disabled = true;
    try {
      const result = await api("POST", "/api/specs/import?dryRun=0", pendingCsv, {
        "Content-Type": "text/csv",
      });
      state.importPreview = null;
      pendingCsv = "";
      notify(`Import done: ${result.creates} new, ${result.updates} updated`);
      await reload();
    } catch (err) {
      notify(err.message, "err");
      if (btn) btn.disabled = false;
    }
  }

  async function exportCsv() {
    try {
      const res = await window.ApiSession.request("/api/specs/export.csv");
      const safe = res || window.ApiSession.cancelled();
      if (!safe.ok) {
        const data = await safe.json().catch(() => null);
        throw new Error((data && data.message) || "Export fail");
      }
      const blob = await safe.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "product-specs.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      notify(err.message, "err");
    }
  }

  /* ---------------- topbar wiring (once) ---------------- */
  function bindTopbar() {
    const addBtn = $("specAddBtn");
    if (addBtn && !addBtn.dataset.bound) {
      addBtn.dataset.bound = "1";
      addBtn.addEventListener("click", () => {
        state.editing = { new: true };
        render();
        const first = $("specEdKey");
        if (first) first.focus();
      });
    }

    const importBtn = $("specImportBtn");
    const importFile = $("specImportFile");
    if (importBtn && importFile && !importBtn.dataset.bound) {
      importBtn.dataset.bound = "1";
      importBtn.addEventListener("click", () => importFile.click());
      importFile.addEventListener("change", async () => {
        const file = importFile.files && importFile.files[0];
        if (!file) return;
        try {
          pendingCsv = await readFile(file);
        } catch (err) {
          notify(err.message, "err");
          importFile.value = "";
          return;
        }
        await previewCsv();
      });
    }

    const exportBtn = $("specExportBtn");
    if (exportBtn && !exportBtn.dataset.bound) {
      exportBtn.dataset.bound = "1";
      exportBtn.addEventListener("click", exportCsv);
    }
  }

  bindTopbar();
  window.specManagerPage = { open };
})();

