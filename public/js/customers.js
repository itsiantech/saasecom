/* ==========================================================================
   Customers — registered buyers, order/cancel stats, notes, password reset.
   Exposes window.customerPage = { open }
   Relies on dashboard.js globals: api, toast, money, esc, switchView,
   confirmDialog and orderCatalog.openOrder.
   ========================================================================== */
(function () {
"use strict";

const api = window.api;
const toast = window.toast;
const money = window.money;
const esc = window.esc;

const ROOT = "custRoot";
const PAGE_SIZES = [10, 20, 50];

const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 3h16v14H8l-4 4V3z"/><path d="M8 8h8M8 12h5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
};

const STATUS_LABELS = {
  pending: "Pending",
  processing: "Processing",
  on_the_way: "On the way",
  in_courier: "In courier",
  call_not_received: "Call not received",
  completed: "Completed",
  incomplete: "Incomplete",
  cancelled: "Cancelled",
  confirmed: "Confirmed",
  shipped: "Shipped",
  delivered: "Delivered",
};

function initialLimit() {
  try {
    const n = Number(localStorage.getItem("cust_page_size"));
    return PAGE_SIZES.includes(n) ? n : 10;
  } catch {
    return 10;
  }
}

const state = {
  search: "",
  page: 1,
  limit: initialLimit(),
  total: 0,
  pages: 1,
  rows: [],
  requestId: 0,
};

function el(id) {
  return document.getElementById(id);
}

function truncate(text, limit) {
  const value = String(text || "");
  return value.length > limit ? value.slice(0, limit - 1) + "…" : value;
}

function fmtDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function fmtDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

function statusLabel(value) {
  return STATUS_LABELS[value] || value || "—";
}

/* ===================== SHELL ===================== */

function open() {
  state.search = "";
  state.page = 1;
  state.requestId += 1;
  renderShell();
  loadList();
}

function renderShell() {
  const root = el(ROOT);
  if (!root) return;
  root.innerHTML = `
    <div class="cust-toolbar">
      <span class="cust-total">Total <b id="custTotalCount">—</b> registered buyers</span>
      <span class="cust-sort">Sort: Postal code ↓</span>
      <div class="pc-search cust-search">
        ${ICONS.search}
        <input type="search" id="custSearch" placeholder="Search name, phone, area..." aria-label="Search customers" />
      </div>
    </div>
    <div id="custTableWrap"><div class="pc-empty">Loading...</div></div>
    <div class="pc-foot" id="custFoot"></div>
  `;

  const input = el("custSearch");
  let timer = null;
  const runSearch = () => {
    clearTimeout(timer);
    state.page = 1;
    loadList();
  };
  input.addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.search = e.target.value.trim();
      state.page = 1;
      loadList();
    }, 320);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    clearTimeout(timer);
    state.search = e.target.value.trim();
    runSearch();
  });
}

/* ===================== LIST ===================== */

async function loadList() {
  const wrap = el("custTableWrap");
  if (!wrap) return;
  const requestId = ++state.requestId;
  wrap.innerHTML = '<div class="pc-empty">Loading...</div>';

  const params = new URLSearchParams({ page: String(state.page), limit: String(state.limit) });
  if (state.search) params.set("search", state.search);

  try {
    const res = await api("/api/customers?" + params.toString());
    if (!res) return;
    const data = await res.json();
    if (requestId !== state.requestId) return;
    if (!res.ok) throw new Error(data.message || "Customer list load hoyni");

    state.rows = data.customers || [];
    state.total = data.total || 0;
    state.pages = data.pages || 1;
    if (state.page > state.pages) {
      state.page = state.pages;
      return loadList();
    }

    const countEl = el("custTotalCount");
    if (countEl) countEl.textContent = String(state.total);
    renderTable();
    renderFoot();
  } catch (err) {
    if (requestId !== state.requestId) return;
    wrap.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>`;
  }
}

function cols() {
  return [
    "name", "phone", "email", "address", "orders", "spend", "country",
    "city", "region", "postal", "note", "status", "actions",
  ];
}

function headerFor(col) {
  switch (col) {
    case "name": return "Name";
    case "phone": return "Phone";
    case "email": return "Email";
    case "address": return "Address";
    case "orders": return "Orders";
    case "spend": return "Total spend";
    case "country": return "Country / Region";
    case "city": return "City";
    case "region": return "Region";
    case "postal": return 'Postal code <span class="cust-sort-arrow" aria-hidden="true">↓</span>';
    case "note": return "Note";
    case "status": return "Status";
    case "actions": return "Action";
    default: return "";
  }
}

function cellHtml(c, col) {
  switch (col) {
    case "name":
      return `<div class="cust-name">
        <span class="cust-avatar">${esc(initials(c.name))}</span>
        <div>
          <b>${esc(c.name || "Customer")}</b>
          <small>Last order ${fmtDate(c.lastOrderAt)}</small>
        </div>
      </div>`;
    case "phone":
      return `<span class="cust-line">${esc(c.phone || "—")}</span>`;
    case "email":
      return `<span class="cust-line cust-email">${esc(c.email || "—")}</span>`;
    case "address": {
      const line = [c.address, c.thana].filter(Boolean).join(", ");
      return `<span class="cust-line">${esc(line || "—")}</span>`;
    }
    case "orders":
      return `<div class="cust-orders"><b>${Number(c.orders) || 0}</b> order${Number(c.orders) === 1 ? "" : "s"}</div>
        <div class="${Number(c.cancelled) ? "cust-cancelled" : "cust-nocancel"}">${Number(c.cancelled) || 0} cancelled</div>`;
    case "spend":
      return `<span class="cust-spend">${money(c.totalSpend)}</span>`;
    case "country":
      return `<span class="cust-line">${esc(c.country || "—")}</span>`;
    case "city":
      return `<span class="cust-line">${esc(c.district || "—")}</span>`;
    case "region":
      return `<span class="cust-line">${esc(c.division || "—")}</span>`;
    case "postal":
      return `<span class="cust-postal">${esc(c.postCode || "—")}</span>`;
    case "note": {
      const note = c.latestNote;
      if (!note || !note.text) return '<span class="cust-muted">—</span>';
      const count = Number(c.noteCount) || 1;
      return `<div class="cust-note-text" title="${esc(note.text)}">${esc(truncate(note.text, 46))}</div>
        <div class="cust-note-count">${count} note${count > 1 ? "s" : ""}</div>`;
    }
    case "status":
      return '<span class="cust-status"><i></i>Registered</span>';
    case "actions":
      return `<div class="pc-row-actions">
        <button type="button" class="icon-btn edit" data-note="${esc(c.id)}" title="Add note">${ICONS.note}</button>
        <button type="button" class="icon-btn edit" data-edit="${esc(c.id)}" title="Edit customer">${ICONS.edit}</button>
        <button type="button" class="icon-btn del" data-del="${esc(c.id)}" title="Trash customer">${ICONS.trash}</button>
      </div>`;
    default:
      return "";
  }
}

function renderTable() {
  const wrap = el("custTableWrap");
  if (!wrap) return;
  if (!state.rows.length) {
    wrap.innerHTML = `<div class="pc-empty">
      <div>Kono registered customer pawa jayni.</div>
      <div class="cust-empty-hint">Customer account khule ei store theke order korle ekhane asbe. Guest orders customer list-e dhukbe na.</div>
      <div class="cust-empty-actions"><button type="button" class="btn-ghost" id="custViewOrders">View orders</button></div>
    </div>`;
    const ordersBtn = el("custViewOrders");
    if (ordersBtn) ordersBtn.addEventListener("click", () => window.switchView("orders"));
    return;
  }

  const c = cols();
  const thead = c.map((col) => `<th>${headerFor(col)}</th>`).join("");
  const tbody = state.rows.map((row) => {
    const id = esc(row.id);
    const cells = c.map((col) => `<td data-col="${col}" data-label="${esc(headerFor(col).replace(/<[^>]*>/g, ""))}">${cellHtml(row, col)}</td>`).join("");
    return `<tr data-row="${id}">${cells}</tr>`;
  }).join("");

  wrap.innerHTML = `<div class="pc-table-wrap cust-table-wrap"><table class="pc-table cust-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
  bindTable();
}

function bindTable() {
  const wrap = el("custTableWrap");
  if (!wrap) return;

  wrap.querySelectorAll("[data-note]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDetail(btn.dataset.note, { focusNote: true });
    });
  });
  wrap.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openEdit(btn.dataset.edit);
    });
  });
  wrap.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const row = state.rows.find((r) => String(r.id) === btn.dataset.del);
      if (row) await trashCustomer(row);
    });
  });
  wrap.querySelectorAll("tr[data-row]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button, a, input, select, textarea")) return;
      openDetail(tr.dataset.row);
    });
  });
}

function renderFoot() {
  const foot = el("custFoot");
  if (!foot) return;
  const from = state.total ? (state.page - 1) * state.limit + 1 : 0;
  const to = Math.min(state.page * state.limit, state.total);
  foot.innerHTML = `
    <div class="ol-foot-info">
      <span>Showing ${from}–${to} of ${state.total} customers</span>
      <label class="ol-page-size" for="custPageSize">Per page
        <select id="custPageSize" aria-label="Customers per page">
          ${PAGE_SIZES.map((n) => `<option value="${n}" ${state.limit === n ? "selected" : ""}>${n}</option>`).join("")}
        </select>
      </label>
    </div>
    <span class="spacer"></span>
    <div class="pc-pager" role="navigation" aria-label="Customer pagination"></div>
  `;

  el("custPageSize").addEventListener("change", (e) => {
    const n = Number(e.target.value);
    if (!PAGE_SIZES.includes(n)) return;
    state.limit = n;
    state.page = 1;
    try { localStorage.setItem("cust_page_size", String(n)); } catch { /* private mode */ }
    loadList();
  });

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
  if (win[0] > 1) {
    btn("1", 1);
    if (win[0] > 2) pager.appendChild(document.createTextNode("…"));
  }
  win.forEach((i) => btn(String(i), i, { current: i === state.page }));
  const last = win[win.length - 1];
  if (last < state.pages) {
    if (last < state.pages - 1) pager.appendChild(document.createTextNode("…"));
    btn(String(state.pages), state.pages);
  }
  btn("›", state.page + 1, { disabled: state.page >= state.pages });
}

/* ===================== OVERLAY ===================== */

function openPop(extraClass) {
  const pop = document.createElement("div");
  pop.className = "pc-pop cust-pop";
  const box = document.createElement("div");
  box.className = "pc-pop-box cust-modal " + (extraClass || "");
  pop.appendChild(box);
  document.body.appendChild(pop);

  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  const close = () => {
    document.removeEventListener("keydown", onKey);
    pop.remove();
  };
  document.addEventListener("keydown", onKey);
  pop.addEventListener("click", (e) => {
    if (e.target === pop) close();
  });
  pop._close = close;
  pop._box = box;
  return pop;
}

/* ===================== DETAIL ===================== */

async function openDetail(id, opts = {}) {
  const pop = openPop("cust-detail-modal");
  pop._box.innerHTML = '<div class="pc-empty">Loading customer...</div>';

  try {
    const res = await api("/api/customers/" + encodeURIComponent(id));
    if (!res) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Customer load hoyni");
    renderDetail(pop, data, opts);
  } catch (err) {
    pop._box.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>
      <div class="pc-pop-actions"><button type="button" class="btn-ghost" id="custDetailClose">Close</button></div>`;
    pop._box.querySelector("#custDetailClose").addEventListener("click", () => pop._close());
  }
}

function renderDetail(pop, data, opts = {}) {
  const c = data.customer || {};
  const orders = data.orders || [];
  const notes = c.notes || [];
  const box = pop._box;

  const fields = [
    ["Phone", c.phone],
    ["Email", c.email],
    ["Country / Region", c.country],
    ["City", c.district],
    ["Region", c.division],
    ["Postal code", c.postCode],
    ["Thana / Area", c.thana],
    ["Account", c.hasPassword ? "Registered · password set" : "Registered · Google / OTP"],
  ].map(([label, value]) => `<div class="cust-field"><span>${esc(label)}</span><b>${esc(value || "—")}</b></div>`).join("");

  const orderRows = orders.length
    ? orders.map((o) => `<button type="button" class="cust-order-row" data-order="${esc(o.id)}">
        <span class="cust-order-main">
          <b>${esc(o.orderNumber || "—")}</b>
          <small>${fmtDate(o.createdAt)} · ${Number(o.itemCount) || 0} item${Number(o.itemCount) === 1 ? "" : "s"}</small>
        </span>
        <span class="cust-order-side">
          <span class="cust-order-status st-${esc(o.status)}">${esc(statusLabel(o.status))}</span>
          <b>${money(o.totalAmount)}</b>
        </span>
      </button>`).join("")
    : '<p class="cust-muted">Kono order nei.</p>';

  const noteRows = notes.length
    ? notes.map((n) => `<div class="cust-note">
        <p>${esc(n.text).replace(/\n/g, "<br>")}</p>
        <span>${esc(n.byName || "Admin")} · ${fmtDateTime(n.createdAt)}</span>
      </div>`).join("")
    : '<p class="cust-muted">Ekhono kono admin note nei.</p>';

  box.innerHTML = `
    <div class="cust-modal-head">
      <span class="cust-avatar">${esc(initials(c.name))}</span>
      <div>
        <h3>${esc(c.name || "Customer")}</h3>
        <div class="cust-modal-sub">Registered customer${c.createdAt ? " · joined " + fmtDate(c.createdAt) : ""}</div>
      </div>
      <button type="button" class="cust-close" id="custDetailX" aria-label="Close">×</button>
    </div>

    <div class="cust-stats">
      <div class="cust-stat"><span>Orders</span><b>${Number(c.orders) || 0}</b></div>
      <div class="cust-stat"><span>Cancelled</span><b class="${Number(c.cancelled) ? "danger" : ""}">${Number(c.cancelled) || 0}</b></div>
      <div class="cust-stat"><span>Total spend</span><b class="gold">${money(c.totalSpend)}</b></div>
      <div class="cust-stat"><span>Last order</span><b>${fmtDate(c.lastOrderAt)}</b></div>
    </div>

    <div class="cust-grid">
      ${fields}
      <div class="cust-field full"><span>Address</span><b>${esc(c.address || "—")}</b></div>
    </div>

    <div class="cust-section">
      <h4>Admin notes <span>${notes.length}</span></h4>
      <div class="cust-note-list">${noteRows}</div>
      <div class="cust-note-form">
        <textarea id="custNoteText" maxlength="1000" rows="2" placeholder="Ei customer somporke note likhun..."></textarea>
        <button type="button" class="btn-gold" id="custNoteSave">Add note</button>
      </div>
    </div>

    <div class="cust-section">
      <h4>Orders <span>${orders.length}</span></h4>
      <div class="cust-order-list">${orderRows}</div>
    </div>

    <div class="cust-modal-actions">
      <button type="button" class="btn-ghost" id="custResetPw">Reset password</button>
      <button type="button" class="btn-ghost" id="custEditBtn">Edit customer</button>
      <button type="button" class="btn-ghost cust-danger" id="custTrashBtn">Trash</button>
    </div>
  `;

  box.querySelector("#custDetailX").addEventListener("click", () => pop._close());
  box.querySelector("#custEditBtn").addEventListener("click", () => openEdit(c.id));
  box.querySelector("#custResetPw").addEventListener("click", () => openPassword(c));
  box.querySelector("#custTrashBtn").addEventListener("click", async () => {
    if (await trashCustomer(c)) pop._close();
  });

  box.querySelectorAll("[data-order]").forEach((btn) => {
    btn.addEventListener("click", () => {
      pop._close();
      if (window.orderCatalog) window.orderCatalog.openOrder(btn.dataset.order);
    });
  });

  const noteBtn = box.querySelector("#custNoteSave");
  const noteInput = box.querySelector("#custNoteText");
  noteBtn.addEventListener("click", async () => {
    const text = noteInput.value.trim();
    if (!text) {
      toast("Note likhun", "err");
      noteInput.focus();
      return;
    }
    noteBtn.disabled = true;
    noteBtn.textContent = "Saving...";
    try {
      const res = await api(`/api/customers/${encodeURIComponent(c.id)}/notes`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      if (!res) return;
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || "Note save hoyni");
      toast("Note add hoyeche", "ok");
      pop._close();
      await loadList();
      openDetail(c.id);
    } catch (err) {
      toast(err.message, "err");
      noteBtn.disabled = false;
      noteBtn.textContent = "Add note";
    }
  });

  if (opts.focusNote) noteInput.focus();
}

/* ===================== EDIT ===================== */

function openEdit(id) {
  const row = state.rows.find((r) => String(r.id) === String(id));
  const pop = openPop("cust-edit-modal");
  const box = pop._box;
  box.innerHTML = '<div class="pc-empty">Loading customer...</div>';

  (async () => {
    try {
      let customer = row || null;
      if (!customer) {
        const res = await api("/api/customers/" + encodeURIComponent(id));
        if (!res) return;
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Customer load hoyni");
        customer = data.customer;
      }

      box.innerHTML = `
        <div class="cust-modal-head">
          <div>
            <h3>Edit customer</h3>
            <div class="cust-modal-sub">Account info + saved delivery address (this customer)</div>
          </div>
          <button type="button" class="cust-close" id="custEditX" aria-label="Close">×</button>
        </div>
        <form id="custEditForm" class="cust-form-grid" novalidate>
          <label class="full"><span>Name *</span><input id="ceName" type="text" maxlength="120" value="${esc(customer.name || "")}" required /></label>
          <label><span>Phone</span><input id="cePhone" type="text" maxlength="20" value="${esc(customer.phone || "")}" placeholder="01XXXXXXXXX" /></label>
          <label><span>Email</span><input id="ceEmail" type="email" maxlength="160" value="${esc(customer.email || "")}" /></label>
          <label class="full"><span>Address</span><input id="ceAddress" type="text" maxlength="240" value="${esc(customer.address || "")}" /></label>
          <label><span>Thana / Area</span><input id="ceThana" type="text" maxlength="80" value="${esc(customer.thana || "")}" /></label>
          <label><span>City (District)</span><input id="ceDistrict" type="text" maxlength="80" value="${esc(customer.district || "")}" /></label>
          <label><span>Region (Division)</span><input id="ceDivision" type="text" maxlength="80" value="${esc(customer.division || "")}" /></label>
          <label><span>Postal code</span><input id="cePostCode" type="text" maxlength="20" value="${esc(customer.postCode || "")}" /></label>
          <label class="full"><span>Country / Region</span><input id="ceCountry" type="text" maxlength="80" value="${esc(customer.country || "")}" /></label>
          <p class="cust-form-error full" id="custEditError"></p>
          <div class="pc-pop-actions full">
            <button type="button" class="btn-ghost" id="custEditCancel">Cancel</button>
            <button type="submit" class="btn-gold" id="custEditSave">Save changes</button>
          </div>
        </form>
      `;

      box.querySelector("#custEditX").addEventListener("click", () => pop._close());
      box.querySelector("#custEditCancel").addEventListener("click", () => pop._close());

      box.querySelector("#custEditForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const errorEl = box.querySelector("#custEditError");
        errorEl.textContent = "";
        const body = {
          name: box.querySelector("#ceName").value.trim(),
          phone: box.querySelector("#cePhone").value.trim(),
          email: box.querySelector("#ceEmail").value.trim(),
          address: box.querySelector("#ceAddress").value.trim(),
          thana: box.querySelector("#ceThana").value.trim(),
          district: box.querySelector("#ceDistrict").value.trim(),
          division: box.querySelector("#ceDivision").value.trim(),
          postCode: box.querySelector("#cePostCode").value.trim(),
          country: box.querySelector("#ceCountry").value.trim(),
        };
        const save = box.querySelector("#custEditSave");
        save.disabled = true;
        save.textContent = "Saving...";
        try {
          const res = await api("/api/customers/" + encodeURIComponent(id), {
            method: "PATCH",
            body: JSON.stringify(body),
          });
          if (!res) return;
          const result = await res.json();
          if (!res.ok) throw new Error(result.message || "Customer update hoyni");
          toast("Customer updated", "ok");
          pop._close();
          await loadList();
        } catch (err) {
          errorEl.textContent = err.message;
          save.disabled = false;
          save.textContent = "Save changes";
        }
      });
    } catch (err) {
      box.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>`;
    }
  })();
}

/* ===================== PASSWORD RESET ===================== */

function openPassword(customer) {
  const pop = openPop("cust-small-modal");
  const box = pop._box;
  box.innerHTML = `
    <div class="cust-modal-head">
      <div>
        <h3>Reset password</h3>
        <div class="cust-modal-sub">${esc(customer.name || "Customer")} · notun password set korun</div>
      </div>
      <button type="button" class="cust-close" id="custPwX" aria-label="Close">×</button>
    </div>
    <form id="custPwForm" class="cust-form-grid" novalidate>
      <label class="full"><span>New password *</span><input id="custPw1" type="password" minlength="6" maxlength="72" autocomplete="new-password" /></label>
      <label class="full"><span>Confirm password *</span><input id="custPw2" type="password" minlength="6" maxlength="72" autocomplete="new-password" /></label>
      <p class="cust-form-error full" id="custPwError"></p>
      <div class="pc-pop-actions full">
        <button type="button" class="btn-ghost" id="custPwCancel">Cancel</button>
        <button type="submit" class="btn-gold" id="custPwSave">Reset password</button>
      </div>
    </form>
  `;

  const pw1 = box.querySelector("#custPw1");
  pw1.focus();
  box.querySelector("#custPwX").addEventListener("click", () => pop._close());
  box.querySelector("#custPwCancel").addEventListener("click", () => pop._close());

  box.querySelector("#custPwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = box.querySelector("#custPwError");
    errorEl.textContent = "";
    const password = pw1.value;
    const confirm = box.querySelector("#custPw2").value;
    if (password.length < 6) {
      errorEl.textContent = "Password kompokkhe 6 character hote hobe";
      return;
    }
    if (password !== confirm) {
      errorEl.textContent = "Dui bar same password likhun";
      return;
    }
    const save = box.querySelector("#custPwSave");
    save.disabled = true;
    save.textContent = "Resetting...";
    try {
      const res = await api(`/api/customers/${encodeURIComponent(customer.id)}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      if (!res) return;
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || "Password reset hoyni");
      toast("Password reset hoyeche", "ok");
      pop._close();
    } catch (err) {
      errorEl.textContent = err.message;
      save.disabled = false;
      save.textContent = "Reset password";
    }
  });
}

/* ===================== TRASH ===================== */

async function trashCustomer(customer) {
  const ok = await window.confirmDialog({
    title: "Trash this customer?",
    text: `${customer.name || "Customer"} customer list theke soriye jabe. Account ar order history intact thakbe.`,
    okLabel: "Trash",
  });
  if (!ok) return false;
  try {
    const res = await api("/api/customers/" + encodeURIComponent(customer.id), { method: "DELETE" });
    if (!res) return false;
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Customer trash hoyni");
    toast("Customer list theke soriye deya hoyeche", "ok");
    await loadList();
    return true;
  } catch (err) {
    toast(err.message, "err");
    return false;
  }
}

window.customerPage = { open };
})();
