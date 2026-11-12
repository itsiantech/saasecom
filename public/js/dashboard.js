const TOKEN_KEY = "luxe_token";
const token = localStorage.getItem(TOKEN_KEY);

if (!token) location.href = "/login.html";

// ApiSession: silent refresh + re-login modal. It never navigates away, so an
// open form survives an expired session (see api-session.js).
const api = (url, options) => window.ApiSession.request(url, options);

const money = (n) => "৳ " + Number(n || 0).toLocaleString("en-IN");

/* ---- navigation ---- */
let currentView = "products";

function switchView(viewName) {
  if (!viewAllowed(viewName)) {
    toast("এই মডিউল আপনার প্যাকেজে নেই — প্যাকেজ আপগ্রেড করুন", "err");
    return;
  }
  currentView = viewName;

  // Hide all views
  document.querySelectorAll(".view").forEach((el) => el.hidden = true);

  // Show selected view
  const viewEl = document.getElementById("view-" + viewName);
  if (viewEl) viewEl.hidden = false;
  placeUserDock();
  closeUserMenu();

  // Update nav items (group er parent row active hoy na — child active choose kore)
  document.querySelectorAll(".nav-item").forEach((el) => {
    const active = (el.dataset.view === viewName && !el.closest(".nav-parent-row")) ||
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
  } else if (viewName === "inventory-overview") {
    if (window.inventoryPage) window.inventoryPage.open("overview");
  } else if (viewName === "inventory-category") {
    if (window.inventoryPage) window.inventoryPage.open("category");
  } else if (viewName === "inventory-variant") {
    if (window.inventoryPage) window.inventoryPage.open("variant");
  } else if (viewName === "inventory-supplier") {
    if (window.inventoryPage) window.inventoryPage.open("supplier");
  } else if (viewName === "inventory-movements") {
    if (window.inventoryPage) window.inventoryPage.open("movements");
  } else if (viewName === "inventory-damage") {
    if (window.inventoryPage) window.inventoryPage.open("damage");
  } else if (viewName === "inventory-adjustment") {
    if (window.inventoryPage) window.inventoryPage.open("adjustment");
  } else if (viewName === "inventory-transfer") {
    if (window.inventoryPage) window.inventoryPage.open("transfer");
  } else if (viewName === "accounts-dashboard") {
    if (window.accountsPage) window.accountsPage.open("dashboard");
  } else if (viewName === "accounts-sales") {
    if (window.accountsPage) window.accountsPage.open("sales");
  } else if (viewName === "accounts-suppliers") {
    if (window.accountsPage) window.accountsPage.open("suppliers");
  } else if (viewName === "accounts-office") {
    if (window.accountsPage) window.accountsPage.open("office");
  } else if (viewName === "accounts-tech") {
    if (window.accountsPage) window.accountsPage.open("tech");
  } else if (viewName === "accounts-marketing") {
    if (window.accountsPage) window.accountsPage.open("marketing");
  } else if (viewName === "accounts-salary") {
    if (window.accountsPage) window.accountsPage.open("salary");
  } else if (viewName === "accounts-voids") {
    if (window.accountsPage) window.accountsPage.open("voids");
  } else if (viewName === "accounts-export") {
    if (window.accountsPage) window.accountsPage.open("export");
  }
}

/* ---- package modules: sidebar hide + view guard ---- */
// "products" view-e dashboard overview — sheta always available thake,
// karon module bondho thakleo stats read-only dekha jay.
const VIEW_MODULES = {
  "product-list": "products",
  "add-product": "products",
  categories: "categories",
  brands: "brands",
  orders: "orders",
  "order-detail": "orders",
  customers: "customers",
  suppliers: "supplierPortal",
  "supplier-history": "supplierPortal",
  "report-sales": "reports",
  "report-products": "reports",
  "report-categories": "reports",
  "report-coupons": "reports",
  "report-customers": "reports",
  "inventory-overview": "inventory",
  "inventory-category": "inventory",
  "inventory-variant": "inventory",
  "inventory-supplier": "inventory",
  "inventory-movements": "inventory",
  "inventory-damage": "inventory",
  "inventory-adjustment": "inventory",
  "inventory-transfer": "inventory",
  "accounts-dashboard": "accounts",
  "accounts-sales": "accounts",
  "accounts-suppliers": "accounts",
  "accounts-office": "accounts",
  "accounts-tech": "accounts",
  "accounts-marketing": "accounts",
  "accounts-salary": "accounts",
  "accounts-voids": "accounts",
  "accounts-export": "accounts",
  settings: "settings",
  "installment-orders": "partialPayment",
  "flash-sales": "flashSales",
  coupons: "coupons",
};

let storeAccess = null;

function moduleOn(key) {
  if (!storeAccess || !storeAccess.features) return true;
  // purono backend module key na dile kichu hide hobe na (fail open)
  return storeAccess.features[key] !== false;
}

function viewAllowed(viewName) {
  const key = VIEW_MODULES[viewName];
  return !key || moduleOn(key);
}

function applyStoreAccess(access) {
  storeAccess = access && access.features ? access : null;
  if (!storeAccess) return;

  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    if (!viewAllowed(item.dataset.view)) item.hidden = true;
  });
  const productGroup = document.getElementById("navGroupProducts");
  if (productGroup) productGroup.hidden = !moduleOn("products");
  const supplierGroup = document.getElementById("navGroupSuppliers");
  if (supplierGroup) supplierGroup.hidden = !moduleOn("supplierPortal");
  const funnelGroups = { navGroupReports: "reports", navGroupInventory: "inventory", navGroupAccounts: "accounts" };
  Object.entries(funnelGroups).forEach(([id, key]) => {
    if (moduleOn(key)) return;
    const group = document.getElementById(id);
    if (group) group.hidden = true;
  });
  document.querySelectorAll('.nav-item[href^="/settings.html"]').forEach((link) => {
    link.hidden = !moduleOn("settings");
  });
  const addBtn = document.getElementById("addBtn");
  if (addBtn) addBtn.hidden = !moduleOn("products");
  const viewAll = document.getElementById("viewAllProducts");
  if (viewAll) viewAll.hidden = !moduleOn("products");
}

// Navigation click handlers
document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", (e) => {
    const view = item.dataset.view;
    if (!view) return;
    e.preventDefault();
    switchView(view);
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

/* ---- account menu: top-right dock, active view er topbar e bose ---- */
function placeUserDock() {
  const dock = document.getElementById("userDock");
  const view = document.getElementById("view-" + currentView);
  if (!dock || !view) return;
  const bar = view.querySelector(".topbar, .cat-topbar, .pf-topbar");
  if (bar) {
    let right = [...bar.children].find((c) => c.classList.contains("top-right"));
    if (!right) {
      right = document.createElement("div");
      right.className = "top-right";
      [...bar.children].slice(1).forEach((c) => right.appendChild(c));
      bar.appendChild(right);
    }
    right.appendChild(dock);
    return;
  }
  let row = view.querySelector(":scope > .view-dock-row");
  if (!row) {
    row = document.createElement("div");
    row.className = "view-dock-row";
    view.prepend(row);
  }
  row.appendChild(dock);
}

function closeUserMenu() {
  const panel = document.getElementById("userDockPanel");
  const btn = document.getElementById("userDockBtn");
  if (panel) panel.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
}

placeUserDock();
document.getElementById("userDockBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const panel = document.getElementById("userDockPanel");
  const btn = document.getElementById("userDockBtn");
  panel.hidden = !panel.hidden;
  btn.setAttribute("aria-expanded", String(!panel.hidden));
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#userDock")) closeUserMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeUserMenu();
});

/* ---- session ---- */
let me = null;
(async function init() {
  await window.ApiSession.ensureFresh();
  const res = await api("/api/auth/me");
  if (!res) return;
  me = await res.json();
  try {
    localStorage.setItem("luxe_user_id", String(me.id));
  } catch {
    /* private mode */
  }
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
    const brand = document.querySelector(".sb-brand");
    if (name) name.textContent = d.siteTitleResolved;
    if (brand) brand.classList.toggle("has-logo", !!d.logo);
    if (mark) {
      if (d.logo) mark.innerHTML = `<img src="${esc(d.logo)}" alt="Logo" />`;
      else mark.textContent = (d.siteTitleResolved || "L")[0].toUpperCase();
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
    // jei dokaner panel khola, tar link — amar owned list er first na
    const res = await api("/api/stores/current");
    const store = res.ok ? await res.json() : null;
    const el = document.getElementById("storeName");
    const siteBtn = document.getElementById("siteViewBtn");
    if (store && store.slug) {
      localStorage.setItem("luxe_store_slug", store.slug);
      if (store.id) localStorage.setItem("luxe_store_id", String(store.id));
      const settingsNav = [...document.querySelectorAll(".nav-item")].find((a) =>
        String(a.getAttribute("href") || "").startsWith("/settings.html")
      );
      if (settingsNav) settingsNav.href = "/settings.html?store=" + encodeURIComponent(store.slug);
      // themed Next site (Store Settings → Appearance); folder address is the fallback
      const addr = store.storefrontUrl || "/" + encodeURIComponent(store.slug);
      el.innerHTML =
        '<a href="' + esc(addr) + '" target="_blank" rel="noopener" title="আপনার দোকানের আসল সাইট (থিমসহ)">' +
        '<span>Visit website</span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3h7v7"/><path d="M21 3l-9 9"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>' +
        "</a>";
      el.hidden = false;
      if (siteBtn) {
        siteBtn.href = addr;
        siteBtn.title = addr;
        siteBtn.hidden = false;
      }
      if (banner) banner.hidden = true;
      applyStoreAccess(store.access);
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
  const res = await api("/api/products?limit=1000");
  const data = await res.json();
  // server error howle array na ashte pare — crash bondho
  products = Array.isArray(data) ? data : (Array.isArray(data.products) ? data.products : []);
  renderStats();
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
document.getElementById("viewAllProducts").addEventListener("click", (e) => {
  e.preventDefault();
  switchView("product-list");
});
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
  // package e flash sales na thakle toggle ON holeo menu fire ashbe na
  const on = enabled !== false && viewAllowed("flash-sales");
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
  if (window.FormGuard) window.FormGuard.clearAllLocal();
  if (window.ApiSession) window.ApiSession.clear();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem("luxe_store_slug");
  localStorage.removeItem("luxe_store_id");
  localStorage.removeItem("luxe_user_id");
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
