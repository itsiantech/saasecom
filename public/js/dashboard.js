const TOKEN_KEY = "luxe_token";
const token = localStorage.getItem(TOKEN_KEY);

if (!token) location.href = "/login.html";

const api = async (url, options = {}) => {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem(TOKEN_KEY);
    location.href = "/login.html";
    return;
  }
  return res;
};

const money = (n) => "৳ " + Number(n || 0).toLocaleString("en-IN");

/* ---- navigation ---- */
let currentView = "products";

function switchView(viewName) {
  currentView = viewName;

  // Hide all views
  document.querySelectorAll(".view").forEach((el) => el.hidden = true);

  // Show selected view
  const viewEl = document.getElementById("view-" + viewName);
  if (viewEl) viewEl.hidden = false;

  // Update nav items
  document.querySelectorAll(".nav-item").forEach((el) => {
    const active = el.dataset.view === viewName ||
      (viewName === "order-detail" && el.dataset.view === "orders");
    el.classList.toggle("active", active);
  });

  // submenu group: child active hole auto expand koro + parent highlight
  document.querySelectorAll(".nav-group").forEach((group) => {
    const sub = group.querySelector(".nav-sub");
    const toggle = group.querySelector(".nav-toggle");
    const childActive = !!group.querySelector(".nav-sub .nav-item.active");
    group.classList.toggle("child-active", childActive);
    if (childActive && sub) {
      sub.hidden = false;
      if (toggle) toggle.setAttribute("aria-expanded", "true");
    }
  });

  // mobile sidebar bondho koro
  const sb = document.getElementById("sidebar");
  const ov = document.getElementById("sbOverlay");
  if (sb) sb.classList.remove("open");
  if (ov) ov.classList.remove("show");

  // Load data for the view
  if (viewName === "products") {
    loadProducts();
  } else if (viewName === "categories") {
    // Categories are loaded by categories.js
  } else if (viewName === "add-product") {
    if (window.productForm) window.productForm.open();
  } else if (viewName === "product-list") {
    if (window.productCatalog) window.productCatalog.open();
  } else if (viewName === "orders") {
    if (window.orderCatalog) window.orderCatalog.open();
  } else if (viewName === "customers") {
    if (window.customerPage) window.customerPage.open();
  } else if (viewName === "suppliers") {
    if (window.supplierPage) window.supplierPage.open();
  } else if (viewName === "supplier-history") {
    if (window.supplierHistoryPage) window.supplierHistoryPage.open();
  } else if (viewName === "settings") {
    if (window.settingsPage) window.settingsPage.open();
  } else if (viewName === "installment-orders") {
    if (window.installmentAdmin) window.installmentAdmin.open();
  } else if (viewName === "flash-sales") {
    if (window.flashSalesPage) window.flashSalesPage.open();
  } else if (viewName === "coupons") {
    if (window.couponsPage) window.couponsPage.open();
  } else if (viewName === "hero-slider") {
    if (window.heroSliderPage) window.heroSliderPage.open();
  } else if (viewName === "report-sales") {
    if (window.reportsPage) window.reportsPage.open("sales");
  } else if (viewName === "report-products") {
    if (window.reportsPage) window.reportsPage.open("products");
  } else if (viewName === "report-categories") {
    if (window.reportsPage) window.reportsPage.open("categories");
  } else if (viewName === "report-coupons") {
    if (window.reportsPage) window.reportsPage.open("coupons");
  } else if (viewName === "report-customers") {
    if (window.reportsPage) window.reportsPage.open("customers");
  }
}

// Navigation click handlers
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    e.preventDefault();
    const view = item.dataset.view;
    if (view) switchView(view);
  });
});

// Products er submenu caret toggle
document.querySelectorAll(".nav-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const sub = document.getElementById(btn.getAttribute("aria-controls"));
    if (!sub) return;
    sub.hidden = !sub.hidden;
    btn.setAttribute("aria-expanded", String(!sub.hidden));
  });
});

/* ---- session ---- */
let me = null;
(async function init() {
  const res = await api("/api/auth/me");
  if (!res) return;
  me = await res.json();
  document.getElementById("uName").textContent = me.name;
  document.getElementById("uEmail").textContent = me.email;
  document.getElementById("avatar").textContent = (me.name || "A")[0].toUpperCase();
  loadStoreInfo();
  loadSiteSettings();
  loadPromotionStatus();
  await loadProducts();
})();

/* ---- site settings (logo / title / favicon / footer) ---- */
async function loadSiteSettings() {
  try {
    const res = await api("/api/settings/site");
    if (!res || !res.ok) return;
    const d = await res.json();

    document.title = d.siteTitleResolved + " — Admin Dashboard";

    const mark = document.querySelector(".sb-brand .mark");
    const name = document.querySelector(".sb-brand .name");
    if (name) name.textContent = d.siteTitleResolved;
    if (mark) {
      if (d.logo) {
        mark.classList.add("has-logo");
        mark.innerHTML = `<img src="${esc(d.logo)}" alt="Logo" style="max-width:${Math.min(d.logoWidth, 120)}px;max-height:${Math.min(d.logoHeight, 40)}px" />`;
      } else {
        mark.classList.remove("has-logo");
        mark.textContent = (d.siteTitleResolved || "L")[0].toUpperCase();
      }
    }

    if (d.favicon) {
      let link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = d.favicon;
    }

    const copyright = document.getElementById("siteFooterCopyright");
    if (copyright && d.footerCopyright) copyright.textContent = d.footerCopyright;

    const footerLogo = document.getElementById("footerLogo");
    if (footerLogo && d.footerLogo) {
      footerLogo.src = d.footerLogo;
      footerLogo.hidden = false;
    }
  } catch {
    /* brand fallback e thakbe */
  }
}

/* ---- theme toggle (light / dark) ---- */
const THEME_KEY = "luxe_theme";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const label = document.getElementById("themeLabel");
  if (label) label.textContent = theme === "light" ? "Dark mode" : "Light mode";
  const btn = document.getElementById("themeToggle");
  if (btn) btn.setAttribute("aria-pressed", theme === "light" ? "true" : "false");
}

(function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  applyTheme(saved);
  const btn = document.getElementById("themeToggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
})();

/* ---- store ---- */
async function loadStoreInfo() {
  const banner = document.getElementById("setupBanner");
  try {
    const res = await api("/api/stores/mine");
    const stores = await res.json();
    const el = document.getElementById("storeName");
    const siteBtn = document.getElementById("siteViewBtn");
    if (stores.length) {
      const plan = stores[0].plan;
      const planName = plan && typeof plan === "object" ? plan.name : plan;
      const addr = "/" + encodeURIComponent(stores[0].slug);
      el.innerHTML =
        "<b>" + esc(stores[0].name) + "</b> · " + esc(planName) +
        ' · <a href="' + esc(addr) + '" target="_blank" rel="noopener" title="আপনার দোকানের ঠিকানা">' +
        esc(location.host + addr) + "</a>";
      el.hidden = false;
      if (siteBtn) {
        siteBtn.href = addr;
        siteBtn.title = location.host + addr;
        siteBtn.hidden = false;
      }
      if (banner) banner.hidden = true;
    } else if (banner) {
      banner.hidden = false;
    }
  } catch {
    if (banner) banner.hidden = true;
  }
}

/* ---- products ---- */
let products = [];

async function loadProducts() {
  const res = await api("/api/products");
  const data = await res.json();
  // server error howle array na ashte pare — crash bondho
  products = Array.isArray(data) ? data : (Array.isArray(data.products) ? data.products : []);
  renderStats();
  renderTable();
}

function renderStats() {
  const total = products.length;
  const units = products.reduce((s, p) => s + (p.stock || 0), 0);
  const value = products.reduce((s, p) => s + (p.price || 0) * (p.stock || 0), 0);
  const out = products.filter((p) => !p.stock || p.stock <= 0).length;

  document.getElementById("stTotal").textContent = total;
  document.getElementById("stUnits").textContent = units.toLocaleString("en-IN");
  document.getElementById("stValue").textContent = money(value);
  document.getElementById("stOut").textContent = out;
}

function stockBadge(stock) {
  if (!stock || stock <= 0) return '<span class="badge out">শেষ</span>';
  if (stock < 5) return `<span class="badge low">${stock} পিস — কম</span>`;
  return `<span class="badge in">${stock} পিস</span>`;
}

function renderTable() {
  const tbody = document.getElementById("pBody");
  document.getElementById("pCount").textContent = products.length + " টি প্রোডাক্ট";

  if (!products.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty">এখনো কোনো প্রোডাক্ট নেই — "Add Product" চাপুন</div></td></tr>';
    return;
  }

  tbody.innerHTML = products
    .map(
      (p) => `
      <tr>
        <td>
          <div class="p-name">${esc(p.name)}</div>
          <div class="p-desc">${esc(p.description || "—")}</div>
        </td>
        <td class="p-price">${money(p.price)}</td>
        <td>${stockBadge(p.stock)}</td>
        <td style="color: var(--muted); font-size: 13px;">${new Date(p.createdAt).toLocaleDateString("bn-BD", { day: "numeric", month: "short", year: "numeric" })}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn edit" title="Edit" onclick="openEdit('${p._id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button class="icon-btn del" title="Delete" onclick="removeProduct('${p._id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          </div>
        </td>
      </tr>`
    )
    .join("");
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---- modal: add / edit ---- */
const overlay = document.getElementById("modalOverlay");
const modalTitle = document.getElementById("modalTitle");
const fName = document.getElementById("fName");
const fPrice = document.getElementById("fPrice");
const fStock = document.getElementById("fStock");
const fDesc = document.getElementById("fDesc");
const saveBtn = document.getElementById("saveBtn");
let editingId = null;

function openAdd() {
  editingId = null;
  modalTitle.textContent = "নতুন প্রোডাক্ট";
  fName.value = fPrice.value = fStock.value = fDesc.value = "";
  overlay.classList.add("open");
  fName.focus();
}

function openEdit(id) {
  const p = products.find((x) => x._id === id);
  if (!p) return;
  editingId = id;
  modalTitle.textContent = "প্রোডাক্ট এডিট";
  fName.value = p.name;
  fPrice.value = p.price;
  fStock.value = p.stock;
  fDesc.value = p.description || "";
  overlay.classList.add("open");
}

function closeModal() {
  overlay.classList.remove("open");
}

// "Add Product" dashboard-er vitorei view switch kore (alada page na)
document.getElementById("addBtn").addEventListener("click", () => { switchView("add-product"); });
document.getElementById("cancelBtn").addEventListener("click", closeModal);
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeModal();
});

document.getElementById("productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  saveBtn.disabled = true;
  const body = {
    name: fName.value.trim(),
    price: Number(fPrice.value),
    stock: Number(fStock.value || 0),
    description: fDesc.value.trim(),
  };
  try {
    const res = await api(editingId ? "/api/products/" + editingId : "/api/products", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "সেভ হয়নি");
    closeModal();
    toast(editingId ? "প্রোডাক্ট আপডেট হয়েছে" : "নতুন প্রোডাক্ট যোগ হয়েছে", "ok");
    await loadProducts();
  } catch (err) {
    toast(err.message, "err");
  } finally {
    saveBtn.disabled = false;
  }
});

async function removeProduct(id) {
  const p = products.find((x) => x._id === id);
  if (!confirm(`"${p ? p.name : ""}" ডিলিট করবেন? এটা ফেরত আসবে না।`)) return;
  try {
    const res = await api("/api/products/" + id, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "ডিলিট হয়নি");
    toast("প্রোডাক্ট ডিলিট হয়েছে", "ok");
    await loadProducts();
  } catch (err) {
    toast(err.message, "err");
  }
}

/* ---- misc ---- */
const footerYear = document.getElementById("footerYear");
if (footerYear) footerYear.textContent = new Date().getFullYear();

function toast(text, type) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.className = "toast show " + (type || "");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3200);
}

/* ---- generic confirm modal (Cancel / Delete) — Promise resolve kore ----
   #confirmOverlay dashboard.html e already ache; sob delete action ekhane hoy. */
function confirmDialog({ title = "Are you sure?", text = "", okLabel = "Delete", okClass = "btn-gold" } = {}) {
  const overlay = document.getElementById("confirmOverlay");
  if (!overlay || overlay.classList.contains("open")) return Promise.resolve(false);
  const el = (id) => document.getElementById(id);
  el("confirmTitle").textContent = title;
  el("confirmText").textContent = text;
  const ok = el("confirmOk");
  ok.textContent = okLabel;
  ok.className = okClass;
  overlay.classList.add("open");
  const close = (val) => {
    overlay.classList.remove("open");
    el("confirmOk").onclick = null;
    el("confirmCancel").onclick = null;
    overlay.onclick = null;
    document.removeEventListener("keydown", onKey);
    resolve(val);
  };
  let resolve = () => {};
  el("confirmOk").onclick = () => close(true);
  el("confirmCancel").onclick = () => close(false);
  overlay.onclick = (e) => {
    if (e.target === overlay) close(false);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close(false);
  };
  document.addEventListener("keydown", onKey);
  el("confirmCancel").focus();
  return new Promise((r) => (resolve = r));
}
window.confirmDialog = confirmDialog;
// shared page helpers — `const` bindings window e attach hoy na,
// tai jei JS file gulir nijer module-scoped copy lage shegular jonno expose kora
window.api = api;
window.money = money;
window.toast = toast;
window.esc = esc;
window.switchView = switchView;

/* ---- flash sales global on/off (sidebar menu visibility) ---- */
function applyFlashSalesStatus(enabled) {
  const on = enabled !== false;
  const nav = document.getElementById("navFlashSales");
  if (nav) nav.hidden = !on;
  document.querySelectorAll("[data-flash-off]").forEach((badge) => {
    badge.hidden = on;
  });
  const toggle = document.getElementById("flashSalesEnabled");
  if (toggle) toggle.checked = on;
  const status = document.getElementById("flashSalesStatus");
  if (status) {
    status.textContent = on
      ? "Flash sales ON — sidebar e menu dekhabe."
      : "Flash sales OFF — sidebar theke menu hide ache.";
  }
  if (!on && currentView === "flash-sales") switchView("products");
}
window.applyFlashSalesStatus = applyFlashSalesStatus;

async function loadPromotionStatus() {
  try {
    const res = await api("/api/promotions/status");
    if (!res || !res.ok) return;
    const data = await res.json();
    applyFlashSalesStatus(data.flashSalesEnabled !== false);
  } catch {
    /* status fail hole default ON thakbe */
  }
}

window.addEventListener("settings:saved", (e) => {
  const settings = e.detail && e.detail.settings;
  if (settings && Object.prototype.hasOwnProperty.call(settings, "flash_sales_enabled")) {
    applyFlashSalesStatus(String(settings.flash_sales_enabled) === "true");
  } else {
    loadPromotionStatus();
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  location.href = "/login.html";
});

const sidebar = document.getElementById("sidebar");
const sbOverlay = document.getElementById("sbOverlay");

// mobile menu button — prottek view er topbar e ekta kore ache
document.querySelectorAll(".menu-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    sidebar.classList.add("open");
    sbOverlay.classList.add("show");
  });
});

sbOverlay.addEventListener("click", () => {
  sidebar.classList.remove("open");
  sbOverlay.classList.remove("show");
});
