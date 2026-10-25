/* ==========================================================================
   Reports admin — sales overview, product/category/coupon breakdowns and top
   customers. Exposes window.reportsPage = { open }.
   Uses its own fetch helper on purpose: the dashboard api() logs the user out
   on any 403, while a report permission error must stay inside this page.
   ========================================================================== */
(function () {
"use strict";

const TOKEN_KEY = "luxe_token";
const API = "/api/admin/reports";
const MAX_RANGE_DAYS = 366;

const PRESETS = [
  { key: "yearly", label: "Yearly" },
  { key: "last_month", label: "Last month" },
  { key: "this_month", label: "This month" },
  { key: "last_7_days", label: "Last 7 days" },
];

const CUSTOMER_RANGES = [
  { key: "monthly", label: "Monthly" },
  { key: "half_yearly", label: "Half-yearly" },
  { key: "yearly", label: "Yearly" },
];

const CUSTOMER_LIMITS = [10, 25, 50];

const META = {
  sales: {
    root: "repSalesRoot",
    title: "Sales overview",
    hint: "Valid orders = processing + completed",
    endpoint: "/sales/summary",
    report: "summary",
  },
  products: {
    root: "repProductsRoot",
    title: "Product-wise sales",
    hint: "Merchandise revenue after coupon adjustments · shipping excluded",
    endpoint: "/sales/products",
    report: "products",
  },
  categories: {
    root: "repCategoriesRoot",
    title: "Category-wise sales",
    hint: "Earliest category link wins · products without a link go to Uncategorized",
    endpoint: "/sales/categories",
    report: "categories",
  },
  coupons: {
    root: "repCouponsRoot",
    title: "Coupon-wise sales",
    hint: "Only valid orders with a coupon code · discount snapshot on the order",
    endpoint: "/sales/coupons",
    report: "coupons",
  },
  customers: {
    root: "repCustomersRoot",
    title: "Top customers",
    hint: "Grouped by account, phone or email · valid orders only",
    endpoint: "/customers/top",
    report: "customers",
  },
};

const state = {
  kind: "sales",
  period: { preset: "this_month" },
  resolved: null,
  customerRange: "monthly",
  customerLimit: 10,
  sort: { products: "sales", categories: "sales" },
  page: { products: 1, categories: 1, coupons: 1 },
  limit: 20,
  seq: 0,
  controller: null,
  access: { status: "pending", canView: false, canExport: false, canRebuild: false },
  accessPromise: null,
};

/* ============================== helpers ============================== */

function el(id) {
  return document.getElementById(id);
}

const esc =
  window.esc ||
  function (value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function bdt(value) {
  const n = num(value);
  const sign = n < 0 ? "-" : "";
  return `${sign}৳ ${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function count(value) {
  return num(value).toLocaleString("en-IN");
}

function compactNum(value) {
  const n = Math.max(0, num(value));
  if (n >= 10000000) return `${(n / 10000000).toFixed(1).replace(/\.0$/, "")}Cr`;
  if (n >= 100000) return `${(n / 100000).toFixed(1).replace(/\.0$/, "")}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayLocalKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthStartKey() {
  return `${todayLocalKey().slice(0, 7)}-01`;
}

function dayTime(key) {
  const parts = String(key || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return NaN;
  const time = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const date = new Date(time);
  if (
    date.getUTCFullYear() !== parts[0] ||
    date.getUTCMonth() !== parts[1] - 1 ||
    date.getUTCDate() !== parts[2]
  ) {
    return NaN;
  }
  return time;
}

function fmtDay(key) {
  const time = dayTime(key);
  if (!Number.isFinite(time)) return String(key || "");
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(time));
}

function authHeaders() {
  return { Authorization: "Bearer " + (localStorage.getItem(TOKEN_KEY) || "") };
}

async function apiGet(path, signal) {
  const res = await fetch(API + path, {
    headers: authHeaders(),
    cache: "no-store",
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.message || "Report load korte parlam na");
    error.status = res.status;
    error.requestId = data.requestId;
    throw error;
  }
  return data;
}

function periodQuery() {
  if (state.period.preset) return `preset=${encodeURIComponent(state.period.preset)}`;
  return `from=${encodeURIComponent(state.period.from)}&to=${encodeURIComponent(state.period.to)}`;
}

function queryFor(kind) {
  if (kind === "customers") {
    return `/customers/top?range=${encodeURIComponent(state.customerRange)}&limit=${state.customerLimit}`;
  }
  let query = `${META[kind].endpoint}?${periodQuery()}`;
  if (kind === "products" || kind === "categories") {
    query += `&sort=${encodeURIComponent(state.sort[kind])}`;
  }
  if (kind !== "sales") {
    query += `&page=${state.page[kind]}&limit=${state.limit}`;
  }
  return query;
}

function exportUrl(kind, format) {
  if (kind === "customers") {
    return `${API}/export?report=customers&format=${format}&range=${encodeURIComponent(
      state.customerRange
    )}&limit=${state.customerLimit}`;
  }
  let url = `${API}/export?report=${META[kind].report}&format=${format}&${periodQuery()}`;
  if (kind === "products" || kind === "categories") {
    url += `&sort=${encodeURIComponent(state.sort[kind])}`;
  }
  return url;
}

function rangeText(period) {
  if (!period || !period.from || !period.to) return "";
  const base = `${fmtDay(period.from)} – ${fmtDay(period.to)}`;
  return period.days ? `${base} · ${count(period.days)} din` : base;
}

function resetPages() {
  state.page.products = 1;
  state.page.categories = 1;
  state.page.coupons = 1;
}

/* =============================== access =============================== */

function ensureAccess() {
  if (!state.accessPromise) {
    state.accessPromise = fetch(`${API}/access`, { headers: authHeaders(), cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("access");
        const data = await res.json();
        state.access = {
          status: "ok",
          canView: Boolean(data.canView),
          canExport: Boolean(data.canExport),
          canRebuild: Boolean(data.canRebuild),
        };
      })
      .catch(() => {
        // Fail closed: a failed probe must never reveal the reports menu.
        state.access = { status: "denied", canView: false, canExport: false, canRebuild: false };
      })
      .finally(() => {
        const group = el("navGroupReports");
        if (group) group.hidden = !state.access.canView;
      });
  }
  return state.accessPromise;
}

/* ============================== rendering ============================== */

function presetButtons() {
  return PRESETS.map(
    (preset) =>
      `<button type="button" class="rep-chip" data-preset="${preset.key}" aria-pressed="false">${preset.label}</button>`
  ).join("");
}

function rangeButtons() {
  return CUSTOMER_RANGES.map(
    (range) =>
      `<button type="button" class="rep-chip" data-customer-range="${range.key}" aria-pressed="false">${range.label}</button>`
  ).join("");
}

function exportButtons() {
  if (!state.access.canExport) return "";
  return `<div class="rep-actions">
    <button type="button" class="btn-ghost" data-export="csv">Export CSV</button>
    <button type="button" class="btn-ghost" data-export="pdf">Export PDF</button>
  </div>`;
}

function shellHtml(kind) {
  const today = todayLocalKey();
  const actions = exportButtons();
  const meta = `<div class="rep-filter-meta">
      <p class="rep-range" data-role="range-label" aria-live="polite">Report load hocche…</p>
      <p class="rep-msg" data-role="filter-msg" role="alert" hidden></p>
    </div>`;
  if (kind === "customers") {
    return `<div class="rep-page">
      <div class="rep-filterbar">
        <div class="rep-filter-row">
          <div class="rep-chips" role="group" aria-label="Customer range">${rangeButtons()}</div>
          <label class="rep-limit">Show
            <select data-role="customer-limit">
              ${CUSTOMER_LIMITS.map((limit) => `<option value="${limit}">${limit}</option>`).join("")}
            </select>
          </label>
          ${actions}
        </div>
        ${meta}
      </div>
      <div class="rep-export-note" data-role="export-note" aria-live="polite"></div>
      <div data-role="content">${loadingHtml(kind)}</div>
    </div>`;
  }
  return `<div class="rep-page">
    <div class="rep-filterbar">
      <div class="rep-filter-row">
        <div class="rep-chips" role="group" aria-label="Report period">${presetButtons()}</div>
        <form class="rep-dates" data-role="custom-form" novalidate>
          <label>From <input type="date" name="from" max="${today}" /></label>
          <label>To <input type="date" name="to" max="${today}" /></label>
          <button type="submit" class="btn-gold rep-go">Go</button>
        </form>
        ${actions}
      </div>
      ${meta}
    </div>
    <div class="rep-export-note" data-role="export-note" aria-live="polite"></div>
    <div data-role="content">${loadingHtml(kind)}</div>
  </div>`;
}

function loadingHtml(kind) {
  if (kind === "sales") {
    return `<div class="rep-skeleton-stack" aria-hidden="true">
      <div class="rep-skeleton-cards">
        ${Array.from({ length: 8 }, () => '<div class="rep-skeleton rep-skeleton-card"></div>').join("")}
      </div>
      <div class="rep-skeleton rep-skeleton-chart"></div>
    </div>`;
  }
  return '<div class="rep-skeleton rep-skeleton-table" aria-hidden="true"></div>';
}

function emptyState(message) {
  return `<div class="rep-state rep-empty">
    <span class="rep-state-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>
    </span>
    <h2>Kono data nei</h2>
    <p>${esc(message || "Ei range e kono report data pawa jayni.")}</p>
  </div>`;
}

function lockedHtml() {
  return `<div class="rep-page"><div class="rep-state rep-locked">
    <span class="rep-state-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
    </span>
    <h2>Reports are admin-only</h2>
    <p>Ei section dekhte store admin adhikar lagbe.</p>
  </div></div>`;
}

function errorHtml(error) {
  return `<div class="rep-state rep-error" role="alert">
    <span class="rep-state-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></svg>
    </span>
    <h2>Report load korte parlam na</h2>
    <p>${esc(error.message || "Ektu pore abar chesta korun.")}</p>
    ${error.requestId ? `<small>Request: ${esc(error.requestId)}</small>` : ""}
    <button type="button" class="btn-gold" data-retry>Retry</button>
  </div>`;
}

function ensureShell(kind, root) {
  if (root.dataset.built === "1") return;
  root.dataset.built = "1";
  root.innerHTML = shellHtml(kind);

  root.addEventListener("click", (event) => {
    const preset = event.target.closest("[data-preset]");
    if (preset) {
      choosePreset(preset.dataset.preset, root);
      return;
    }
    const range = event.target.closest("[data-customer-range]");
    if (range) {
      chooseCustomerRange(range.dataset.customerRange, root);
      return;
    }
    const page = event.target.closest("[data-page]");
    if (page) {
      goToPage(Number(page.dataset.page), root);
      return;
    }
    const retry = event.target.closest("[data-retry]");
    if (retry) {
      load(kind);
      return;
    }
    const exporter = event.target.closest("[data-export]");
    if (exporter) handleExport(kind, exporter.dataset.export, root);
  });

  root.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-role='custom-form']");
    if (!form) return;
    event.preventDefault();
    applyCustomRange(form, root);
  });

  root.addEventListener("change", (event) => {
    const sort = event.target.closest("[data-role='sort']");
    if (sort) {
      state.sort[kind] = sort.value === "quantity" ? "quantity" : "sales";
      resetPages();
      load(kind);
      return;
    }
    const limit = event.target.closest("[data-role='customer-limit']");
    if (limit) {
      state.customerLimit = Number(limit.value) || 10;
      load(kind);
    }
  });
}

function syncControls(kind, root) {
  root.querySelectorAll("input[type='date']").forEach((input) => {
    input.max = todayLocalKey();
  });
  if (kind === "customers") {
    root.querySelectorAll("[data-customer-range]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.customerRange === state.customerRange)
      );
    });
    const limit = root.querySelector("[data-role='customer-limit']");
    if (limit) limit.value = String(state.customerLimit);
    return;
  }

  root.querySelectorAll("[data-preset]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(Boolean(state.period.preset) && button.dataset.preset === state.period.preset)
    );
  });

  const fromInput = root.querySelector("input[name='from']");
  const toInput = root.querySelector("input[name='to']");
  if (!fromInput || !toInput) return;
  if (state.period.from && state.period.to) {
    fromInput.value = state.period.from;
    toInput.value = state.period.to;
  } else if (state.resolved) {
    fromInput.value = state.resolved.from;
    toInput.value = state.resolved.to;
  } else if (!fromInput.value) {
    fromInput.value = monthStartKey();
    toInput.value = todayLocalKey();
  }
}

/* ============================== actions ============================== */

function choosePreset(preset, root) {
  if (!PRESETS.some((item) => item.key === preset)) return;
  state.period = { preset };
  state.resolved = null;
  resetPages();
  setFilterMessage(root, "");
  syncControls(state.kind, root);
  load(state.kind);
}

function chooseCustomerRange(range, root) {
  if (!CUSTOMER_RANGES.some((item) => item.key === range)) return;
  state.customerRange = range;
  syncControls(state.kind, root);
  setFilterMessage(root, "");
  load(state.kind);
}

function applyCustomRange(form, root) {
  const from = form.elements.from ? form.elements.from.value.trim() : "";
  const to = form.elements.to ? form.elements.to.value.trim() : "";
  const error = validateCustom(from, to);
  if (error) {
    setFilterMessage(root, error);
    return;
  }
  state.period = { from, to };
  state.resolved = { from, to };
  resetPages();
  setFilterMessage(root, "");
  syncControls(state.kind, root);
  load(state.kind);
}

function validateCustom(from, to) {
  if (!from || !to) return "Start date ar end date duitai din.";
  const fromTime = dayTime(from);
  const toTime = dayTime(to);
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) {
    return "Date YYYY-MM-DD format e hote hobe.";
  }
  if (from > to) return "Start date end date er pore hote parbe na.";
  if (to > todayLocalKey()) return "Future date er report neya jay na.";
  const days = Math.floor((toTime - fromTime) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) return `Maximum report range ${MAX_RANGE_DAYS} din.`;
  return "";
}

function goToPage(page, root) {
  const content = root.querySelector("[data-role='content']");
  if (!content) return;
  const kind = state.kind;
  if (kind === "customers") return;
  const pages = Number(content.dataset.pages) || 1;
  const next = Math.min(Math.max(1, page), pages);
  if (next === state.page[kind]) return;
  state.page[kind] = next;
  load(kind);
}

function setFilterMessage(root, message) {
  const node = root.querySelector("[data-role='filter-msg']");
  if (!node) return;
  node.textContent = message || "";
  node.hidden = !message;
}

function setRangeLabel(root, text) {
  const node = root.querySelector("[data-role='range-label']");
  if (node) node.textContent = text || "";
}

function setExportNote(root, message, isError) {
  const node = root.querySelector("[data-role='export-note']");
  if (!node) return;
  node.textContent = message || "";
  node.classList.toggle("is-error", Boolean(isError));
}

async function handleExport(kind, format, root) {
  if (!state.access.canExport) return;
  if (format !== "csv" && format !== "pdf") return;

  setExportNote(root, "");
  let win = null;
  if (format === "pdf") {
    // Opened synchronously so browsers do not treat it as a blocked popup.
    win = window.open("about:blank", "_blank");
    if (!win) {
      setExportNote(root, "Popup block kora hoyeche — browser e allow korun.", true);
      return;
    }
    win.document.write(
      '<p style="font-family:system-ui,sans-serif;padding:24px;color:#553c1a">Report toiri hocche…</p>'
    );
  }

  const button = root.querySelector(`[data-export='${format}']`);
  if (button) button.disabled = true;
  try {
    const res = await fetch(exportUrl(kind, format), {
      headers: authHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || "Export fail hoyeche");
    }
    if (format === "csv") {
      const blob = await res.blob();
      const name = fileNameFrom(res.headers.get("content-disposition"), `report-${kind}.csv`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setExportNote(root, "CSV download hoyeche.");
    } else {
      const html = await res.text();
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      setExportNote(root, "Print window khuleche — Save as PDF korun.");
    }
  } catch (error) {
    if (win) win.close();
    setExportNote(root, error.message || "Export fail hoyeche", true);
  } finally {
    if (button) button.disabled = false;
  }
}

function fileNameFrom(header, fallback) {
  const match = /filename="?([^";]+)"?/i.exec(header || "");
  return match ? match[1] : fallback;
}

/* =============================== loading =============================== */

function load(kind) {
  const root = el(META[kind].root);
  if (!root || root.dataset.built !== "1") return;
  const job = ++state.seq;
  if (state.controller) state.controller.abort();
  const controller = new AbortController();
  state.controller = controller;

  root.setAttribute("aria-busy", "true");
  setFilterMessage(root, "");
  const content = root.querySelector("[data-role='content']");
  if (content) content.innerHTML = loadingHtml(kind);
  setRangeLabel(root, "Report load hocche…");

  apiGet(queryFor(kind), controller.signal)
    .then((data) => {
      if (job !== state.seq) return;
      if (data.period) state.resolved = data.period;
      if (kind === "sales") renderSales(root, data);
      else if (kind === "customers") renderCustomers(root, data);
      else renderTable(kind, root, data);
      setRangeLabel(root, rangeText(data.period));
      syncControls(kind, root);
      root.removeAttribute("aria-busy");
    })
    .catch((error) => {
      if (error.name === "AbortError" || job !== state.seq) return;
      const contentNode = root.querySelector("[data-role='content']");
      if (contentNode) contentNode.innerHTML = errorHtml(error);
      setRangeLabel(root, "Report load hoyni");
      root.removeAttribute("aria-busy");
    });
}

/* =============================== sales =============================== */

function renderSales(root, data) {
  const content = root.querySelector("[data-role='content']");
  if (!content) return;
  const cards = [
    {
      label: "Sales",
      value: bdt(data.sales),
      hint: "Valid orders · coupon applied",
      accent: true,
    },
    {
      label: "Average daily sales",
      value: bdt(data.averageDailySales),
      hint: `${count(data.period.days)} calendar days`,
    },
    {
      label: "Net sales this year",
      value: bdt(data.netSalesThisYear),
      hint: "Sales − refunds − shipping − tax",
      danger: num(data.netSalesThisYear) < 0,
    },
    { label: "Orders placed", value: count(data.ordersPlaced), hint: "Processing + completed" },
    { label: "Items purchased", value: count(data.itemsPurchased), hint: "Total quantity" },
    { label: "Refunded orders", value: count(data.refundedOrders), hint: "By refund date" },
    { label: "Charged for shipping", value: bdt(data.shippingCharged), hint: "Shipping in valid orders" },
    { label: "Worth of coupons used", value: bdt(data.couponsWorth), hint: "Discount given" },
  ];

  content.innerHTML = `<div class="rep-cards">
      ${cards
        .map(
          (card) => `<article class="rep-card${card.accent ? " is-accent" : ""}${
            card.danger ? " is-danger" : ""
          }">
            <span class="rep-card-label">${esc(card.label)}</span>
            <strong class="rep-card-value">${esc(card.value)}</strong>
            <span class="rep-card-hint">${esc(card.hint)}</span>
          </article>`
        )
        .join("")}
    </div>
    <section class="rep-panel" aria-labelledby="repChartTitle">
      <div class="rep-panel-head">
        <div>
          <h2 id="repChartTitle">Sales chart</h2>
          <p>${esc(chartHint(data.chart && data.chart.granularity, data.period.days))}</p>
        </div>
      </div>
      ${chartHtml(data)}
    </section>`;
}

function chartHint(granularity, days) {
  const unit = granularity === "day" ? "Daily" : granularity === "week" ? "Weekly" : "Monthly";
  return `${unit} buckets · ${count(days)} calendar days · zero-filled`;
}

function chartHtml(data) {
  const buckets = (data.chart && data.chart.buckets) || [];
  const total = buckets.reduce((sum, bucket) => sum + num(bucket.sales), 0);
  const legend = `<p class="rep-chart-legend">Bars = sales in BDT · tooltip e orders</p>`;
  if (!buckets.length) {
    return `${legend}${emptyState("Ei period er jonno chart bucket nei.")}`;
  }

  const W = 760;
  const H = 280;
  const L = 54;
  const R = 16;
  const T = 16;
  const B = 42;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const max = Math.max(1, ...buckets.map((bucket) => num(bucket.sales)));
  const n = buckets.length;
  const slot = plotW / n;
  const barW = Math.max(4, Math.min(46, slot * 0.58));
  const every = n <= 12 ? 1 : Math.ceil(n / 8);

  let grid = "";
  for (let i = 0; i <= 4; i += 1) {
    const y = T + plotH - (plotH * i) / 4;
    grid += `<line class="rep-chart-grid" x1="${L}" y1="${y}" x2="${W - R}" y2="${y}"></line>`;
    grid += `<text class="rep-chart-axis" x="${L - 8}" y="${y + 4}" text-anchor="end">${compactNum(
      (max * i) / 4
    )}</text>`;
  }

  let bars = "";
  let labels = "";
  buckets.forEach((bucket, index) => {
    const sales = num(bucket.sales);
    const height = Math.max(0, (sales / max) * plotH);
    const x = L + index * slot + (slot - barW) / 2;
    const y = T + plotH - height;
    const title = `${bucket.label}: ${bdt(sales)} · ${count(bucket.orders)} order`;
    bars += `<rect class="rep-chart-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(
      1
    )}" height="${height.toFixed(1)}" rx="4"><title>${esc(title)}</title></rect>`;
    if (index % every === 0 || index === n - 1) {
      const rawLabel = String(bucket.label || "");
      const label = rawLabel.length > 14 ? `${rawLabel.slice(0, 13)}…` : rawLabel;
      labels += `<text x="${(L + index * slot + slot / 2).toFixed(
        1
      )}" y="${H - 16}" text-anchor="middle">${esc(label)}</text>`;
    }
  });

  const base = `<line class="rep-chart-base" x1="${L}" y1="${T + plotH}" x2="${W - R}" y2="${
    T + plotH
  }"></line>`;
  const emptyNote =
    total <= 0 ? '<p class="rep-chart-empty">Ei period e kono valid sale nei.</p>' : "";
  const dataRows = buckets
    .map(
      (bucket) =>
        `<tr><td>${esc(bucket.label)}</td><td class="rep-num">${esc(
          bdt(bucket.sales)
        )}</td><td class="rep-num">${count(bucket.orders)}</td></tr>`
    )
    .join("");

  return `${legend}
    <div class="rep-chart-wrap">
      <svg class="rep-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales in BDT for ${esc(
        rangeText(data.period)
      )}">
        ${base}${grid}${bars}${labels}
      </svg>
    </div>
    ${emptyNote}
    <details class="rep-chart-details">
      <summary>Chart data</summary>
      <div class="rep-chart-data">
        <table>
          <caption class="rep-sr-only">Sales and orders per chart bucket</caption>
          <thead><tr><th scope="col">Bucket</th><th scope="col" class="rep-num">Sales (BDT)</th><th scope="col" class="rep-num">Orders</th></tr></thead>
          <tbody>${dataRows}</tbody>
        </table>
      </div>
    </details>`;
}

/* ============================ table reports ============================ */

function renderTable(kind, root, data) {
  const content = root.querySelector("[data-role='content']");
  if (!content) return;
  const rows = data.rows || [];
  const panelTitle = META[kind].title;
  const headingId = `repTableTitle-${kind}`;

  let head = "";
  let body = "";
  let emptyText = "Ei range e kono data nei.";

  if (kind === "products" || kind === "categories") {
    head = `<tr>
      <th scope="col">${kind === "products" ? "Product" : "Category"}</th>
      <th scope="col" class="rep-num">Sales (BDT)</th>
      <th scope="col" class="rep-num">Quantity</th>
      <th scope="col" class="rep-num">Orders</th>
    </tr>`;
    body = rows
      .map(
        (row) => `<tr>
          <td><span class="rep-name">${esc(row.name || (kind === "products" ? "Unnamed product" : "Untitled category"))}</span></td>
          <td class="rep-num">${esc(bdt(row.sales))}</td>
          <td class="rep-num">${count(row.quantity)}</td>
          <td class="rep-num">${count(row.orders)}</td>
        </tr>`
      )
      .join("");
    emptyText = "Ei range e kono valid sale nei.";
  } else if (kind === "coupons") {
    head = `<tr>
      <th scope="col">Coupon code</th>
      <th scope="col">Label</th>
      <th scope="col" class="rep-num">Discount (BDT)</th>
      <th scope="col" class="rep-num">Orders</th>
    </tr>`;
    body = rows
      .map(
        (row) => `<tr>
          <td><span class="rep-code">${esc(row.code)}</span></td>
          <td>${row.label ? esc(row.label) : '<span class="rep-muted">—</span>'}</td>
          <td class="rep-num">${esc(bdt(row.discount))}</td>
          <td class="rep-num">${count(row.orders)}</td>
        </tr>`
      )
      .join("");
    emptyText = "Ei range e coupon diye kono valid order nei.";
  }

  const sort =
    kind === "coupons"
      ? ""
      : `<label class="rep-sort">Sort
      <select data-role="sort">
        <option value="sales"${state.sort[kind] === "sales" ? " selected" : ""}>Sales</option>
        <option value="quantity"${state.sort[kind] === "quantity" ? " selected" : ""}>Quantity</option>
      </select>
    </label>`;

  content.innerHTML = `<section class="rep-panel" aria-labelledby="${headingId}">
    <div class="rep-panel-head">
      <div>
        <h2 id="${headingId}">${esc(panelTitle)}</h2>
        <p>${esc(META[kind].hint)}</p>
      </div>
      ${sort}
    </div>
    ${
      rows.length
        ? `<div class="rep-table-wrap">
            <table class="rep-table">
              <caption class="rep-sr-only">${esc(panelTitle)}</caption>
              <thead>${head}</thead>
              <tbody>${body}</tbody>
            </table>
          </div>
          ${footHtml(data)}`
        : emptyState(emptyText)
    }
  </section>`;
  content.dataset.pages = String(data.pages || 1);
}

function footHtml(data) {
  const total = num(data.total);
  const limit = num(data.limit) || 1;
  const page = num(data.page) || 1;
  const pages = Math.max(1, num(data.pages) || 1);
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(total, page * limit);
  return `<div class="rep-foot">
    <span>${count(start)}–${count(end)} of ${count(total)}</span>
    <div class="rep-pager">
      <button type="button" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="Previous page">Prev</button>
      <span>Page ${page} / ${pages}</span>
      <button type="button" data-page="${page + 1}" ${page >= pages ? "disabled" : ""} aria-label="Next page">Next</button>
    </div>
  </div>`;
}

/* ============================ top customers ============================ */

function renderCustomers(root, data) {
  const content = root.querySelector("[data-role='content']");
  if (!content) return;
  const rows = data.rows || [];
  const body = rows
    .map(
      (row) => `<tr>
        <td><span class="rep-name">${esc(row.name || "Guest")}</span></td>
        <td><span class="rep-badge ${row.isGuest ? "is-guest" : "is-registered"}">${
          row.isGuest ? "Guest" : "Registered"
        }</span></td>
        <td class="rep-num">${count(row.orders)}</td>
        <td class="rep-num">${esc(bdt(row.totalSpent))}</td>
      </tr>`
    )
    .join("");

  content.innerHTML = `<section class="rep-panel" aria-labelledby="repCustomersTitle">
    <div class="rep-panel-head">
      <div>
        <h2 id="repCustomersTitle">Top customers</h2>
        <p>${esc(META.customers.hint)}</p>
      </div>
    </div>
    ${
      rows.length
        ? `<div class="rep-table-wrap">
            <table class="rep-table">
              <caption class="rep-sr-only">Top customers by total spent</caption>
              <thead><tr>
                <th scope="col">Customer</th>
                <th scope="col">Type</th>
                <th scope="col" class="rep-num">Orders</th>
                <th scope="col" class="rep-num">Total spent (BDT)</th>
              </tr></thead>
              <tbody>${body}</tbody>
            </table>
          </div>
          <div class="rep-foot"><span>Top ${count(rows.length)} customers</span><span>Guest buyers are grouped by phone/email</span></div>`
        : emptyState("Ei range e kono valid customer order nei.")
    }
  </section>`;
}

/* ================================ open ================================ */

async function open(kind) {
  if (!META[kind]) return;
  state.kind = kind;
  const root = el(META[kind].root);
  if (!root) return;

  await ensureAccess();
  if (!state.access.canView) {
    root.innerHTML = lockedHtml();
    return;
  }

  ensureShell(kind, root);
  syncControls(kind, root);
  load(kind);
}

ensureAccess();

window.reportsPage = { open };
})();
