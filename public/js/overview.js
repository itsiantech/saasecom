/* Dashboard Overview — renders /api/admin/overview into the .ov sections.
 * Kept separate from dashboard.js so the rest of the admin panel is untouched. */
(function () {
  "use strict";

  const state = { period: "today", from: "", to: "", data: null, timer: null };
  const $ = (id) => document.getElementById(id);

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function api(url, options) {
    if (window.ApiSession && window.ApiSession.request) return window.ApiSession.request(url, options);
    return fetch(url, options);
  }

  function money(paisa) {
    return "৳" + Math.round(Number(paisa || 0) / 100).toLocaleString("en-IN");
  }

  function count(value) {
    return Number(value || 0).toLocaleString("en-IN");
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function deltaMarkup(value, note, invert) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return '<b class="neg">—</b> ' + esc(note || "");
    }
    const numeric = Number(value);
    const good = invert ? numeric < 0 : numeric > 0;
    const bad = invert ? numeric > 0 : numeric < 0;
    const cls = good ? "pos" : bad ? "neg" : "";
    const sign = numeric > 0 ? "+" : "";
    return `<b class="${cls}">${sign}${numeric}%</b> ${esc(note || "")}`;
  }

  function countDeltaMarkup(value, note, invert) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return '<b class="neg">—</b> ' + esc(note || "");
    }
    const numeric = Number(value);
    const good = invert ? numeric < 0 : numeric > 0;
    const bad = invert ? numeric > 0 : numeric < 0;
    const cls = good ? "pos" : bad ? "neg" : "";
    const sign = numeric > 0 ? "+" : "";
    return `<b class="${cls}">${sign}${numeric}</b> ${esc(note || "")}`;
  }

  function setKpi(id, value, deltaHtml) {
    const valueEl = $(id);
    const deltaEl = $(id + "Delta");
    if (valueEl) valueEl.textContent = value;
    if (deltaEl) deltaEl.innerHTML = deltaHtml || "";
  }

  function chartSvg(points) {
    const W = 640;
    const H = 200;
    const PX = 6;
    const TOP = 12;
    const BOTTOM = 26;
    const max = Math.max(
      1,
      ...points.map((point) => Math.max(point.retailPaisa || 0, point.wholesalePaisa || 0))
    );
    const n = points.length;
    const x = (i) => (n <= 1 ? PX : PX + (i * (W - PX * 2)) / (n - 1));
    const y = (v) => BOTTOM + (H - TOP - BOTTOM) * (1 - v / max);

    const lineFor = (key) => {
      if (!n) return "";
      if (n === 1) {
        const yy = y(points[0][key] || 0).toFixed(1);
        return `${PX},${yy} ${W - PX},${yy}`;
      }
      return points.map((point, i) => `${x(i).toFixed(1)},${y(point[key] || 0).toFixed(1)}`).join(" ");
    };

    const grid = [0, 0.25, 0.5, 0.75, 1]
      .map((t) => {
        const yy = (TOP + (H - TOP - BOTTOM) * t).toFixed(1);
        return `<line x1="${PX}" x2="${W - PX}" y1="${yy}" y2="${yy}" stroke="var(--ov-line)" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
      })
      .join("");

    return (
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Retail and wholesale sales trend">` +
      grid +
      `<polyline points="${lineFor("retailPaisa")}" fill="none" stroke="var(--ov-retail)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
      `<polyline points="${lineFor("wholesalePaisa")}" fill="none" stroke="var(--ov-wholesale)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>` +
      `</svg>`
    );
  }

  function renderTrend(trend) {
    const points = Array.isArray(trend) ? trend : [];
    const chart = $("ovTrendChart");
    const labels = $("ovTrendX");
    if (!chart || !labels) return;
    chart.innerHTML = points.length
      ? chartSvg(points)
      : '<p class="ov-empty">No sales in this period</p>';

    const maxLabels = 7;
    let indexes = points.map((_, i) => i);
    if (indexes.length > maxLabels) {
      const step = (indexes.length - 1) / (maxLabels - 1);
      indexes = Array.from({ length: maxLabels }, (_, i) => Math.round(i * step));
    }
    labels.innerHTML = indexes
      .map((i) => `<span>${esc(points[i].label)}</span>`)
      .join("");
  }

  function renderStatus(status) {
    const root = $("ovStatus");
    if (!root) return;
    const rows = (status && status.rows) || [];
    root.innerHTML = rows
      .map(
        (row) =>
          `<div class="ov-list-row"><span>${esc(row.label)}</span><b>${count(row.count)}</b></div>`
      )
      .join("");
    const split = $("ovGuestSplit");
    if (split) {
      split.textContent = `${status ? status.guestPercent : 0}% / ${status ? status.registeredPercent : 0}%`;
    }
  }

  function renderLatest(orders) {
    const root = $("ovLatestOrders");
    if (!root) return;
    const rows = Array.isArray(orders) ? orders : [];
    if (!rows.length) {
      root.innerHTML = '<p class="ov-empty">No orders in this period</p>';
      return;
    }
    const head =
      '<div class="ov-table-head"><span>Order</span><span>Customer</span><span>Total</span><span>Status</span><span>Courier</span></div>';
    const body = rows
      .map(
        (order) =>
          `<div class="ov-table-row">` +
          `<span class="num">${esc(order.number)}</span>` +
          `<span class="cust">${esc(order.customer)}</span>` +
          `<span class="num">${money(order.totalPaisa)}</span>` +
          `<span><span class="ov-badge ${esc(order.statusKey)}">${esc(order.statusLabel)}</span></span>` +
          `<span class="courier">${esc(order.courier || "—")}</span>` +
          `</div>`
      )
      .join("");
    root.innerHTML = head + body;
  }

  function renderAlerts(alerts) {
    const root = $("ovAlerts");
    if (!root) return;
    const a = alerts || {};
    const rows = [
      { label: "Low stock products", value: `${count(a.lowStock)} items`, tone: "warn" },
      { label: "Out of stock", value: `${count(a.outOfStock)} items`, tone: "danger" },
      { label: "Failed courier booking", value: count(a.failedCourier), tone: "info" },
      { label: "Pending wholesale requests", value: count(a.pendingWholesale), tone: "info" },
      {
        label: "Server-side tracking",
        value: a.tracking ? "Working" : "Off",
        tone: a.tracking ? "ok" : "muted",
      },
    ];
    root.innerHTML = rows
      .map(
        (row) =>
          `<div class="ov-list-row"><span>${esc(row.label)}</span>` +
          `<span class="ov-badge ${row.tone}">${esc(row.value)}</span></div>`
      )
      .join("");
  }

  function renderCourier(courier) {
    const root = $("ovCourier");
    if (!root) return;
    const c = courier || {};
    const rows = (c.rows || [])
      .map(
        (row) =>
          `<div class="ov-list-row"><span>${esc(row.name)} delivered</span><b>${count(row.delivered)}</b></div>`
      )
      .join("");
    root.innerHTML =
      (rows || '<p class="ov-empty">No courier deliveries yet</p>') +
      `<div class="ov-list-row"><span>In transit</span><b>${count(c.inTransit)}</b></div>` +
      `<div class="ov-list-row"><span>Success rate</span><b class="${c.successRate >= 75 ? "pos" : ""}">${count(c.successRate)}%</b></div>` +
      `<div class="ov-list-row"><span>COD pending</span><b>${money(c.codPendingPaisa)}</b></div>`;
  }

  function renderFinance(finance) {
    const root = $("ovFinance");
    if (!root) return;
    const f = finance || {};
    root.innerHTML =
      `<div class="ov-list-row"><span>Income</span><b class="pos">${money(f.incomePaisa)}</b></div>` +
      `<div class="ov-list-row"><span>Expense</span><b class="neg">${money(f.expensePaisa)}</b></div>` +
      `<div class="ov-list-row"><span>Supplier due</span><b>${money(f.supplierDuePaisa)}</b></div>` +
      `<div class="ov-list-row"><span>Customer / wholesale due</span><b>${money(f.customerDuePaisa)}</b></div>`;
  }

  function renderTopProducts(products) {
    const root = $("ovTopProducts");
    if (!root) return;
    const rows = Array.isArray(products) ? products : [];
    if (!rows.length) {
      root.innerHTML = '<p class="ov-empty">No product sales in this period</p>';
      return;
    }
    root.innerHTML = rows
      .map(
        (row) =>
          `<div class="ov-list-row"><span>${esc(row.name)}</span><b>${count(row.sold)} sold</b></div>`
      )
      .join("");
  }

  function renderMarketing(marketing) {
    const root = $("ovMarketing");
    if (!root) return;
    const m = marketing || {};
    const sources = Array.isArray(m.sources) ? m.sources : [];
    const sourceRows = sources.length
      ? sources
          .map(
            (row) =>
              `<div class="ov-list-row"><span>${esc(row.label)}</span><b>${count(row.percent)}%</b></div>`
          )
          .join("")
      : '<div class="ov-list-row"><span>Traffic sources</span><b class="pos">—</b></div>';
    root.innerHTML =
      sourceRows +
      `<div class="ov-list-row"><span>Conversion rate</span><b>${count(m.conversionRate)}%</b></div>` +
      `<div class="ov-list-row"><span>Abandoned carts</span><b>${count(m.abandonedCarts)}</b></div>`;
  }

  function renderFlash(flash) {
    const timeEl = $("ovFlashTime");
    const barEl = $("ovFlashBar");
    const barWrap = $("ovFlashBarWrap");
    if (!timeEl || !barEl || !barWrap) return;
    clearInterval(state.timer);
    state.timer = null;

    if (!flash || !flash.active) {
      timeEl.textContent = "No active flash sale";
      barEl.style.width = "0%";
      barWrap.hidden = true;
      return;
    }

    barWrap.hidden = false;
    barEl.style.width = `${Math.min(100, Math.max(0, Number(flash.progress) || 0))}%`;
    const end = new Date(flash.endAt).getTime();
    const tick = () => {
      const diff = Math.max(0, end - Date.now());
      if (!diff) {
        timeEl.textContent = "Flash sale ended";
        barEl.style.width = "100%";
        clearInterval(state.timer);
        state.timer = null;
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      timeEl.textContent = `Flash sale ends in ${pad(h)}:${pad(m)}:${pad(s)}`;
    };
    tick();
    state.timer = setInterval(tick, 1000);
  }

  function render(data) {
    if (!data) return;
    const k = data.kpis || {};
    const note = (data.period && data.period.compareLabel) || "";
    setKpi("ovTotalSales", money(k.totalSalesPaisa), deltaMarkup(k.totalSalesDelta, note));
    setKpi("ovTotalOrders", count(k.totalOrders), deltaMarkup(k.totalOrdersDelta, note));
    setKpi("ovPendingOrders", count(k.pendingOrders), countDeltaMarkup(k.pendingDelta, note, true));
    setKpi("ovNetProfit", money(k.netProfitPaisa), deltaMarkup(k.netProfitDelta, note));
    setKpi("ovNewCustomers", count(k.newCustomers), deltaMarkup(k.newCustomersDelta, note));
    setKpi("ovAvgOrder", money(k.avgOrderPaisa), deltaMarkup(k.avgOrderDelta, note));

    renderTrend(data.trend);
    renderStatus(data.status);
    renderLatest(data.latestOrders);
    renderAlerts(data.alerts);
    renderCourier(data.courier);
    renderFinance(data.finance);
    renderTopProducts(data.topProducts);
    renderMarketing(data.marketing);
    renderFlash(data.flashSale);
  }

  async function load(period, from, to) {
    const root = $("ovRoot");
    if (!root) return;
    state.period = period || state.period;
    state.from = from || "";
    state.to = to || "";

    const params = new URLSearchParams();
    if (state.period === "custom") {
      params.set("period", "custom");
      if (state.from) params.set("from", state.from);
      if (state.to) params.set("to", state.to);
    } else {
      params.set("period", state.period);
    }

    root.setAttribute("aria-busy", "true");
    try {
      const res = await api(`/api/admin/overview?${params.toString()}`, { cache: "no-store" });
      if (!res || !res.ok) {
        let message = "Overview load hoyni";
        try {
          const body = await res.json();
          if (body && body.message) message = body.message;
        } catch {
          /* keep the generic message */
        }
        if (window.toast) window.toast(message, "err");
        return;
      }
      const data = await res.json();
      state.data = data;
      render(data);
    } catch {
      if (window.toast) window.toast("Overview load hoyni", "err");
    } finally {
      root.setAttribute("aria-busy", "false");
    }
  }

  function setActive(period) {
    document.querySelectorAll("#ovPeriod > button").forEach((button) => {
      button.classList.toggle("active", button.dataset.period === period);
    });
  }

  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function bind() {
    const periodBox = $("ovPeriod");
    const customBox = $("ovCustom");
    if (!periodBox) return;

    periodBox.querySelectorAll(":scope > button").forEach((button) => {
      button.addEventListener("click", () => {
        const period = button.dataset.period;
        if (period === "custom") {
          setActive("custom");
          if (customBox) {
            if (!customBox.hidden) {
              customBox.hidden = true;
              return;
            }
            const fromInput = $("ovFrom");
            const toInput = $("ovTo");
            if (fromInput && !fromInput.value) fromInput.value = state.from || todayKey();
            if (toInput && !toInput.value) toInput.value = state.to || todayKey();
            customBox.hidden = false;
          }
          return;
        }
        if (customBox) customBox.hidden = true;
        setActive(period);
        load(period);
      });
    });

    const apply = $("ovApply");
    if (apply) {
      apply.addEventListener("click", () => {
        const from = ($("ovFrom") || {}).value;
        const to = ($("ovTo") || {}).value;
        if (!from || !to) {
          if (window.toast) window.toast("From ar To date din", "err");
          return;
        }
        if (from > to) {
          if (window.toast) window.toast("From date To er age hote hobe", "err");
          return;
        }
        if (customBox) customBox.hidden = true;
        setActive("custom");
        load("custom", from, to);
      });
    }

    document.addEventListener("click", (event) => {
      if (!customBox || customBox.hidden) return;
      if (!event.target.closest(".ov-period")) customBox.hidden = true;
    });
  }

  window.overviewPage = {
    open: () => load(state.period, state.from, state.to),
  };

  bind();
  if ($("ovRoot")) load("today");
})();
