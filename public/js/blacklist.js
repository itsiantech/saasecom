/* ==========================================================================
   Blacklist — blocked phones / addresses / IPs. Checkout theke ei entry
   gulir order reject hoy. Exposes window.blacklistPage = { open }
   Relies on dashboard.js globals: api, toast, esc, confirmDialog.
   ========================================================================== */
(function () {
"use strict";

const api = window.api;
const toast = window.toast;
const esc = window.esc;

const ROOT = "blRoot";

const TYPE_LABELS = { phone: "Phone", address: "Address", ip: "IP" };

const ICONS = {
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
};

const state = { type: "", entries: [], loading: false };

function el(id) {
  return document.getElementById(id);
}

function fmtDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function open() {
  state.type = "";
  renderShell();
  loadList();
}

function renderShell() {
  const root = el(ROOT);
  if (!root) return;
  root.innerHTML = `
    <div class="pf-card bl-add-card">
      <div class="pf-card-head"><h3>Notun entry blacklist korun</h3></div>
      <div class="settings-body">
        <div class="pf-grid-2">
          <div class="pf-field">
            <label for="blType">Type</label>
            <select id="blType">
              <option value="phone">Phone number</option>
              <option value="address">Address</option>
              <option value="ip">IP address</option>
            </select>
          </div>
          <div class="pf-field">
            <label for="blValue">Value</label>
            <input id="blValue" placeholder="01XXXXXXXXX" autocomplete="off" />
          </div>
        </div>
        <div class="pf-field">
          <label for="blReason">Reason (optional)</label>
          <input id="blReason" maxlength="300" placeholder="Keno block korchen — audit log e thakbe" />
        </div>
        <div class="sst-actions">
          <button class="btn-gold" type="button" id="blAddBtn">Blacklist e jog korun</button>
        </div>
        <p class="pf-note">Phone must be a valid BD number (01XXXXXXXXX). Blacklist e thaka phone / address / IP theke checkout e order neoya bondho — customer ke generic message dekhano hoy. Shob add / remove audit log e record hoy.</p>
      </div>
    </div>

    <div class="cust-toolbar bl-toolbar">
      <span class="cust-total">Total <b id="blTotalCount">—</b> entries</span>
      <div class="pc-search">
        <select id="blFilter" aria-label="Filter by type">
          <option value="">All types</option>
          <option value="phone">Phone</option>
          <option value="address">Address</option>
          <option value="ip">IP</option>
        </select>
      </div>
    </div>
    <div id="blTableWrap"><div class="pc-empty">Loading...</div></div>
  `;

  el("blFilter").addEventListener("change", () => {
    state.type = el("blFilter").value;
    loadList();
  });

  el("blType").addEventListener("change", () => {
    const t = el("blType").value;
    el("blValue").placeholder = t === "phone" ? "01XXXXXXXXX" : t === "ip" ? "103.x.x.x" : "House / road / area...";
  });

  el("blAddBtn").addEventListener("click", addEntry);
  el("blValue").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addEntry();
  });
}

async function addEntry() {
  const type = el("blType").value;
  const value = el("blValue").value.trim();
  const reason = el("blReason").value.trim();
  if (!value) return toast("Value din", "err");
  const btn = el("blAddBtn");
  btn.disabled = true;
  try {
    const res = await api("/api/blacklist", {
      method: "POST",
      body: JSON.stringify({ type, value, reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Blacklist e jog hoyni");
    toast("Blacklist e jog hoyeche", "ok");
    el("blValue").value = "";
    el("blReason").value = "";
    loadList();
  } catch (err) {
    toast(err.message, "err");
  } finally {
    btn.disabled = false;
  }
}

async function loadList() {
  const wrap = el("blTableWrap");
  if (!wrap) return;
  wrap.innerHTML = '<div class="pc-empty">Loading...</div>';
  try {
    const params = state.type ? "?type=" + encodeURIComponent(state.type) : "";
    const res = await api("/api/blacklist" + params);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Blacklist load hoyni");
    state.entries = data.entries || [];
    const total = el("blTotalCount");
    if (total) total.textContent = String(state.entries.length);
    renderTable();
  } catch (err) {
    wrap.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>`;
  }
}

function renderTable() {
  const wrap = el("blTableWrap");
  if (!wrap) return;
  if (!state.entries.length) {
    wrap.innerHTML = '<div class="pc-empty">Blacklist khali — kono blocked phone / address / IP nei.</div>';
    return;
  }
  const rows = state.entries
    .map((r) => `<tr>
      <td><span class="bl-type-chip ${esc(r.type)}">${esc(TYPE_LABELS[r.type] || r.type)}</span></td>
      <td class="bl-value">${esc(r.value)}</td>
      <td>${esc(r.reason || "—")}</td>
      <td style="color:var(--muted);font-size:12.5px;">${esc(fmtDateTime(r.createdAt))}</td>
      <td>
        <div class="pc-row-actions">
          <button type="button" class="icon-btn del" data-bl-del="${esc(r.id)}" title="Blacklist theke shoriye din">${ICONS.trash}</button>
        </div>
      </td>
    </tr>`)
    .join("");
  wrap.innerHTML = `<table class="pc-table ol-table">
    <thead><tr><th>Type</th><th>Value</th><th>Reason</th><th>Added</th><th>Action</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  wrap.querySelectorAll("[data-bl-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const entry = state.entries.find((r) => r.id === btn.dataset.blDel);
      if (!entry) return;
      const ok = await window.confirmDialog({
        title: "Blacklist theke shoraben?",
        text: `"${entry.value}" (${TYPE_LABELS[entry.type] || entry.type}) ar blocked thakbe na — ei value theke order neoya jabe.`,
        okLabel: "Remove",
      });
      if (!ok) return;
      try {
        const res = await api("/api/blacklist/" + entry.id, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || "Remove hoyni");
        toast("Blacklist theke shorano hoyeche", "ok");
        loadList();
      } catch (err) {
        toast(err.message, "err");
      }
    });
  });
}

window.blacklistPage = { open };
})();