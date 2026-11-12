/* ==========================================================================
   Accounts & Finance — nine finance reports under Reports.
   Read-only for sales, suppliers and voids; expense/capital entries are the
   only writable data and live in FinanceEntry. Exposes window.accountsPage.
   ========================================================================== */
(function () {
  "use strict";

  const API = "/api/admin/accounts";

  const META = {
    dashboard: { root: "acctDashboardRoot", title: "Accounts dashboard" },
    sales: { root: "acctSalesRoot", title: "Sales & return cost" },
    suppliers: { root: "acctSuppliersRoot", title: "Supplier ledger" },
    office: {
      root: "acctOfficeRoot",
      title: "Office operating cost",
      kinds: ["office"],
      hint: "Rent, utilities ar office er daily khoroch. Void korle report theke soriye jay.",
    },
    tech: {
      root: "acctTechRoot",
      title: "Tech & server cost",
      kinds: ["tech"],
      hint: "Hosting, domain, software ar server khoroch.",
    },
    marketing: {
      root: "acctMarketingRoot",
      title: "Marketing & ads cost",
      kinds: ["marketing"],
      hint: "Ads, boost ar campaign khoroch.",
    },
    salary: {
      root: "acctSalaryRoot",
      title: "Salary & investment",
      kinds: ["salary", "investment"],
      hint: "Salary cost hisheb e jay; investment owner capital hisheb e dhora hoy.",
    },
    voids: { root: "acctVoidsRoot", title: "Void & cancel logs" },
    export: { root: "acctExportRoot", title: "Export Excel report" },
  };

  const PERIODS = [
    { key: "this_month", label: "This month" },
    { key: "last_month", label: "Last month" },
    { key: "last_7_days", label: "Last 7 days" },
    { key: "yearly", label: "This year" },
    { key: "custom", label: "Custom" },
  ];

  const KIND_LABELS = {
    office: "Office operating cost",
    tech: "Tech & server cost",
    marketing: "Marketing & ads cost",
    salary: "Salary",
    investment: "Investment",
  };

  const METHOD_LABELS = {
    cash: "Cash",
    bank: "Bank",
    bkash: "bKash",
    nagad: "Nagad",
    other: "Other",
  };

  const VOID_LABELS = {
    all: "All logs",
    order_cancel: "Order cancel",
    supplier_order_cancel: "PO cancelled",
    supplier_invoice_void: "Invoice void",
    supplier_payment_void: "Payment void",
    expense_void: "Expense void",
  };

  const VOID_KEYS = [
    "all",
    "order_cancel",
    "supplier_order_cancel",
    "supplier_invoice_void",
    "supplier_payment_void",
    "expense_void",
  ];

  const state = {
    access: { status: "pending", canView: false, canExport: false },
    accessPromise: null,
    period: { preset: "this_month", from: "", to: "" },
    supplierQuery: "",
    voidType: "all",
  };

  /* ------------------------------- helpers ------------------------------- */

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

  function count(value) {
    return num(value).toLocaleString("en-IN");
  }

  // All API money is integer paisa.
  function bdt(paisa) {
    const n = num(paisa) / 100;
    const sign = n < 0 ? "-" : "";
    return `${sign}৳ ${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  }

  function signedBdt(paisa) {
    const n = num(paisa) / 100;
    return `${n > 0 ? "+" : n < 0 ? "-" : ""}৳ ${Math.abs(n).toLocaleString("en-IN", {
      maximumFractionDigits: 2,
    })}`;
  }

  function fmtDate(value, withTime) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    const options = { year: "numeric", month: "short", day: "2-digit" };
    if (withTime) {
      options.hour = "2-digit";
      options.minute = "2-digit";
    }
    return date.toLocaleString("en-GB", options);
  }

  function qs(params) {
    const search = new URLSearchParams();
    Object.keys(params || {}).forEach(function (key) {
      const value = params[key];
      if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
    });
    return search.toString();
  }

  function toast(message, kind) {
    if (typeof window.toast === "function") window.toast(message, kind);
  }

  async function api(path, options) {
    const res = await window.ApiSession.request(API + path, options);
    if (!res) throw new Error("Session shesh — abar login korun");
    if (!res.ok) {
      let message = "Request fail hoyeche";
      try {
        const data = await res.json();
        if (data && data.message) message = data.message;
      } catch (err) {
        /* keep the generic message */
      }
      throw new Error(message);
    }
    const type = String(res.headers.get("content-type") || "");
    return type.indexOf("json") >= 0 ? res.json() : res.text();
  }

  function postJson(path, body) {
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  }

  function downloadBlob(blob, name) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(link.href);
    }, 4000);
  }

  function periodQuery() {
    if (state.period.preset) return { preset: state.period.preset };
    return { from: state.period.from, to: state.period.to };
  }

  function periodLabel() {
    if (state.period.preset) {
      const found = PERIODS.find(function (row) {
        return row.key === state.period.preset;
      });
      return found ? found.label : "This month";
    }
    return `${state.period.from || "?"} → ${state.period.to || "?"}`;
  }

  /* -------------------------------- access -------------------------------- */

  function ensureAccess() {
    if (!state.accessPromise) {
      state.accessPromise = window.ApiSession.request(`${API}/access`, { cache: "no-store" })
        .then(async function (res) {
          if (!res || !res.ok) throw new Error("access");
          const data = await res.json();
          state.access = {
            status: "ok",
            canView: Boolean(data.canView),
            canExport: Boolean(data.canExport),
          };
        })
        .catch(function () {
          state.access = { status: "denied", canView: false, canExport: false };
        })
        .finally(function () {
          const group = el("navGroupAccounts");
          if (group) group.hidden = !state.access.canView;
        });
    }
    return state.accessPromise;
  }

  function lockedHtml() {
    return `<div class="rep-state rep-empty">
      <span class="rep-state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>
      </span>
      <h2>Accounts access nei</h2>
      <p>Ei report shudhu store owner ba admin dekhte pare.</p>
    </div>`;
  }

  /* ------------------------------- fragments ------------------------------- */

  function skeleton() {
    return '<div class="rep-skeleton rep-skeleton-table" aria-hidden="true"></div>';
  }

  function emptyHtml(message) {
    return `<div class="rep-state rep-empty">
      <span class="rep-state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
      </span>
      <h2>${esc(message || "Kono data nei")}</h2>
    </div>`;
  }

  function errorHtml(message) {
    return `<div class="rep-state rep-error">
      <span class="rep-state-icon" aria-hidden="true">!</span>
      <h2>Load hoyni</h2>
      <p>${esc(message)}</p>
      <button type="button" class="btn-gold" data-role="retry">Retry</button>
    </div>`;
  }

  function cardsHtml(cards) {
    const body = cards
      .map(function (card) {
        const cls = `rep-card${card.accent ? " is-accent" : ""}${card.danger ? " is-danger" : ""}`;
        return `<article class="${cls}">
          <span class="rep-card-label">${esc(card.label)}</span>
          <strong class="rep-card-value">${card.value}</strong>
          <span class="rep-card-hint">${esc(card.hint || "")}</span>
        </article>`;
      })
      .join("");
    return `<div class="rep-cards">${body}</div>`;
  }

  function tableHtml(headers, rows, numeric) {
    if (!rows.length) return emptyHtml("Kono row nei");
    const numericCols = numeric || [];
    const head = headers
      .map(function (header, index) {
        return `<th scope="col"${numericCols.indexOf(index) >= 0 ? ' class="rep-num"' : ""}>${esc(header)}</th>`;
      })
      .join("");
    const body = rows
      .map(function (cells) {
        return `<tr>${cells
          .map(function (cell, index) {
            return `<td${numericCols.indexOf(index) >= 0 ? ' class="rep-num"' : ""}>${cell}</td>`;
          })
          .join("")}</tr>`;
      })
      .join("");
    return `<div class="rep-table-wrap"><table class="rep-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function panel(title, hint, body, actions) {
    return `<section class="rep-panel">
      <div class="rep-panel-head">
        <div><h2>${esc(title)}</h2><p>${esc(hint)}</p></div>
        ${actions || ""}
      </div>
      ${body}
    </section>`;
  }

  function badge(text, tone) {
    return `<span class="acct-badge is-${tone || "neutral"}">${esc(text)}</span>`;
  }

  function statusBadge(status) {
    const map = {
      paid: "ok",
      delivered: "ok",
      completed: "ok",
      received: "ok",
      active: "ok",
      pending: "warn",
      partially_paid: "warn",
      processing: "info",
      shipped: "info",
      ordered: "info",
      cancelled: "danger",
      refunded: "danger",
      void: "danger",
    };
    return badge(status || "—", map[status] || "neutral");
  }

  function methodText(method) {
    return METHOD_LABELS[method] || method || "—";
  }

  /* -------------------------------- header -------------------------------- */

  function headerHtml(hint, extra) {
    const chips = PERIODS.map(function (row) {
      const pressed = row.key === "custom" ? !state.period.preset : state.period.preset === row.key;
      return `<button type="button" class="rep-chip" data-period="${row.key}" aria-pressed="${pressed}">${row.label}</button>`;
    }).join("");
    const customHidden = state.period.preset ? " hidden" : "";
    const exportButton = state.access.canExport
      ? '<button type="button" class="btn-ghost" data-role="export">Export Excel</button>'
      : "";
    return `<div class="rep-filterbar">
      <div class="rep-filter-row">
        <p class="acct-hint">${esc(hint)}</p>
        <div class="rep-chips" role="group" aria-label="Report period">${chips}</div>
        <form class="rep-dates" data-role="period-custom"${customHidden}>
          <label>From <input type="date" name="from" value="${esc(state.period.from)}" required /></label>
          <label>To <input type="date" name="to" value="${esc(state.period.to)}" required /></label>
          <button type="submit" class="btn-ghost">Apply</button>
        </form>
        ${extra || ""}
        <div class="rep-actions">
          <button type="button" class="btn-ghost" data-role="refresh">Refresh</button>
          ${exportButton}
        </div>
      </div>
      <p class="acct-period-note">Period: <b>${esc(periodLabel())}</b></p>
    </div>`;
  }

  function wireHeader(root, kind) {
    root.querySelectorAll("[data-period]").forEach(function (button) {
      button.addEventListener("click", function () {
        const key = button.getAttribute("data-period");
        if (key === "custom") {
          state.period = { preset: null, from: state.period.from || "", to: state.period.to || "" };
          syncPeriod(root);
          const input = root.querySelector("[data-role='period-custom'] input[name='from']");
          if (input) input.focus();
          return;
        }
        if (state.period.preset === key) return;
        state.period = { preset: key, from: "", to: "" };
        syncPeriod(root);
        refresh(kind, root);
      });
    });

    const customForm = root.querySelector("[data-role='period-custom']");
    if (customForm) {
      customForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const from = customForm.querySelector("input[name='from']").value;
        const to = customForm.querySelector("input[name='to']").value;
        if (!from || !to) return toast("From ar To date din", "err");
        if (from > to) return toast("From date To er age hobe", "err");
        state.period = { preset: null, from: from, to: to };
        syncPeriod(root);
        refresh(kind, root);
      });
    }

    const refreshBtn = root.querySelector("[data-role='refresh']");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        refresh(kind, root);
      });
    }

    const exportBtn = root.querySelector("[data-role='export']");
    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        downloadWorkbook(exportBtn);
      });
    }

    if (kind === "suppliers") {
      const searchForm = root.querySelector("[data-role='supplier-search']");
      if (searchForm) {
        searchForm.addEventListener("submit", function (event) {
          event.preventDefault();
          state.supplierQuery = searchForm.querySelector("input[name='q']").value.trim();
          refresh("suppliers", root);
        });
      }
    }
  }

  function syncPeriod(root) {
    root.querySelectorAll("[data-period]").forEach(function (button) {
      const key = button.getAttribute("data-period");
      const pressed = key === "custom" ? !state.period.preset : state.period.preset === key;
      button.setAttribute("aria-pressed", String(pressed));
    });
    const customForm = root.querySelector("[data-role='period-custom']");
    if (customForm) {
      customForm.hidden = Boolean(state.period.preset);
      const from = customForm.querySelector("input[name='from']");
      const to = customForm.querySelector("input[name='to']");
      if (from && !customForm.hidden) from.value = state.period.from;
      if (to && !customForm.hidden) to.value = state.period.to;
    }
    const note = root.querySelector(".acct-period-note b");
    if (note) note.textContent = periodLabel();
  }

  /* -------------------------------- export -------------------------------- */

  async function downloadWorkbook(button) {
    if (button) button.disabled = true;
    try {
      const res = await window.ApiSession.request(`${API}/export.xlsx?${qs(periodQuery())}`, {
        cache: "no-store",
      });
      if (!res || !res.ok) {
        let message = "Export fail hoyeche";
        try {
          const data = await res.json();
          if (data && data.message) message = data.message;
        } catch (err) {
          /* generic */
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const match = /filename="([^"]+)"/.exec(disposition);
      downloadBlob(blob, match ? match[1] : "accounts-report.xlsx");
      toast("Excel report download hoyeche");
    } catch (err) {
      toast(err.message, "err");
    } finally {
      if (button) button.disabled = false;
    }
  }

  /* ------------------------------- dashboard ------------------------------- */

  async function loadDashboard(root, content) {
    const data = await api("/dashboard?" + qs(periodQuery()));
    const sales = data.sales;
    const expenses = data.expenses;
    const kindCount = (expenses.byKind || []).reduce(function (sum, row) {
      return sum + num(row.count);
    }, 0);

    content.innerHTML = `
      ${cardsHtml([
        {
          label: "Net sales",
          value: bdt(sales.netSalesPaisa),
          hint: `${count(sales.orders)} orders · period ${data.period.from} → ${data.period.to}`,
          accent: true,
        },
        {
          label: "Returns & refunds",
          value: bdt(sales.refundsPaisa),
          hint: `${count(sales.refundedOrders)} refunded orders`,
          danger: sales.refundsPaisa > 0,
        },
        {
          label: "Supplier purchases",
          value: bdt(data.purchases.totalPaisa),
          hint: `${count(data.purchases.invoices)} invoices · paid ${bdt(data.supplierPayments.totalPaisa)}`,
        },
        {
          label: "Operating cost",
          value: bdt(expenses.costPaisa),
          hint: `${count(kindCount)} entries · excludes investment`,
        },
        {
          label: "Net profit",
          value: bdt(data.profit.netPaisa),
          hint: "net sales − refunds − purchases − costs",
          danger: data.profit.netPaisa < 0,
        },
        {
          label: "Cash balance",
          value: bdt(data.cash.balancePaisa),
          hint: "collected + investment − supplier paid − costs",
          accent: data.cash.balancePaisa >= 0,
          danger: data.cash.balancePaisa < 0,
        },
      ])}
      <div class="acct-split">
        ${panel(
          "Cost breakdown",
          "Void kora entry ei hisheb e ashe na",
          tableHtml(
            ["Type", "Entries", "Amount"],
            (expenses.byKind || []).map(function (row) {
              return [
                `<span class="rep-name">${esc(row.label || KIND_LABELS[row.kind] || row.kind)}</span>`,
                count(row.count),
                `<span class="acct-money">${bdt(row.amountPaisa)}</span>`,
              ];
            }),
            [1, 2]
          ) +
            `<div class="rep-foot"><span>Cost total</span><span class="acct-money">${bdt(
              expenses.costPaisa
            )}</span></div>`
        )}
        ${panel(
          "Sales snapshot",
          "Order value theke hisheb kora",
          tableHtml(
            ["Metric", "Amount"],
            [
              ["Gross item value", `<span class="acct-money">${bdt(sales.grossPaisa)}</span>`],
              ["Coupon discounts", `<span class="acct-neg">− ${bdt(sales.discountPaisa)}</span>`],
              ["Shipping charged", `<span class="acct-money">${bdt(sales.shippingPaisa)}</span>`],
              ["Net sales", `<span class="acct-money">${bdt(sales.netSalesPaisa)}</span>`],
              ["Refunds", `<span class="acct-neg">− ${bdt(sales.refundsPaisa)}</span>`],
              ["Cancelled order value", `<span class="acct-muted">${bdt(sales.cancelledValuePaisa)}</span>`],
              ["Collected cash", `<span class="acct-money">${bdt(sales.collectedPaisa)}</span>`],
            ],
            [1]
          )
        )}
      </div>
      ${panel(
        "How these totals are calculated",
        "Ei report shudhu pore theke hisheb kore — kono order ba invoice change kore na",
        `<p class="acct-note">
          <b>Net sales</b> = discounted item value + shipping charged (paid orders).<br />
          <b>Net profit</b> = net sales − refunds − supplier purchases − operating cost.<br />
          <b>Cash balance</b> = collected cash + investment − supplier payments − operating cost.<br />
          Cancelled orders sales e jog hoy na; installment cancel e <code>paid − refund</code> collected thake.
        </p>`
      )}`;
  }

  /* --------------------------------- sales --------------------------------- */

  async function loadSales(root, content) {
    const data = await api("/sales?" + qs(periodQuery()));
    const totals = data.totals;
    const dailyRows = (data.daily || []).map(function (row) {
      return [
        esc(row.date),
        count(row.orders),
        `<span class="acct-money">${bdt(row.grossPaisa)}</span>`,
        `<span class="acct-money">${bdt(row.discountPaisa)}</span>`,
        `<span class="acct-money">${bdt(row.shippingPaisa)}</span>`,
        `<span class="acct-money">${bdt(row.netSalesPaisa)}</span>`,
        `<span class="acct-neg">${bdt(row.refundsPaisa)}</span>`,
        count(row.cancelledOrders),
        `<span class="acct-money">${bdt(row.cancelledValuePaisa)}</span>`,
      ];
    });
    const orderRows = (data.rows || []).map(function (row) {
      return [
        esc(fmtDate(row.date)),
        `<span class="rep-name">${esc(row.orderNumber || "—")}</span>`,
        esc(row.customer || "Guest"),
        statusBadge(row.cancelled ? "cancelled" : row.status),
        statusBadge(row.paymentStatus),
        `<span class="acct-money">${bdt(row.grossPaisa)}</span>`,
        `<span class="acct-money">${bdt(row.discountPaisa)}</span>`,
        `<span class="acct-money">${bdt(row.shippingPaisa)}</span>`,
        row.cancelled
          ? `<span class="acct-muted">cancelled · ${bdt(row.cancelledValuePaisa)}</span>`
          : `<span class="acct-money">${bdt(row.netPaisa)}</span>`,
        row.refundPaisa > 0 ? `<span class="acct-neg">− ${bdt(row.refundPaisa)}</span>` : '<span class="acct-muted">—</span>',
      ];
    });

    content.innerHTML = `
      ${cardsHtml([
        { label: "Net sales", value: bdt(totals.netSalesPaisa), hint: `${count(totals.orders)} paid orders`, accent: true },
        { label: "Return cost", value: bdt(totals.refundsPaisa), hint: `${count(totals.refundedOrders)} refunded`, danger: totals.refundsPaisa > 0 },
        { label: "Cancelled value", value: bdt(totals.cancelledValuePaisa), hint: `${count(totals.cancelledOrders)} cancelled orders` },
        { label: "Discounts", value: bdt(totals.discountPaisa), hint: `shipping ${bdt(totals.shippingPaisa)}` },
      ])}
      ${panel(
        "Daily sales",
        "Order created date dhore daily breakdown",
        tableHtml(
          ["Date", "Orders", "Gross", "Discount", "Shipping", "Net sales", "Refunds", "Cancelled", "Cancelled value"],
          dailyRows,
          [1, 2, 3, 4, 5, 6, 7, 8]
        )
      )}
      ${panel(
        "Orders in this period",
        `${count(data.totalRows)} orders · cancelled order value sales e nei`,
        tableHtml(
          ["Date", "Order", "Customer", "Status", "Payment", "Gross", "Discount", "Shipping", "Net", "Refund"],
          orderRows,
          [5, 6, 7, 8, 9]
        )
      )}`;
  }

  /* -------------------------------- suppliers ------------------------------ */

  async function loadSuppliers(root, content) {
    const params = periodQuery();
    if (state.supplierQuery) params.q = state.supplierQuery;
    const data = await api("/suppliers?" + qs(params));
    const totals = data.totals;
    const rows = (data.rows || []).map(function (row) {
      return [
        `<span class="rep-name">${esc(row.name)}</span>`,
        esc(row.company || "—"),
        esc(row.phone || "—"),
        `<span class="acct-money">${bdt(row.purchasesPaisa)}</span>`,
        `<span class="acct-money">${bdt(row.paidPaisa)}</span>`,
        row.outstandingPaisa > 0
          ? `<span class="acct-neg">${bdt(row.outstandingPaisa)}</span>`
          : `<span class="acct-pos">${bdt(row.outstandingPaisa)}</span>`,
        count(row.invoices),
        row.holds > 0 ? badge(`${row.holds} hold`, "warn") : '<span class="acct-muted">—</span>',
        row.lastPaymentAt ? esc(fmtDate(row.lastPaymentAt)) : '<span class="acct-muted">—</span>',
      ];
    });
    const recentRows = (data.recent || []).map(function (row) {
      return [
        esc(fmtDate(row.at)),
        row.type === "purchase" ? badge("Purchase", "info") : badge("Payment", "ok"),
        esc(row.supplier),
        esc(row.reference || "—"),
        row.method ? esc(methodText(row.method)) : '<span class="acct-muted">—</span>',
        `<span class="acct-money">${bdt(row.amountPaisa)}</span>`,
      ];
    });

    content.innerHTML = `
      ${cardsHtml([
        { label: "Purchases", value: bdt(totals.purchasesPaisa), hint: `${count(totals.invoices)} active invoices` },
        { label: "Paid to suppliers", value: bdt(totals.paidPaisa), hint: "payments in this period", accent: true },
        { label: "Outstanding", value: bdt(totals.outstandingPaisa), hint: "all-time due on active invoices", danger: totals.outstandingPaisa > 0 },
        { label: "Suppliers", value: count((data.rows || []).length), hint: "with ledger activity" },
      ])}
      ${panel(
        "Supplier balances",
        `Outstanding all-time; purchases ar payments ${esc(periodLabel())}`,
        tableHtml(
          ["Supplier", "Company", "Phone", "Purchases", "Paid", "Outstanding", "Invoices", "Holds", "Last payment"],
          rows,
          [3, 4, 5, 6, 8]
        )
      )}
      ${panel(
        "Recent supplier activity",
        "Purchases ar payments ek timeline e",
        tableHtml(["Date", "Type", "Supplier", "Reference", "Method", "Amount"], recentRows, [5])
      )}`;
  }

  /* ------------------------------- expenses -------------------------------- */

  function expenseMount(kind, root) {
    const meta = META[kind];
    const isSalary = kind === "salary";
    const typeField = isSalary
      ? `<label><span>Type</span>
          <select name="kind">
            <option value="salary">Salary</option>
            <option value="investment">Investment (owner capital)</option>
          </select>
        </label>`
      : `<input type="hidden" name="kind" value="${esc(meta.kinds[0])}" />`;
    const methodOptions = Object.keys(METHOD_LABELS)
      .map(function (key) {
        return `<option value="${key}">${METHOD_LABELS[key]}</option>`;
      })
      .join("");

    root.innerHTML = `<div class="rep-page acct-page">
      ${headerHtml(meta.hint, "")}
      <div data-role="kpis">${skeleton()}</div>
      <section class="rep-panel">
        <div class="rep-panel-head">
          <div><h2>Add ${isSalary ? "salary / investment" : "cost"} entry</h2><p>EntryDate faka thakle ajker Dhaka date hobe.</p></div>
        </div>
        <form class="acct-form" data-role="entry-form" novalidate>
          <div class="acct-form-grid">
            ${typeField}
            <label><span>Title</span><input type="text" name="title" maxlength="120" placeholder="e.g. Office rent" required /></label>
            <label><span>Amount (৳)</span><input type="text" name="amount" inputmode="decimal" placeholder="1250.50" required /></label>
            <label><span>Date</span><input type="date" name="entryDate" /></label>
            <label><span>Method</span><select name="method">${methodOptions}</select></label>
            <label><span>Reference</span><input type="text" name="reference" maxlength="120" placeholder="Optional" /></label>
            <label class="acct-wide"><span>Note</span><input type="text" name="note" maxlength="300" placeholder="Optional" /></label>
          </div>
          <div class="acct-form-actions">
            <button type="submit" class="btn-gold">Add entry</button>
            <span class="acct-form-msg" data-role="form-msg" role="status"></span>
          </div>
        </form>
      </section>
      <div data-role="list">${skeleton()}</div>
    </div>`;

    wireHeader(root, kind);
    const form = root.querySelector("[data-role='entry-form']");
    const message = form.querySelector("[data-role='form-msg']");

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const title = form.querySelector("input[name='title']").value.trim();
      const amount = form.querySelector("input[name='amount']").value.trim();
      const entryDate = form.querySelector("input[name='entryDate']").value;
      const method = form.querySelector("select[name='method']").value;
      const reference = form.querySelector("input[name='reference']").value.trim();
      const note = form.querySelector("input[name='note']").value.trim();
      const entryKind = isSalary ? form.querySelector("select[name='kind']").value : meta.kinds[0];
      if (!title) return setMsg(message, "Title din", "err");
      if (!amount) return setMsg(message, "Amount din", "err");

      const button = form.querySelector("button[type='submit']");
      button.disabled = true;
      setMsg(message, "Saving…");
      try {
        const created = await postJson("/entries", {
          kind: entryKind,
          title: title,
          amount: amount,
          entryDate: entryDate,
          method: method,
          reference: reference,
          note: note,
        });
        setMsg(
          message,
          `${KIND_LABELS[created.kind] || entryKind}: ${created.title} · ${bdt(created.amountPaisa)} add hoyeche`,
          "ok"
        );
        form.querySelector("input[name='title']").value = "";
        form.querySelector("input[name='amount']").value = "";
        form.querySelector("input[name='reference']").value = "";
        form.querySelector("input[name='note']").value = "";
        await refresh(kind, root);
      } catch (err) {
        setMsg(message, err.message, "err");
      } finally {
        button.disabled = false;
      }
    });
  }

  function setMsg(node, text, kind) {
    if (!node) return;
    node.textContent = text || "";
    node.className = "acct-form-msg" + (kind ? ` is-${kind}` : "");
  }

  async function loadExpenses(kind, root) {
    const meta = META[kind];
    const data = await api(
      "/entries?kind=" + encodeURIComponent(meta.kinds.join(",")) + "&" + qs(periodQuery())
    );
    const isSalary = kind === "salary";
    const kpis = root.querySelector("[data-role='kpis']");
    if (kpis) {
      const cards = [
        {
          label: isSalary ? "Salary cost" : "Cost in period",
          value: bdt(data.costPaisa),
          hint: `${count(data.total)} active entries`,
          accent: true,
        },
        {
          label: "Voided entries",
          value: count(data.voided),
          hint: "excluded from totals",
          danger: data.voided > 0,
        },
      ];
      if (isSalary) {
        cards.push({
          label: "Investment in",
          value: bdt(data.investmentPaisa),
          hint: "owner capital — not a cost",
        });
      }
      cards.push({
        label: "Average entry",
        value: bdt(data.total ? Math.round(data.costPaisa / data.total) : 0),
        hint: "per active entry",
      });
      kpis.innerHTML = cardsHtml(cards);
    }

    const rows = (data.rows || []).map(function (row) {
      const tone = row.kind === "investment" ? "info" : row.kind === "salary" ? "warn" : "neutral";
      return [
        esc(fmtDate(row.entryDate)),
        badge(row.label || KIND_LABELS[row.kind] || row.kind, tone),
        `<span class="rep-name">${esc(row.title)}</span>`,
        esc(methodText(row.method)),
        esc(row.reference || "—"),
        row.kind === "investment"
          ? `<span class="acct-pos">${signedBdt(row.amountPaisa)}</span>`
          : `<span class="acct-money">${bdt(row.amountPaisa)}</span>`,
        esc(row.note || ""),
        `<button type="button" class="acct-icon-btn" data-void="${esc(row.id)}" data-title="${esc(
          row.title
        )}" title="Void entry" aria-label="Void ${esc(row.title)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>
        </button>`,
      ];
    });

    const list = root.querySelector("[data-role='list']");
    if (list) {
      list.innerHTML = panel(
        isSalary ? "Salary & investment entries" : "Cost entries",
        `Latest ${count(rows.length)} of ${count(data.total)} · void hole total theke bad`,
        tableHtml(
          ["Date", "Type", "Title", "Method", "Reference", "Amount", "Note", ""],
          rows,
          [5]
        )
      );
      list.querySelectorAll("[data-void]").forEach(function (button) {
        button.addEventListener("click", async function () {
          const reason = window.prompt(`"${button.getAttribute("data-title")}" void korar karon:`);
          if (reason === null) return;
          if (!reason.trim()) return toast("Void reason lagbe", "err");
          button.disabled = true;
          try {
            await postJson(`/entries/${button.getAttribute("data-void")}/void`, { reason: reason.trim() });
            toast("Entry void hoyeche");
            await refresh(kind, root);
          } catch (err) {
            toast(err.message, "err");
            button.disabled = false;
          }
        });
      });
    }
  }

  function mountExpenses(kind, root) {
    expenseMount(kind, root);
  }

  /* --------------------------------- voids --------------------------------- */

  async function loadVoids(root, content) {
    const params = periodQuery();
    if (state.voidType !== "all") params.type = state.voidType;
    const data = await api("/voids?" + qs(params));
    const totals = data.totals || {};
    const totalCount = Object.keys(totals).reduce(function (sum, key) {
      return sum + num(totals[key].count);
    }, 0);

    const rows = (data.rows || []).map(function (row) {
      const tone =
        row.type === "expense_void"
          ? "warn"
          : row.type === "order_cancel"
            ? "danger"
            : row.type === "supplier_order_cancel"
              ? "warn"
              : "info";
      return [
        esc(fmtDate(row.at, true)),
        badge(VOID_LABELS[row.type] || row.type, tone),
        `<span class="rep-name">${esc(row.reference || "—")}</span>`,
        esc(row.party || "—"),
        `<span class="acct-money">${bdt(row.amountPaisa)}</span>`,
        esc(row.reason || ""),
        esc(row.actor || "Admin"),
      ];
    });

    content.innerHTML = `
      ${cardsHtml([
        { label: "All logs", value: count(totalCount), hint: "in this period" },
        {
          label: "Order cancels",
          value: count(totals.order_cancel ? totals.order_cancel.count : 0),
          hint: bdt(totals.order_cancel ? totals.order_cancel.amountPaisa : 0),
          danger: totals.order_cancel && totals.order_cancel.count > 0,
        },
        {
          label: "Supplier cancels",
          value: count(totals.supplier_order_cancel ? totals.supplier_order_cancel.count : 0),
          hint: bdt(totals.supplier_order_cancel ? totals.supplier_order_cancel.amountPaisa : 0),
        },
        {
          label: "Supplier voids",
          value: count(
            num(totals.supplier_invoice_void && totals.supplier_invoice_void.count) +
              num(totals.supplier_payment_void && totals.supplier_payment_void.count)
          ),
          hint: `invoices + payments`,
        },
        {
          label: "Expense voids",
          value: count(totals.expense_void ? totals.expense_void.count : 0),
          hint: bdt(totals.expense_void ? totals.expense_void.amountPaisa : 0),
        },
      ])}
      ${panel(
        "Void & cancel timeline",
        `${count(data.total)} rows · latest first`,
        tableHtml(["When", "Type", "Reference", "Party", "Amount", "Reason", "Actor"], rows, [4])
      )}`;
  }

  function mountVoids(root) {
    const chips = VOID_KEYS.map(function (key) {
      return `<button type="button" class="rep-chip" data-vtype="${key}" aria-pressed="${
        state.voidType === key
      }">${VOID_LABELS[key]}</button>`;
    }).join("");
    root.innerHTML = `<div class="rep-page acct-page">
      ${headerHtml(
        "Order cancel, supplier document void ar expense void — sob ek jagay.",
        `<div class="rep-chips" role="group" aria-label="Void type">${chips}</div>`
      )}
      <div data-role="content">${skeleton()}</div>
    </div>`;
    wireHeader(root, "voids");
    root.querySelectorAll("[data-vtype]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.voidType = button.getAttribute("data-vtype");
        root.querySelectorAll("[data-vtype]").forEach(function (other) {
          other.setAttribute("aria-pressed", String(other === button));
        });
        refresh("voids", root);
      });
    });
  }

  /* --------------------------------- export -------------------------------- */

  function mountExport(root) {
    root.innerHTML = `<div class="rep-page acct-page">
      ${headerHtml("Report period select kore ek workbook e sob sheet download korun.", "")}
      <div class="acct-export-card">
        <div>
          <h2>Accounts &amp; Finance workbook</h2>
          <p>Filename: <b>accounts-&lt;from&gt;-to-&lt;to&gt;.xlsx</b> · period <b>${esc(periodLabel())}</b>.
             Excel, LibreOffice ar Google Sheets e khola jay.</p>
        </div>
        <div class="acct-export-actions">
          <button type="button" class="btn-gold" data-role="export-main">Download Excel</button>
        </div>
        <ul class="acct-sheet-list">
          <li><b>Summary</b> — net sales, refunds, purchases, costs, net profit, cash balance ar formula notes</li>
          <li><b>Sales &amp; Returns</b> — every order with gross, discount, shipping, net ar refund</li>
          <li><b>Daily Sales</b> — day-wise orders, net sales, refunds ar cancelled value</li>
          <li><b>Supplier Ledger</b> — purchases, payments, outstanding ar holds per supplier</li>
          <li><b>Expenses</b> — office, tech, marketing, salary ar investment entries</li>
          <li><b>Void &amp; Cancel Logs</b> — order cancels, supplier voids ar expense voids</li>
        </ul>
        <p class="acct-note">Export shudhu porar jonno — kono data change hoy na. Voided entries ar cancelled orders sales theke bad thake.</p>
      </div>
    </div>`;
    wireHeader(root, "export");
    const button = root.querySelector("[data-role='export-main']");
    if (button) {
      button.addEventListener("click", function () {
        downloadWorkbook(button);
      });
    }
  }

  /* ----------------------------- orchestration ----------------------------- */

  function showError(root, kind, message) {
    const node =
      root.querySelector("[data-role='content']") ||
      root.querySelector("[data-role='list']") ||
      root.querySelector("[data-role='kpis']");
    if (!node) return;
    node.innerHTML = errorHtml(message);
    const retry = node.querySelector("[data-role='retry']");
    if (retry) {
      retry.addEventListener("click", function () {
        refresh(kind, root);
      });
    }
  }

  async function refresh(kind, root) {
    try {
      if (kind === "dashboard") {
        const content = root.querySelector("[data-role='content']");
        if (!content) return;
        content.innerHTML = skeleton();
        await loadDashboard(root, content);
      } else if (kind === "sales") {
        const content = root.querySelector("[data-role='content']");
        if (!content) return;
        content.innerHTML = skeleton();
        await loadSales(root, content);
      } else if (kind === "suppliers") {
        const content = root.querySelector("[data-role='content']");
        if (!content) return;
        content.innerHTML = skeleton();
        await loadSuppliers(root, content);
      } else if (kind === "office" || kind === "tech" || kind === "marketing" || kind === "salary") {
        await loadExpenses(kind, root);
      } else if (kind === "voids") {
        const content = root.querySelector("[data-role='content']");
        if (!content) return;
        content.innerHTML = skeleton();
        await loadVoids(root, content);
      } else if (kind === "export") {
        /* static page — period note is updated by syncPeriod */
      }
    } catch (err) {
      showError(root, kind, err.message);
    }
  }

  function mount(kind, root) {
    if (kind === "office" || kind === "tech" || kind === "marketing" || kind === "salary") {
      mountExpenses(kind, root);
      return;
    }
    if (kind === "voids") {
      mountVoids(root);
      return;
    }
    if (kind === "export") {
      mountExport(root);
      return;
    }
    const hints = {
      dashboard: "Sales, returns, supplier purchases, cost ar cash position ek jaygay.",
      sales: "Paid order er item value, discount, shipping ar refund.",
      suppliers: "Supplier invoice ar payment theke balance — read-only.",
    };
    const supplierSearch =
      kind === "suppliers"
        ? `<form class="acct-search" data-role="supplier-search">
            <input type="search" name="q" placeholder="Supplier, company ba phone" value="${esc(
              state.supplierQuery
            )}" />
            <button type="submit" class="btn-ghost">Search</button>
          </form>`
        : "";
    root.innerHTML = `<div class="rep-page acct-page">
      ${headerHtml(hints[kind] || "", supplierSearch)}
      <div data-role="content">${skeleton()}</div>
    </div>`;
    wireHeader(root, kind);
  }

  async function open(kind) {
    if (!META[kind]) return;
    const root = el(META[kind].root);
    if (!root) return;

    await ensureAccess();
    if (!state.access.canView) {
      root.innerHTML = lockedHtml();
      return;
    }

    try {
      if (!root.getAttribute("data-mounted")) {
        mount(kind, root);
        root.setAttribute("data-mounted", "1");
      }
      await refresh(kind, root);
    } catch (err) {
      root.innerHTML = errorHtml(err.message);
    }
  }

  ensureAccess();
  window.accountsPage = { open };
})();
