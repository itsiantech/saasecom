/* ==========================================================================
   Suppliers — list, purchase orders, invoices, payments, stock and reports.
   Exposes window.supplierPage = { open } and window.supplierHistoryPage.
   Relies on dashboard.js globals: api, toast, esc, confirmDialog, switchView.
   ========================================================================== */
(function () {
"use strict";

const api = window.api;
const toast = window.toast;
const esc = window.esc;

const ROOT = "supRoot";
const HISTORY_ROOT = "supHistoryRoot";
const PAGE_SIZES = [10, 20, 50];
const FILTERS = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "due", label: "Due" },
  { key: "hold", label: "Hold" },
  { key: "void", label: "Void" },
  { key: "trash", label: "Trash" },
];
const TABS = [
  { key: "invoices", label: "Invoices" },
  { key: "payments", label: "Payments" },
  { key: "stock", label: "Stock log" },
];
const PAYMENT_METHODS = {
  cash: "Cash",
  bank: "Bank",
  bkash: "bKash",
  nagad: "Nagad",
  other: "Other",
};
const BADGE_CLASS = {
  paid: "is-paid",
  due: "is-due",
  hold: "is-hold",
  void: "is-void",
  none: "is-none",
};
const BADGE_LABEL = {
  paid: "Paid",
  due: "Due",
  hold: "Hold",
  void: "Void",
  none: "No invoices",
};
const STATE_LABEL = { active: "Active", void: "Void", trashed: "In trash" };
const MODE_LABEL = { auto: "Auto", manual: "Manual", reversal: "Reversal" };
const ORDER_STATUS_LABEL = { ordered: "Ordered", received: "Received", cancelled: "Cancelled" };

const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  view: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.7L3 8"/><path d="M3 3v5h5"/></svg>',
  ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><path d="M6 14h12v7H6z"/></svg>',
};

const access = {
  loaded: false,
  canManageSettings: false,
  canPurge: false,
  autoAdjustStock: false,
  maxOrderQty: 10000,
  timezone: "Asia/Dhaka",
  settings: null,
};

const state = {
  filter: "all",
  search: "",
  page: 1,
  limit: 10,
  total: 0,
  pages: 1,
  rows: [],
  requestId: 0,
  searchTimer: null,
};

const historyState = {
  period: "daily",
  page: 1,
  limit: 10,
  requestId: 0,
  data: null,
};

let detailState = null;
const modalStack = [];

/* ============================== HELPERS ============================== */

function el(id) {
  return document.getElementById(id);
}

function int(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function fmtPaisa(paisa, withSymbol = true) {
  const value = int(paisa) / 100;
  const body = value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withSymbol ? "৳ " + body : body;
}

function toPaisa(value) {
  const n = Number(String(value == null ? "" : value).replace(/,/g, ""));
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dateInput(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function truncate(value, limit) {
  const text = String(value == null ? "" : value);
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

function payBadge(status) {
  const value = BADGE_CLASS[status] ? status : "none";
  return '<span class="sup-badge ' + BADGE_CLASS[value] + '">' + esc(BADGE_LABEL[value]) + "</span>";
}

function invoiceDueView(invoice) {
  return invoice && invoice.state === "void" ? 0 : int(invoice && invoice.dueAmountPaisa);
}

function stateBadge(value) {
  if (!value || value === "active") return '<span class="sup-badge is-active">Active</span>';
  if (value === "void") return '<span class="sup-badge is-void">Void</span>';
  if (value === "trashed") return '<span class="sup-badge is-trash">In trash</span>';
  return "";
}

function stateLabel(value) {
  return STATE_LABEL[value] || value || "—";
}

function modeBadge(value) {
  const known = Object.prototype.hasOwnProperty.call(MODE_LABEL, value) ? value : "manual";
  return '<span class="sup-mode is-' + known + '">' + esc(MODE_LABEL[known]) + "</span>";
}

function makeKey() {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
  } catch {
    /* fallback below */
  }
  return "sup-" + Date.now() + "-" + Math.random().toString(36).slice(2, 12);
}

function downloadUrl(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function pageSizeFromStorage() {
  try {
    const n = Number(localStorage.getItem("sup_page_size"));
    return PAGE_SIZES.includes(n) ? n : 10;
  } catch {
    return 10;
  }
}

/* ============================== MODALS ============================== */

function openModal(extraClass) {
  const pop = document.createElement("div");
  pop.className = "sup-pop";
  const box = document.createElement("div");
  box.className = "sup-modal " + (extraClass || "");
  pop.appendChild(box);
  document.body.appendChild(pop);

  const close = () => {
    if (!pop.isConnected) return;
    document.removeEventListener("keydown", onKey);
    pop.remove();
    const index = modalStack.indexOf(pop);
    if (index >= 0) modalStack.splice(index, 1);
    pop.dispatchEvent(new CustomEvent("sup:close"));
  };
  const onKey = (e) => {
    if (e.key === "Escape" && modalStack[modalStack.length - 1] === pop) close();
  };
  document.addEventListener("keydown", onKey);
  pop.addEventListener("click", (e) => {
    if (e.target === pop) close();
  });

  modalStack.push(pop);
  pop._close = close;
  pop._box = box;
  return pop;
}

function modalHead(title, subtitle, closeLabel) {
  return `<div class="sup-modal-head">
    <div>
      <h3>${esc(title)}</h3>
      <div class="sup-modal-sub">${esc(subtitle)}</div>
    </div>
    <button type="button" class="sup-close" aria-label="${esc(closeLabel || "Close")}">×</button>
  </div>`;
}

function askReason(options) {
  const opts = options || {};
  const required = opts.required !== false;
  return new Promise((resolve) => {
    const pop = openModal("sup-small-modal");
    const box = pop._box;
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    pop.addEventListener("sup:close", () => settle(null));

    box.innerHTML = modalHead(opts.title || "Reason", opts.text || "", "Close") + `
      <form class="sup-form" novalidate>
        <label class="full">
          <span>${esc(opts.label || "Reason")}${required ? " *" : " (optional)"}</span>
          <textarea id="supReasonText" rows="3" maxlength="300" placeholder="${esc(opts.placeholder || "")}"></textarea>
        </label>
        <p class="sup-form-error" id="supReasonError"></p>
        <div class="sup-modal-actions">
          <button type="button" class="btn-ghost" data-cancel>Cancel</button>
          <button type="submit" class="${opts.danger === false ? "btn-gold" : "btn-gold sup-danger-solid"}">${esc(opts.okLabel || "Confirm")}</button>
        </div>
      </form>`;

    box.querySelector(".sup-close").addEventListener("click", () => pop._close());
    box.querySelector("[data-cancel]").addEventListener("click", () => pop._close());
    const input = box.querySelector("#supReasonText");
    input.focus();
    box.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (required && value.length < 3) {
        box.querySelector("#supReasonError").textContent = "Reason ontoto 3 character likhun";
        input.focus();
        return;
      }
      settle(value);
      pop._close();
    });
  });
}

async function closePop(pop) {
  if (pop && pop._close) pop._close();
}

/* ============================== ACCESS ============================== */

async function loadAccess(force) {
  if (access.loaded && !force) return access;
  try {
    const res = await api("/api/suppliers/settings");
    if (!res) return access;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Settings load hoyni");
    access.settings = data.settings || null;
    access.canManageSettings = data.canManageSettings === true;
    access.canPurge = data.canPurge === true;
    if (data.settings) {
      access.autoAdjustStock = data.settings.autoAdjustStock === true;
      access.maxOrderQty = int(data.settings.maxOrderQty) || 10000;
      access.timezone = data.settings.timezone || "Asia/Dhaka";
    }
    access.loaded = true;
  } catch {
    /* read-only fallback; supplier list still works */
  }
  return access;
}

/* =============================== LIST =============================== */

async function open() {
  state.filter = "all";
  state.search = "";
  state.page = 1;
  state.limit = pageSizeFromStorage();
  state.requestId += 1;
  renderShell();
  await loadAccess();
  loadList();
}

function renderShell() {
  const root = el(ROOT);
  if (!root) return;
  const chips = FILTERS.map(
    (f) =>
      `<button type="button" class="pc-chip" data-filter="${f.key}" aria-pressed="${state.filter === f.key}">${f.label}</button>`
  ).join("");

  root.innerHTML = `
    <div class="sup-toolbar">
      <div class="sup-chips" role="group" aria-label="Supplier payment filter">${chips}</div>
      <span class="sup-count" id="supCount">—</span>
      <div class="pc-search sup-search">
        ${ICONS.search}
        <input type="search" id="supSearch" placeholder="Search name, phone, company..." aria-label="Search suppliers" />
      </div>
    </div>
    <div id="supListWrap"><div class="pc-empty">Loading...</div></div>
    <div class="pc-foot" id="supListFoot"></div>
  `;

  root.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.filter === btn.dataset.filter) return;
      state.filter = btn.dataset.filter;
      state.page = 1;
      root.querySelectorAll("[data-filter]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.filter === state.filter));
      });
      loadList();
    });
  });

  const input = el("supSearch");
  if (input) {
    input.value = state.search;
    input.addEventListener("input", (e) => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        state.search = e.target.value.trim();
        state.page = 1;
        loadList();
      }, 320);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      clearTimeout(state.searchTimer);
      state.search = e.target.value.trim();
      state.page = 1;
      loadList();
    });
  }
}

async function loadList() {
  const wrap = el("supListWrap");
  if (!wrap) return;
  const requestId = ++state.requestId;
  wrap.innerHTML = '<div class="pc-empty">Loading suppliers...</div>';

  const params = new URLSearchParams({
    filter: state.filter,
    page: String(state.page),
    limit: String(state.limit),
  });
  if (state.search) params.set("search", state.search);

  try {
    const res = await api("/api/suppliers?" + params.toString());
    if (!res) return;
    const data = await res.json();
    if (requestId !== state.requestId) return;
    if (!res.ok) throw new Error(data.message || "Supplier list load hoyni");

    state.rows = Array.isArray(data.suppliers) ? data.suppliers : [];
    state.total = int(data.total);
    state.pages = Math.max(1, int(data.pages) || 1);
    if (state.page > state.pages) {
      state.page = state.pages;
      return loadList();
    }

    const count = el("supCount");
    if (count) count.textContent = state.total + " supplier" + (state.total === 1 ? "" : "s");
    renderTable();
    renderListFoot();
  } catch (err) {
    if (requestId !== state.requestId) return;
    wrap.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>`;
  }
}

function iconAction(kind, id, label, icon) {
  return `<button type="button" class="icon-btn ${kind === "trash" || kind === "purge" ? "del" : "edit"}" data-${kind}="${esc(id)}" title="${esc(label)}" aria-label="${esc(label)}">${icon}</button>`;
}

function renderTable() {
  const wrap = el("supListWrap");
  if (!wrap) return;
  if (!state.rows.length) {
    let hint = "Search ba filter change kore dekhen.";
    if (state.filter === "trash") {
      hint = "Trash e kono supplier nei. Trash kora supplier shudhu superadmin permanently delete korte parbe — automatic purge nei.";
    } else if (state.filter === "all") {
      hint = "New supplier diye purchase order, invoice ar payment track kora shuru korun.";
    }
    wrap.innerHTML = `<div class="pc-empty">
      <div>Kono supplier pawa jayni.</div>
      <div class="sup-empty-hint">${esc(hint)}</div>
      ${state.filter === "all" ? '<div class="sup-empty-actions"><button type="button" class="btn-gold" id="supEmptyNew">New supplier</button></div>' : ""}
    </div>`;
    const newBtn = el("supEmptyNew");
    if (newBtn) newBtn.addEventListener("click", () => openSupplierForm(null));
    return;
  }

  const headers = ["Name", "Company", "Address", "Phone", "Email", "Order qty", "Payment", "In stock", "Note", "Actions"];
  const head = headers.map((h) => "<th>" + h + "</th>").join("");
  const rows = state.rows
    .map((row) => {
      const id = esc(row.id);
      const actions = [];
      actions.push(iconAction("view", row.id, "View supplier", ICONS.view));
      if (row.state !== "trashed") actions.push(iconAction("edit", row.id, "Edit supplier", ICONS.edit));
      if (row.state === "active") actions.push(iconAction("void", row.id, "Void supplier", ICONS.ban));
      if (row.state === "active" || row.state === "void") {
        actions.push(iconAction("trash", row.id, "Trash supplier", ICONS.trash));
      }
      if (row.state === "trashed") {
        actions.push(iconAction("restore", row.id, "Restore supplier", ICONS.restore));
        if (access.canPurge) {
          actions.push(`<button type="button" class="icon-btn del" data-purge="${id}" title="Delete permanently" aria-label="Delete permanently">${ICONS.trash}</button>`);
        }
      }
      const pay = payBadge(row.paymentStatus);
      const statusNote = row.state !== "active" ? `<div class="sup-substate">${esc(stateLabel(row.state))}</div>` : "";
      return `<tr data-row="${id}">
        <td data-col="name" data-label="Name">
          <div class="sup-name">
            <span class="sup-avatar">${esc(initials(row.name))}</span>
            <div>
              <b>${esc(row.name || "Supplier")}</b>
              <small>${esc(stateLabel(row.state))} · ${row.orderCount || 0} order${Number(row.orderCount) === 1 ? "" : "s"}</small>
            </div>
          </div>
        </td>
        <td data-col="company" data-label="Company"><span class="sup-line">${esc(row.companyName || "—")}</span></td>
        <td data-col="address" data-label="Address"><span class="sup-line sup-wrap">${esc(row.address || "—")}</span></td>
        <td data-col="phone" data-label="Phone"><span class="sup-line">${esc(row.phone || "—")}</span></td>
        <td data-col="email" data-label="Email"><span class="sup-line sup-wrap">${esc(row.email || "—")}</span></td>
        <td data-col="qty" data-label="Order qty"><b>${int(row.orderQty).toLocaleString("en-IN")}</b> <span class="sup-muted">units</span></td>
        <td data-col="payment" data-label="Payment">${pay}${statusNote}</td>
        <td data-col="stock" data-label="In stock"><b class="${int(row.inStock) <= 0 ? "sup-low" : ""}">${int(row.inStock).toLocaleString("en-IN")}</b> <span class="sup-muted">in ${int(row.productCount)} product${int(row.productCount) === 1 ? "" : "s"}</span></td>
        <td data-col="note" data-label="Note"><span class="sup-note" title="${esc(row.note || "")}">${esc(row.note ? truncate(row.note, 44) : "—")}</span></td>
        <td data-col="actions" data-label="Actions"><div class="pc-row-actions">${actions.join("")}</div></td>
      </tr>`;
    })
    .join("");

  wrap.innerHTML = `<div class="pc-table-wrap sup-table-wrap"><table class="pc-table sup-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  bindTable();
}

function bindTable() {
  const wrap = el("supListWrap");
  if (!wrap) return;
  wrap.querySelectorAll("tr[data-row]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button, a, input, select, textarea")) return;
      openSupplier(tr.dataset.row);
    });
  });
  wrap.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openSupplier(btn.dataset.view);
    });
  });
  wrap.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = state.rows.find((r) => String(r.id) === btn.dataset.edit);
      if (row) openSupplierForm(row);
    });
  });
  wrap.querySelectorAll("[data-void]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const row = state.rows.find((r) => String(r.id) === btn.dataset.void);
      if (row) await voidSupplier(row);
    });
  });
  wrap.querySelectorAll("[data-trash]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const row = state.rows.find((r) => String(r.id) === btn.dataset.trash);
      if (row) await trashSupplier(row);
    });
  });
  wrap.querySelectorAll("[data-restore]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const row = state.rows.find((r) => String(r.id) === btn.dataset.restore);
      if (row) await restoreSupplier(row);
    });
  });
  wrap.querySelectorAll("[data-purge]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const row = state.rows.find((r) => String(r.id) === btn.dataset.purge);
      if (row) await purgeSupplier(row);
    });
  });
}

function renderListFoot() {
  const foot = el("supListFoot");
  if (!foot) return;
  if (!state.total) {
    foot.innerHTML = "";
    return;
  }
  const from = (state.page - 1) * state.limit + 1;
  const to = Math.min(state.page * state.limit, state.total);
  foot.innerHTML = `
    <div class="sup-foot-info">
      <span>Showing ${from}–${to} of ${state.total} suppliers</span>
      <label class="sup-page-size">Per page
        <select id="supPageSize" aria-label="Suppliers per page">
          ${PAGE_SIZES.map((n) => `<option value="${n}" ${state.limit === n ? "selected" : ""}>${n}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="sup-pager" id="supListPager" role="navigation" aria-label="Supplier pagination"></div>
  `;

  el("supPageSize").addEventListener("change", (e) => {
    const n = Number(e.target.value);
    if (!PAGE_SIZES.includes(n)) return;
    state.limit = n;
    state.page = 1;
    try {
      localStorage.setItem("sup_page_size", String(n));
    } catch {
      /* private mode */
    }
    loadList();
  });

  buildPager(el("supListPager"), state.page, state.pages, (page) => {
    state.page = page;
    loadList();
  });
}

function buildPager(container, page, pages, onPage) {
  if (!container) return;
  container.innerHTML = "";
  const make = (label, target, options) => {
    const opts = options || {};
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.disabled = !!opts.disabled;
    if (opts.current) btn.setAttribute("aria-current", "page");
    btn.addEventListener("click", () => onPage(target));
    container.appendChild(btn);
  };

  make("‹", page - 1, { disabled: page <= 1 });
  const windowPages = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i += 1) windowPages.push(i);
  if (windowPages[0] > 1) {
    make("1", 1);
    if (windowPages[0] > 2) container.appendChild(document.createTextNode("…"));
  }
  windowPages.forEach((p) => make(String(p), p, { current: p === page }));
  const last = windowPages[windowPages.length - 1];
  if (last < pages) {
    if (last < pages - 1) container.appendChild(document.createTextNode("…"));
    make(String(pages), pages);
  }
  make("›", page + 1, { disabled: page >= pages });
}

/* ============================ SUPPLIER ACTIONS ============================ */

async function openSupplierForm(supplier) {
  const editing = !!supplier;
  const pop = openModal("sup-edit-modal");
  const box = pop._box;
  box.innerHTML = modalHead(
    editing ? "Edit supplier" : "New supplier",
    editing ? "Contact ar company details update korun" : "Purchase order shuru korte supplier add korun",
    "Close"
  ) + `
    <form class="sup-form" novalidate>
      <div class="sup-form-grid">
        <label class="full"><span>Supplier name *</span><input id="supFormName" type="text" maxlength="120" value="${esc(editing ? supplier.name || "" : "")}" required /></label>
        <label><span>Company name</span><input id="supFormCompany" type="text" maxlength="160" value="${esc(editing ? supplier.companyName || "" : "")}" /></label>
        <label><span>Phone *</span><input id="supFormPhone" type="text" maxlength="20" value="${esc(editing ? supplier.phone || "" : "")}" placeholder="01XXXXXXXXX" required /></label>
        <label><span>Email</span><input id="supFormEmail" type="email" maxlength="160" value="${esc(editing ? supplier.email || "" : "")}" /></label>
        <label class="full"><span>Address</span><input id="supFormAddress" type="text" maxlength="300" value="${esc(editing ? supplier.address || "" : "")}" /></label>
        <label class="full"><span>Note</span><textarea id="supFormNote" rows="3" maxlength="500">${esc(editing ? supplier.note || "" : "")}</textarea></label>
      </div>
      <p class="sup-form-error" id="supFormError"></p>
      <div class="sup-modal-actions">
        <button type="button" class="btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn-gold" id="supFormSave">${editing ? "Save changes" : "Create supplier"}</button>
      </div>
    </form>`;

  const errorEl = box.querySelector("#supFormError");
  box.querySelector(".sup-close").addEventListener("click", () => pop._close());
  box.querySelector("[data-cancel]").addEventListener("click", () => pop._close());
  box.querySelector("#supFormName").focus();

  box.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const body = {
      name: box.querySelector("#supFormName").value.trim(),
      companyName: box.querySelector("#supFormCompany").value.trim(),
      phone: box.querySelector("#supFormPhone").value.trim(),
      email: box.querySelector("#supFormEmail").value.trim(),
      address: box.querySelector("#supFormAddress").value.trim(),
      note: box.querySelector("#supFormNote").value.trim(),
    };
    if (!body.name) {
      errorEl.textContent = "Supplier name lagbe";
      return;
    }
    if (!body.phone) {
      errorEl.textContent = "Phone number lagbe";
      return;
    }
    const save = box.querySelector("#supFormSave");
    save.disabled = true;
    save.textContent = "Saving...";
    try {
      const res = await api(editing ? "/api/suppliers/" + encodeURIComponent(supplier.id) : "/api/suppliers", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      if (!res) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Supplier save hoyni");
      toast(editing ? "Supplier updated" : "Supplier created", "ok");
      pop._close();
      await loadList();
    } catch (err) {
      errorEl.textContent = err.message;
      save.disabled = false;
      save.textContent = editing ? "Save changes" : "Create supplier";
    }
  });
}

async function voidSupplier(supplier) {
  const reason = await askReason({
    title: "Void this supplier?",
    text: (supplier.name || "Supplier") + " active list theke soriye Void filter e jabe. Invoices, payments ar stock history intact thakbe.",
    label: "Void reason",
    placeholder: "Keno void korchen?",
    okLabel: "Void supplier",
  });
  if (reason === null) return false;
  try {
    const res = await api("/api/suppliers/" + encodeURIComponent(supplier.id) + "/void", {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    if (!res) return false;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Supplier void hoyni");
    toast("Supplier void kora hoyeche", "ok");
    await loadList();
    return true;
  } catch (err) {
    toast(err.message, "err");
    return false;
  }
}

async function trashSupplier(supplier) {
  const reason = await askReason({
    title: "Trash this supplier?",
    text: (supplier.name || "Supplier") + " Trash filter e jabe. Supplier permanently delete korar age restore kora jabe.",
    label: "Trash reason",
    placeholder: "Optional note",
    okLabel: "Trash supplier",
    required: false,
  });
  if (reason === null) return false;
  try {
    const res = await api("/api/suppliers/" + encodeURIComponent(supplier.id) + "/trash", {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    if (!res) return false;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Supplier trash hoyni");
    toast("Supplier trash e soriye deya hoyeche", "ok");
    await loadList();
    return true;
  } catch (err) {
    toast(err.message, "err");
    return false;
  }
}

async function restoreSupplier(supplier) {
  const ok = await window.confirmDialog({
    title: "Restore this supplier?",
    text: (supplier.name || "Supplier") + " abar active supplier list e fire jabe.",
    okLabel: "Restore",
  });
  if (!ok) return false;
  try {
    const res = await api("/api/suppliers/" + encodeURIComponent(supplier.id) + "/restore", {
      method: "POST",
      body: "{}",
    });
    if (!res) return false;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Supplier restore hoyni");
    toast("Supplier restore hoyeche", "ok");
    await loadList();
    return true;
  } catch (err) {
    toast(err.message, "err");
    return false;
  }
}

async function purgeSupplier(supplier) {
  const ok = await window.confirmDialog({
    title: "Delete supplier permanently?",
    text: "Ei supplier er purchase orders, invoices, payments ar stock log permanently delete hobe. Ei kaj ferano jabe na.",
    okLabel: "Delete permanently",
  });
  if (!ok) return false;
  try {
    const res = await api("/api/suppliers/" + encodeURIComponent(supplier.id) + "/purge", {
      method: "DELETE",
    });
    if (!res) return false;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Supplier delete hoyni");
    toast("Supplier permanently delete hoyeche", "ok");
    await loadList();
    return true;
  } catch (err) {
    toast(err.message, "err");
    return false;
  }
}

/* ============================== DETAIL ============================== */

async function openSupplier(id) {
  const pop = openModal("sup-detail-modal");
  const box = pop._box;
  box.innerHTML = '<div class="pc-empty">Loading supplier...</div>';

  let data;
  try {
    const res = await api("/api/suppliers/" + encodeURIComponent(id));
    if (!res) return;
    data = await res.json();
    if (!res.ok) throw new Error(data.message || "Supplier load hoyni");
  } catch (err) {
    box.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>
      <div class="sup-modal-actions"><button type="button" class="btn-ghost" data-close>Close</button></div>`;
    box.querySelector("[data-close]").addEventListener("click", () => pop._close());
    return;
  }

  if (!pop.isConnected) return;
  const supplier = data.supplier || {};
  detailState = {
    id: supplier.id,
    tab: "invoices",
    pages: { invoices: 1, payments: 1, stock: 1 },
    token: 0,
    data,
  };
  pop.addEventListener("sup:close", () => {
    if (detailState && detailState.id === supplier.id) detailState = null;
  });

  const actions = [];
  if (supplier.state === "active") {
    actions.push('<button type="button" class="btn-gold" data-d-new-order>New order</button>');
  }
  if (supplier.state !== "trashed") {
    actions.push('<button type="button" class="btn-ghost" data-d-payment>Record payment</button>');
    actions.push('<button type="button" class="btn-ghost" data-d-stock>Adjust stock</button>');
    actions.push('<button type="button" class="btn-ghost" data-d-edit>Edit</button>');
  }
  if (supplier.state === "active") actions.push('<button type="button" class="btn-ghost sup-danger" data-d-void>Void</button>');
  if (supplier.state === "active" || supplier.state === "void") {
    actions.push('<button type="button" class="btn-ghost sup-danger" data-d-trash>Trash</button>');
  }
  if (supplier.state === "trashed") actions.push('<button type="button" class="btn-ghost" data-d-restore>Restore</button>');

  const banner =
    supplier.state === "void" && supplier.voidReason
      ? `<div class="sup-notice is-warn">Void: ${esc(supplier.voidReason)}</div>`
      : supplier.state === "trashed"
      ? '<div class="sup-notice is-warn">Ei supplier trash e ache. Restore na kora porjonto notun order ba stock change kora jabe na.</div>'
      : "";

  box.innerHTML = `
    <div class="sup-modal-head">
      <span class="sup-avatar sup-avatar-lg">${esc(initials(supplier.name))}</span>
      <div class="sup-modal-head-main">
        <h3>${esc(supplier.name || "Supplier")}</h3>
        <div class="sup-modal-sub">${esc(supplier.companyName || "No company")} · ${stateBadge(supplier.state)}</div>
      </div>
      <button type="button" class="sup-close" aria-label="Close">×</button>
    </div>
    ${banner}
    <div class="sup-summary" id="supDetailSummary">${summaryHtml(data.stats || {})}</div>
    <div class="sup-grid">
      ${field("Company", supplier.companyName)}
      ${field("Phone", supplier.phone)}
      ${field("Email", supplier.email)}
      ${field("Created", fmtDate(supplier.createdAt))}
      <div class="sup-field full"><span>Address</span><b>${esc(supplier.address || "—")}</b></div>
      <div class="sup-field full"><span>Note</span><b>${esc(supplier.note || "—")}</b></div>
    </div>
    <div class="sup-detail-actions">${actions.join("")}</div>
    <div class="sup-tabs" role="tablist" aria-label="Supplier detail">
      ${TABS.map(
        (tab) =>
          `<button type="button" role="tab" class="sup-tab" data-tab="${tab.key}" aria-selected="${tab.key === "invoices"}" id="supTab-${tab.key}">${tab.label}</button>`
      ).join("")}
    </div>
    <div id="supTabPanel" class="sup-tab-panel" role="tabpanel"><div class="pc-empty">Loading...</div></div>
  `;

  box.querySelector(".sup-close").addEventListener("click", () => pop._close());
  box.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!detailState || detailState.tab === btn.dataset.tab) return;
      detailState.tab = btn.dataset.tab;
      box.querySelectorAll("[data-tab]").forEach((b) => {
        b.setAttribute("aria-selected", String(b.dataset.tab === detailState.tab));
      });
      loadSupplierTab();
    });
  });

  const refresh = async () => {
    await refreshDetailSummary(supplier.id);
    if (detailState && detailState.id === supplier.id) await loadSupplierTab();
    loadList();
  };

  box.querySelector("[data-d-new-order]")?.addEventListener("click", () => {
    openOrderModal(supplier, {
      onCreated: async (result) => {
        await refresh();
        if (result && result.invoiceId) {
          openInvoiceModal(result.invoiceId, { onChanged: refresh });
        }
      },
    });
  });
  box.querySelector("[data-d-payment]")?.addEventListener("click", () => {
    openPaymentModal({ supplierId: supplier.id, onDone: refresh });
  });
  box.querySelector("[data-d-stock]")?.addEventListener("click", () => {
    openStockModal(supplier, { onDone: refresh });
  });
  box.querySelector("[data-d-edit]")?.addEventListener("click", async () => {
    await closePop(pop);
    openSupplierForm(supplier);
  });
  box.querySelector("[data-d-void]")?.addEventListener("click", async () => {
    const changed = await voidSupplier(supplier);
    if (changed) await closePop(pop);
  });
  box.querySelector("[data-d-trash]")?.addEventListener("click", async () => {
    const changed = await trashSupplier(supplier);
    if (changed) await closePop(pop);
  });
  box.querySelector("[data-d-restore]")?.addEventListener("click", async () => {
    const changed = await restoreSupplier(supplier);
    if (changed) {
      await closePop(pop);
      openSupplier(supplier.id);
    }
  });

  loadSupplierTab();
}

function field(label, value) {
  return `<div class="sup-field"><span>${esc(label)}</span><b>${esc(value || "—")}</b></div>`;
}

function summaryHtml(stats) {
  const due = int(stats.dueAmountPaisa);
  return `
    <div class="sup-stat"><span>Order quantity</span><b>${int(stats.orderQty).toLocaleString("en-IN")}</b><small>${int(stats.orderCount)} order${int(stats.orderCount) === 1 ? "" : "s"}</small></div>
    <div class="sup-stat"><span>Purchase total</span><b class="is-gold">${fmtPaisa(stats.totalPurchasePaisa)}</b><small>${int(stats.invoiceCount)} invoice${int(stats.invoiceCount) === 1 ? "" : "s"}</small></div>
    <div class="sup-stat"><span>Due</span><b class="${due > 0 ? "is-danger" : ""}">${fmtPaisa(due)}</b><small>${payBadge(stats.paymentStatus || "none")}</small></div>
    <div class="sup-stat"><span>In stock</span><b class="${int(stats.inStock) <= 0 ? "is-danger" : ""}">${int(stats.inStock).toLocaleString("en-IN")}</b><small>${int(stats.productCount)} linked product${int(stats.productCount) === 1 ? "" : "s"}</small></div>
  `;
}

async function refreshDetailSummary(id) {
  try {
    const res = await api("/api/suppliers/" + encodeURIComponent(id));
    if (!res) return;
    const data = await res.json();
    if (!res.ok) return;
    if (!detailState || detailState.id !== id) return;
    detailState.data = data;
    const summary = el("supDetailSummary");
    if (summary) summary.innerHTML = summaryHtml(data.stats || {});
  } catch {
    /* non-blocking */
  }
}

async function loadSupplierTab(pageOverride) {
  const ds = detailState;
  const panel = el("supTabPanel");
  if (!ds || !panel) return;

  const tab = ds.tab;
  if (pageOverride) ds.pages[tab] = pageOverride;
  const page = Math.max(1, ds.pages[tab] || 1);
  const token = ++ds.token;
  panel.innerHTML = '<div class="pc-empty">Loading...</div>';

  let url;
  if (tab === "payments") {
    url = "/api/suppliers/" + encodeURIComponent(ds.id) + "/payments?page=" + page + "&limit=10";
  } else if (tab === "stock") {
    url = "/api/suppliers/" + encodeURIComponent(ds.id) + "/stock-log?page=" + page + "&limit=10";
  } else {
    url = "/api/suppliers/" + encodeURIComponent(ds.id) + "/invoices?page=" + page + "&limit=10";
  }

  try {
    const res = await api(url);
    if (!res) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Tab load hoyni");
    if (!detailState || detailState.id !== ds.id || detailState.token !== token || detailState.tab !== tab) return;

    if (tab === "payments") renderPaymentsTab(panel, data);
    else if (tab === "stock") renderStockTab(panel, data);
    else renderInvoicesTab(panel, data);
    bindTabPager(panel, data);
  } catch (err) {
    if (detailState && detailState.token === token) {
      panel.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>`;
    }
  }
}

function tabEmpty(text) {
  return `<div class="pc-empty">${esc(text)}</div>`;
}

function renderInvoicesTab(panel, data) {
  const rows = Array.isArray(data.invoices) ? data.invoices : [];
  if (!rows.length) {
    panel.innerHTML = tabEmpty("Kono supplier invoice nei. New order diye prothom invoice create korun.");
    return;
  }
  panel.innerHTML = `
    <div class="sup-tab-intro"><span>${data.total || 0} invoice</span><button type="button" class="sup-link" data-refresh-tab>Refresh</button></div>
    <div class="sup-table-wrap"><table class="sup-table sup-inner-table">
      <thead><tr><th>Invoice</th><th>Issued</th><th>Order</th><th>Qty</th><th>Total</th><th>Due</th><th>Payment</th><th>Actions</th></tr></thead>
      <tbody>${rows
        .map(
          (inv) => `<tr data-invoice-row="${esc(inv.id)}">
            <td data-label="Invoice"><b>${esc(inv.invoiceNo)}</b>${inv.holdFlag ? ' <span class="sup-badge is-hold">Hold</span>' : ""}</td>
            <td data-label="Issued">${fmtDate(inv.issueDate)}</td>
            <td data-label="Order"><span>${esc(inv.orderNo || "—")}</span><small class="sup-cell-sub">${esc(ORDER_STATUS_LABEL[inv.orderStatus] || inv.orderStatus || "")}</small></td>
            <td data-label="Qty">${int(inv.totalQty)}</td>
            <td data-label="Total">${fmtPaisa(inv.totalAmountPaisa)}</td>
            <td data-label="Due"><span class="${invoiceDueView(inv) > 0 ? "sup-danger-text" : ""}">${fmtPaisa(invoiceDueView(inv))}</span></td>
            <td data-label="Payment">${payBadge(inv.paymentStatus)}</td>
            <td data-label="Actions"><div class="sup-inline-actions">
              <button type="button" class="sup-link" data-open-invoice="${esc(inv.id)}">View</button>
              <button type="button" class="icon-btn edit" data-print-invoice="${esc(inv.id)}" title="Print / PDF" aria-label="Print invoice">${ICONS.print}</button>
            </div></td>
          </tr>`
        )
        .join("")}</tbody>
    </table></div>
    <div class="sup-tab-foot" data-tab-foot></div>
  `;
  panel.querySelectorAll("[data-invoice-row]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button, a")) return;
      openInvoiceForDetail(tr.dataset.invoiceRow);
    });
  });
  panel.querySelectorAll("[data-open-invoice]").forEach((btn) => {
    btn.addEventListener("click", () => openInvoiceForDetail(btn.dataset.openInvoice));
  });
  panel.querySelectorAll("[data-print-invoice]").forEach((btn) => {
    btn.addEventListener("click", () => printInvoice(btn.dataset.printInvoice));
  });
  panel.querySelector("[data-refresh-tab]")?.addEventListener("click", () => {
    refreshDetailSummary(detailState.id);
    loadSupplierTab();
  });
}

function openInvoiceForDetail(invoiceId) {
  const supplierId = detailState && detailState.id;
  openInvoiceModal(invoiceId, {
    onChanged: async () => {
      if (supplierId) await refreshDetailSummary(supplierId);
      if (detailState) await loadSupplierTab();
      loadList();
    },
  });
}

function renderPaymentsTab(panel, data) {
  const rows = Array.isArray(data.payments) ? data.payments : [];
  if (!rows.length) {
    panel.innerHTML = tabEmpty("Kono supplier payment record nei.");
    return;
  }
  panel.innerHTML = `
    <div class="sup-tab-intro"><span>${data.total || 0} payment</span><button type="button" class="sup-link" data-refresh-tab>Refresh</button></div>
    <div class="sup-table-wrap"><table class="sup-table sup-inner-table">
      <thead><tr><th>Date</th><th>Invoice</th><th>Amount</th><th>Method</th><th>Reference</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows
        .map(
          (p) => `<tr>
            <td data-label="Date">${fmtDate(p.paidAt)}</td>
            <td data-label="Invoice"><button type="button" class="sup-link" data-open-invoice="${esc(p.invoiceId)}">${esc(p.invoiceNo || "—")}</button></td>
            <td data-label="Amount"><b>${fmtPaisa(p.amountPaisa)}</b></td>
            <td data-label="Method">${esc(PAYMENT_METHODS[p.method] || p.method || "—")}</td>
            <td data-label="Reference">${esc(p.reference || "—")}</td>
            <td data-label="Status">${p.state === "void" ? '<span class="sup-badge is-void">Void</span>' : '<span class="sup-badge is-paid">Active</span>'}</td>
            <td data-label="Actions">${p.state === "active" ? `<button type="button" class="sup-link sup-danger-text" data-void-payment="${esc(p.id)}">Void</button>` : '<span class="sup-muted">—</span>'}</td>
          </tr>`
        )
        .join("")}</tbody>
    </table></div>
    <div class="sup-tab-foot" data-tab-foot></div>
  `;
  panel.querySelectorAll("[data-open-invoice]").forEach((btn) => {
    btn.addEventListener("click", () => openInvoiceForDetail(btn.dataset.openInvoice));
  });
  panel.querySelectorAll("[data-void-payment]").forEach((btn) => {
    btn.addEventListener("click", () => voidPayment(btn.dataset.voidPayment));
  });
  panel.querySelector("[data-refresh-tab]")?.addEventListener("click", () => {
    refreshDetailSummary(detailState.id);
    loadSupplierTab();
  });
}

async function voidPayment(paymentId) {
  const reason = await askReason({
    title: "Void this payment?",
    text: "Payment void hole invoice er paid amount theke ei taka bad jabe. Invoice ar payment history te void badge diye thakbe.",
    label: "Void reason",
    placeholder: "Keno void korchen?",
    okLabel: "Void payment",
  });
  if (reason === null) return;
  try {
    const res = await api("/api/suppliers/payments/" + encodeURIComponent(paymentId) + "/void", {
      method: "PATCH",
      body: JSON.stringify({ reason }),
    });
    if (!res) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Payment void hoyni");
    toast("Payment void hoyeche", "ok");
    if (detailState) {
      await refreshDetailSummary(detailState.id);
      await loadSupplierTab();
    }
  } catch (err) {
    toast(err.message, "err");
  }
}

function renderStockTab(panel, data) {
  const rows = Array.isArray(data.movements) ? data.movements : [];
  const table = rows.length
    ? `<div class="sup-table-wrap"><table class="sup-table sup-inner-table">
        <thead><tr><th>Date</th><th>Product</th><th>Change</th><th>Stock after</th><th>Mode</th><th>Reason</th></tr></thead>
        <tbody>${rows
          .map(
            (m) => `<tr>
              <td data-label="Date">${fmtDateTime(m.createdAt)}</td>
              <td data-label="Product"><b>${esc(m.productName || "Product")}</b><small class="sup-cell-sub">${esc(m.productCode || "—")}</small></td>
              <td data-label="Change"><span class="sup-change ${int(m.change) > 0 ? "is-plus" : "is-minus"}">${int(m.change) > 0 ? "+" : ""}${int(m.change)}</span></td>
              <td data-label="Stock after">${int(m.stockAfter)}</td>
              <td data-label="Mode">${modeBadge(m.mode)}</td>
              <td data-label="Reason"><span class="sup-wrap">${esc(m.reason || "—")}</span>${m.orderNo ? `<small class="sup-cell-sub">${esc(m.orderNo)}</small>` : ""}</td>
            </tr>`
          )
          .join("")}</tbody>
      </table></div>
      <div class="sup-tab-foot" data-tab-foot></div>`
    : tabEmpty("Kono stock movement nei. Stock auto/manual change hole ekhane log hobe.");

  panel.innerHTML = `
    <div class="sup-tab-intro">
      <span>${data.total || 0} movement${data.total === 1 ? "" : "s"} · append-only ledger</span>
      <button type="button" class="btn-ghost sup-small-btn" data-adjust-stock>Adjust stock</button>
    </div>
    ${table}
  `;
  panel.querySelector("[data-adjust-stock]")?.addEventListener("click", () => {
    if (!detailState || !detailState.data) return;
    openStockModal(detailState.data.supplier, {
      onDone: async () => {
        await refreshDetailSummary(detailState.id);
        await loadSupplierTab();
      },
    });
  });
}

function bindTabPager(panel, data) {
  const foot = panel.querySelector("[data-tab-foot]");
  if (!foot) return;
  if (!data.total) {
    foot.innerHTML = "";
    return;
  }
  const from = (data.page - 1) * data.limit + 1;
  const to = Math.min(data.page * data.limit, data.total);
  foot.innerHTML = `<span class="sup-foot-info">Showing ${from}–${to} of ${data.total}</span><div class="sup-pager" data-inner-pager role="navigation" aria-label="Tab pagination"></div>`;
  buildPager(foot.querySelector("[data-inner-pager]"), data.page, data.pages, (page) => loadSupplierTab(page));
}

/* ============================ NEW ORDER ============================ */

async function openOrderModal(supplier, opts) {
  const options = opts || {};
  const pop = openModal("sup-order-modal");
  const box = pop._box;
  box.innerHTML = '<div class="pc-empty">Loading products...</div>';

  let products = [];
  try {
    const res = await api("/api/suppliers/product-options");
    if (!res) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Product list load hoyni");
    products = (Array.isArray(data.products) ? data.products : []).slice().sort((a, b) => {
      const aLinked = String(a.supplierId) === String(supplier.id) ? 0 : 1;
      const bLinked = String(b.supplierId) === String(supplier.id) ? 0 : 1;
      if (aLinked !== bLinked) return aLinked - bLinked;
      return String(a.name).localeCompare(String(b.name));
    });
  } catch (err) {
    box.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>
      <div class="sup-modal-actions"><button type="button" class="btn-ghost" data-close>Close</button></div>`;
    box.querySelector("[data-close]").addEventListener("click", () => pop._close());
    return;
  }

  if (!pop.isConnected) return;
  if (!products.length) {
    box.innerHTML = modalHead("New purchase order", supplier.name || "Supplier", "Close") +
      '<div class="pc-empty">Kono published product nei. Age product publish korun.</div>' +
      '<div class="sup-modal-actions"><button type="button" class="btn-ghost" data-close>Close</button></div>';
    box.querySelector(".sup-close").addEventListener("click", () => pop._close());
    box.querySelector("[data-close]").addEventListener("click", () => pop._close());
    return;
  }

  const idempotencyKey = makeKey();
  const draft = [];
  const maxQty = access.maxOrderQty || 10000;

  box.innerHTML = modalHead("New purchase order", supplier.name || "Supplier", "Close") + `
    <form class="sup-order-form" novalidate>
      <div class="sup-form-grid sup-order-meta">
        <label><span>Order date *</span><input id="supOrderDate" type="date" value="${dateInput()}" max="2100-12-31" required /></label>
        <label><span>Order note</span><input id="supOrderNote" type="text" maxlength="500" placeholder="Optional note" /></label>
      </div>
      <div class="sup-picker">
        <div class="sup-picker-row">
          <label class="sup-picker-search">
            <span>Product by name or SKU</span>
            <input id="supProdSearch" type="search" placeholder="Search product or SKU..." autocomplete="off" />
          </label>
          <label class="sup-picker-select">
            <span>Product</span>
            <select id="supProdSelect" aria-label="Select product"></select>
          </label>
          <button type="button" class="btn-ghost sup-small-btn" id="supAddLine">Add product</button>
        </div>
        <p class="sup-hint">Linked product age dekhano hoy. Qty max ${maxQty.toLocaleString("en-IN")} per line.</p>
      </div>
      <div id="supDraftWrap"></div>
      <div class="sup-order-total">
        <span>Order total</span>
        <b id="supOrderTotal">৳ 0.00</b>
      </div>
      <p class="sup-form-error" id="supOrderError"></p>
      <div class="sup-modal-actions">
        <button type="button" class="btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn-gold" id="supOrderSave">Create order + invoice</button>
      </div>
    </form>`;

  const searchInput = box.querySelector("#supProdSearch");
  const select = box.querySelector("#supProdSelect");
  const draftWrap = box.querySelector("#supDraftWrap");
  const errorEl = box.querySelector("#supOrderError");
  const totalEl = box.querySelector("#supOrderTotal");

  function availableProducts() {
    const term = searchInput.value.trim().toLowerCase();
    const used = new Set(draft.map((line) => String(line.productId)));
    return products.filter((p) => {
      if (used.has(String(p.id))) return false;
      if (!term) return true;
      return String(p.name || "").toLowerCase().includes(term) || String(p.sku || "").toLowerCase().includes(term);
    });
  }

  function fillSelect() {
    const rows = availableProducts();
    select.innerHTML = rows.length
      ? rows
          .map((p) => {
            const linked = String(p.supplierId) === String(supplier.id);
            return `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.sku || "no SKU")}${linked ? " · linked" : ""}</option>`;
          })
          .join("")
      : '<option value="">No matching product</option>';
    select.disabled = !rows.length;
  }

  function renderDraft() {
    if (!draft.length) {
      draftWrap.innerHTML = '<div class="sup-draft-empty">Ekhono kono product add kora hoyni.</div>';
      updateTotal();
      return;
    }
    draftWrap.innerHTML = `<div class="sup-table-wrap"><table class="sup-table sup-inner-table sup-draft-table">
      <thead><tr><th>Product</th><th>Qty</th><th>Unit cost (৳)</th><th>Line total</th><th></th></tr></thead>
      <tbody>${draft
        .map(
          (line, index) => `<tr data-line="${index}">
            <td data-label="Product"><b>${esc(line.name)}</b><small class="sup-cell-sub">${esc(line.sku || "—")}</small></td>
            <td data-label="Qty"><input type="number" class="sup-input sup-line-qty" min="1" step="1" max="${maxQty}" value="${line.quantity}" data-index="${index}" aria-label="Quantity for ${esc(line.name)}" /></td>
            <td data-label="Unit cost"><input type="number" class="sup-input sup-line-cost" min="0" step="0.01" value="${(line.unitCostPaisa / 100).toFixed(2)}" data-index="${index}" aria-label="Unit cost for ${esc(line.name)}" /></td>
            <td data-label="Line total"><b class="sup-line-total">${fmtPaisa(line.quantity * line.unitCostPaisa)}</b></td>
            <td data-label="Remove"><button type="button" class="sup-remove" data-remove="${index}" aria-label="Remove ${esc(line.name)}">×</button></td>
          </tr>`
        )
        .join("")}</tbody>
    </table></div>`;

    draftWrap.querySelectorAll(".sup-line-qty").forEach((input) => {
      input.addEventListener("input", () => {
        const line = draft[Number(input.dataset.index)];
        if (!line) return;
        line.quantity = input.value === "" ? 0 : Math.trunc(Number(input.value)) || 0;
        updateRowTotal(input.dataset.index);
        updateTotal();
      });
    });
    draftWrap.querySelectorAll(".sup-line-cost").forEach((input) => {
      input.addEventListener("input", () => {
        const line = draft[Number(input.dataset.index)];
        if (!line) return;
        const paisa = toPaisa(input.value);
        line.unitCostPaisa = Number.isFinite(paisa) && paisa >= 0 ? paisa : 0;
        updateRowTotal(input.dataset.index);
        updateTotal();
      });
    });
    draftWrap.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        draft.splice(Number(btn.dataset.remove), 1);
        renderDraft();
        fillSelect();
      });
    });
    updateTotal();
  }

  function updateRowTotal(index) {
    const line = draft[Number(index)];
    if (!line) return;
    const row = draftWrap.querySelector('tr[data-line="' + index + '"]');
    if (!row) return;
    const cell = row.querySelector(".sup-line-total");
    if (cell) cell.textContent = fmtPaisa(line.quantity * line.unitCostPaisa);
  }

  function updateTotal() {
    const sum = draft.reduce((total, line) => total + line.quantity * line.unitCostPaisa, 0);
    totalEl.textContent = fmtPaisa(sum);
  }

  function addProduct() {
    const id = select.value;
    const product = products.find((p) => String(p.id) === String(id));
    if (!product) {
      errorEl.textContent = "Age product select korun";
      return;
    }
    if (draft.some((line) => String(line.productId) === String(id))) {
      errorEl.textContent = "Ei product already line e ache";
      return;
    }
    errorEl.textContent = "";
    draft.push({
      productId: product.id,
      name: product.name,
      sku: product.sku || "",
      quantity: 1,
      unitCostPaisa: 0,
    });
    searchInput.value = "";
    renderDraft();
    fillSelect();
  }

  searchInput.addEventListener("input", fillSelect);
  box.querySelector("#supAddLine").addEventListener("click", addProduct);
  select.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addProduct();
    }
  });
  box.querySelector(".sup-close").addEventListener("click", () => pop._close());
  box.querySelector("[data-cancel]").addEventListener("click", () => pop._close());

  box.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    if (!draft.length) {
      errorEl.textContent = "Ontoto ekta product add korun";
      return;
    }
    const orderDate = box.querySelector("#supOrderDate").value;
    if (!orderDate) {
      errorEl.textContent = "Order date valid na";
      return;
    }
    const items = [];
    for (let i = 0; i < draft.length; i += 1) {
      const line = draft[i];
      if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        errorEl.textContent = "Line " + (i + 1) + ": quantity positive integer hote hobe";
        return;
      }
      if (line.quantity > maxQty) {
        errorEl.textContent = "Line " + (i + 1) + ": quantity " + maxQty + " er beshi hote parbe na";
        return;
      }
      if (!Number.isInteger(line.unitCostPaisa) || line.unitCostPaisa < 0) {
        errorEl.textContent = "Line " + (i + 1) + ": unit cost 0 ba tar beshi hote hobe";
        return;
      }
      items.push({
        productId: line.productId,
        quantity: line.quantity,
        unitCostPaisa: line.unitCostPaisa,
      });
    }

    const submit = box.querySelector("#supOrderSave");
    submit.disabled = true;
    submit.textContent = "Creating...";
    try {
      const res = await api("/api/suppliers/" + encodeURIComponent(supplier.id) + "/orders", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          orderDate,
          note: box.querySelector("#supOrderNote").value.trim(),
          items,
        }),
      });
      if (!res) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Order create hoyni");
      toast(
        (data.replayed ? "Order already created — " : "Order created — ") + data.orderNo + " · " + data.invoiceNo,
        "ok"
      );
      pop._close();
      if (options.onCreated) await options.onCreated(data);
    } catch (err) {
      errorEl.textContent = err.message;
      submit.disabled = false;
      submit.textContent = "Create order + invoice";
    }
  });

  fillSelect();
  renderDraft();
}

/* ============================ PAYMENT MODAL ============================ */

async function openPaymentModal(options) {
  const opts = options || {};
  const pop = openModal("sup-payment-modal");
  const box = pop._box;
  box.innerHTML = '<div class="pc-empty">Loading invoice...</div>';

  let invoices = [];
  try {
    if (opts.invoice && opts.invoice.id) {
      invoices = [opts.invoice];
    } else {
      const res = await api(
        "/api/suppliers/" + encodeURIComponent(opts.supplierId) + "/invoices?page=1&limit=50"
      );
      if (!res) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Invoice list load hoyni");
      invoices = (Array.isArray(data.invoices) ? data.invoices : []).filter(
        (inv) => inv.state === "active" && int(inv.dueAmountPaisa) > 0
      );
    }
  } catch (err) {
    box.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>
      <div class="sup-modal-actions"><button type="button" class="btn-ghost" data-close>Close</button></div>`;
    box.querySelector("[data-close]").addEventListener("click", () => pop._close());
    return;
  }

  if (!pop.isConnected) return;
  if (!invoices.length) {
    toast("Payment korar moto due invoice nei", "err");
    pop._close();
    return;
  }

  const fixed = !!(opts.invoice && opts.invoice.id);
  const first = invoices[0];
  const firstDue = int(first.dueAmountPaisa);
  box.innerHTML = modalHead("Record payment", opts.supplierName || first.supplierName || "Supplier invoice", "Close") + `
    <form class="sup-form" novalidate>
      <div class="sup-form-grid">
        ${fixed
          ? `<div class="sup-field full"><span>Invoice</span><b>${esc(first.invoiceNo || "—")} · due ${fmtPaisa(firstDue)}</b></div>`
          : `<label class="full"><span>Invoice *</span>
              <select id="supPayInvoice">
                ${invoices
                  .map(
                    (inv) =>
                      `<option value="${esc(inv.id)}">${esc(inv.invoiceNo)} · due ${fmtPaisa(inv.dueAmountPaisa)}</option>`
                  )
                  .join("")}
              </select>
            </label>`}
        <label><span>Amount (৳) *</span><input id="supPayAmount" type="number" min="0.01" step="0.01" value="${(firstDue / 100).toFixed(2)}" required /></label>
        <label><span>Method *</span>
          <select id="supPayMethod">
            ${Object.keys(PAYMENT_METHODS)
              .map((key) => `<option value="${key}">${PAYMENT_METHODS[key]}</option>`)
              .join("")}
          </select>
        </label>
        <label><span>Payment date *</span><input id="supPayDate" type="date" value="${dateInput()}" required /></label>
        <label><span>Reference</span><input id="supPayRef" type="text" maxlength="120" placeholder="Txn ID / cheque no." /></label>
        <label class="full"><span>Note</span><textarea id="supPayNote" rows="2" maxlength="300"></textarea></label>
      </div>
      <p class="sup-hint" id="supPayDueHint">Invoice due: ${fmtPaisa(firstDue)}</p>
      <p class="sup-form-error" id="supPayError"></p>
      <div class="sup-modal-actions">
        <button type="button" class="btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn-gold" id="supPaySave">Record payment</button>
      </div>
    </form>`;

  const errorEl = box.querySelector("#supPayError");
  const amountInput = box.querySelector("#supPayAmount");
  const dueHint = box.querySelector("#supPayDueHint");
  box.querySelector(".sup-close").addEventListener("click", () => pop._close());
  box.querySelector("[data-cancel]").addEventListener("click", () => pop._close());

  function selectedInvoice() {
    if (fixed) return first;
    const id = box.querySelector("#supPayInvoice")?.value;
    return invoices.find((inv) => String(inv.id) === String(id)) || first;
  }

  function updateDue() {
    const invoice = selectedInvoice();
    const due = int(invoice.dueAmountPaisa);
    dueHint.textContent = "Invoice due: " + fmtPaisa(due);
    amountInput.max = (due / 100).toFixed(2);
    if (toPaisa(amountInput.value) > due) amountInput.value = (due / 100).toFixed(2);
  }

  if (!fixed) box.querySelector("#supPayInvoice")?.addEventListener("change", updateDue);

  box.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const invoice = selectedInvoice();
    const due = int(invoice.dueAmountPaisa);
    const amountPaisa = toPaisa(amountInput.value);
    if (!Number.isInteger(amountPaisa) || amountPaisa < 1) {
      errorEl.textContent = "Amount positive hote hobe";
      return;
    }
    if (amountPaisa > due) {
      errorEl.textContent = "Payment due er beshi hote parbe na (due: " + fmtPaisa(due) + ")";
      return;
    }
    const ok = await window.confirmDialog({
      title: "Record this payment?",
      text: fmtPaisa(amountPaisa) + " " + (invoice.invoiceNo || "invoice") + " e record hobe. Due thakbe " + fmtPaisa(due - amountPaisa) + ".",
      okLabel: "Record payment",
    });
    if (!ok) return;

    const save = box.querySelector("#supPaySave");
    save.disabled = true;
    save.textContent = "Recording...";
    try {
      const res = await api("/api/suppliers/invoices/" + encodeURIComponent(invoice.id) + "/payments", {
        method: "POST",
        body: JSON.stringify({
          amountPaisa,
          method: box.querySelector("#supPayMethod").value,
          reference: box.querySelector("#supPayRef").value.trim(),
          paidAt: box.querySelector("#supPayDate").value,
          note: box.querySelector("#supPayNote").value.trim(),
        }),
      });
      if (!res) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Payment record hoyni");
      toast("Payment record hoyeche", "ok");
      pop._close();
      if (opts.onDone) await opts.onDone(data);
    } catch (err) {
      errorEl.textContent = err.message;
      save.disabled = false;
      save.textContent = "Record payment";
    }
  });
}

/* ============================ INVOICE MODAL ============================ */

async function openInvoiceModal(invoiceId, options) {
  const opts = options || {};
  const pop = openModal("sup-invoice-modal");
  const box = pop._box;
  let data = null;
  let notice = "";
  let noticeTone = "";

  const notifyChanged = async () => {
    if (opts.onChanged) await opts.onChanged();
  };

  async function load() {
    box.innerHTML = '<div class="pc-empty">Loading invoice...</div>';
    try {
      const res = await api("/api/suppliers/invoices/" + encodeURIComponent(invoiceId));
      if (!res) return;
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || "Invoice load hoyni");
      data = payload;
      if (!pop.isConnected) return;
      render();
    } catch (err) {
      box.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>
        <div class="sup-modal-actions"><button type="button" class="btn-ghost" data-close>Close</button></div>`;
      box.querySelector("[data-close]")?.addEventListener("click", () => pop._close());
    }
  }

  function render() {
    const invoice = data.invoice || {};
    const supplier = data.supplier || {};
    const order = data.order || null;
    const payments = Array.isArray(data.payments) ? data.payments : [];
    const active = invoice.state === "active";
    const due = invoiceDueView(invoice);
    const actions = [];
    actions.push(`<button type="button" class="btn-ghost" data-print>Print / PDF</button>`);
    if (active && due > 0) {
      actions.push('<button type="button" class="btn-gold" data-pay>Record payment</button>');
    }
    if (active) {
      actions.push(`<button type="button" class="btn-ghost" data-hold>${invoice.holdFlag ? "Clear hold" : "Put on hold"}</button>`);
      actions.push('<button type="button" class="btn-ghost sup-danger" data-void-invoice>Void invoice</button>');
    }
    if (order && order.status === "ordered") {
      actions.push('<button type="button" class="btn-ghost" data-receive>Mark received</button>');
    }
    if (order && order.status !== "cancelled") {
      actions.push('<button type="button" class="btn-ghost sup-danger" data-cancel-order>Cancel order</button>');
    }

    box.innerHTML = `
      <div class="sup-modal-head">
        <span class="sup-avatar sup-avatar-lg">${esc(initials(supplier.name || invoice.supplierName))}</span>
        <div class="sup-modal-head-main">
          <h3>${esc(invoice.invoiceNo || "Invoice")}</h3>
          <div class="sup-modal-sub">${esc(supplier.name || invoice.supplierName || "Supplier")}${supplier.companyName ? " · " + esc(supplier.companyName) : ""}</div>
          <div class="sup-head-badges">${active ? payBadge(invoice.paymentStatus) : '<span class="sup-badge is-void">Void</span>'}</div>
        </div>
        <button type="button" class="sup-close" aria-label="Close">×</button>
      </div>
      ${notice ? `<div class="sup-notice ${noticeTone === "ok" ? "is-ok" : "is-warn"}">${esc(notice)}</div>` : ""}
      ${invoice.voidReason ? `<div class="sup-notice is-warn">Void reason: ${esc(invoice.voidReason)}</div>` : ""}
      ${invoice.holdFlag && invoice.holdReason ? `<div class="sup-notice is-warn">Hold reason: ${esc(invoice.holdReason)}</div>` : ""}
      <div class="sup-grid sup-invoice-meta">
        ${field("Issue date", fmtDate(invoice.issueDate))}
        ${field("Purchase order", invoice.orderNo || "—")}
        ${field("Order status", order ? ORDER_STATUS_LABEL[order.status] || order.status : "—")}
        ${field("Stock applied", order ? (order.stockApplied ? "Yes" : "No") : "—")}
      </div>
      <div class="sup-summary sup-summary-3">
        <div class="sup-stat"><span>Invoice total</span><b>${fmtPaisa(invoice.totalAmountPaisa)}</b></div>
        <div class="sup-stat"><span>Paid</span><b class="is-gold">${fmtPaisa(invoice.paidAmountPaisa)}</b></div>
        <div class="sup-stat"><span>Due</span><b class="${due > 0 ? "is-danger" : ""}">${fmtPaisa(due)}</b></div>
      </div>
      <section class="sup-section">
        <h4>Line items <span>${(invoice.lines || []).length}</span></h4>
        <div class="sup-table-wrap"><table class="sup-table sup-inner-table">
          <thead><tr><th>Product</th><th>Code</th><th>Qty</th><th>Unit cost</th><th>Line total</th></tr></thead>
          <tbody>${(invoice.lines || [])
            .map(
              (line) => `<tr>
                <td data-label="Product">${esc(line.name)}</td>
                <td data-label="Code">${esc(line.productCode)}</td>
                <td data-label="Qty">${int(line.quantity)}</td>
                <td data-label="Unit cost">${fmtPaisa(line.unitCostPaisa)}</td>
                <td data-label="Line total"><b>${fmtPaisa(line.lineTotalPaisa)}</b></td>
              </tr>`
            )
            .join("")}</tbody>
        </table></div>
      </section>
      <section class="sup-section">
        <h4>Payments <span>${payments.length}</span></h4>
        ${payments.length
          ? `<div class="sup-table-wrap"><table class="sup-table sup-inner-table">
              <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Status</th><th></th></tr></thead>
              <tbody>${payments
                .map(
                  (p) => `<tr>
                    <td data-label="Date">${fmtDate(p.paidAt)}</td>
                    <td data-label="Amount"><b>${fmtPaisa(p.amountPaisa)}</b></td>
                    <td data-label="Method">${esc(PAYMENT_METHODS[p.method] || p.method || "—")}</td>
                    <td data-label="Reference">${esc(p.reference || "—")}</td>
                    <td data-label="Status">${p.state === "void" ? '<span class="sup-badge is-void">Void</span>' : '<span class="sup-badge is-paid">Active</span>'}</td>
                    <td data-label="Action">${p.state === "active" ? `<button type="button" class="sup-link sup-danger-text" data-void-pay="${esc(p.id)}">Void</button>` : ""}</td>
                  </tr>`
                )
                .join("")}</tbody>
            </table></div>`
          : '<p class="sup-muted">Ekhono kono payment nei.</p>'}
      </section>
      <div class="sup-modal-actions sup-invoice-actions">${actions.join("")}</div>
    `;

    box.querySelector(".sup-close").addEventListener("click", () => pop._close());
    box.querySelector("[data-print]")?.addEventListener("click", () => printInvoice(invoiceId));
    box.querySelector("[data-pay]")?.addEventListener("click", () => {
      openPaymentModal({
        supplierId: invoice.supplierId,
        supplierName: supplier.name || invoice.supplierName,
        invoice,
        onDone: async () => {
          await load();
          await notifyChanged();
        },
      });
    });
    box.querySelector("[data-hold]")?.addEventListener("click", () => toggleHold(invoice, active));
    box.querySelector("[data-void-invoice]")?.addEventListener("click", () => voidInvoiceFlow(invoice));
    box.querySelector("[data-receive]")?.addEventListener("click", () => receiveOrderFlow(order));
    box.querySelector("[data-cancel-order]")?.addEventListener("click", () => cancelOrderFlow(order));
    box.querySelectorAll("[data-void-pay]").forEach((btn) => {
      btn.addEventListener("click", () => voidPaymentInInvoice(btn.dataset.voidPay));
    });
  }

  async function toggleHold(invoice, active) {
    if (!active) return;
    if (invoice.holdFlag) {
      const ok = await window.confirmDialog({
        title: "Clear this hold?",
        text: "Hold clear hole invoice abar normal due/paid status e fire jabe.",
        okLabel: "Clear hold",
      });
      if (!ok) return;
      try {
        const res = await api("/api/suppliers/invoices/" + encodeURIComponent(invoice.id) + "/hold", {
          method: "PATCH",
          body: JSON.stringify({ holdFlag: false }),
        });
        if (!res) return;
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.message || "Hold clear hoyni");
        toast("Hold clear hoyeche", "ok");
        await load();
        await notifyChanged();
      } catch (err) {
        toast(err.message, "err");
      }
      return;
    }
    const reason = await askReason({
      title: "Put invoice on hold?",
      text: "Hold status payment er age priority dekhabe. Reason audit log e jabe.",
      label: "Hold reason",
      placeholder: "Keno hold korchen?",
      okLabel: "Put on hold",
    });
    if (reason === null) return;
    try {
      const res = await api("/api/suppliers/invoices/" + encodeURIComponent(invoice.id) + "/hold", {
        method: "PATCH",
        body: JSON.stringify({ holdFlag: true, reason }),
      });
      if (!res) return;
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || "Invoice hold hoyni");
      toast("Invoice hold e deya hoyeche", "ok");
      await load();
      await notifyChanged();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  async function voidInvoiceFlow(invoice) {
    const reason = await askReason({
      title: "Void this invoice?",
      text: "Void invoice totals theke bad jabe. Jodi order received ar stock applied hoy, stock reversal hobe.",
      label: "Void reason",
      placeholder: "Keno void korchen?",
      okLabel: "Void invoice",
    });
    if (reason === null) return;
    try {
      const res = await api("/api/suppliers/invoices/" + encodeURIComponent(invoice.id) + "/void", {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      if (!res) return;
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || "Invoice void hoyni");
      toast(payload.stockReversed ? "Invoice void — stock reverse hoyeche" : "Invoice void hoyeche", "ok");
      notice = payload.stockReversed ? "Invoice void kora hoyeche. Stock reversal stock log e ache." : "Invoice void kora hoyeche.";
      noticeTone = "warn";
      await load();
      await notifyChanged();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  async function receiveOrderFlow(order) {
    if (!order) return;
    const auto = access.autoAdjustStock === true;
    const ok = await window.confirmDialog({
      title: "Mark this order as received?",
      text: auto
        ? "Auto stock setting ON ache. Receive korle product stock automatically barbe ar stock log e auto entry hobe."
        : "Auto stock setting OFF ache. Receive korle stock change hobe na — product stock manually adjust korte hobe.",
      okLabel: "Receive order",
    });
    if (!ok) return;
    try {
      const res = await api("/api/suppliers/orders/" + encodeURIComponent(order.id) + "/receive", {
        method: "POST",
        body: "{}",
      });
      if (!res) return;
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || "Order receive hoyni");
      notice = payload.message || (auto ? "Stock auto update hoyeche." : "Stock not changed. Adjust manually.");
      noticeTone = payload.stockChanged ? "ok" : "warn";
      toast(notice, payload.stockChanged ? "ok" : "");
      await load();
      await notifyChanged();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  async function cancelOrderFlow(order) {
    if (!order) return;
    const reason = await askReason({
      title: "Cancel this purchase order?",
      text: order.stockApplied
        ? "Order cancel korle stock reversal hobe. Negative stock hole cancel block hobe."
        : "Order cancel korle invoice void hobe. Stock applied chilo na, tai stock change hobe na.",
      label: "Cancel reason",
      placeholder: "Keno cancel korchen?",
      okLabel: "Cancel order",
    });
    if (reason === null) return;
    try {
      const res = await api("/api/suppliers/orders/" + encodeURIComponent(order.id) + "/cancel", {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      if (!res) return;
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || "Order cancel hoyni");
      toast(payload.stockReversed ? "Order cancel — stock reverse hoyeche" : "Order cancel hoyeche", "ok");
      notice = payload.stockReversed ? "Order cancel kora hoyeche ar stock reverse kora hoyeche." : "Order cancel kora hoyeche.";
      noticeTone = "warn";
      await load();
      await notifyChanged();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  async function voidPaymentInInvoice(paymentId) {
    const reason = await askReason({
      title: "Void this payment?",
      text: "Payment void hole invoice er paid amount theke ei taka bad jabe.",
      label: "Void reason",
      placeholder: "Keno void korchen?",
      okLabel: "Void payment",
    });
    if (reason === null) return;
    try {
      const res = await api("/api/suppliers/payments/" + encodeURIComponent(paymentId) + "/void", {
        method: "PATCH",
        body: JSON.stringify({ reason }),
      });
      if (!res) return;
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || "Payment void hoyni");
      toast("Payment void hoyeche", "ok");
      await load();
      await notifyChanged();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  await load();
}

async function printInvoice(invoiceId) {
  const win = window.open("", "_blank");
  if (!win) {
    toast("Popup block kora ache — browser e popup allow korun", "err");
    return;
  }
  try {
    const res = await api("/api/suppliers/invoices/" + encodeURIComponent(invoiceId) + "/print");
    if (!res) {
      win.close();
      return;
    }
    if (!res.ok) {
      win.close();
      let message = "Invoice print load hoyni";
      try {
        const data = await res.json();
        message = data.message || message;
      } catch {
        /* ignore */
      }
      toast(message, "err");
      return;
    }
    const html = await res.text();
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    win.close();
    toast("Invoice print load hoyni", "err");
  }
}

/* ============================ STOCK MODAL ============================ */

async function openStockModal(supplier, options) {
  const opts = options || {};
  const pop = openModal("sup-stock-modal");
  const box = pop._box;
  box.innerHTML = '<div class="pc-empty">Loading products...</div>';

  let products = [];
  try {
    const res = await api("/api/suppliers/product-options");
    if (!res) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Product list load hoyni");
    products = (Array.isArray(data.products) ? data.products : []).filter(
      (p) => !p.supplierId || String(p.supplierId) === String(supplier.id)
    );
  } catch (err) {
    box.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>
      <div class="sup-modal-actions"><button type="button" class="btn-ghost" data-close>Close</button></div>`;
    box.querySelector("[data-close]").addEventListener("click", () => pop._close());
    return;
  }

  if (!pop.isConnected) return;
  if (!products.length) {
    toast("Ei supplier er jonno adjust korar moto product nei", "err");
    pop._close();
    return;
  }

  box.innerHTML = modalHead("Adjust stock", (supplier.name || "Supplier") + " · manual ledger entry", "Close") + `
    <form class="sup-form" novalidate>
      <div class="sup-form-grid">
        <label class="full"><span>Product *</span>
          <select id="supStockProduct">
            ${products
              .map(
                (p) =>
                  `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.sku || "no SKU")} · stock ${int(p.stock)}</option>`
              )
              .join("")}
          </select>
        </label>
        <label><span>Stock change *</span><input id="supStockChange" type="number" step="1" min="-1000000" max="1000000" placeholder="e.g. 10 or -2" required /></label>
        <label class="full"><span>Reason *</span><input id="supStockReason" type="text" maxlength="300" placeholder="Manual count correction, damage, etc." required /></label>
      </div>
      <p class="sup-hint">Positive number stock barabe, negative number komabe. Ei entry stock log e manual hisebe thakbe.</p>
      <p class="sup-form-error" id="supStockError"></p>
      <div class="sup-modal-actions">
        <button type="button" class="btn-ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn-gold" id="supStockSave">Apply adjustment</button>
      </div>
    </form>`;

  const errorEl = box.querySelector("#supStockError");
  box.querySelector(".sup-close").addEventListener("click", () => pop._close());
  box.querySelector("[data-cancel]").addEventListener("click", () => pop._close());
  box.querySelector("#supStockChange").focus();

  box.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const change = Number(box.querySelector("#supStockChange").value);
    if (!Number.isInteger(change) || change === 0) {
      errorEl.textContent = "Stock change non-zero integer hote hobe";
      return;
    }
    const reason = box.querySelector("#supStockReason").value.trim();
    if (reason.length < 3) {
      errorEl.textContent = "Reason ontoto 3 character likhun";
      return;
    }
    const save = box.querySelector("#supStockSave");
    save.disabled = true;
    save.textContent = "Applying...";
    try {
      const res = await api("/api/suppliers/" + encodeURIComponent(supplier.id) + "/stock-adjustments", {
        method: "POST",
        body: JSON.stringify({
          productId: box.querySelector("#supStockProduct").value,
          change,
          reason,
        }),
      });
      if (!res) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Stock adjustment hoyni");
      toast("Stock adjust hoyeche — ekhon " + int(data.stockAfter) + " stock", "ok");
      pop._close();
      if (opts.onDone) await opts.onDone(data);
    } catch (err) {
      errorEl.textContent = err.message;
      save.disabled = false;
      save.textContent = "Apply adjustment";
    }
  });
}

/* ============================ SETTINGS ============================ */

async function openSettingsModal() {
  const pop = openModal("sup-settings-modal");
  const box = pop._box;
  box.innerHTML = '<div class="pc-empty">Loading settings...</div>';

  let payload;
  try {
    const res = await api("/api/suppliers/settings");
    if (!res) return;
    payload = await res.json();
    if (!res.ok) throw new Error(payload.message || "Settings load hoyni");
  } catch (err) {
    box.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>
      <div class="sup-modal-actions"><button type="button" class="btn-ghost" data-close>Close</button></div>`;
    box.querySelector("[data-close]").addEventListener("click", () => pop._close());
    return;
  }

  if (!pop.isConnected) return;
  const settings = payload.settings || {};
  const canManage = payload.canManageSettings === true;
  let auto = settings.autoAdjustStock === true;

  box.innerHTML = modalHead("Supplier settings", "Purchase receiving ar stock behavior", "Close") + `
    <div class="sup-settings-row">
      <div>
        <b id="supAutoLabel">Auto adjust stock when received</b>
        <p class="sup-hint">${auto
          ? "Mark as received korle product stock automatically barbe."
          : "Receive korle stock change hobe na. Admin manually adjust korben."}</p>
      </div>
      <button type="button" class="sup-switch" id="supAutoSwitch" role="switch" aria-checked="${auto}" aria-labelledby="supAutoLabel" ${canManage ? "" : "disabled"}>
        <span class="sup-switch-knob"></span>
      </button>
    </div>
    <div class="sup-state-line"><span id="supAutoState">${auto ? "ON" : "OFF"}</span> · superadmin only</div>
    <form class="sup-form" novalidate>
      <div class="sup-form-grid">
        <label><span>Max quantity per order line</span>
          <input id="supMaxQty" type="number" min="1" max="1000000" step="1" value="${int(settings.maxOrderQty) || 10000}" ${canManage ? "" : "disabled"} />
        </label>
        <label><span>Report timezone</span>
          <input value="${esc(settings.timezone || "Asia/Dhaka")}" disabled />
        </label>
      </div>
      <p class="sup-hint">Auto stock setting OFF rakhe safely shuru korun. ON korle receive order stock auto update korbe; OFF korle app stock touch korbe na.</p>
      <p class="sup-form-error" id="supSettingsError"></p>
      <div class="sup-modal-actions">
        <button type="button" class="btn-ghost" data-cancel>Close</button>
        ${canManage ? '<button type="submit" class="btn-gold" id="supSettingsSave">Save settings</button>' : ""}
      </div>
    </form>
    ${canManage ? "" : '<p class="sup-readonly-note">Shudhu superadmin ei setting change korte parben. Apni read-only mode e dekhchen.</p>'}
  `;

  box.querySelector(".sup-close").addEventListener("click", () => pop._close());
  box.querySelector("[data-cancel]").addEventListener("click", () => pop._close());

  const switchBtn = box.querySelector("#supAutoSwitch");
  const autoState = box.querySelector("#supAutoState");
  switchBtn.addEventListener("click", () => {
    if (!canManage) return;
    auto = !auto;
    switchBtn.setAttribute("aria-checked", String(auto));
    autoState.textContent = auto ? "ON" : "OFF";
    const hint = box.querySelector(".sup-settings-row .sup-hint");
    hint.textContent = auto
      ? "Mark as received korle product stock automatically barbe."
      : "Receive korle stock change hobe na. Admin manually adjust korben.";
  });

  box.querySelector("form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canManage) return;
    const errorEl = box.querySelector("#supSettingsError");
    errorEl.textContent = "";
    const maxQty = Number(box.querySelector("#supMaxQty").value);
    if (!Number.isInteger(maxQty) || maxQty < 1 || maxQty > 1000000) {
      errorEl.textContent = "Max quantity 1-1000000 er modhye integer hote hobe";
      return;
    }
    const ok = await window.confirmDialog({
      title: "Save supplier settings?",
      text: "Auto stock: " + (auto ? "ON" : "OFF") + " · Max qty per line: " + maxQty + ". Ei change audit log e jabe.",
      okLabel: "Save settings",
    });
    if (!ok) return;
    const save = box.querySelector("#supSettingsSave");
    save.disabled = true;
    save.textContent = "Saving...";
    try {
      const res = await api("/api/suppliers/settings", {
        method: "PATCH",
        body: JSON.stringify({ autoAdjustStock: auto, maxOrderQty: maxQty }),
      });
      if (!res) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Settings save hoyni");
      access.loaded = true;
      access.canManageSettings = data.canManageSettings === true;
      access.canPurge = data.canPurge === true;
      access.settings = data.settings || null;
      access.autoAdjustStock = data.settings ? data.settings.autoAdjustStock === true : auto;
      access.maxOrderQty = data.settings ? int(data.settings.maxOrderQty) || maxQty : maxQty;
      access.timezone = (data.settings && data.settings.timezone) || access.timezone;
      toast("Supplier settings saved", "ok");
      pop._close();
    } catch (err) {
      errorEl.textContent = err.message;
      save.disabled = false;
      save.textContent = "Save settings";
    }
  });
}

/* ============================= HISTORY ============================= */

async function openHistory() {
  historyState.period = "daily";
  historyState.page = 1;
  renderHistoryShell();
  await loadAccess();
  loadHistory();
}

function renderHistoryShell() {
  const root = el(HISTORY_ROOT);
  if (!root) return;
  root.innerHTML = `
    <div class="sup-history-toolbar">
      <div class="pc-filter-bar sup-history-periods" role="group" aria-label="Report period">
        ${["daily", "monthly", "yearly"]
          .map(
            (p) =>
              `<button type="button" class="pc-chip" data-period="${p}" aria-pressed="${historyState.period === p}">${p.charAt(0).toUpperCase() + p.slice(1)}</button>`
          )
          .join("")}
      </div>
      <span class="sup-history-tz" id="supHistoryTz"></span>
    </div>
    <div id="supHistorySummary" class="sup-summary">${summaryLoading()}</div>
    <div class="sup-card sup-chart-card">
      <div class="sup-card-head"><h3>Purchase trend</h3><span class="sup-legend"><i class="is-total"></i>Total <i class="is-paid"></i>Paid</span></div>
      <div id="supChart"><div class="pc-empty">Loading chart...</div></div>
    </div>
    <div class="sup-card">
      <div class="sup-card-head"><h3>Invoices</h3><span id="supHistoryCount" class="sup-muted"></span></div>
      <div id="supHistoryList"><div class="pc-empty">Loading invoices...</div></div>
      <div id="supHistoryFoot" class="pc-foot"></div>
    </div>
  `;
  root.querySelectorAll("[data-period]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (historyState.period === btn.dataset.period) return;
      historyState.period = btn.dataset.period;
      historyState.page = 1;
      root.querySelectorAll("[data-period]").forEach((b) => {
        b.setAttribute("aria-pressed", String(b.dataset.period === historyState.period));
      });
      loadHistory();
    });
  });
}

function summaryLoading() {
  return `
    <div class="sup-stat"><span>Invoices</span><b>—</b></div>
    <div class="sup-stat"><span>Purchase total</span><b>—</b></div>
    <div class="sup-stat"><span>Paid</span><b>—</b></div>
    <div class="sup-stat"><span>Due</span><b>—</b></div>`;
}

async function loadHistory() {
  const summary = el("supHistorySummary");
  const chart = el("supChart");
  const list = el("supHistoryList");
  const foot = el("supHistoryFoot");
  if (!summary || !chart || !list) return;

  const requestId = ++historyState.requestId;
  summary.innerHTML = summaryLoading();
  chart.innerHTML = '<div class="pc-empty">Loading chart...</div>';
  list.innerHTML = '<div class="pc-empty">Loading invoices...</div>';
  if (foot) foot.innerHTML = "";

  const params = new URLSearchParams({
    period: historyState.period,
    page: String(historyState.page),
    limit: String(historyState.limit),
  });

  try {
    const res = await api("/api/suppliers/reports?" + params.toString());
    if (!res) return;
    const data = await res.json();
    if (requestId !== historyState.requestId) return;
    if (!res.ok) throw new Error(data.message || "Report load hoyni");
    historyState.data = data;
    if (historyState.page > (data.pages || 1)) {
      historyState.page = data.pages || 1;
      return loadHistory();
    }

    const tz = el("supHistoryTz");
    if (tz) tz.textContent = "Timezone: " + (data.timezone || "Asia/Dhaka");
    summary.innerHTML = historySummaryHtml(data.summary || {});
    chart.innerHTML = chartHtml(data.buckets || [], historyState.period);
    renderHistoryInvoices(list, data.invoices || []);
    const count = el("supHistoryCount");
    if (count) count.textContent = int(data.total) + " invoice" + (int(data.total) === 1 ? "" : "s");
    renderHistoryFoot(foot, data);
  } catch (err) {
    if (requestId !== historyState.requestId) return;
    summary.innerHTML = "";
    chart.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>`;
    list.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>`;
  }
}

function historySummaryHtml(summary) {
  return `
    <div class="sup-stat"><span>Invoices</span><b>${int(summary.invoiceCount).toLocaleString("en-IN")}</b></div>
    <div class="sup-stat"><span>Purchase total</span><b class="is-gold">${fmtPaisa(summary.totalAmountPaisa)}</b></div>
    <div class="sup-stat"><span>Paid</span><b>${fmtPaisa(summary.paidAmountPaisa)}</b></div>
    <div class="sup-stat"><span>Due</span><b class="${int(summary.dueAmountPaisa) > 0 ? "is-danger" : ""}">${fmtPaisa(summary.dueAmountPaisa)}</b></div>`;
}

function chartHtml(buckets, period) {
  const hasData = buckets.some((b) => int(b.totalAmountPaisa) > 0 || int(b.paidAmountPaisa) > 0);
  if (!buckets.length || !hasData) {
    return '<div class="pc-empty">Ei period e kono purchase invoice nei.</div>';
  }
  const max = Math.max(1, ...buckets.map((b) => Math.max(int(b.totalAmountPaisa), int(b.paidAmountPaisa))));
  const groupWidth = 66;
  const padX = 22;
  const width = Math.max(620, padX * 2 + buckets.length * groupWidth);
  const height = 236;
  const chartTop = 20;
  const baseline = 186;
  const chartHeight = baseline - chartTop;

  const bars = buckets
    .map((bucket, index) => {
      const x = padX + index * groupWidth;
      const total = int(bucket.totalAmountPaisa);
      const paid = int(bucket.paidAmountPaisa);
      const totalH = Math.round((total / max) * chartHeight);
      const paidH = Math.round((paid / max) * chartHeight);
      const shortLabel =
        period === "daily"
          ? String(bucket.label || "").split(" ").slice(0, 2).join(" ")
          : String(bucket.label || "");
      const title = `${bucket.label}: total ${fmtPaisa(total)}, paid ${fmtPaisa(paid)}, due ${fmtPaisa(bucket.dueAmountPaisa)}`;
      return `<g>
        <title>${esc(title)}</title>
        <rect class="sup-bar-total" x="${x + 10}" y="${baseline - totalH}" width="20" height="${Math.max(totalH, total ? 2 : 0)}" rx="3"></rect>
        <rect class="sup-bar-paid" x="${x + 34}" y="${baseline - paidH}" width="20" height="${Math.max(paidH, paid ? 2 : 0)}" rx="3"></rect>
        <text class="sup-axis-label" x="${x + 32}" y="${baseline + 18}" text-anchor="middle">${esc(shortLabel)}</text>
        <text class="sup-axis-count" x="${x + 32}" y="${baseline + 34}" text-anchor="middle">${int(bucket.invoiceCount)} inv</text>
      </g>`;
    })
    .join("");

  return `<div class="sup-chart-scroll">
    <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Supplier purchase totals chart">
      <line class="sup-grid-line" x1="${padX}" y1="${baseline}" x2="${width - padX}" y2="${baseline}"></line>
      <line class="sup-grid-line" x1="${padX}" y1="${baseline - chartHeight / 2}" x2="${width - padX}" y2="${baseline - chartHeight / 2}" stroke-dasharray="4 5"></line>
      ${bars}
    </svg>
  </div>`;
}

function renderHistoryInvoices(container, invoices) {
  if (!invoices.length) {
    container.innerHTML = '<div class="pc-empty">Ei period e kono invoice nei.</div>';
    return;
  }
  container.innerHTML = `<div class="sup-table-wrap"><table class="sup-table sup-history-table">
    <thead><tr><th>Invoice</th><th>Supplier</th><th>Issued</th><th>Order</th><th>Qty</th><th>Total</th><th>Due</th><th>Payment</th></tr></thead>
    <tbody>${invoices
      .map(
        (inv) => `<tr data-history-invoice="${esc(inv.id)}">
          <td data-label="Invoice"><b>${esc(inv.invoiceNo)}</b></td>
          <td data-label="Supplier"><b>${esc(inv.supplierName || "—")}</b><small class="sup-cell-sub">${esc(inv.companyName || "")}</small></td>
          <td data-label="Issued">${fmtDate(inv.issueDate)}</td>
          <td data-label="Order">${esc(inv.orderNo || "—")}<small class="sup-cell-sub">${esc(ORDER_STATUS_LABEL[inv.orderStatus] || inv.orderStatus || "")}</small></td>
          <td data-label="Qty">${int(inv.totalQty)}</td>
          <td data-label="Total">${fmtPaisa(inv.totalAmountPaisa)}</td>
          <td data-label="Due">${fmtPaisa(invoiceDueView(inv))}</td>
          <td data-label="Payment">${payBadge(inv.paymentStatus)}</td>
        </tr>`
      )
      .join("")}</tbody>
  </table></div>`;

  container.querySelectorAll("[data-history-invoice]").forEach((tr) => {
    tr.addEventListener("click", () => {
      openInvoiceModal(tr.dataset.historyInvoice, {
        onChanged: async () => {
          await loadHistory();
        },
      });
    });
  });
}

function renderHistoryFoot(foot, data) {
  if (!foot) return;
  if (!data.total) {
    foot.innerHTML = "";
    return;
  }
  const from = (data.page - 1) * data.limit + 1;
  const to = Math.min(data.page * data.limit, data.total);
  foot.innerHTML = `<div class="sup-foot-info"><span>Showing ${from}–${to} of ${data.total} invoices</span></div>
    <div class="sup-pager" id="supHistoryPager" role="navigation" aria-label="Report pagination"></div>`;
  buildPager(el("supHistoryPager"), data.page, data.pages, (page) => {
    historyState.page = page;
    loadHistory();
  });
}

async function exportHistory() {
  try {
    const res = await api("/api/suppliers/reports/export?period=" + encodeURIComponent(historyState.period));
    if (!res) return;
    if (!res.ok) {
      let message = "Export hoyni";
      try {
        const data = await res.json();
        message = data.message || message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    let filename = "supplier-orders-" + historyState.period + "-" + dateInput() + ".csv";
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/i);
    if (match) filename = match[1];
    const url = URL.createObjectURL(blob);
    downloadUrl(url, filename);
    toast("CSV export download hoyeche", "ok");
  } catch (err) {
    toast(err.message, "err");
  }
}

/* ============================== BOOT ============================== */

let topBound = false;
function bindDashboardActions() {
  if (topBound) return;
  topBound = true;
  el("supNewBtn")?.addEventListener("click", () => openSupplierForm(null));
  el("supSettingsBtn")?.addEventListener("click", openSettingsModal);
  el("supExportBtn")?.addEventListener("click", exportHistory);
}

bindDashboardActions();

window.supplierPage = { open };
window.supplierHistoryPage = { open: openHistory };
})();
