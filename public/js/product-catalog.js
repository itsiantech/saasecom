/* ==========================================================================
   Product catalog — list + view (details) pages
   Exposes window.productCatalog = { open, openProduct }
   Relies on dashboard.js globals: api, toast, money, switchView
   ========================================================================== */
(function () {
"use strict";

const TOKEN_KEY = "luxe_token";

// dashboard.js er `const api` window e jay na — tai nijer api helper (others der moto)
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + localStorage.getItem(TOKEN_KEY),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem(TOKEN_KEY);
    location.href = "/login.html";
    return null;
  }
  return res;
}

const toast = (text, type) => {
  if (typeof window.toast === "function") window.toast(text, type);
  else console.log("[toast]", type || "", text);
};
const money = (n) => "৳ " + Number(n || 0).toLocaleString("en-IN");
const switchView = (name) => window.switchView && window.switchView(name);

const ROOT_LIST = "pcListRoot";
const ROOT_VIEW = "pcViewRoot";

const state = {
  filter: "all",
  search: "",
  advanced: { category: "", sku: "", type: "", status: "", priceMin: "", priceMax: "", stockMin: "", stockMax: "" },
  categories: [],
  page: 1,
  limit: 10,
  total: 0,
  pages: 1,
  rows: [],
  modes: { wholesale: false, international: false },
  selected: new Set(),
};

/* ---- helpers ---- */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function el(id) {
  return document.getElementById(id);
}

// two-step "armed" button: prothom click arm kore, 4s er moddhe 2nd click kaj kore
function armAction(btn, label, fn) {
  if (btn.dataset.armed === "1") {
    clearTimeout(btn._armT);
    btn.dataset.armed = "";
    btn.textContent = btn.dataset.label;
    fn();
    return;
  }
  btn.dataset.label = btn.textContent;
  btn.textContent = label;
  btn.dataset.armed = "1";
  clearTimeout(btn._armT);
  btn._armT = setTimeout(() => {
    btn.dataset.armed = "";
    btn.textContent = btn.dataset.label;
  }, 4000);
}

const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M12 2v10"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>',
};

function thumbHtml(src) {
  if (src) return `<img class="pc-thumb" src="${esc(src)}" alt="" loading="lazy" />`;
  return `<span class="pc-thumb-placeholder" aria-hidden="true">${ICONS.image}</span>`;
}

function priceCellHtml(p) {
  const sale = Number(p.salePrice) || 0;
  const regular = Number(p.regularPrice) || 0;
  const label = state.modes.wholesale ? "Retail price" : "Price";
  let html = "";
  if (sale > 0 && sale < regular) {
    html = `<div class="pc-price" data-col-label="${label}"><b>${money(sale)}</b> <s>${money(regular)}</s></div>`;
  } else {
    html = `<div class="pc-price" data-col-label="${label}">${money(regular)}</div>`;
  }
  if (state.modes.wholesale) html += `<div class="pc-price-note">Retail closed</div>`;
  return html;
}

/* ===================== LIST PAGE ===================== */

function open() {
  state.page = 1;
  state.selected.clear();
  renderShell();
  loadList();
}

function renderShell() {
  const root = el(ROOT_LIST);
  const chips = [
    ["all", "All"],
    ["hot", "Hot deal"],
    ["active", "Active"],
    ["inactive", "Inactive"],
  ];

  root.innerHTML = `
    <div id="pcBannerSlot"></div>
    <div class="pc-filter-bar" role="group" aria-label="Product filters">
      ${chips.map(([k, l]) => `<button type="button" class="pc-chip" data-filter="${k}" aria-pressed="${state.filter === k}">${l}</button>`).join("")}
      <span id="pcModeChips"></span>
      <div class="pc-search">
        ${ICONS.search}
        <input type="search" id="pcSearch" placeholder="Search name or SKU..." aria-label="Search products" value="${esc(state.search)}" />
      </div>
      <button type="button" class="pc-chip pc-adv-toggle" id="pcAdvToggle" aria-expanded="false" aria-controls="pcAdvPanel">Advanced search</button>
    </div>
    <div class="pc-adv-panel" id="pcAdvPanel" hidden></div>
    <div class="pc-bulk-bar" id="pcBulkBar" hidden></div>
    <div class="pc-table-wrap" id="pcTableWrap"></div>
    <div class="pc-foot" id="pcFoot"></div>
  `;

  root.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filter = btn.dataset.filter;
      state.page = 1;
      root.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      loadList();
    });
  });

  const searchInput = el("pcSearch");
  let deb = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(deb);
    deb = setTimeout(() => {
      state.search = searchInput.value.trim();
      state.page = 1;
      loadList();
    }, 300);
  });

  // ---- advanced search panel ----
  renderAdvPanel();
  const advToggle = el("pcAdvToggle");
  if (advToggle) {
    advToggle.addEventListener("click", async () => {
      const panel = el("pcAdvPanel");
      const open = panel.hidden;
      panel.hidden = !open;
      advToggle.setAttribute("aria-expanded", String(open));
      if (open && !state.categories.length) {
        try {
          const res = await api("/api/categories");
          const data = await res.json();
          if (res.ok) {
            // flat list with tree indentation (categories API returns a tree)
            const flat = [];
            const walk = (nodes, depth) => {
              (nodes || []).forEach((n) => {
                flat.push({ id: n._id, name: "› ".repeat(depth) + n.name });
                if (n.children && n.children.length) walk(n.children, depth + 1);
              });
            };
            walk(Array.isArray(data) ? data : data.categories || data.tree || [], 0);
            state.categories = flat;
            renderAdvPanel();
          }
        } catch {
          /* category select khali rabhe */
        }
      }
    });
  }
}

function advHtml() {
  const a = state.advanced;
  const f = (id, label, inner) => `<label class="pc-adv-field" for="${id}"><span>${label}</span>${inner}</label>`;
  return `
    <div class="pc-adv-grid">
      ${f("pcAdvCategory", "Category", `<select id="pcAdvCategory">
        <option value="">All categories</option>
        ${state.categories.map((c) => `<option value="${esc(c.id)}" ${a.category === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
      </select>`)}
      ${f("pcAdvSku", "SKU", `<input id="pcAdvSku" type="text" value="${esc(a.sku)}" placeholder="Exact / partial SKU" />`)}
      ${f("pcAdvType", "Type", `<select id="pcAdvType">
        <option value="" ${!a.type ? "selected" : ""}>All types</option>
        <option value="physical" ${a.type === "physical" ? "selected" : ""}>Physical</option>
        <option value="digital" ${a.type === "digital" ? "selected" : ""}>Digital</option>
      </select>`)}
      ${f("pcAdvStatus", "Status", `<select id="pcAdvStatus">
        <option value="" ${!a.status ? "selected" : ""}>All statuses</option>
        <option value="active" ${a.status === "active" ? "selected" : ""}>Active</option>
        <option value="inactive" ${a.status === "inactive" ? "selected" : ""}>Inactive</option>
      </select>`)}
      ${f("pcAdvPriceMin", "Price min", `<input id="pcAdvPriceMin" type="number" min="0" step="any" value="${esc(a.priceMin)}" />`)}
      ${f("pcAdvPriceMax", "Price max", `<input id="pcAdvPriceMax" type="number" min="0" step="any" value="${esc(a.priceMax)}" />`)}
      ${f("pcAdvStockMin", "Stock min", `<input id="pcAdvStockMin" type="number" min="0" step="1" value="${esc(a.stockMin)}" />`)}
      ${f("pcAdvStockMax", "Stock max", `<input id="pcAdvStockMax" type="number" min="0" step="1" value="${esc(a.stockMax)}" />`)}
    </div>
    <div class="pc-adv-actions">
      <button type="button" class="btn-gold" id="pcAdvSearch">Search</button>
      <button type="button" class="btn-ghost" id="pcAdvReset">Reset</button>
    </div>
  `;
}

function renderAdvPanel() {
  const panel = el("pcAdvPanel");
  if (!panel) return;
  const wasHidden = panel.hidden;
  panel.innerHTML = advHtml();
  if (wasHidden) panel.hidden = true;

  el("pcAdvSearch").addEventListener("click", () => {
    state.advanced = {
      category: el("pcAdvCategory").value,
      sku: el("pcAdvSku").value.trim(),
      type: el("pcAdvType").value,
      status: el("pcAdvStatus").value,
      priceMin: el("pcAdvPriceMin").value,
      priceMax: el("pcAdvPriceMax").value,
      stockMin: el("pcAdvStockMin").value,
      stockMax: el("pcAdvStockMax").value,
    };
    state.page = 1;
    markAdvApplied();
    loadList();
  });

  el("pcAdvReset").addEventListener("click", () => {
    state.advanced = { category: "", sku: "", type: "", status: "", priceMin: "", priceMax: "", stockMin: "", stockMax: "" };
    state.page = 1;
    markAdvApplied();
    renderAdvPanel();
    loadList();
  });
}

// applied hole toggle button-highlight hoi
function markAdvApplied() {
  const btn = el("pcAdvToggle");
  if (!btn) return;
  const empty = Object.values(state.advanced).every((v) => String(v || "").trim() === "");
  btn.classList.toggle("pc-adv-active", !empty);
}

function renderModeBits() {
  const { wholesale, international } = state.modes;
  const slot = el("pcBannerSlot");
  if (slot) {
    let html = "";
    if (wholesale) {
      html += `<div class="pc-banner">${ICONS.info}<span><b>Wholesale mode is on.</b> Retail buying is closed, so buyers see the tier prices, MOQ and the Wholesale badge.</span></div>`;
    }
    if (international) {
      html += `<div class="pc-banner">${ICONS.info}<span><b>International mode is on.</b> Each product shows where it ships and whether it is available abroad.</span></div>`;
    }
    slot.innerHTML = html;
  }
  const chips = el("pcModeChips");
  if (chips) {
    const extra = [];
    if (wholesale) extra.push(["tiers", "Has tiers"]);
    if (international) extra.push(["international", "Ships abroad"]);
    chips.innerHTML = extra
      .map(([k, l]) => `<button type="button" class="pc-chip" data-filter="${k}" aria-pressed="${state.filter === k}" style="margin-left:6px;">${l}</button>`)
      .join("");
    chips.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filter = btn.dataset.filter;
        state.page = 1;
        document.querySelectorAll("#" + ROOT_LIST + " [data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
        loadList();
      });
    });
  }
  // bulk bar er mode-conditional button gulo (re-render)
  renderBulkBar();
}

async function loadList() {
  const wrap = el("pcTableWrap");
  if (!wrap) return;
  wrap.innerHTML = '<div class="pc-empty">Loading...</div>';
  try {
    const params = new URLSearchParams({ filter: state.filter, search: state.search, page: state.page, limit: state.limit });
    const a = state.advanced;
    if (a.category) params.set("category", a.category);
    if (a.sku) params.set("sku", a.sku);
    if (a.type) params.set("type", a.type);
    if (a.status) params.set("status", a.status);
    if (String(a.priceMin).trim() !== "") params.set("priceMin", a.priceMin);
    if (String(a.priceMax).trim() !== "") params.set("priceMax", a.priceMax);
    if (String(a.stockMin).trim() !== "") params.set("stockMin", a.stockMin);
    if (String(a.stockMax).trim() !== "") params.set("stockMax", a.stockMax);
    const res = await api("/api/product-catalog/list?" + params.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "List load hoyni");
    state.rows = data.products || [];
    state.total = data.total || 0;
    state.pages = data.pages || 1;
    state.modes = data.modes || { wholesale: false, international: false };
    renderModeBits();
    renderTable();
    renderFoot();
  } catch (err) {
    wrap.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>`;
  }
}

function cols() {
  // spec column order — action must stay the LAST column
  const c = ["checkbox", "sl", "name", "category", "type", "image", "price", "stock", "variations", "deal", "status", "action"];
  if (state.modes.wholesale) {
    const i = c.indexOf("stock");
    c.splice(i + 1, 0, "wholesaleTiers", "moq");
  }
  if (state.modes.international) {
    const i = state.modes.wholesale ? c.indexOf("moq") : c.indexOf("stock");
    c.splice(i + 1, 0, "international");
  }
  return c;
}

function headerFor(col) {
  const { wholesale, international } = state.modes;
  switch (col) {
    case "checkbox": return `<input type="checkbox" id="pcSelectAll" aria-label="Select all products" />`;
    case "sl": return "SL";
    case "image": return "Image";
    case "name": return "Name";
    case "category": return "Category";
    case "type": return "Type";
    case "price": return wholesale ? "Retail price" : "Price";
    case "stock": return "Stock";
    case "wholesaleTiers": return "Wholesale tiers";
    case "moq": return "MOQ";
    case "international": return "International";
    case "variations": return "Variations";
    case "deal": return "Deal &amp; feature";
    case "status": return "Status";
    case "action": return "Action";
    default: return "";
  }
}

function cellHtml(p, col) {
  const { wholesale, international } = state.modes;
  switch (col) {
    case "checkbox":
      return `<input type="checkbox" data-select="${p.id}" aria-label="Select ${esc(p.name)}" ${state.selected.has(p.id) ? "checked" : ""} />`;
    case "sl":
      return `<span style="color:var(--muted);font-size:12.5px;">${p.sl}</span>`;
    case "image":
      return thumbHtml(p.image);
    case "name":
      return `<a href="#" class="pc-name-link" data-open="${p.id}">${esc(p.name) || "Unnamed"}</a><div class="pc-sku">${esc(p.sku || "—")}</div>`;
    case "category":
      return `<span class="pc-cat">${esc(p.categoryNames.join(", ") || "Uncategorized")}</span>`;
    case "type":
      return `<span class="pc-type-badge">${p.productType === "digital" ? "Digital" : "Physical"}</span>`;
    case "price":
      return priceCellHtml(p);
    case "stock":
      if (!p.stock || p.stock <= 0) return '<span class="badge out">Out of stock</span>';
      if (p.stock < 5) return `<span class="badge low">${p.stock} — Low</span>`;
      return `<span class="badge in">${p.stock}</span>`;
    case "wholesaleTiers":
      if (p.tierLines && p.tierLines.length) {
        return `<div class="pc-tier-lines">${p.tierLines.map((l) => esc(l)).join("<br>")}</div>`;
      }
      return '<span class="pc-tier-none">No tiers set</span>';
    case "moq":
      return `<span style="font-size:13px;">${esc(p.moq)}</span>`;
    case "international":
      if (p.productType === "digital") return '<span class="pc-type-badge">Online delivery</span>';
      return `
        <label class="switch" title="Allow international shipping">
          <input type="checkbox" data-intl="${p.id}" ${p.shipsAbroad ? "checked" : ""} aria-label="Allow international for ${esc(p.name)}" />
          <span class="slider"></span>
        </label>
        <div class="pc-intl" style="margin-top:5px;">${p.shipsAbroad ? esc(String(p.countryCount)) + (p.countryCount === 1 ? " country" : " countries") : "Local only"}</div>`;
    case "variations":
      return `<span class="pc-var-count">${p.variationCount ? esc(String(p.variationCount)) + " variations" : "None"}</span>`;
    case "deal":
      return `<div class="pc-flags">Hot deal <b class="${p.isHotDeal ? "pc-deal-yes" : ""}">${p.isHotDeal ? "Yes" : "No"}</b><br>Top feature <b>${p.isTopFeature ? "Yes" : "No"}</b></div>`;
    case "status":
      return `
        <label class="switch">
          <input type="checkbox" data-status="${p.id}" ${p.status === "active" ? "checked" : ""} aria-label="Toggle status for ${esc(p.name)}" />
          <span class="slider"></span>
        </label>`;
    case "action":
      return `
        <div class="pc-row-actions">
          <button type="button" class="icon-btn edit" data-toggle="${p.id}" title="${p.status === "active" ? "Deactivate" : "Activate"}">${ICONS.power}</button>
          <button type="button" class="icon-btn edit" data-edit="${p.id}" title="Edit">${ICONS.edit}</button>
          <button type="button" class="icon-btn del" data-del="${p.id}" title="Delete">${ICONS.trash}</button>
        </div>`;
    default:
      return "";
  }
}

function renderTable() {
  const wrap = el("pcTableWrap");
  if (!state.rows.length) {
    wrap.innerHTML = '<div class="pc-empty">No products match.</div>';
    renderBulkBar();
    return;
  }
  const c = cols();
  const thead = c.map((col) => `<th>${headerFor(col)}</th>`).join("");
  const tbody = state.rows
    .map((p) => {
      const tds = c.map((col) => `<td data-col="${col}">${cellHtml(p, col)}</td>`).join("");
      return `<tr data-row="${p.id}">${tds}</tr>`;
    })
    .join("");
  wrap.innerHTML = `<table class="pc-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
  bindTableEvents();
  renderBulkBar();
}

function bindTableEvents() {
  const wrap = el("pcTableWrap");

  // row click → detail (checkbox/switch/link/button badle)
  wrap.querySelectorAll("tr[data-row]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("input, button, a, label.switch")) return;
      openProduct(tr.dataset.row);
    });
  });

  wrap.querySelectorAll("[data-open]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      openProduct(a.dataset.open);
    });
  });

  const selectAll = el("pcSelectAll");
  if (selectAll) {
    selectAll.addEventListener("change", () => {
      state.rows.forEach((p) => (selectAll.checked ? state.selected.add(p.id) : state.selected.delete(p.id)));
      renderTable();
    });
  }
  wrap.querySelectorAll("[data-select]").forEach((cb) => {
    cb.addEventListener("change", () => {
      cb.checked ? state.selected.add(cb.dataset.select) : state.selected.delete(cb.dataset.select);
      renderBulkBar();
      syncSelectAll();
    });
    cb.addEventListener("click", (e) => e.stopPropagation());
  });

  wrap.querySelectorAll("[data-status]").forEach((sw) => {
    sw.addEventListener("change", () => setStatus(sw.dataset.status, sw.checked, sw));
    sw.addEventListener("click", (e) => e.stopPropagation());
  });

  wrap.querySelectorAll("[data-intl]").forEach((sw) => {
    sw.addEventListener("change", () => setInternational(sw.dataset.intl, sw.checked, sw));
    sw.addEventListener("click", (e) => e.stopPropagation());
  });

  wrap.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const p = state.rows.find((x) => String(x.id) === btn.dataset.toggle);
      if (p) await setStatus(p.id, p.status !== "active", null);
    });
  });

  wrap.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      switchView("add-product");
      if (window.productForm) window.productForm.open(btn.dataset.edit);
    });
  });

  wrap.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const p = state.rows.find((x) => String(x.id) === btn.dataset.del);
      if (!p) return;
      const ok = await window.confirmDialog({
        title: "Delete product?",
        text: `"${p.name || "Unnamed product"}" will be deleted permanently, along with its variations, tiers and country list.`,
        okLabel: "Delete",
      });
      if (!ok) return;
      try {
        const res = await api("/api/product-catalog/" + p.id, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Delete hoyni");
        toast("Product deleted", "ok");
        state.selected.delete(p.id);
        await loadList();
      } catch (err) {
        toast(err.message, "err");
      }
    });
  });
}

function syncSelectAll() {
  const selectAll = el("pcSelectAll");
  if (!selectAll) return;
  const onPage = state.rows.filter((p) => state.selected.has(p.id)).length;
  selectAll.checked = state.rows.length > 0 && onPage === state.rows.length;
}

async function setStatus(id, active, checkboxEl) {
  try {
    const res = await api("/api/product-catalog/" + id + "/status", {
      method: "PATCH",
      body: JSON.stringify({ active }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Status update hoyni");
    const p = state.rows.find((x) => String(x.id) === String(id));
    if (p) p.status = active ? "active" : "inactive";
    toast(active ? "Activated" : "Deactivated", "ok");
    renderTable();
  } catch (err) {
    if (checkboxEl) checkboxEl.checked = !active;
    toast(err.message, "err");
  }
}

// international switch = bulk allow_international with a default country set? na — detail page e manage hoy.
// list e switch on/off sudhu shipsAbroad flag (bulk endpoint e countryCodes lage, tai ekhane direct API).
async function setInternational(id, allow, checkboxEl) {
  try {
    const res = await api("/api/product-catalog/bulk", {
      method: "POST",
      body: JSON.stringify({
        action: "allow_international",
        ids: [id],
        countryCodes: allow ? [allCountryCodes()[0]] : null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Update hoyni");
    const p = state.rows.find((x) => String(x.id) === String(id));
    if (p) {
      p.shipsAbroad = allow;
      if (allow) p.countryCount = 1;
    }
    toast(allow ? "International allowed" : "Local only", "ok");
    renderTable();
  } catch (err) {
    if (checkboxEl) checkboxEl.checked = !allow;
    toast(err.message, "err");
  }
}

function allCountryCodes() {
  return ["US", "GB", "CA", "AU", "BD", "IN", "AE", "SA", "MY", "SG"];
}

/* ---- bulk bar ---- */

function renderBulkBar() {
  const bar = el("pcBulkBar");
  if (!bar) return;
  const n = state.selected.size;
  if (!n) {
    bar.hidden = true;
    return;
  }
  const { wholesale, international } = state.modes;
  bar.hidden = false;
  bar.innerHTML = `
    <span class="pc-bulk-count">${n} selected</span>
    <button type="button" data-bulk="activate">Activate</button>
    <button type="button" data-bulk="deactivate">Deactivate</button>
    ${wholesale ? '<button type="button" data-bulk="set_tiers">Set price tiers</button>' : ""}
    ${international ? '<button type="button" data-bulk="allow_international">Allow international</button>' : ""}
    <button type="button" class="danger" data-bulk="delete">Delete</button>
  `;
  bar.querySelectorAll("[data-bulk]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.bulk;
      if (action === "delete") {
        confirmBulkDelete(btn);
      } else if (action === "set_tiers") {
        openTierPopover();
      } else if (action === "allow_international") {
        openCountryPopover();
      } else {
        runBulk(action);
      }
    });
  });
}

// bulk delete — confirm modal diye (Cancel / Delete)
async function confirmBulkDelete() {
  const ok = await window.confirmDialog({
    title: "Delete selected products?",
    text: `${state.selected.size} product(s) will be deleted permanently.`,
    okLabel: "Delete",
  });
  if (ok) runBulk("delete");
}

async function runBulk(action, extra = {}) {
  try {
    const res = await api("/api/product-catalog/bulk", {
      method: "POST",
      body: JSON.stringify({ action, ids: [...state.selected], ...extra }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Bulk action fail");
    toast("Done — " + (data.modified || 0) + " product(s)", "ok");
    state.selected.clear();
    await loadList();
  } catch (err) {
    toast(err.message, "err");
  }
}

/* ---- tier popover ---- */

function openTierPopover() {
  const pop = document.createElement("div");
  pop.className = "pc-pop";
  pop.innerHTML = `
    <div class="pc-pop-box" role="dialog" aria-modal="true" aria-labelledby="pcTierTitle">
      <h3 id="pcTierTitle">Set price tiers</h3>
      <p class="hint">Same tiers apply to each selected product. Existing product-level tiers are replaced. Leave Max empty for "and above".</p>
      <div id="pcTierRows"></div>
      <button type="button" class="pc-add-link" id="pcTierAdd">+ Add row</button>
      <div class="pc-pop-actions">
        <button type="button" class="btn-ghost" id="pcTierCancel">Cancel</button>
        <button type="button" class="btn-gold" id="pcTierSave">Apply tiers</button>
      </div>
    </div>
  `;
  document.body.appendChild(pop);

  const rows = el("pcTierRows");
  const addRow = (min = "", max = "", price = "") => {
    const row = document.createElement("div");
    row.className = "pc-tier-row";
    row.innerHTML = `
      <input type="number" min="1" placeholder="Min qty" value="${min}" aria-label="Minimum quantity" />
      <input type="number" min="1" placeholder="Max qty (optional)" value="${max}" aria-label="Maximum quantity" />
      <input type="number" min="0" step="any" placeholder="Price per piece" value="${price}" aria-label="Price per piece" />
      <button type="button" class="rm" aria-label="Remove row">&times;</button>
    `;
    row.querySelector(".rm").addEventListener("click", () => row.remove());
    rows.appendChild(row);
  };
  addRow(1, "", "");
  el("pcTierAdd").addEventListener("click", () => addRow());

  el("pcTierCancel").addEventListener("click", () => pop.remove());
  pop.addEventListener("click", (e) => {
    if (e.target === pop) pop.remove();
  });
  el("pcTierSave").addEventListener("click", () => {
    const tier = [...rows.querySelectorAll(".pc-tier-row")].map((r) => {
      const [minEl, maxEl, priceEl] = r.querySelectorAll("input");
      return {
        minQty: Number(minEl.value),
        maxQty: maxEl.value === "" ? null : Number(maxEl.value),
        price: Number(priceEl.value),
      };
    }).filter((t) => t.minQty >= 1 && t.price >= 0);
    if (!tier.length) {
      toast("Kampona thik thak fill korun", "err");
      return;
    }
    pop.remove();
    runBulk("set_tiers", { tier });
  });
}

function openCountryPopover() {
  const pop = document.createElement("div");
  pop.className = "pc-pop";
  pop.innerHTML = `
    <div class="pc-pop-box" role="dialog" aria-modal="true" aria-labelledby="pcCtryTitle">
      <h3 id="pcCtryTitle">Allow international shipping</h3>
      <p class="hint">Comma-separated 2-letter country codes (e.g. US, GB, CA). Applies to each selected product; previous list is replaced.</p>
      <textarea id="pcCtryInput" rows="3" placeholder="US, GB, CA" aria-label="Country codes"></textarea>
      <div class="pc-pop-actions">
        <button type="button" class="btn-ghost" id="pcCtryCancel">Cancel</button>
        <button type="button" class="btn-gold" id="pcCtrySave">Apply</button>
      </div>
    </div>
  `;
  document.body.appendChild(pop);
  el("pcCtryCancel").addEventListener("click", () => pop.remove());
  pop.addEventListener("click", (e) => {
    if (e.target === pop) pop.remove();
  });
  el("pcCtrySave").addEventListener("click", () => {
    const codes = el("pcCtryInput").value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!codes.length) {
      toast("Kampona country code din", "err");
      return;
    }
    pop.remove();
    runBulk("allow_international", { countryCodes: codes });
  });
}

/* ---- footer / pagination ---- */

function renderFoot() {
  const foot = el("pcFoot");
  if (!foot) return;
  const from = state.total === 0 ? 0 : (state.page - 1) * state.limit + 1;
  const to = Math.min(state.total, state.page * state.limit);
  foot.innerHTML = `
    <span>Showing ${from}–${to} of ${state.total} products</span>
    <span class="spacer"></span>
    <div class="pc-pager" role="navigation" aria-label="Pagination"></div>
  `;
  const pager = foot.querySelector(".pc-pager");
  const btn = (label, page, opts = {}) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.disabled = !!opts.disabled;
    if (opts.current) b.setAttribute("aria-current", "page");
    b.addEventListener("click", () => {
      state.page = page;
      loadList();
    });
    pager.appendChild(b);
  };
  btn("‹", state.page - 1, { disabled: state.page <= 1 });
  const win = [];
  for (let i = Math.max(1, state.page - 2); i <= Math.min(state.pages, state.page + 2); i++) win.push(i);
  if (win[0] > 1) { btn("1", 1); if (win[0] > 2) pager.appendChild(document.createTextNode("…")); }
  win.forEach((i) => btn(String(i), i, { current: i === state.page }));
  const last = win[win.length - 1];
  if (last < state.pages) { if (last < state.pages - 1) pager.appendChild(document.createTextNode("…")); btn(String(state.pages), state.pages); }
  btn("›", state.page + 1, { disabled: state.page >= state.pages });
}

/* ---- import / export ---- */

function exportCsv() {
  const header = ["SL", "Name", "SKU", "Category", "Type", "Regular price", "Sale price", "Stock", "Variations", "Hot deal", "Top feature", "Status"];
  const lines = [header.join(",")];
  for (const p of state.rows) {
    lines.push([
      p.sl, `"${String(p.name).replace(/"/g, '""')}"`, `"${p.sku}"`, `"${p.categoryNames.join(", ")}"`,
      p.productType, p.regularPrice, p.salePrice, p.stock, p.variationCount,
      p.isHotDeal ? "Yes" : "No", p.isTopFeature ? "Yes" : "No", p.status,
    ].join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "products-page-" + state.page + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("CSV export hoise", "ok");
}

/* ===================== PRODUCT VIEW (DETAILS) ===================== */

let viewData = null;

async function openProduct(id) {
  const root = el(ROOT_VIEW);
  root.innerHTML = '<div class="pc-empty">Loading...</div>';
  switchView("product-view");
  try {
    const res = await api("/api/product-catalog/" + id);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Product load hoyni");
    viewData = data;
    renderView();
    window.scrollTo(0, 0);
  } catch (err) {
    root.innerHTML = `
      <button type="button" class="pcv-back" id="pcvBack">${ICONS.back} Back to list</button>
      <div class="pc-empty">${esc(err.message)}</div>
    `;
    el("pcvBack").addEventListener("click", () => switchView("product-list"));
  }
}

function renderView() {
  const { product: p, variations, swatches, tiers, countries, modes } = viewData;
  const root = el(ROOT_VIEW);

  const badges = [
    `<span class="pcv-badge">${p.productType === "digital" ? "Digital" : "Physical"}</span>`,
    p.status === "active" ? '<span class="pcv-badge ok">Active</span>' : '<span class="pcv-badge danger">Inactive</span>',
    p.isHotDeal ? '<span class="pcv-badge gold">Hot deal</span>' : "",
    p.isTopFeature ? '<span class="pcv-badge gold">Top feature</span>' : "",
    modes.wholesale ? '<span class="pcv-badge gold">Wholesale</span>' : "",
  ].filter(Boolean).join("");

  const sale = Number(p.salePrice) || 0;
  const regular = Number(p.regularPrice) || 0;
  const hasSale = sale > 0 && sale < regular;
  const priceHtml = modes.wholesale
    ? `<div class="pcv-price">${hasSale ? money(sale) : money(regular)}${hasSale ? `<s>${money(regular)}</s>` : ""}</div>
       <div class="pcv-price-note">Retail buying is closed — sells by wholesale tiers</div>`
    : `<div class="pcv-price">${hasSale ? money(sale) : money(regular)}${hasSale ? `<s>${money(regular)}</s>` : ""}</div>`;

  const stockV = Number(p.stock) || 0;
  const stockHtml = stockV <= 0
    ? '<span class="v low">Out of stock</span>'
    : stockV < 5 ? `<span class="v low">${stockV} — Low stock</span>` : `<span class="v">${stockV}</span>`;

  const mainImg = (p.images && p.images[0]) || "";
  const thumbs = (p.images || []).map((src, i) =>
    `<button type="button" data-thumb="${i}" aria-pressed="${i === 0}" aria-label="Image ${i + 1}"><img src="${esc(src)}" alt="" /></button>`
  ).join("");

  root.innerHTML = `
    <button type="button" class="pcv-back" id="pcvBack">${ICONS.back} Back to list</button>
    <div class="pcv-top">
      <div class="pcv-gallery">
        ${mainImg
          ? `<img class="pcv-main" id="pcvMain" src="${esc(mainImg)}" alt="${esc(p.name)}" />`
          : `<div class="pcv-main-placeholder">${ICONS.image}</div>`}
        ${thumbs ? `<div class="pcv-thumbs">${thumbs}</div>` : ""}
      </div>
      <div class="pcv-info-card">
        <div class="pcv-badges">${badges}</div>
        <h2 class="pcv-name">${esc(p.name) || "Unnamed product"}</h2>
        <div class="pcv-sub">SKU: ${esc(p.sku || "—")} · ${esc(p.categoryNames.join(", ") || "Uncategorized")}</div>
        ${priceHtml}
        <div class="pcv-info-grid">
          <div class="pcv-info-item"><div class="k">Stock</div>${stockHtml}</div>
          <div class="pcv-info-item"><div class="k">Variations</div><div class="v">${variations.length || "None"}</div></div>
          <div class="pcv-info-item"><div class="k">Hot deal</div><div class="v">${p.isHotDeal ? "Yes" : "No"}</div></div>
          <div class="pcv-info-item"><div class="k">Top feature</div><div class="v">${p.isTopFeature ? "Yes" : "No"}</div></div>
          <div class="pcv-info-item"><div class="k">Sold</div><div class="v">${Number(p.soldCount) || 0}</div></div>
          <div class="pcv-info-item"><div class="k">Created</div><div class="v">${new Date(p.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div></div>
          ${modes.wholesale ? `<div class="pcv-info-item"><div class="k">MOQ</div><div class="v">${Number(p.moq) || 1}</div></div>` : ""}
        </div>
        <div class="pcv-actions">
          <button type="button" id="pcvEdit">Edit product</button>
          <button type="button" id="pcvToggle">${p.status === "active" ? "Deactivate" : "Activate"}</button>
          <button type="button" class="danger" id="pcvDelete">Delete</button>
        </div>
      </div>
    </div>
    <div id="pcvSections"></div>
  `;

  el("pcvBack").addEventListener("click", () => switchView("product-list"));
  el("pcvEdit").addEventListener("click", () => {
    switchView("add-product");
    if (window.productForm) window.productForm.open(p.id);
  });
  el("pcvToggle").addEventListener("click", async () => {
    const makeActive = p.status !== "active";
    try {
      const res = await api("/api/product-catalog/" + p.id + "/status", {
        method: "PATCH",
        body: JSON.stringify({ active: makeActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Status update hoyni");
      p.status = makeActive ? "active" : "inactive";
      toast(makeActive ? "Activated" : "Deactivated", "ok");
      renderView();
    } catch (err) {
      toast(err.message, "err");
    }
  });
  el("pcvDelete").addEventListener("click", async () => {
    const ok = await window.confirmDialog({
      title: "Delete product?",
      text: `"${p.name || "Unnamed product"}" will be deleted permanently.`,
      okLabel: "Delete",
    });
    if (!ok) return;
    try {
      const res = await api("/api/product-catalog/" + p.id, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Delete hoyni");
      toast("Product deleted", "ok");
      switchView("product-list");
    } catch (err) {
      toast(err.message, "err");
    }
  });

  root.querySelectorAll("[data-thumb]").forEach((b) => {
    b.addEventListener("click", () => {
      root.querySelectorAll("[data-thumb]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      el("pcvMain").src = p.images[Number(b.dataset.thumb)];
    });
  });

  renderSections();
}

function renderSections() {
  const { product: p, variations, swatches, tiers, countries, modes } = viewData;
  const slot = el("pcvSections");
  const secs = [];

  // 1. Description
  secs.push(`
    <section class="pcv-section" aria-labelledby="pcvSecDesc">
      <h3 id="pcvSecDesc">Description</h3>
      ${p.description ? `<div class="pcv-desc">${p.description}</div>` : '<div class="pcv-desc-empty">No description added.</div>'}
    </section>`);

  // 2. Variations + swatches
  const varRows = variations.map((v) => `
    <tr>
      <td>${v.image ? `<img class="pcv-vimg" src="${esc(v.image)}" alt="" />` : '<span class="pcv-digital-note">—</span>'}</td>
      <td>${esc(v.termName || v.attributeName || "—")}</td>
      <td>${money(v.regularPrice)}</td>
      <td>${Number(v.salePrice) > 0 ? money(v.salePrice) : "—"}</td>
      <td>${Number(v.stock) || 0}</td>
    </tr>`).join("");
  secs.push(`
    <section class="pcv-section" aria-labelledby="pcvSecVar">
      <h3 id="pcvSecVar">Variations</h3>
      ${variations.length ? `
        <div class="pcv-table-wrap"><table class="pcv-table">
          <thead><tr><th>Image</th><th>Term</th><th>Regular price</th><th>Sale price</th><th>Stock</th></tr></thead>
          <tbody>${varRows}</tbody>
        </table></div>` : '<div class="pcv-desc-empty">No variations.</div>'}
      ${swatches.length ? `<div class="pcv-swatches">${swatches.map((s) => `
        <span class="pcv-swatch">
          ${s.image ? `<img src="${esc(s.image)}" alt="" />` : ""}
          ${esc(s.name)} · ${money(s.price)} · ${Number(s.stock) || 0}
        </span>`).join("")}</div>` : ""}
    </section>`);

  // 3. Wholesale pricing
  if (modes.wholesale) {
    const tierRows = tiers.map((t) => `
      <tr>
        <td>${t.maxQty ? `${t.minQty} – ${t.maxQty}` : `${t.minQty}+`}</td>
        <td>${money(t.price)}</td>
        <td>${Number(p.moq) || 1}</td>
      </tr>`).join("");
    secs.push(`
      <section class="pcv-section" aria-labelledby="pcvSecWholesale">
        <h3 id="pcvSecWholesale">Wholesale pricing</h3>
        ${tiers.length ? `
          <div class="pcv-table-wrap"><table class="pcv-table">
            <thead><tr><th>Quantity range</th><th>Price per piece</th><th>Minimum order</th></tr></thead>
            <tbody>${tierRows}</tbody>
          </table></div>` : `
          <span class="pc-tier-none">No tiers set</span>
          <p class="pcv-hint">Add quantity tiers from the product list — select products → “Set price tiers”.</p>`}
      </section>`);
  }

  // 4. International shipping
  if (modes.international) {
    let body = "";
    if (p.productType === "digital") {
      body = '<div class="pcv-digital-note">Online delivery — available worldwide, no shipping needed.</div>';
    } else if (p.shipsAbroad) {
      body = `<div class="pcv-hint" style="margin-top:0;">Ships abroad</div>
        <div class="pcv-chips" style="margin-top:10px;">${countries.map((c) => `<span class="pcv-chip">${esc(c)}</span>`).join("") || '<span class="pcv-chip dim">No countries set</span>'}</div>`;
    } else {
      body = '<div class="pcv-digital-note">Local only — international shipping is off for this product.</div>';
    }
    secs.push(`
      <section class="pcv-section" aria-labelledby="pcvSecIntl">
        <h3 id="pcvSecIntl">International shipping</h3>
        ${body}
      </section>`);
  }

  // 5. Category and tags
  secs.push(`
    <section class="pcv-section" aria-labelledby="pcvSecTax">
      <h3 id="pcvSecTax">Category and tags</h3>
      <div class="pcv-hint" style="margin-top:0;">Categories</div>
      <div class="pcv-chips" style="margin-top:8px;">${p.categoryNames.length ? p.categoryNames.map((c) => `<span class="pcv-chip">${esc(c)}</span>`).join("") : '<span class="pcv-chip dim">Uncategorized</span>'}</div>
      <div class="pcv-hint" style="margin-top:16px;">Tags</div>
      <div class="pcv-chips" style="margin-top:8px;">${p.tagNames.length ? p.tagNames.map((t) => `<span class="pcv-chip">${esc(t)}</span>`).join("") : '<span class="pcv-chip dim">No tags</span>'}</div>
    </section>`);

  slot.innerHTML = secs.join("");
}

/* ---- top buttons (bind once) ---- */
document.addEventListener("DOMContentLoaded", () => {
  const addBtn = el("pcAddProduct");
  if (addBtn) addBtn.addEventListener("click", () => switchView("add-product"));
  const ieBtn = el("pcImportExport");
  if (ieBtn) ieBtn.addEventListener("click", exportCsv);
});

window.productCatalog = { open, openProduct };
})();
