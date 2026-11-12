/* ==========================================================================
   Inventory & Stock Manage — eight reports under Reports.
   Exposes window.inventoryPage = { open }.
   Uses ApiSession directly (a 403 must stay inside this page, never log out).
   ========================================================================== */
(function () {
  "use strict";

  const API = "/api/admin/inventory";

  const META = {
    overview: { root: "invOverviewRoot", title: "Stock overview" },
    category: { root: "invCategoryRoot", title: "Category-wise stock" },
    variant: { root: "invVariantRoot", title: "Attribute / variant stock" },
    supplier: { root: "invSupplierRoot", title: "Supplier stock (purchase)" },
    movements: { root: "invMovementsRoot", title: "Stock movements" },
    damage: { root: "invDamageRoot", title: "Damage & returned stock" },
    adjustment: { root: "invAdjustmentRoot", title: "Stock adjustment" },
    transfer: { root: "invTransferRoot", title: "Warehouse transfer" },
  };

  const TYPE_LABELS = {
    all: "All",
    sale: "Sale",
    purchase: "Purchase",
    damage: "Damage",
    return: "Return",
    adjustment: "Adjustment",
    transfer: "Transfer",
    reversal: "Reversal",
  };

  const TYPE_KEYS = ["all", "sale", "purchase", "damage", "return", "adjustment", "transfer", "reversal"];

  const state = {
    access: { status: "pending", canView: false, canExport: false },
    accessPromise: null,
    products: [],
    productsAt: 0,
    warehouses: [],
    variantData: null,
    movementType: "all",
    movementDays: 30,
    movementPage: 1,
    importCsv: "",
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

  function bdt(value) {
    const n = num(value);
    const sign = n < 0 ? "-" : "";
    return `${sign}৳ ${Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  }

  function fmtDate(value, withTime) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
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

  function needsProducts(kind) {
    return kind === "damage" || kind === "adjustment" || kind === "transfer";
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
          const group = el("navGroupInventory");
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
      <h2>Inventory access nei</h2>
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
    return cards
      .map(
        function (card) {
          return `<div class="inv-kpi">
            <span class="inv-kpi-label">${esc(card[0])}</span>
            <strong class="inv-kpi-value">${card[1]}</strong>
            <span class="inv-kpi-sub">${esc(card[2] || "")}</span>
          </div>`;
        }
      )
      .join("");
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

  function actionsHtml() {
    return `<button type="button" class="btn-ghost" data-role="refresh">Refresh</button>${
      state.access.canExport ? '<button type="button" class="btn-ghost" data-role="export">Export CSV</button>' : ""
    }`;
  }

  function readHeader(hint, filters) {
    return `<div class="rep-filterbar">
      <div class="rep-filter-row">
        <p class="inv-hint">${esc(hint)}</p>
        ${filters || ""}
        <div class="rep-actions">${actionsHtml()}</div>
      </div>
    </div>`;
  }

  function typeBadge(type) {
    const cls =
      {
        sale: "is-info",
        purchase: "is-ok",
        damage: "is-danger",
        return: "is-warn",
        adjustment: "is-info",
        transfer: "is-neutral",
        reversal: "is-warn",
      }[type] || "is-neutral";
    return `<span class="inv-badge ${cls}">${esc(TYPE_LABELS[type] || type)}</span>`;
  }

  function statusBadge(status) {
    const cls =
      { received: "is-ok", ordered: "is-info", cancelled: "is-danger" }[status] || "is-neutral";
    return `<span class="inv-badge ${cls}">${esc(status)}</span>`;
  }

  function changeHtml(change) {
    const n = num(change);
    const cls = n > 0 ? "inv-pos" : n < 0 ? "inv-neg" : "inv-muted";
    return `<span class="${cls}">${n > 0 ? "+" : ""}${count(n)}</span>`;
  }

  function setMsg(node, message, kind) {
    if (!node) return;
    node.textContent = message || "";
    node.className = "inv-form-msg" + (kind ? ` is-${kind}` : "");
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

  /* --------------------------------- data --------------------------------- */

  async function loadProducts(force) {
    if (!force && state.products.length && Date.now() - state.productsAt < 60000) return;
    const data = await api("/products");
    state.products = data.products || [];
    state.productsAt = Date.now();
  }

  function productById(id) {
    return state.products.find(function (product) {
      return product.id === id;
    });
  }

  function productOptionsHtml() {
    const options = ['<option value="">— Select product —</option>'];
    state.products.forEach(function (product) {
      const label = `${product.title}${product.sku ? ` — ${product.sku}` : ""} · ${count(product.units)} pcs`;
      options.push(`<option value="${esc(product.id)}">${esc(label)}</option>`);
    });
    return options.join("");
  }

  function variantOptionsHtml(product) {
    const options = [`<option value="">Base product · stock ${count(product.base)}</option>`];
    product.variations.forEach(function (variation) {
      options.push(`<option value="v:${esc(variation.id)}">${esc(variation.label)} · stock ${count(variation.stock)}</option>`);
    });
    product.swatches.forEach(function (swatch) {
      options.push(`<option value="s:${esc(swatch.id)}">${esc(swatch.label)} · stock ${count(swatch.stock)}</option>`);
    });
    return options.join("");
  }

  function syncTargetSelect(form) {
    const productSel = form.querySelector("[data-role='product']");
    const variantSel = form.querySelector("[data-role='variant']");
    if (!productSel || !variantSel) return;
    const product = productById(productSel.value);
    variantSel.innerHTML = product ? variantOptionsHtml(product) : '<option value="">—</option>';
  }

  function filterProductOptions(select, query) {
    const previous = select.value;
    const needle = String(query || "").trim().toLowerCase();
    const list = !needle
      ? state.products
      : state.products.filter(function (product) {
          return `${product.title} ${product.sku}`.toLowerCase().indexOf(needle) >= 0;
        });
    select.innerHTML = productOptionsHtmlFor(list);
    if (previous && list.some(function (product) { return product.id === previous; })) {
      select.value = previous;
    }
  }

  function productOptionsHtmlFor(list) {
    const options = ['<option value="">— Select product —</option>'];
    list.forEach(function (product) {
      const label = `${product.title}${product.sku ? ` — ${product.sku}` : ""} · ${count(product.units)} pcs`;
      options.push(`<option value="${esc(product.id)}">${esc(label)}</option>`);
    });
    return options.join("");
  }

  function wireTargetPicker(form) {
    if (!form) return;
    const select = form.querySelector("[data-role='product']");
    const search = form.querySelector("[data-role='product-search']");
    if (!select) return;
    select.innerHTML = productOptionsHtml();
    select.addEventListener("change", function () {
      syncTargetSelect(form);
    });
    if (search) {
      search.addEventListener("input", function () {
        filterProductOptions(select, search.value);
        syncTargetSelect(form);
      });
    }
    syncTargetSelect(form);
  }

  function populateAllPickers(root) {
    root.querySelectorAll("form").forEach(function (form) {
      const select = form.querySelector("[data-role='product']");
      if (!select) return;
      const previous = select.value;
      select.innerHTML = productOptionsHtml();
      if (previous && productById(previous)) select.value = previous;
      const search = form.querySelector("[data-role='product-search']");
      if (search && search.value.trim()) filterProductOptions(select, search.value);
      syncTargetSelect(form);
    });
  }

  function targetPayload(form) {
    const productSel = form.querySelector("[data-role='product']");
    const variantSel = form.querySelector("[data-role='variant']");
    const payload = { productId: productSel ? productSel.value : "" };
    const raw = variantSel ? variantSel.value : "";
    if (raw.indexOf("v:") === 0) payload.variationId = raw.slice(2);
    if (raw.indexOf("s:") === 0) payload.swatchId = raw.slice(2);
    return payload;
  }

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("CSV file pora jayni"));
      };
      reader.readAsText(file);
    });
  }

  async function postJson(path, body) {
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  }

  /* -------------------------------- export -------------------------------- */

  function exportParams(kind, root) {
    if (kind === "supplier") {
      const form = root.querySelector("[data-role='supplier-filters']");
      if (!form) return {};
      return { status: form.status.value, q: form.q.value.trim() };
    }
    if (kind === "movements") {
      const input = root.querySelector("[data-role='movement-q']");
      return { type: state.movementType, days: state.movementDays, q: input ? input.value.trim() : "" };
    }
    return {};
  }

  async function downloadExport(kind, button, root) {
    button.disabled = true;
    try {
      const query = qs(exportParams(kind, root));
      const res = await window.ApiSession.request(
        `${API}/export?view=${encodeURIComponent(kind)}${query ? "&" + query : ""}`,
        { cache: "no-store" }
      );
      if (!res || !res.ok) {
        let message = "Export fail hoyeche";
        try {
          const data = await res.json();
          if (data && data.message) message = data.message;
        } catch (err) {
          /* generic message */
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const match = /filename="([^"]+)"/.exec(disposition);
      downloadBlob(blob, match ? match[1] : `inventory-${kind}.csv`);
      toast("CSV download hoyeche");
    } catch (err) {
      toast(err.message, "err");
    } finally {
      button.disabled = false;
    }
  }

  function wireHeader(root, kind) {
    const refreshBtn = root.querySelector("[data-role='refresh']");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        refresh(kind, root);
      });
    }
    const exportBtn = root.querySelector("[data-role='export']");
    if (exportBtn) {
      exportBtn.addEventListener("click", function () {
        downloadExport(kind, exportBtn, root);
      });
    }
  }

  /* -------------------------------- overview ------------------------------- */

  async function loadOverview(root, content) {
    const data = await api("/overview");
    const totals = data.totals;
    const cards = [
      ["Total SKUs", count(totals.products), `${count(totals.published)} published`],
      [
        "On-hand units",
        count(totals.units),
        `${count(totals.base)} base · ${count(totals.variantUnits)} variant · ${count(totals.swatchUnits)} swatch`,
      ],
      ["Low stock", count(totals.lowStock), `≤ ${data.lowStockThreshold} units`],
      ["Out of stock", count(totals.outOfStock), "restock dorkar"],
      ["Stock value", bdt(totals.value), "retail value"],
    ];
    const alertRows = (data.alerts || []).map(function (row) {
      return [
        `<span class="rep-name">${esc(row.title)}</span>`,
        esc(row.sku || "—"),
        count(row.base),
        count(row.variantUnits),
        count(row.swatchUnits),
        count(row.units),
        row.units === 0
          ? '<span class="inv-badge is-danger">Out</span>'
          : '<span class="inv-badge is-warn">Low</span>',
      ];
    });
    const recentRows = (data.recent || []).map(function (row) {
      return [
        esc(fmtDate(row.at, true)),
        typeBadge(row.type),
        `<span class="rep-name">${esc(row.product)}</span>`,
        changeHtml(row.change),
        esc(row.reference || "—"),
      ];
    });
    content.innerHTML = `
      <div class="inv-kpis">${cardsHtml(cards)}</div>
      ${panel(
        "Restock alerts",
        `On-hand ${data.lowStockThreshold} ba tar kom unit`,
        tableHtml(["Product", "SKU", "Base", "Variants", "Swatches", "On hand", "Flag"], alertRows, [2, 3, 4, 5])
      )}
      ${panel("Recent movements", "Last 14 days", tableHtml(["Date", "Type", "Product", "Change", "Reference"], recentRows, [3]))}`;
  }

  function mountOverview(root) {
    root.innerHTML = `<div class="rep-page">${readHeader(
      "Base, variant ar swatch stock ek shathe. Variant/swatch stock alada jog hoy.",
      ""
    )}<div data-role="content">${skeleton()}</div></div>`;
    wireHeader(root, "overview");
  }

  /* -------------------------------- category ------------------------------- */

  async function loadCategory(root, content) {
    const data = await api("/categories");
    const rows = (data.rows || []).map(function (row) {
      return [esc(row.category), count(row.products), count(row.units), bdt(row.value)];
    });
    content.innerHTML = panel(
      "Category-wise stock",
      "Primary category = product er prothom category",
      tableHtml(["Category", "Products", "Units", "Stock value"], rows, [1, 2, 3]) +
        `<div class="rep-foot"><span>${count((data.rows || []).length)} categories</span><span>Total ${count(
          data.totals.units
        )} units · ${bdt(data.totals.value)}</span></div>`
    );
  }

  function mountCategory(root) {
    root.innerHTML = `<div class="rep-page">${readHeader(
      "Product er primary category dhore stock group kora hoy.",
      ""
    )}<div data-role="content">${skeleton()}</div></div>`;
    wireHeader(root, "category");
  }

  /* -------------------------------- variant -------------------------------- */

  function renderVariantContent(root, content) {
    const input = root.querySelector("[data-role='variant-q']");
    const needle = input ? input.value.trim().toLowerCase() : "";
    const data = state.variantData || { rows: [], totals: { units: 0, value: 0 } };
    const rows = (data.rows || [])
      .filter(function (row) {
        return !needle || `${row.attribute} ${row.term}`.toLowerCase().indexOf(needle) >= 0;
      })
      .map(function (row) {
        return [esc(row.attribute), esc(row.term), count(row.products), count(row.units), bdt(row.value)];
      });
    content.innerHTML = panel(
      "Attribute / variant stock",
      "Attribute name dhore term-wise units · swatch alada group",
      tableHtml(["Attribute", "Term", "Products", "Units", "Stock value"], rows, [2, 3, 4]) +
        `<div class="rep-foot"><span>${count(rows.length)} terms</span><span>Total ${count(
          data.totals.units
        )} units · ${bdt(data.totals.value)}</span></div>`
    );
  }

  async function loadVariant(root, content) {
    state.variantData = await api("/variants");
    renderVariantContent(root, content);
  }

  function mountVariant(root) {
    root.innerHTML = `<div class="rep-page">${readHeader(
      "Variant ar swatch stock er term-wise breakdown.",
      `<form class="inv-search" data-role="variant-search">
        <input type="search" placeholder="Attribute ba term" data-role="variant-q" />
      </form>`
    )}<div data-role="content">${skeleton()}</div></div>`;
    wireHeader(root, "variant");
    const input = root.querySelector("[data-role='variant-q']");
    if (input) {
      input.addEventListener("input", function () {
        const content = root.querySelector("[data-role='content']");
        if (state.variantData && content) renderVariantContent(root, content);
      });
    }
  }

  /* -------------------------------- supplier ------------------------------- */

  async function loadSupplier(root, content) {
    const form = root.querySelector("[data-role='supplier-filters']");
    const params = form ? { status: form.status.value, q: form.q.value.trim() } : {};
    const data = await api("/suppliers" + (qs(params) ? "?" + qs(params) : ""));
    const totals = data.totals;
    const cards = [
      ["Purchase orders", count(totals.orders), "filtered"],
      ["Line items", count(totals.items), "products"],
      ["Units purchased", count(totals.units), "total qty"],
      ["Purchase cost", bdt(totals.cost), "BDT"],
    ];
    const rows = (data.rows || []).map(function (row) {
      return [
        `<span class="rep-name">${esc(row.orderNo)}</span>`,
        esc(fmtDate(row.date)),
        esc(row.supplier),
        esc(row.product),
        esc(row.sku || "—"),
        count(row.quantity),
        bdt(row.unitCost),
        bdt(row.lineTotal),
        statusBadge(row.status),
        row.stockApplied
          ? '<span class="inv-badge is-ok">Applied</span>'
          : '<span class="inv-badge is-neutral">Not applied</span>',
      ];
    });
    content.innerHTML = `
      <div class="inv-kpis">${cardsHtml(cards)}</div>
      ${panel(
        "Supplier purchases",
        "Supplier order theke purchase stock (received hole stock add hoy)",
        tableHtml(
          ["Order", "Date", "Supplier", "Product", "SKU", "Qty", "Unit cost", "Line total", "Status", "Stock"],
          rows,
          [5, 6, 7]
        )
      )}`;
  }

  function mountSupplier(root) {
    root.innerHTML = `<div class="rep-page">${readHeader(
      "Supplier purchase stock er full history.",
      `<form class="inv-search" data-role="supplier-filters">
        <select name="status" aria-label="Order status">
          <option value="">All status</option>
          <option value="ordered">Ordered</option>
          <option value="received">Received</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="search" name="q" placeholder="Supplier, order ba SKU" />
        <button type="submit" class="btn-ghost">Search</button>
      </form>`
    )}<div data-role="content">${skeleton()}</div></div>`;
    wireHeader(root, "supplier");
    const form = root.querySelector("[data-role='supplier-filters']");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      refresh("supplier", root);
    });
    form.status.addEventListener("change", function () {
      refresh("supplier", root);
    });
  }

  /* -------------------------------- movements ------------------------------ */

  async function loadMovements(root, content) {
    const input = root.querySelector("[data-role='movement-q']");
    const params = {
      type: state.movementType,
      days: state.movementDays,
      q: input ? input.value.trim() : "",
      page: state.movementPage,
      limit: 50,
    };
    const data = await api("/movements?" + qs(params));
    const rows = (data.rows || []).map(function (row) {
      return [
        esc(fmtDate(row.at, true)),
        typeBadge(row.type),
        `<span class="rep-name">${esc(row.product)}</span>`,
        esc(row.sku || "—"),
        esc(row.variant || "—"),
        count(row.quantity),
        changeHtml(row.change),
        esc(row.before == null && row.after == null ? "—" : `${row.before == null ? "?" : row.before} → ${row.after == null ? "?" : row.after}`),
        esc(row.warehouse || "—"),
        esc(row.reference || "—"),
        esc(row.note || ""),
      ];
    });
    const maxPage = Math.max(1, Math.ceil(data.total / data.limit));
    content.innerHTML = panel(
      "Movements",
      `${count(data.total)} rows · last ${data.days} days`,
      tableHtml(
        ["Date", "Type", "Product", "SKU", "Variant", "Qty", "Change", "Before → after", "Warehouse", "Reference", "Note"],
        rows,
        [5, 6, 7]
      ) +
        `<div class="rep-foot"><span>Page ${data.page} / ${maxPage}</span><span class="inv-pager">
          <button type="button" class="btn-ghost" data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>Prev</button>
          <button type="button" class="btn-ghost" data-page="${data.page + 1}" ${
            data.page >= maxPage ? "disabled" : ""
          }>Next</button>
        </span></div>`
    );
    content.querySelectorAll("[data-page]").forEach(function (button) {
      button.addEventListener("click", function () {
        const page = Number(button.getAttribute("data-page"));
        if (page >= 1) {
          state.movementPage = page;
          refresh("movements", root);
        }
      });
    });
  }

  function mountMovements(root) {
    const chips = TYPE_KEYS.map(function (key) {
      return `<button type="button" class="rep-chip" data-mtype="${key}" aria-pressed="${
        state.movementType === key
      }">${TYPE_LABELS[key]}</button>`;
    }).join("");
    root.innerHTML = `<div class="rep-page">${readHeader(
      "Sale, purchase, damage, return, adjustment ar transfer ek timeline e.",
      `<div class="rep-chips" role="group" aria-label="Movement type">${chips}</div>
       <label class="rep-limit">Days
         <select data-role="movement-days">${[7, 30, 90, 180, 365]
           .map(function (day) {
             return `<option value="${day}"${state.movementDays === day ? " selected" : ""}>${day}</option>`;
           })
           .join("")}</select>
       </label>
       <form class="inv-search" data-role="movement-search">
         <input type="search" placeholder="Product, SKU ba reference" data-role="movement-q" />
         <button type="submit" class="btn-ghost">Search</button>
       </form>`
    )}<div data-role="content">${skeleton()}</div></div>`;
    wireHeader(root, "movements");
    root.querySelectorAll("[data-mtype]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.movementType = button.getAttribute("data-mtype");
        state.movementPage = 1;
        root.querySelectorAll("[data-mtype]").forEach(function (other) {
          other.setAttribute("aria-pressed", String(other === button));
        });
        refresh("movements", root);
      });
    });
    root.querySelector("[data-role='movement-days']").addEventListener("change", function (event) {
      state.movementDays = Number(event.target.value) || 30;
      state.movementPage = 1;
      refresh("movements", root);
    });
    root.querySelector("[data-role='movement-search']").addEventListener("submit", function (event) {
      event.preventDefault();
      state.movementPage = 1;
      refresh("movements", root);
    });
  }

  /* --------------------------------- damage -------------------------------- */

  function damageFormHtml() {
    return `<form class="inv-form" data-role="damage-form" novalidate>
      <div class="inv-form-grid">
        <label><span>Type</span>
          <select name="mode"><option value="damage">Damage</option><option value="return">Return</option></select>
        </label>
        <label><span>Find product</span><input type="search" data-role="product-search" placeholder="Title ba SKU" /></label>
        <label><span>Product</span><select data-role="product" name="product" required></select></label>
        <label><span>Variant / swatch</span><select data-role="variant" name="variant"></select></label>
        <label><span>Quantity</span><input type="number" name="quantity" min="1" step="1" value="1" required /></label>
        <label class="inv-check" data-role="restock-wrap" hidden><input type="checkbox" name="restock" checked /> Stock e ferot add korun</label>
        <label><span>Order reference</span><input type="text" name="reference" maxlength="120" placeholder="Optional" /></label>
        <label class="inv-wide"><span>Note</span><input type="text" name="note" maxlength="300" placeholder="Reason ba note" /></label>
      </div>
      <div class="inv-form-actions">
        <button type="submit" class="btn-gold">Record</button>
        <span class="inv-form-msg" data-role="form-msg" role="status"></span>
      </div>
    </form>`;
  }

  function mountDamage(root) {
    root.innerHTML = `<div class="inv-page">
      ${readHeader("Damage stock komay. Return stock ferot add korte pare (restock ON).", "")}
      <div class="inv-kpis" data-role="damage-kpis"></div>
      <section class="rep-panel">
        <div class="rep-panel-head"><div><h2>Record damage / return</h2><p>Quantity always positive — stock effect automatic.</p></div></div>
        ${damageFormHtml()}
      </section>
      <div data-role="damage-list">${skeleton()}</div>
    </div>`;
    wireHeader(root, "damage");
    const form = root.querySelector("[data-role='damage-form']");
    wireTargetPicker(form);
    form.mode.addEventListener("change", function () {
      form.querySelector("[data-role='restock-wrap']").hidden = form.mode.value !== "return";
    });
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const messageNode = form.querySelector("[data-role='form-msg']");
      const payload = targetPayload(form);
      const quantity = Number(form.quantity.value);
      if (!payload.productId) return setMsg(messageNode, "Product select korun", "err");
      if (!Number.isInteger(quantity) || quantity < 1) return setMsg(messageNode, "Quantity 1 ba tar beshi din", "err");
      const button = form.querySelector("button[type='submit']");
      button.disabled = true;
      try {
        const result = await postJson("/damage", {
          mode: form.mode.value,
          quantity: quantity,
          restock: form.mode.value === "return" ? form.restock.checked : false,
          reference: form.reference.value.trim(),
          note: form.note.value.trim(),
          ...payload,
        });
        setMsg(
          messageNode,
          `${result.product}${result.variant ? ` · ${result.variant}` : ""}: ${result.before} → ${result.after} (${result.change > 0 ? "+" : ""}${result.change})`,
          "ok"
        );
        form.quantity.value = 1;
        form.reference.value = "";
        form.note.value = "";
        await afterStockChange(root, "damage");
      } catch (err) {
        setMsg(messageNode, err.message, "err");
      } finally {
        button.disabled = false;
      }
    });
  }

  async function reloadDamage(root) {
    const data = await api("/damage?limit=50");
    const kpis = root.querySelector("[data-role='damage-kpis']");
    if (kpis) {
      kpis.innerHTML = cardsHtml([
        ["Damaged units", count(data.summary.damaged), "stock theke bad"],
        ["Returned units", count(data.summary.returned), "customer return"],
        ["Restocked", count(data.summary.restocked), "stock e ferot"],
      ]);
    }
    const rows = (data.rows || []).map(function (row) {
      return [
        esc(fmtDate(row.at, true)),
        typeBadge(row.type),
        `<span class="rep-name">${esc(row.product)}</span>`,
        esc(row.sku || "—"),
        esc(row.variant || "—"),
        count(row.quantity),
        changeHtml(row.change),
        esc(row.reference || "—"),
        esc(row.note || ""),
      ];
    });
    const list = root.querySelector("[data-role='damage-list']");
    if (list) {
      list.innerHTML = panel(
        "Damage & return log",
        `Latest ${count(rows.length)} of ${count(data.total)}`,
        tableHtml(["Date", "Type", "Product", "SKU", "Variant", "Qty", "Change", "Reference", "Note"], rows, [5, 6])
      );
    }
  }

  /* ------------------------------- adjustment ------------------------------ */

  function adjustmentFormHtml() {
    return `<form class="inv-form" data-role="adjust-form" novalidate>
      <div class="inv-form-grid">
        <label><span>Mode</span>
          <select name="mode">
            <option value="set">Set to quantity</option>
            <option value="increase">Increase by</option>
            <option value="decrease">Decrease by</option>
          </select>
        </label>
        <label><span>Find product</span><input type="search" data-role="product-search" placeholder="Title ba SKU" /></label>
        <label><span>Product</span><select data-role="product" name="product" required></select></label>
        <label><span>Variant / swatch</span><select data-role="variant" name="variant"></select></label>
        <label><span>Quantity</span><input type="number" name="quantity" min="0" step="1" value="0" required /></label>
        <label class="inv-wide"><span>Reason</span><input type="text" name="reason" maxlength="300" placeholder="Cycle count, correction..." /></label>
      </div>
      <div class="inv-form-actions">
        <button type="submit" class="btn-gold">Adjust stock</button>
        <span class="inv-form-msg" data-role="form-msg" role="status"></span>
      </div>
    </form>`;
  }

  function importPanelHtml() {
    return `<section class="rep-panel">
      <div class="rep-panel-head"><div><h2>CSV import</h2><p>Header: sku, stock — optional variant, swatch, note. Absolute stock set hoy.</p></div></div>
      <div class="inv-form-grid">
        <label class="inv-wide"><span>CSV file</span><input type="file" accept=".csv,text/csv" data-role="csv-file" /></label>
      </div>
      <div class="inv-form-actions">
        <button type="button" class="btn-ghost" data-role="csv-preview">Preview</button>
        <button type="button" class="btn-ghost" data-role="csv-template">Download template</button>
        <button type="button" class="btn-gold" data-role="csv-apply" disabled>Apply import</button>
        <span class="inv-form-msg" data-role="import-msg" role="status"></span>
      </div>
      <div data-role="import-preview"></div>
    </section>`;
  }

  async function importCsv(text, dryRun) {
    const res = await window.ApiSession.request(`${API}/import?dryRun=${dryRun ? 1 : 0}`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: text,
    });
    if (!res) throw new Error("Session shesh — abar login korun");
    if (!res.ok) {
      let message = "Import fail hoyeche";
      try {
        const data = await res.json();
        if (data && data.message) message = data.message;
      } catch (err) {
        /* generic */
      }
      throw new Error(message);
    }
    return res.json();
  }

  function renderImportPreview(box, result) {
    if (!box) return;
    const rows = (result.changes || []).map(function (change) {
      return [
        esc(change.sku),
        `<span class="rep-name">${esc(change.product)}</span>`,
        esc(change.variant || "—"),
        count(change.before),
        count(change.after),
        changeHtml(change.delta),
      ];
    });
    const errors = (result.errors || [])
      .map(function (error) {
        return `<li>Line ${error.line}: ${esc(error.message)}</li>`;
      })
      .join("");
    box.innerHTML =
      tableHtml(["SKU", "Product", "Variant", "Before", "After", "Δ"], rows, [3, 4, 5]) +
      (errors ? `<ul class="inv-preview-errors">${errors}</ul>` : "");
  }

  function mountAdjustment(root) {
    root.innerHTML = `<div class="inv-page">
      ${readHeader("Set absolute stock ba +/- kore adjust korun. Warehouse allocation er niche stock nama jabe na.", "")}
      <section class="rep-panel">
        <div class="rep-panel-head"><div><h2>Stock adjustment</h2><p>Prottek change ledger e joma hoy.</p></div></div>
        ${adjustmentFormHtml()}
      </section>
      ${importPanelHtml()}
      <div data-role="adjustment-list">${skeleton()}</div>
    </div>`;
    wireHeader(root, "adjustment");

    const form = root.querySelector("[data-role='adjust-form']");
    wireTargetPicker(form);
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      const messageNode = form.querySelector("[data-role='form-msg']");
      const payload = targetPayload(form);
      const quantity = Number(form.quantity.value);
      if (!payload.productId) return setMsg(messageNode, "Product select korun", "err");
      if (!Number.isInteger(quantity) || quantity < 0) return setMsg(messageNode, "Quantity valid na", "err");
      const button = form.querySelector("button[type='submit']");
      button.disabled = true;
      try {
        const result = await postJson("/adjust", {
          mode: form.mode.value,
          quantity: quantity,
          reason: form.reason.value.trim(),
          ...payload,
        });
        setMsg(
          messageNode,
          result.changed
            ? `${result.product}${result.variant ? ` · ${result.variant}` : ""}: ${result.before} → ${result.after}`
            : "Stock already oi quantity te ache",
          "ok"
        );
        form.quantity.value = 0;
        form.reason.value = "";
        await afterStockChange(root, "adjustment");
      } catch (err) {
        setMsg(messageNode, err.message, "err");
      } finally {
        button.disabled = false;
      }
    });

    const fileInput = root.querySelector("[data-role='csv-file']");
    const previewButton = root.querySelector("[data-role='csv-preview']");
    const applyButton = root.querySelector("[data-role='csv-apply']");
    const previewBox = root.querySelector("[data-role='import-preview']");
    const importMsg = root.querySelector("[data-role='import-msg']");

    previewButton.addEventListener("click", async function () {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return setMsg(importMsg, "CSV file select korun", "err");
      previewButton.disabled = true;
      try {
        const text = await readFileText(file);
        state.importCsv = text;
        const result = await importCsv(text, true);
        renderImportPreview(previewBox, result);
        applyButton.disabled = !result.changed;
        setMsg(
          importMsg,
          `${count((result.changes || []).length)} row milche · ${count((result.errors || []).length)} error`,
          (result.errors || []).length ? "err" : "ok"
        );
      } catch (err) {
        setMsg(importMsg, err.message, "err");
        applyButton.disabled = true;
      } finally {
        previewButton.disabled = false;
      }
    });

    applyButton.addEventListener("click", async function () {
      if (!state.importCsv) return setMsg(importMsg, "Age preview korun", "err");
      applyButton.disabled = true;
      try {
        const result = await importCsv(state.importCsv, false);
        renderImportPreview(previewBox, result);
        setMsg(
          importMsg,
          `${count(result.applied)} row applied · ${count(result.skipped)} skipped · ${count(
            (result.errors || []).length
          )} error`,
          (result.errors || []).length ? "err" : "ok"
        );
        state.importCsv = "";
        fileInput.value = "";
        await afterStockChange(root, "adjustment");
      } catch (err) {
        setMsg(importMsg, err.message, "err");
      } finally {
        applyButton.disabled = false;
      }
    });

    root.querySelector("[data-role='csv-template']").addEventListener("click", function () {
      const csv = "sku,variant,stock,note\r\nSNK-1,,25,cycle count\r\n";
      downloadBlob(new Blob([csv], { type: "text/csv" }), "inventory-import-template.csv");
    });
  }

  async function reloadAdjustment(root) {
    const data = await api("/adjustments?limit=50");
    const rows = (data.rows || []).map(function (row) {
      return [
        esc(fmtDate(row.at, true)),
        `<span class="rep-name">${esc(row.product)}</span>`,
        esc(row.sku || "—"),
        esc(row.variant || "—"),
        count(row.quantity),
        changeHtml(row.change),
        esc(row.before == null ? "—" : count(row.before)),
        esc(row.after == null ? "—" : count(row.after)),
        esc(row.reference || "—"),
        esc(row.note || ""),
      ];
    });
    const list = root.querySelector("[data-role='adjustment-list']");
    if (list) {
      list.innerHTML = panel(
        "Adjustment log",
        `Latest ${count(rows.length)} of ${count(data.total)}`,
        tableHtml(["Date", "Product", "SKU", "Variant", "Qty", "Change", "Before", "After", "Reference", "Reason"], rows, [4, 5, 6, 7])
      );
    }
  }

  /* -------------------------------- transfer ------------------------------- */

  function warehouseFormHtml() {
    return `<form class="inv-form" data-role="warehouse-form" novalidate>
      <div class="inv-form-grid">
        <label><span>New warehouse</span><input type="text" name="name" maxlength="80" placeholder="e.g. Dhaka Hub" required /></label>
        <label><span>Address</span><input type="text" name="address" maxlength="300" placeholder="Optional" /></label>
      </div>
      <div class="inv-form-actions">
        <button type="submit" class="btn-ghost">Add warehouse</button>
        <span class="inv-form-msg" data-role="warehouse-msg" role="status"></span>
      </div>
    </form>`;
  }

  function transferFormHtml() {
    return `<form class="inv-form" data-role="transfer-form" novalidate>
      <div class="inv-form-grid">
        <label><span>From warehouse</span><select name="fromWarehouseId" data-role="from"></select></label>
        <label><span>To warehouse</span><select name="toWarehouseId" data-role="to"></select></label>
        <label><span>Find product</span><input type="search" data-role="product-search" placeholder="Title ba SKU" /></label>
        <label><span>Product</span><select data-role="product" name="product" required></select></label>
        <label><span>Variant / swatch</span><select data-role="variant" name="variant"></select></label>
        <label><span>Quantity</span><input type="number" name="quantity" min="1" step="1" value="1" required /></label>
        <label class="inv-wide"><span>Note</span><input type="text" name="note" maxlength="300" placeholder="Optional" /></label>
      </div>
      <div class="inv-form-actions">
        <button type="submit" class="btn-gold">Transfer</button>
        <span class="inv-form-msg" data-role="form-msg" role="status"></span>
      </div>
    </form>`;
  }

  function mountTransfer(root) {
    root.innerHTML = `<div class="inv-page">
      ${readHeader("Warehouse er moddhe stock move kore — product er total stock same thake.", "")}
      <div class="inv-kpis" data-role="warehouse-kpis"></div>
      <section class="rep-panel">
        <div class="rep-panel-head"><div><h2>Warehouses</h2><p>Main Warehouse default — delete kora jay na.</p></div></div>
        <div class="inv-warehouses" data-role="warehouse-list">${skeleton()}</div>
        ${warehouseFormHtml()}
      </section>
      <section class="rep-panel">
        <div class="rep-panel-head"><div><h2>Transfer stock</h2><p>Source er available quantity er beshi deya jabe na.</p></div></div>
        ${transferFormHtml()}
      </section>
      <div data-role="transfer-list">${skeleton()}</div>
    </div>`;
    wireHeader(root, "transfer");

    const transferForm = root.querySelector("[data-role='transfer-form']");
    wireTargetPicker(transferForm);
    transferForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const messageNode = transferForm.querySelector("[data-role='form-msg']");
      const payload = targetPayload(transferForm);
      const quantity = Number(transferForm.quantity.value);
      const from = transferForm.fromWarehouseId.value;
      const to = transferForm.toWarehouseId.value;
      if (!from || !to) return setMsg(messageNode, "From ar To warehouse select korun", "err");
      if (from === to) return setMsg(messageNode, "Same warehouse e transfer kora jabe na", "err");
      if (!payload.productId) return setMsg(messageNode, "Product select korun", "err");
      if (!Number.isInteger(quantity) || quantity < 1) return setMsg(messageNode, "Quantity 1 ba tar beshi din", "err");
      const button = transferForm.querySelector("button[type='submit']");
      button.disabled = true;
      try {
        const result = await postJson("/transfers", {
          fromWarehouseId: from,
          toWarehouseId: to,
          quantity: quantity,
          note: transferForm.note.value.trim(),
          ...payload,
        });
        setMsg(
          messageNode,
          `${result.product}${result.variant ? ` · ${result.variant}` : ""}: ${result.from.name} → ${
            result.to.name
          } · ${count(result.quantity)} pcs`,
          "ok"
        );
        transferForm.quantity.value = 1;
        transferForm.note.value = "";
        await reloadTransfer(root);
      } catch (err) {
        setMsg(messageNode, err.message, "err");
      } finally {
        button.disabled = false;
      }
    });

    const warehouseForm = root.querySelector("[data-role='warehouse-form']");
    warehouseForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      const messageNode = warehouseForm.querySelector("[data-role='warehouse-msg']");
      const nameInput = warehouseForm.querySelector("input[name='name']");
      const name = nameInput.value.trim();
      if (!name) return setMsg(messageNode, "Warehouse name din", "err");
      const button = warehouseForm.querySelector("button[type='submit']");
      button.disabled = true;
      try {
        await postJson("/warehouses", { name: name, address: warehouseForm.address.value.trim() });
        warehouseForm.reset();
        setMsg(messageNode, `${name} add hoyeche`, "ok");
        await reloadTransfer(root);
      } catch (err) {
        setMsg(messageNode, err.message, "err");
      } finally {
        button.disabled = false;
      }
    });
  }

  function fillWarehouseSelects(root) {
    const from = root.querySelector("[data-role='from']");
    const to = root.querySelector("[data-role='to']");
    if (!from || !to) return;
    const options = state.warehouses
      .map(function (warehouse) {
        return `<option value="${esc(warehouse.id)}">${esc(warehouse.name)}${
          warehouse.isDefault ? " (default)" : ""
        } · ${count(warehouse.units)} pcs</option>`;
      })
      .join("");
    const previousFrom = from.value;
    const previousTo = to.value;
    from.innerHTML = options;
    to.innerHTML = options;
    const has = function (id) {
      return state.warehouses.some(function (warehouse) {
        return warehouse.id === id;
      });
    };
    if (previousFrom && has(previousFrom)) from.value = previousFrom;
    else {
      const main = state.warehouses.find(function (warehouse) {
        return warehouse.isDefault;
      });
      if (main) from.value = main.id;
    }
    if (previousTo && has(previousTo) && previousTo !== from.value) to.value = previousTo;
    else {
      const other = state.warehouses.find(function (warehouse) {
        return warehouse.id !== from.value;
      });
      if (other) to.value = other.id;
    }
  }

  async function reloadTransfer(root) {
    const results = await Promise.all([api("/warehouses"), api("/transfers?limit=50")]);
    const warehouseData = results[0];
    const transfers = results[1];
    state.warehouses = warehouseData.rows || [];

    const kpis = root.querySelector("[data-role='warehouse-kpis']");
    if (kpis) {
      kpis.innerHTML = cardsHtml([
        ["Total units", count(warehouseData.totals.units), "all warehouses"],
        ["Allocated", count(warehouseData.totals.allocated), "non-default warehouses"],
        ["Warehouses", count(warehouseData.totals.warehouses), "including main"],
      ]);
    }

    const list = root.querySelector("[data-role='warehouse-list']");
    if (list) {
      const cards = state.warehouses
        .map(function (warehouse) {
          const badge = warehouse.isDefault
            ? '<span class="inv-badge is-info">Default</span>'
            : `<button type="button" class="inv-icon-btn" data-delete-wh="${esc(warehouse.id)}" title="Delete warehouse" aria-label="Delete ${esc(warehouse.name)}">✕</button>`;
          return `<div class="inv-warehouse">
            <div class="inv-warehouse-head"><strong>${esc(warehouse.name)}</strong>${badge}</div>
            <span class="inv-warehouse-units">${count(warehouse.units)} <small>pcs</small></span>
            <span class="inv-kpi-sub">${esc(warehouse.address || "No address")}</span>
          </div>`;
        })
        .join("");
      list.innerHTML = cards || emptyHtml("Warehouse nei");
      list.querySelectorAll("[data-delete-wh]").forEach(function (button) {
        button.addEventListener("click", async function () {
          if (!window.confirm("Ei warehouse delete korben? Stock thakle delete hobe na.")) return;
          try {
            await api(`/warehouses/${button.getAttribute("data-delete-wh")}`, { method: "DELETE" });
            toast("Warehouse delete hoyeche");
            await reloadTransfer(root);
          } catch (err) {
            toast(err.message, "err");
          }
        });
      });
    }

    fillWarehouseSelects(root);

    const rows = (transfers.rows || []).map(function (row) {
      return [
        esc(fmtDate(row.at, true)),
        `<span class="rep-name">${esc(row.product)}</span>`,
        esc(row.sku || "—"),
        esc(row.variant || "—"),
        count(row.quantity),
        esc(row.from || "—"),
        esc(row.to || "—"),
        esc(row.reference || "—"),
        esc(row.note || ""),
      ];
    });
    const transferList = root.querySelector("[data-role='transfer-list']");
    if (transferList) {
      transferList.innerHTML = panel(
        "Recent transfers",
        `Latest ${count(rows.length)} of ${count(transfers.total)}`,
        tableHtml(["Date", "Product", "SKU", "Variant", "Qty", "From", "To", "Reference", "Note"], rows, [4])
      );
    }
  }

  /* ------------------------------- orchestration --------------------------- */

  async function afterStockChange(root, kind) {
    state.productsAt = 0;
    try {
      await loadProducts(true);
      populateAllPickers(root);
    } catch (err) {
      toast(err.message, "err");
    }
    await refresh(kind, root);
  }

  function showError(root, kind, message) {
    const node =
      root.querySelector("[data-role='content']") ||
      root.querySelector("[data-role='damage-list']") ||
      root.querySelector("[data-role='adjustment-list']") ||
      root.querySelector("[data-role='transfer-list']") ||
      root.querySelector("[data-role='warehouse-list']");
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
      if (kind === "overview" || kind === "category" || kind === "variant" || kind === "supplier" || kind === "movements") {
        const content = root.querySelector("[data-role='content']");
        if (!content) return;
        if (kind === "movements") content.innerHTML = skeleton();
        if (kind === "overview") await loadOverview(root, content);
        else if (kind === "category") await loadCategory(root, content);
        else if (kind === "variant") await loadVariant(root, content);
        else if (kind === "supplier") await loadSupplier(root, content);
        else await loadMovements(root, content);
      } else if (kind === "damage") {
        await reloadDamage(root);
      } else if (kind === "adjustment") {
        await reloadAdjustment(root);
      } else if (kind === "transfer") {
        await reloadTransfer(root);
      }
    } catch (err) {
      showError(root, kind, err.message);
    }
  }

  function mount(kind, root) {
    if (kind === "overview") mountOverview(root);
    else if (kind === "category") mountCategory(root);
    else if (kind === "variant") mountVariant(root);
    else if (kind === "supplier") mountSupplier(root);
    else if (kind === "movements") mountMovements(root);
    else if (kind === "damage") mountDamage(root);
    else if (kind === "adjustment") mountAdjustment(root);
    else if (kind === "transfer") mountTransfer(root);
  }

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

    try {
      if (needsProducts(kind)) await loadProducts();
      if (!root.getAttribute("data-mounted")) {
        mount(kind, root);
        root.setAttribute("data-mounted", "1");
      } else if (needsProducts(kind)) {
        populateAllPickers(root);
      }
      await refresh(kind, root);
    } catch (err) {
      root.innerHTML = errorHtml(err.message);
    }
  }

  ensureAccess();
  window.inventoryPage = { open };
})();
