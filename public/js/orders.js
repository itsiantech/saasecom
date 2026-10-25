/* ==========================================================================
   Order list page — tabs + counts, search + advanced search, bulk actions,
   inline status change, quick edit modal, export, pagination, order details.
   Exposes window.orderCatalog = { open, openOrder }
   Relies on dashboard.js globals: api, toast, money, esc, switchView, confirmDialog
   ========================================================================== */
(function () {
"use strict";

const api = window.api;
const toast = window.toast;
const money = window.money;
// esc dashboard.js er global helper
const esc = window.esc;

const ROOT = "olRoot";

const TABS = [
  ["all", "All orders"],
  ["incomplete", "Incomplete"],
  ["pending", "Pending"],
  ["processing", "Processing"],
  ["on_the_way", "On the way"],
  ["in_courier", "In courier"],
  ["call_not_received", "Call not received"],
  ["completed", "Completed"],
  ["unpaid", "Unpaid"],
  ["cancelled", "Cancelled"],
];

// status dropdown: naya set + legacy statuses (purano data bachte)
const STATUS_OPTIONS = [
  ["pending", "Pending"],
  ["processing", "Processing"],
  ["on_the_way", "On the way"],
  ["in_courier", "In courier"],
  ["call_not_received", "Call not received"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
  ["incomplete", "Incomplete"],
  ["confirmed", "Confirmed (legacy)"],
  ["shipped", "Shipped (legacy)"],
  ["delivered", "Delivered (legacy)"],
];

const PAGE_SIZES = [10, 20, 50, 100];

function initialLimit() {
  try {
    const n = Number(localStorage.getItem("ol_page_size"));
    return PAGE_SIZES.includes(n) ? n : 10;
  } catch {
    return 10;
  }
}

const state = {
  tab: "all",
  search: "",
  advanced: { category: "", sku: "", payment: "", courier: "", from: "", to: "" },
  categories: [],
  page: 1,
  limit: initialLimit(),
  total: 0,
  pages: 1,
  rows: [],
  counts: {},
  modes: { wholesale: false, partialPayment: false, international: false },
  selected: new Set(),
};

/* ---- helpers ---- */
function el(id) {
  return document.getElementById(id);
}

const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M12 2v10"/></svg>',
};

function thumbHtml(src) {
  if (src) return `<img class="ol-thumb" src="${esc(src)}" alt="" loading="lazy" />`;
  return `<span class="ol-thumb-placeholder" aria-hidden="true">${ICONS.image}</span>`;
}

function statusLabel(s) {
  const found = STATUS_OPTIONS.find(([v]) => v === s);
  return found ? found[1] : s;
}

/* ===================== OPEN / SHELL ===================== */

function open() {
  state.page = 1;
  state.selected.clear();
  renderShell();
  loadCounts();
  loadList();
}

function renderShell() {
  const root = el(ROOT);
  root.innerHTML = `
    <div id="olBannerSlot"></div>
    <div class="ol-tabs" role="tablist" aria-label="Order tabs">
      ${TABS.map(([k, l]) => `
        <button type="button" class="ol-tab" role="tab" data-tab="${k}" aria-selected="${state.tab === k}">
          ${l} <span class="ol-tab-count" data-count="${k}">0</span>
        </button>`).join("")}
    </div>
    <div class="pc-filter-bar" role="group" aria-label="Order filters">
      <span class="ol-total-count" aria-live="polite">Total <b id="olTotalCount">—</b> orders</span>
      <div class="pc-search">
        ${ICONS.search}
        <input type="search" id="olSearch" placeholder="Search order no, customer, phone..." aria-label="Search orders" value="${esc(state.search)}" />
      </div>
      <button type="button" class="pc-chip pc-adv-toggle" id="olAdvToggle" aria-expanded="false" aria-controls="olAdvPanel">Advanced search</button>
    </div>
    <div class="pc-adv-panel" id="olAdvPanel" hidden></div>
    <div class="pc-bulk-bar" id="olBulkBar" hidden></div>
    <div class="pc-table-wrap" id="olTableWrap"></div>
    <div class="pc-foot" id="olFoot"></div>
  `;

  renderBanner();
  renderTabs();
  renderAdvPanel();

  const searchInput = el("olSearch");
  let deb = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(deb);
    deb = setTimeout(() => {
      state.search = searchInput.value.trim();
      state.page = 1;
      loadCounts();
      loadList();
    }, 300);
  });

  const advToggle = el("olAdvToggle");
  advToggle.addEventListener("click", async () => {
    const panel = el("olAdvPanel");
    const show = panel.hidden;
    panel.hidden = !show;
    advToggle.setAttribute("aria-expanded", String(show));
    if (show && !state.categories.length) {
      try {
        const res = await api("/api/categories");
        const data = await res.json();
        if (res.ok) {
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
        /* select khali thake */
      }
    }
  });
}

function renderBanner() {
  const slot = el("olBannerSlot");
  if (!slot) return;
  let html = "";
  if (state.modes.wholesale && state.modes.partialPayment) {
    html += `<div class="pc-banner"><span><b>Wholesale partial payment is on.</b> Installment orders show their progress under the payment badge.</span></div>`;
  }
  if (state.modes.international) {
    html += `<div class="pc-banner"><span><b>International mode is on.</b> Destination country is shown on each order.</span></div>`;
  }
  slot.innerHTML = html;
}

function renderTabs() {
  document.querySelectorAll("#" + ROOT + " .ol-tab").forEach((btn) => {
    const c = el("olRoot").querySelector('[data-count="' + btn.dataset.tab + '"]');
    if (c) c.textContent = String(state.counts[btn.dataset.tab] ?? "…");
    btn.setAttribute("aria-selected", String(state.tab === btn.dataset.tab));
    btn.addEventListener("click", () => {
      state.tab = btn.dataset.tab;
      state.page = 1;
      renderTabs();
      loadList();
    });
  });
}

/* ---- advanced search ---- */
function advHtml() {
  const a = state.advanced;
  const f = (id, label, inner) => `<label class="pc-adv-field" for="${id}"><span>${label}</span>${inner}</label>`;
  return `
    <div class="pc-adv-grid">
      ${f("olAdvCategory", "Category", `<select id="olAdvCategory">
        <option value="">All categories</option>
        ${state.categories.map((c) => `<option value="${esc(c.id)}" ${a.category === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
      </select>`)}
      ${f("olAdvSku", "SKU", `<input id="olAdvSku" type="text" value="${esc(a.sku)}" placeholder="Product SKU inside the order" />`)}
      ${f("olAdvPayment", "Payment", `<select id="olAdvPayment">
        <option value="" ${!a.payment ? "selected" : ""}>All payments</option>
        <option value="paid" ${a.payment === "paid" ? "selected" : ""}>Paid</option>
        <option value="partial" ${a.payment === "partial" ? "selected" : ""}>Partial</option>
        <option value="unpaid" ${a.payment === "unpaid" ? "selected" : ""}>Unpaid</option>
      </select>`)}
      ${f("olAdvCourier", "Courier", `<input id="olAdvCourier" type="text" value="${esc(a.courier)}" placeholder="Courier name" />`)}
      ${f("olAdvFrom", "From date", `<input id="olAdvFrom" type="date" value="${esc(a.from)}" />`)}
      ${f("olAdvTo", "To date", `<input id="olAdvTo" type="date" value="${esc(a.to)}" />`)}
    </div>
    <div class="pc-adv-actions">
      <button type="button" class="btn-gold" id="olAdvSearch">Search</button>
      <button type="button" class="btn-ghost" id="olAdvReset">Reset</button>
    </div>
  `;
}

function renderAdvPanel() {
  const panel = el("olAdvPanel");
  if (!panel) return;
  const wasHidden = panel.hidden;
  panel.innerHTML = advHtml();
  if (wasHidden) panel.hidden = true;

  el("olAdvSearch").addEventListener("click", () => {
    state.advanced = {
      category: el("olAdvCategory").value,
      sku: el("olAdvSku").value.trim(),
      payment: el("olAdvPayment").value,
      courier: el("olAdvCourier").value.trim(),
      from: el("olAdvFrom").value,
      to: el("olAdvTo").value,
    };
    state.page = 1;
    markAdvApplied();
    loadCounts();
    loadList();
  });

  el("olAdvReset").addEventListener("click", () => {
    state.advanced = { category: "", sku: "", payment: "", courier: "", from: "", to: "" };
    state.page = 1;
    markAdvApplied();
    renderAdvPanel();
    loadCounts();
    loadList();
  });
}

function markAdvApplied() {
  const btn = el("olAdvToggle");
  if (!btn) return;
  const empty = Object.values(state.advanced).every((v) => String(v || "").trim() === "");
  btn.classList.toggle("pc-adv-active", !empty);
}

function advParams(searchParams) {
  const a = state.advanced;
  if (a.category) searchParams.set("category", a.category);
  if (a.sku) searchParams.set("sku", a.sku);
  if (a.payment) searchParams.set("payment", a.payment);
  if (a.courier) searchParams.set("courier", a.courier);
  if (a.from) searchParams.set("from", a.from);
  if (a.to) searchParams.set("to", a.to);
}

/* ===================== DATA ===================== */

async function baseParams() {
  const params = new URLSearchParams({ search: state.search, page: state.page, limit: state.limit });
  advParams(params);
  return params;
}

async function loadCounts() {
  try {
    const params = new URLSearchParams({ search: state.search, tab: state.tab });
    advParams(params);
    const res = await api("/api/orders/counts?" + params.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Counts load hoyni");
    state.counts = data.counts || {};
    TABS.forEach(([k]) => {
      const c = el(ROOT) && el("olRoot").querySelector('[data-count="' + k + '"]');
      if (c) c.textContent = String(state.counts[k] ?? 0);
    });
    const totalEl = el("olTotalCount");
    if (totalEl) totalEl.textContent = Number(state.counts.all ?? 0).toLocaleString("en-US");
    // counts er upor modes o jani (boaert counts response modes nai — list theke ashe)
  } catch {
    /* silent — counts khali thakbe */
  }
}

async function loadList() {
  const wrap = el("olTableWrap");
  if (!wrap) return;
  wrap.innerHTML = '<div class="pc-empty">Loading...</div>';
  try {
    const params = await baseParams();
    const res = await api("/api/orders/list?" + params.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Order list load hoyni");
    state.rows = data.orders || [];
    state.total = data.total || 0;
    state.pages = data.pages || 1;
    state.modes = data.modes || state.modes;
    renderBanner();
    renderTable();
    renderFoot();
  } catch (err) {
    wrap.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>`;
  }
}

/* ===================== TABLE ===================== */

function cols() {
  // action must stay the LAST column
  return ["checkbox", "sl", "order", "date", "customer", "products", "total", "payment", "status", "action"];
}

function headerFor(col) {
  switch (col) {
    case "checkbox": return `<input type="checkbox" id="olSelectAll" aria-label="Select all orders" />`;
    case "sl": return "SL";
    case "order": return "Order number";
    case "date": return "Date";
    case "customer": return "Customer";
    case "products": return "Products";
    case "total": return "Total";
    case "payment": return "Payment";
    case "status": return "Status";
    case "action": return "Action";
    default: return "";
  }
}

function cellHtml(o, col) {
  switch (col) {
    case "checkbox":
      return `<input type="checkbox" data-select="${o.id}" aria-label="Select order ${esc(o.orderNumber)}" ${state.selected.has(o.id) ? "checked" : ""} />`;
    case "sl":
      return `<span style="color:var(--muted);font-size:12.5px;">${o.sl}</span>`;
    case "order":
      return `<span class="ol-order-no">${esc(o.orderNumber)}</span>`;
    case "date":
      return `<span style="color:var(--muted);font-size:12.5px;">${fmtDate(o.createdAt)}</span>`;
    case "customer":
      return `<div>${esc(o.customerName || "—")}</div><div style="font-size:12.5px;color:var(--muted);">${esc(o.customerPhone || "—")}</div>
        ${state.modes.international && o.country ? `<span class="ol-country-chip">${esc(o.country)}</span>` : ""}`;
    case "products": {
      const first = o.items && o.items[0];
      if (!first) return "—";
      let html = `<div class="ol-prod">${thumbHtml(first.image)}<div>
        <div class="ol-prod-name">${esc(first.name)}</div>
        <div class="ol-prod-sub">${first.quantity} pcs${first.sku ? " · " + esc(first.sku) : ""}</div>
      </div></div>`;
      if (o.moreCount > 0) html += `<div class="ol-more">+${o.moreCount} more</div>`;
      return html;
    }
    case "total":
      return `<div class="ol-total">${money(o.totalAmount)}</div>`;
    case "payment": {
      const b = o.paymentBadge || { label: o.paymentStatus, kind: "unpaid" };
      let html = `<span class="ol-pay-badge ${esc(b.kind)}">${esc(b.label)}</span>
        <div style="font-size:12px;color:var(--muted);margin-top:4px;">${esc(o.paymentMethodLabel || o.paymentLabel || "—")}</div>`;
      if (o.installment && state.modes.partialPayment) {
        html += `<div class="ol-installment" style="font-size:12px;color:var(--gold,inherit);margin-top:4px;">Installment ${o.installment.current} of ${o.installment.total}</div>`;
      }
      return html;
    }
    case "status":
      return `<select class="ol-status-select" data-status="${o.id}" aria-label="Change status for ${esc(o.orderNumber)}">
        ${STATUS_OPTIONS.map(([v, l]) => `<option value="${v}" ${o.status === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
      ${o.courierName ? `<div style="font-size:12px;color:var(--muted);margin-top:4px;">${esc(o.courierName)}</div>` : ""}`;
    case "action": {
      const isCancelled = o.status === "cancelled";
      return `<div class="pc-row-actions">
        <button type="button" class="icon-btn edit" data-toggle="${o.id}" title="${isCancelled ? "Restore to Pending" : "Cancel order"}">${ICONS.power}</button>
        <button type="button" class="icon-btn edit" data-edit="${o.id}" title="Edit">${ICONS.edit}</button>
        <button type="button" class="icon-btn del" data-del="${o.id}" title="Delete">${ICONS.trash}</button>
      </div>`;
    }
    default:
      return "";
  }
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function renderTable() {
  const wrap = el("olTableWrap");
  if (!state.rows.length) {
    wrap.innerHTML = '<div class="pc-empty">No orders found.</div>';
    renderBulkBar();
    return;
  }
  const c = cols();
  const thead = c.map((col) => `<th>${headerFor(col)}</th>`).join("");
  const tbody = state.rows
    .map((o) => `<tr data-row="${o.id}">${c.map((col) => `<td data-col="${col}">${cellHtml(o, col)}</td>`).join("")}</tr>`)
    .join("");
  wrap.innerHTML = `<table class="pc-table ol-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
  bindTableEvents();
  renderBulkBar();
}

function bindTableEvents() {
  const wrap = el("olTableWrap");

  // select all
  const selectAll = el("olSelectAll");
  if (selectAll) {
    selectAll.addEventListener("change", () => {
      state.rows.forEach((o) => (selectAll.checked ? state.selected.add(o.id) : state.selected.delete(o.id)));
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

  // inline status change
  wrap.querySelectorAll("[data-status]").forEach((sel) => {
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", () => setStatus(sel.dataset.status, sel.value, sel));
  });

  // cancel / restore
  wrap.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const o = state.rows.find((x) => String(x.id) === btn.dataset.toggle);
      if (!o) return;
      if (o.status === "cancelled") {
        await setStatus(o.id, "pending", null);
      } else {
        const ok = await window.confirmDialog({
          title: "Cancel this order?",
          text: `Order ${o.orderNumber} will be marked Cancelled and the customer will be notified.`,
          okLabel: "Cancel order",
        });
        if (!ok) return;
        await setStatus(o.id, "cancelled", null);
      }
    });
  });

  wrap.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const o = state.rows.find((x) => String(x.id) === btn.dataset.edit);
      if (o) openEditModal(o);
    });
  });

  wrap.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const o = state.rows.find((x) => String(x.id) === btn.dataset.del);
      if (!o) return;
      const ok = await window.confirmDialog({
        title: "Delete order?",
        text: `Order ${o.orderNumber} and its payment history will be deleted permanently.`,
        okLabel: "Delete",
      });
      if (!ok) return;
      try {
        const res = await api("/api/orders/" + o.id, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Delete hoyni");
        toast("Order deleted", "ok");
        state.selected.delete(o.id);
        loadCounts();
        await loadList();
      } catch (err) {
        toast(err.message, "err");
      }
    });
  });

  // row click → order details (inputs/buttons/selects keep their own action)
  wrap.querySelectorAll("tr[data-row]").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("input, button, select, textarea, a, label")) return;
      openOrder(tr.dataset.row);
    });
  });
}

function syncSelectAll() {
  const selectAll = el("olSelectAll");
  if (!selectAll) return;
  const onPage = state.rows.filter((o) => state.selected.has(o.id)).length;
  selectAll.checked = state.rows.length > 0 && onPage === state.rows.length;
}

async function setStatus(id, status, selectEl) {
  try {
    const res = await api("/api/orders/" + id, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Status update hoyni");
    toast("Status → " + statusLabel(status), "ok");
    loadCounts();
    await loadList();
  } catch (err) {
    if (selectEl) {
      const o = state.rows.find((x) => String(x.id) === String(id));
      if (o) selectEl.value = o.status;
    }
    toast(err.message, "err");
  }
}

/* ---- bulk print ---- */

async function bulkPrintInvoices() {
  const ids = [...state.selected];
  if (!ids.length) return;

  const win = window.open("", "_blank");
  if (!win) {
    toast("Popup block kora ache — browser e allow korun", "err");
    return;
  }
  win.document.write(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Preparing invoices…</title></head>
     <body style="margin:0;padding:32px;font-family:Segoe UI,Arial,sans-serif;background:#f4f1ea;color:#241f18;">
     <p id="olPrintStatus">Preparing ${ids.length} invoice(s)…</p></body></html>`
  );
  win.document.close();

  const htmls = [];
  let failed = 0;
  try {
    for (let i = 0; i < ids.length; i += 8) {
      const chunk = ids.slice(i, i + 8);
      const results = await Promise.all(
        chunk.map((id) =>
          api("/api/orders/" + id + "/invoice")
            .then((res) => (res && res.ok ? res.text() : null))
            .catch(() => null)
        )
      );
      results.forEach((html) => (html ? htmls.push(html) : (failed += 1)));
      const status = win.document && win.document.getElementById("olPrintStatus");
      if (status) status.textContent = `Preparing ${Math.min(i + 8, ids.length)} of ${ids.length}…`;
    }

    if (!htmls.length) throw new Error("Invoice prepare hoyni");

    const parser = new DOMParser();
    let css = "";
    const sheets = [];
    htmls.forEach((html) => {
      const doc = parser.parseFromString(html, "text/html");
      if (!css) css = Array.from(doc.querySelectorAll("style")).map((s) => s.textContent).join("\n");
      const sheet = doc.querySelector(".sheet");
      if (sheet) sheets.push(sheet.outerHTML);
    });
    if (!sheets.length) throw new Error("Invoice sheet pawa jayni");

    const printDoc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invoices (${sheets.length})</title>
<style>
${css}
  .ol-bulk-toolbar { max-width: 820px; margin: 0 auto 14px; display: flex; justify-content: flex-end; gap: 8px; }
  .ol-bulk-toolbar button { border: 0; border-radius: 8px; padding: 9px 16px; cursor: pointer; background: #17140f; color: #c9a961; font-weight: 600; }
  .sheet + .sheet { margin-top: 24px; }
  @media print {
    .ol-bulk-toolbar { display: none; }
    .sheet { break-after: page; page-break-after: always; }
    .sheet:last-child { break-after: auto; page-break-after: auto; }
  }
</style>
</head>
<body>
  <div class="ol-bulk-toolbar"><button onclick="window.print()">Print all (${sheets.length})</button></div>
  ${sheets.join("")}
</body>
</html>`;

    win.document.open();
    win.document.write(printDoc);
    win.document.close();
    win.focus();
    setTimeout(() => {
      try { win.print(); } catch { /* print dialog bondho thakte pare */ }
    }, 450);
    toast(
      failed ? `${sheets.length} invoice ready, ${failed} failed` : `${sheets.length} invoice print-ready`,
      failed ? "err" : "ok"
    );
  } catch (err) {
    try { win.close(); } catch { /* already closed */ }
    toast(err.message, "err");
  }
}

/* ---- bulk bar ---- */

function renderBulkBar() {
  const bar = el("olBulkBar");
  if (!bar) return;
  const n = state.selected.size;
  if (!n) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.innerHTML = `
    <span class="pc-bulk-count">${n} selected</span>
    <label class="ol-bulk-label" for="olBulkStatus">Change status to</label>
    <select id="olBulkStatus" aria-label="Change status to">
      ${STATUS_OPTIONS.filter(([v]) => v !== "incomplete" || state.tab === "incomplete")
        .map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
    </select>
    <button type="button" id="olBulkApply">Apply</button>
    <button type="button" id="olBulkPrint">Print invoices</button>
    <button type="button" class="danger" id="olBulkTrash">Trash</button>
  `;
  el("olBulkApply").addEventListener("click", async () => {
    const status = el("olBulkStatus").value;
    const note = "Bulk status change from order list";
    try {
      const res = await api("/api/orders/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "set_status", ids: [...state.selected], status, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Bulk apply hoyni");
      toast(`${data.modified || 0} order → ${statusLabel(status)}`, "ok");
      state.selected.clear();
      loadCounts();
      await loadList();
    } catch (err) {
      toast(err.message, "err");
    }
  });
  el("olBulkPrint").addEventListener("click", bulkPrintInvoices);
  el("olBulkTrash").addEventListener("click", async () => {
    const ok = await window.confirmDialog({
      title: "Move selected orders to Trash?",
      text: `${state.selected.size} order(s) permanently delete hobe. Ei action undo kora jabe na.`,
      okLabel: "Trash orders",
    });
    if (!ok) return;
    try {
      const res = await api("/api/orders/bulk", {
        method: "POST",
        body: JSON.stringify({ action: "delete", ids: [...state.selected] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Bulk trash hoyni");
      toast("Trashed — " + (data.modified || 0) + " order(s)", "ok");
      state.selected.clear();
      loadCounts();
      await loadList();
    } catch (err) {
      toast(err.message, "err");
    }
  });
}

/* ===================== QUICK EDIT MODAL ===================== */

function openEditModal(order) {
  const pop = document.createElement("div");
  pop.className = "pc-pop";
  pop.innerHTML = `
    <div class="pc-pop-box ol-edit-box" role="dialog" aria-modal="true" aria-labelledby="olEditTitle">
      <h3 id="olEditTitle">Order ${esc(order.orderNumber)}</h3>
      <p class="hint">${esc(order.customerName || "")} · ${esc(order.customerPhone || "")} · ${money(order.totalAmount)}</p>
      <label class="pc-adv-field"><span>Status</span>
        <select id="olEditStatus">
          ${STATUS_OPTIONS.map(([v, l]) => `<option value="${v}" ${order.status === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </label>
      <label class="pc-adv-field"><span>Courier</span>
        <input id="olEditCourier" type="text" value="${esc(order.courierName || "")}" placeholder="Courier name" />
      </label>
      <label class="pc-adv-field"><span>Note</span>
        <input id="olEditNote" type="text" placeholder="Optional note saved with status history" />
      </label>
      <div id="olEditHistory" class="ol-history" aria-label="Status history"></div>
      <div class="pc-pop-actions">
        <button type="button" class="btn-ghost" id="olEditCancel">Cancel</button>
        <button type="button" class="btn-gold" id="olEditSave">Save changes</button>
      </div>
    </div>
  `;
  document.body.appendChild(pop);
  loadHistory(order.id, pop.querySelector("#olEditHistory"));

  pop.querySelector("#olEditCancel").addEventListener("click", () => pop.remove());
  pop.addEventListener("click", (e) => {
    if (e.target === pop) pop.remove();
  });
  pop.querySelector("#olEditSave").addEventListener("click", async () => {
    const status = pop.querySelector("#olEditStatus").value;
    const courierName = pop.querySelector("#olEditCourier").value.trim();
    const note = pop.querySelector("#olEditNote").value.trim();
    try {
      const res = await api("/api/orders/" + order.id, {
        method: "PATCH",
        body: JSON.stringify({ status, courierName, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Save hoyni");
      toast("Order updated", "ok");
      pop.remove();
      loadCounts();
      await loadList();
    } catch (err) {
      toast(err.message, "err");
    }
  });
}

async function loadHistory(orderId, box) {
  try {
    const res = await api("/api/orders/" + orderId + "/status-history");
    const data = await res.json();
    if (!box) return;
    if (!res.ok || !(data.history || []).length) {
      box.innerHTML = '<div class="ol-history-empty">No status changes yet.</div>';
      return;
    }
    box.innerHTML = data.history
      .slice(0, 8)
      .map((h) => `<div class="ol-history-row"><b>${esc(statusLabel(h.toStatus))}</b>
        <span>${h.fromStatus ? esc("from " + statusLabel(h.fromStatus)) + " · " : ""}${esc(fmtDate(h.at))}${h.byName ? " · " + esc(h.byName) : ""}</span></div>`)
      .join("");
  } catch {
    if (box) box.innerHTML = '<div class="ol-history-empty">History load hoyni.</div>';
  }
}

/* ===================== ORDER DETAILS ===================== */

const PAY_STATUS = {
  pending: ["Unpaid", "unpaid"],
  paid: ["Paid", "paid"],
  partially_paid: ["Partial", "partial"],
  failed: ["Failed", "unpaid"],
  refunded: ["Refunded", "partial"],
  cancelled: ["Cancelled", "unpaid"],
  overdue: ["Overdue", "unpaid"],
};

function payBadge(status) {
  const found = PAY_STATUS[status];
  return found ? { label: found[0], kind: found[1] } : { label: status || "—", kind: "unpaid" };
}

function detailStatusClass(s) {
  if (s === "completed" || s === "delivered") return "is-ok";
  if (s === "cancelled" || s === "incomplete") return "is-cancel";
  if (s === "pending") return "is-pending";
  return "is-mid";
}

function contactCard(title, c, opts = {}) {
  const box = c || {};
  const showAddress = opts.address !== false;
  return `<section class="od-card">
    <h4>${title}</h4>
    <dl class="od-kv">
      <div><dt>Name</dt><dd>${esc(box.name || "—")}</dd></div>
      ${showAddress ? `<div><dt>Address</dt><dd>${esc(box.address || "—")}</dd></div>` : ""}
      <div><dt>Email</dt><dd>${esc(box.email || "—")}</dd></div>
      <div><dt>Phone</dt><dd>${esc(box.phone || "—")}</dd></div>
    </dl>
  </section>`;
}

async function openOrder(id) {
  const root = el("odRoot");
  if (root) root.innerHTML = '<div class="pc-empty">Loading order...</div>';
  switchView("order-detail");
  try {
    const res = await api("/api/orders/" + id + "/detail");
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Order details load hoyni");
    renderDetail(data.order);
  } catch (err) {
    if (!root) return;
    root.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>
      <div style="text-align:center;"><button type="button" class="btn-ghost" id="odBackErr">Back to orders</button></div>`;
    const b = el("odBackErr");
    if (b) b.addEventListener("click", () => switchView("orders"));
  }
}

function renderDetail(o) {
  const root = el("odRoot");
  if (!root) return;
  const pay = payBadge(o.paymentStatus);
  const status = statusLabel(o.status);
  const note = o.orderNote || "";
  const historyNote = o.historyNote || "";
  const items = o.items || [];
  const origin = o.origin || { label: "—" };
  const device = o.device || { label: "—" };

  const itemRows = items.length
    ? items.map((it) => `<tr>
        <td>
          <div class="od-item">
            ${thumbHtml(it.image)}
            <div>
              <b>${esc(it.name)}</b>
              ${it.sku ? `<span>SKU: ${esc(it.sku)}</span>` : ""}
            </div>
          </div>
        </td>
        <td>${money(it.unitPrice)}</td>
        <td class="od-c">${it.quantity}</td>
        <td class="od-r">${money(it.total)}</td>
      </tr>`).join("")
    : `<tr><td colspan="4" class="od-empty">No items in this order.</td></tr>`;

  root.innerHTML = `
    <div class="topbar">
      <div style="display:flex;align-items:center;gap:14px;">
        <button class="menu-btn" aria-label="Menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
        <div>
          <button type="button" class="pcv-back" id="odBack">← Back to orders</button>
          <h2>Order ${esc(o.orderNumber)}</h2>
          <p class="crumb">${esc(fmtDateTime(o.createdAt))}${o.invoiceNumber ? " · Invoice " + esc(o.invoiceNumber) : ""}</p>
        </div>
      </div>
      <div class="pc-top-actions od-top-actions">
        <button type="button" class="btn-ghost" id="odInvoice">Download PDF invoice</button>
        <button type="button" class="btn-add" id="odPacking">Print packaging slip</button>
      </div>
    </div>

    <section class="od-hero">
      <div>
        <div class="od-hero-badges">
          <span class="od-status ${detailStatusClass(o.status)}">${esc(status)}</span>
          <span class="ol-pay-badge ${esc(pay.kind)}">${esc(pay.label)}</span>
          ${o.paymentMode === "installment" ? `<span class="od-chip">Installment</span>` : ""}
        </div>
        <h3>Total ${money(o.orderTotal)}</h3>
        <p>Created ${esc(fmtDateTime(o.createdAt))} · ${items.length} item(s)</p>
      </div>
      <div class="od-hero-side">
        <div><span>Payment</span><b>${esc(o.paymentLabel || "—")}</b></div>
        <div><span>Origin</span><b>${esc(origin.label)}</b></div>
        <div><span>Device</span><b>${esc(device.label)}</b></div>
        ${o.courierName ? `<div><span>Courier</span><b>${esc(o.courierName)}</b></div>` : ""}
      </div>
    </section>

    <div class="od-cards">
      ${contactCard("Customer", o.customer, { address: false })}
      ${contactCard("Billing", o.billing)}
      ${contactCard("Shipping", o.shipping)}
      <section class="od-card">
        <h4>Order info</h4>
        <dl class="od-kv">
          <div><dt>Status</dt><dd>${esc(status)}</dd></div>
          <div><dt>Order origin</dt><dd>${esc(origin.label)}</dd></div>
          <div><dt>Device type</dt><dd>${esc(device.label)}</dd></div>
          <div><dt>Payment status</dt><dd>${esc(pay.label)}</dd></div>
          ${o.courierName ? `<div><dt>Courier</dt><dd>${esc(o.courierName)}</dd></div>` : ""}
        </dl>
      </section>
    </div>

    <div class="od-main">
      <section class="od-card od-items">
        <h4>Items</h4>
        <div class="od-table-wrap">
          <table class="od-table">
            <thead>
              <tr><th>Item</th><th>Price</th><th class="od-c">Qty</th><th class="od-r">Total</th></tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
        </div>
      </section>
      <aside class="od-card od-totals">
        <h4>Summary</h4>
        <div class="od-total-row"><span>Items Total</span><b>${money(o.itemsTotal)}</b></div>
        <div class="od-total-row"><span>Shipping${o.shippingLabel ? ` · ${esc(o.shippingLabel)}` : ""}</span><b>${money(o.shippingAmount)}</b></div>
        <div class="od-total-row grand"><span>Order Total</span><b>${money(o.orderTotal)}</b></div>
        ${o.paymentMode === "installment" ? `
          <div class="od-total-row"><span>Paid</span><b>${money((Number(o.paidAmount) || 0) / 100)}</b></div>
          <div class="od-total-row"><span>Due</span><b>${money((Number(o.dueAmount) || 0) / 100)}</b></div>` : ""}
      </aside>
    </div>

    <section class="od-card od-note">
      <h4>Order note</h4>
      <div id="odNoteView">
        ${note ? `<p class="od-note-text">${esc(note)}</p>` : `<p class="od-note-empty">No order note added yet.</p>`}
        ${!note && historyNote ? `<p class="od-note-history">Latest status note: ${esc(historyNote)}</p>` : ""}
        <button type="button" class="od-note-btn" id="odNoteEditBtn">${note ? "Edit note" : "Add note"}</button>
      </div>
      <div id="odNoteForm" hidden>
        <textarea id="odNoteInput" rows="3" maxlength="2000" placeholder="Internal note for this order...">${esc(note)}</textarea>
        <div class="od-note-actions">
          <button type="button" class="btn-ghost" id="odNoteCancel">Cancel</button>
          <button type="button" class="btn-gold" id="odNoteSave">Save note</button>
        </div>
      </div>
    </section>
  `;

  el("odBack").addEventListener("click", () => switchView("orders"));
  const docUrl = (path) => {
    const base = "/api/orders/" + o.id + "/" + path;
    return o.storeSlug ? base + "?store=" + encodeURIComponent(o.storeSlug) : base;
  };
  el("odInvoice").addEventListener("click", () => {
    window.open(docUrl("invoice"), "_blank", "noopener");
  });
  el("odPacking").addEventListener("click", () => {
    window.open(docUrl("packing-slip"), "_blank", "noopener");
  });

  const menuBtn = root.querySelector(".menu-btn");
  if (menuBtn) {
    menuBtn.addEventListener("click", () => {
      const sb = document.getElementById("sidebar");
      const ov = document.getElementById("sbOverlay");
      if (sb) sb.classList.add("open");
      if (ov) ov.classList.add("show");
    });
  }

  const noteView = el("odNoteView");
  const noteForm = el("odNoteForm");
  const noteInput = el("odNoteInput");
  el("odNoteEditBtn").addEventListener("click", () => {
    noteView.hidden = true;
    noteForm.hidden = false;
    noteInput.focus();
  });
  el("odNoteCancel").addEventListener("click", () => {
    noteForm.hidden = true;
    noteView.hidden = false;
  });
  el("odNoteSave").addEventListener("click", async () => {
    const orderNote = noteInput.value.trim();
    try {
      const res = await api("/api/orders/" + o.id, {
        method: "PATCH",
        body: JSON.stringify({ orderNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Note save hoyni");
      o.orderNote = orderNote;
      toast("Order note saved", "ok");
      renderDetail(o);
    } catch (err) {
      toast(err.message, "err");
    }
  });
}

/* ===================== FOOTER / PAGINATION ===================== */

function renderFoot() {
  const foot = el("olFoot");
  if (!foot) return;
  const from = state.total ? (state.page - 1) * state.limit + 1 : 0;
  const to = Math.min(state.page * state.limit, state.total);
  foot.innerHTML = `
    <div class="ol-foot-info">
      <span>Showing ${from}–${to} of ${state.total} orders</span>
      <label class="ol-page-size" for="olPageSize">Per page
        <select id="olPageSize" aria-label="Orders per page">
          ${PAGE_SIZES.map((n) => `<option value="${n}" ${state.limit === n ? "selected" : ""}>${n}</option>`).join("")}
        </select>
      </label>
    </div>
    <span class="spacer"></span>
    <div class="pc-pager" role="navigation" aria-label="Pagination"></div>
  `;
  el("olPageSize").addEventListener("change", (e) => {
    const n = Number(e.target.value);
    if (!PAGE_SIZES.includes(n)) return;
    state.limit = n;
    state.page = 1;
    try { localStorage.setItem("ol_page_size", String(n)); } catch { /* private mode */ }
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
  if (win[0] > 1) { btn("1", 1); if (win[0] > 2) pager.appendChild(document.createTextNode("…")); }
  win.forEach((i) => btn(String(i), i, { current: i === state.page }));
  const last = win[win.length - 1];
  if (last < state.pages) { if (last < state.pages - 1) pager.appendChild(document.createTextNode("…")); btn(String(state.pages), state.pages); }
  btn("›", state.page + 1, { disabled: state.page >= state.pages });
}

/* ===================== EXPORT ===================== */

function exportCsv() {
  const header = ["SL", "Order no", "Date", "Customer", "Phone", "Items", "Total", "Payment", "Status", "Courier"];
  const lines = [header.join(",")];
  for (const o of state.rows) {
    const items = (o.items || []).map((it) => `${it.name} x${it.quantity}`).join(" | ");
    lines.push([
      o.sl,
      `"${o.orderNumber}"`,
      `"${fmtDate(o.createdAt)}"`,
      `"${o.customerName}"`,
      `"${o.customerPhone}"`,
      `"${items.replace(/"/g, '""')}"`,
      o.totalAmount,
      `"${(o.paymentBadge && o.paymentBadge.label) || o.paymentStatus} / ${o.paymentMethodLabel || ""}"`,
      `"${o.status}"`,
      `"${o.courierName}"`,
    ].join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "orders-page-" + state.page + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("CSV export hoise", "ok");
}

/* ===================== CREATE ORDER (simple) ===================== */

let productsCache = null;

async function openCreateModal() {
  if (!productsCache) {
    try {
      const res = await api("/api/products");
      const data = await res.json();
      productsCache = (Array.isArray(data) ? data : data.products || []).filter((p) => p.status !== "draft" || true).slice(0, 200);
    } catch {
      productsCache = [];
    }
  }
  const pop = document.createElement("div");
  pop.className = "pc-pop";
  pop.innerHTML = `
    <div class="pc-pop-box ol-edit-box" role="dialog" aria-modal="true" aria-labelledby="olCreateTitle">
      <h3 id="olCreateTitle">Create order</h3>
      <p class="hint">Simple admin order — product price theke total hisheb hoy. Customer pore payment deny korle update kore niben.</p>
      <label class="pc-adv-field"><span>Customer name</span><input id="olCName" type="text" placeholder="Full name" /></label>
      <label class="pc-adv-field"><span>Phone</span><input id="olCPhone" type="text" placeholder="01XXXXXXXXX" /></label>
      <label class="pc-adv-field"><span>Address</span><input id="olCAddress" type="text" placeholder="Street, area" /></label>
      <label class="pc-adv-field"><span>Product</span>
        <select id="olCProduct">
          ${productsCache.map((p) => `<option value="${p._id}" data-price="${Number(p.price || p.regularPrice || 0)}">${esc(p.name || p.title)} — ${money(p.price || p.regularPrice || 0)}</option>`).join("")}
        </select>
      </label>
      <label class="pc-adv-field"><span>Quantity</span><input id="olCQty" type="number" min="1" step="1" value="1" /></label>
      <label class="pc-adv-field"><span>Payment method</span>
        <select id="olCPayment">
          <option value="cod">COD</option>
          <option value="mobile">Mobile banking</option>
          <option value="bank">Bank</option>
        </select>
      </label>
      <div class="pc-pop-actions">
        <button type="button" class="btn-ghost" id="olCreateCancel">Cancel</button>
        <button type="button" class="btn-gold" id="olCreateSave">Create order</button>
      </div>
    </div>
  `;
  document.body.appendChild(pop);
  pop.querySelector("#olCreateCancel").addEventListener("click", () => pop.remove());
  pop.addEventListener("click", (e) => {
    if (e.target === pop) pop.remove();
  });
  pop.querySelector("#olCreateSave").addEventListener("click", async () => {
    const productSel = pop.querySelector("#olCProduct");
    const productId = productSel.value;
    const quantity = Math.max(1, Number(pop.querySelector("#olCQty").value) || 1);
    const unitPrice = Number(productSel.options[productSel.selectedIndex].dataset.price) || 0;
    const paymentMethod = pop.querySelector("#olCPayment").value;
    const body = {
      orderNumber: "ORD-" + Date.now().toString(36).toUpperCase(),
      customerName: pop.querySelector("#olCName").value.trim(),
      customerPhone: pop.querySelector("#olCPhone").value.trim(),
      address: pop.querySelector("#olCAddress").value.trim(),
      items: [{ product: productId, quantity, unitPrice, price: unitPrice * quantity }],
      totalAmount: unitPrice * quantity,
      shippingAmount: 0,
      paymentMethod,
      paymentLabel: { cod: "COD", mobile: "Mobile banking", bank: "Bank" }[paymentMethod],
      paymentStatus: "pending",
      status: "pending",
    };
    if (!body.customerName) return toast("Customer name din", "err");
    try {
      const res = await api("/api/orders", { method: "POST", body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Order create hoyni");
      toast("Order created", "ok");
      pop.remove();
      loadCounts();
      await loadList();
    } catch (err) {
      toast(err.message, "err");
    }
  });
}

/* ---- top buttons (bind once) ---- */
document.addEventListener("DOMContentLoaded", () => {
  const ex = el("olExport");
  if (ex) ex.addEventListener("click", exportCsv);
  const cr = el("olCreateOrder");
  if (cr) cr.addEventListener("click", () => openCreateModal());
});

window.orderCatalog = { open, openProduct: open, openOrder };
})();
