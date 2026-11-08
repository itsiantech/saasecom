const TOKEN_KEY = "luxe_token";
const token = localStorage.getItem(TOKEN_KEY);
const LOGIN_URL = "/admin-login.html";

if (!token) location.href = LOGIN_URL;

const $ = (id) => document.getElementById(id);

/* ---------- helpers ---------- */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(url, options = {}) {
  let res;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error("সার্ভারের সাথে যোগাযোগ হচ্ছে না — সার্ভার চালু আছে কিনা দেখুন");
  }
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const html = typeof data === "string" && /^\s*</.test(data);
    throw new Error(html ? "সার্ভার এই অনুরোধ চিনছে না — সার্ভার রিস্টার্ট করুন" : (data && data.message) || "Request fail hoyeche");
  }
  return data;
}

function toast(text, type) {
  const el = $("toast");
  if (!el) return;
  el.textContent = text;
  el.className = "toast show " + (type || "");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3000);
}

const fmtLimit = (n) => (n === 0 ? "∞" : Number(n || 0).toLocaleString("en-IN"));

/* ---------- session / guard ---------- */
(async function init() {
  let me;
  try {
    me = await api("/api/auth/me");
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    location.href = LOGIN_URL;
    return;
  }

  $("uName").textContent = me.name;
  $("uEmail").textContent = me.email;
  $("avatar").textContent = (me.name || "A")[0].toUpperCase();

  if (me.role !== "superadmin") {
    document.body.innerHTML =
      '<div style="min-height:100vh;display:grid;place-items:center;text-align:center;padding:24px;">' +
      '<div><h1 style="font-size:28px;">403 — অনুমতি নেই</h1>' +
      '<p style="color:#98917f;margin:12px 0 24px;">এই পেজে শুধু Super Admin ঢুকতে পারবেন।<br>' +
      'এখন <strong style="color:#e8e2d5;">' + esc(me.email || me.name) + '</strong> (' + esc(me.role) + ') দিয়ে লগ-ইন করা আছে।</p>' +
      '<a id="switchSuperAdmin" href="' + LOGIN_URL + '" style="display:inline-block;padding:10px 20px;border:1px solid #d4af7a;border-radius:999px;color:#d4af7a;text-decoration:none;font-size:14px;">Super Admin দিয়ে লগ-ইন করুন</a>' +
      '<div style="margin-top:16px;"><a href="/dashboard.html" style="color:#98917f;font-size:13px;">← ড্যাশবোর্ডে ফিরুন</a></div></div>';
    document.getElementById("switchSuperAdmin").addEventListener("click", () => {
      localStorage.removeItem(TOKEN_KEY);
    });
    return;
  }

  await Promise.all([loadStats(), loadPlans(), loadStores(), loadSaas(), loadTheme(), loadLanding(), loadPayments(), loadBillingSettings()]);
})();

/* ---------- stats ---------- */
async function loadStats() {
  try {
    const s = await api("/api/admin/stats");
    $("stStores").textContent = s.stores;
    $("stUsers").textContent = s.users;
    $("stProducts").textContent = s.products;
  } catch (e) {
    toast(e.message, "err");
  }
}

/* ---------- plans ---------- */
let plans = [];

async function loadPlans() {
  try {
    plans = await api("/api/admin/plans");
    $("planCount").textContent = plans.length + " টি প্ল্যান";
    $("stPlans").textContent = plans.length;
    renderPlans();
  } catch (e) {
    toast(e.message, "err");
  }
}

function renderPlans() {
  const tbody = $("planBody");
  if (!plans.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty">কোনো প্ল্যান নেই — "নতুন প্ল্যান" চাপুন</div></td></tr>';
    return;
  }

  tbody.innerHTML = plans
    .map((p) => {
      const limits = [
        "প্রোডাক্ট " + fmtLimit(p.limits?.products),
        "অর্ডার " + fmtLimit(p.limits?.orders),
        "স্টোরেজ " + fmtLimit(p.limits?.storageMB) + "MB",
        "স্টাফ " + fmtLimit(p.limits?.staffMembers),
      ].join(" · ");
      const trial = p.trialDays > 0 ? p.trialDays + " দিন" : "—";
      return `
      <tr>
        <td><div class="p-name">${esc(p.name)}</div><div class="muted" style="font-size:12px;">${esc(p.slug)}</div></td>
        <td style="color:var(--gold);font-weight:600;">৳ ${Number(p.price || 0)}</td>
        <td>${trial}</td>
        <td class="muted" style="font-size:12px;">${esc(limits)}</td>
        <td><span class="badge ${p.active ? "on" : "off"}">${p.active ? "সক্রিয়" : "নিষ্ক্রিয়"}</span></td>
        <td>
          <div class="row-actions">
            <button class="icon-btn edit" title="Edit" onclick="openPlanEdit('${p._id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button class="icon-btn del" title="Delete" onclick="deletePlan('${p._id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

/* ---------- plan modal ---------- */
const overlay = $("modalOverlay");
let editingPlanId = null;

function openPlanAdd() {
  editingPlanId = null;
  $("modalTitle").textContent = "নতুন প্ল্যান";
  $("planForm").reset();
  $("fPlanId").value = "";
  $("fActive").checked = true;
  $("planMsg").textContent = "";
  overlay.classList.add("open");
  $("fPlanName").focus();
}

function openPlanEdit(id) {
  const p = plans.find((x) => x._id === id);
  if (!p) return;
  editingPlanId = id;
  $("modalTitle").textContent = "প্ল্যান এডিট — " + p.name;
  $("fPlanName").value = p.name || "";
  $("fPlanSlug").value = p.slug || "";
  $("fPrice").value = p.price || 0;
  $("fDuration").value = p.durationDays || 30;
  $("fTrial").value = p.trialDays || 0;
  $("fOrder").value = p.order || 0;
  $("fProducts").value = p.limits?.products ?? "";
  $("fOrders").value = p.limits?.orders ?? "";
  $("fStorage").value = p.limits?.storageMB ?? "";
  $("fStaff").value = p.limits?.staffMembers ?? "";
  $("fCustomDomain").checked = !!p.features?.customDomain;
  $("fAnalytics").checked = !!p.features?.analytics;
  $("fApi").checked = !!p.features?.apiAccess;
  $("fPriority").checked = !!p.features?.prioritySupport;
  $("fActive").checked = p.active !== false;
  $("planMsg").textContent = "";
  overlay.classList.add("open");
}

function closePlanModal() {
  overlay.classList.remove("open");
}

$("addPlanBtn").addEventListener("click", openPlanAdd);
$("cancelPlanBtn").addEventListener("click", closePlanModal);
overlay.addEventListener("click", (e) => { if (e.target === overlay) closePlanModal(); });

$("planForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("savePlanBtn");
  const msg = $("planMsg");

  const body = {
    name: $("fPlanName").value.trim(),
    slug: $("fPlanSlug").value.trim(),
    price: Number($("fPrice").value) || 0,
    durationDays: Number($("fDuration").value) || 30,
    trialDays: Number($("fTrial").value) || 0,
    order: Number($("fOrder").value) || 0,
    limits: {
      products: Number($("fProducts").value) || 0,
      orders: Number($("fOrders").value) || 0,
      storageMB: Number($("fStorage").value) || 0,
      staffMembers: Number($("fStaff").value) || 0,
    },
    features: {
      customDomain: $("fCustomDomain").checked,
      analytics: $("fAnalytics").checked,
      apiAccess: $("fApi").checked,
      prioritySupport: $("fPriority").checked,
    },
    active: $("fActive").checked,
  };
  if (!body.name) { msg.textContent = "প্ল্যানের নাম লিখুন"; msg.className = "msg err"; return; }

  btn.disabled = true;
  btn.textContent = "সেভ হচ্ছে...";
  try {
    if (editingPlanId) {
      await api("/api/plans/" + editingPlanId, { method: "PUT", body: JSON.stringify(body) });
      toast("প্ল্যান আপডেট হয়েছে", "ok");
    } else {
      await api("/api/plans", { method: "POST", body: JSON.stringify(body) });
      toast("নতুন প্ল্যান তৈরি হয়েছে", "ok");
    }
    closePlanModal();
    await loadPlans();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "msg err";
  } finally {
    btn.disabled = false;
    btn.textContent = "সেভ করুন";
  }
});

async function deletePlan(id) {
  if (!confirm("এই প্ল্যানটি ডিলিট করবেন? এটা ফেরত আসবে না।")) return;
  try {
    await api("/api/plans/" + id, { method: "DELETE" });
    toast("প্ল্যান ডিলিট হয়েছে", "ok");
    await loadPlans();
  } catch (e) {
    toast(e.message, "err");
  }
}

/* ---------- stores ---------- */
let stores = [];

async function loadStores() {
  try {
    stores = await api("/api/admin/stores");
    $("storeCount").textContent = stores.length + " টি দোকান";
    renderStores();
  } catch (e) {
    toast(e.message, "err");
  }
}

function renderStores() {
  const tbody = $("storeBody");
  if (!stores.length) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty">কোনো দোকান নেই</div></td></tr>';
    return;
  }

  tbody.innerHTML = stores
    .map((s) => {
      const current = s.plan && typeof s.plan === "object" ? s.plan.slug : (s.plan || "");
      const planLabel = s.plan && typeof s.plan === "object" ? (s.plan.name || s.plan.slug) : s.plan;
      const opts = plans
        .map((p) => `<option value="${esc(p.slug)}" ${p.slug === current ? "selected" : ""}>${esc(p.name)}</option>`)
        .join("");
      const owner = s.owner ? s.owner.name + " · " + s.owner.email : "—";
      return `
      <tr>
        <td><div class="p-name">${esc(s.name)}</div><div class="muted" style="font-size:12px;">/${esc(s.slug)}</div></td>
        <td class="muted" style="font-size:12px;">${esc(owner)}</td>
        <td>${planLabel ? '<span class="badge on">' + esc(planLabel) + "</span>" : '<span class="badge off">—</span>'}</td>
        <td>
          <div class="row-actions">
            <select class="plan-select" data-store="${s._id}">${opts}</select>
            <button class="icon-btn edit" title="বদলান" onclick="changeStorePlan('${s._id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </button>
            <a class="icon-btn" title="এই দোকানের Store Settings" href="/settings.html?store=${encodeURIComponent(s.slug)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.89a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 8.96 4.5a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/></svg>
            </a>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

async function changeStorePlan(storeId) {
  const sel = document.querySelector(`.plan-select[data-store="${storeId}"]`);
  if (!sel) return;
  try {
    await api("/api/admin/stores/" + storeId + "/plan", {
      method: "PUT",
      body: JSON.stringify({ planSlug: sel.value }),
    });
    toast("দোকানের প্ল্যান বদলেছে", "ok");
    await loadStores();
  } catch (e) {
    toast(e.message, "err");
  }
}

/* ---------- settings (SaaS toggle) ---------- */
async function loadSaas() {
  try {
    const res = await fetch("/api/admin/settings/saas");
    const { saasEnabled } = await res.json();
    $("saasToggle").checked = !!saasEnabled;
  } catch { /* ignore */ }
}

$("saasToggle").addEventListener("change", async (e) => {
  try {
    const res = await fetch("/api/admin/settings/saas", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ enabled: e.target.checked }),
    });
    const data = await res.json();
    $("saasToggle").checked = !!data.saasEnabled;
    toast("SaaS মোড " + (data.saasEnabled ? "চালু" : "বন্ধ") + " হয়েছে", "ok");
  } catch (err) {
    toast(err.message, "err");
    e.target.checked = !e.target.checked;
  }
});

/* ---------- admin design colors ---------- */
const THEME_CACHE_KEY = "luxe_admin_theme_vars";

const THEME_FIELDS = [
  { group: "বডি ও কার্ড", items: [
    { key: "bg", label: "বডি ব্যাকগ্রাউন্ড" },
    { key: "panel", label: "কার্ড / প্যানেল ব্যাকগ্রাউন্ড" },
    { key: "line", label: "বর্ডার / লাইন" },
  ]},
  { group: "সাইডবার", items: [
    { key: "sideBg", label: "সাইডবার ব্যাকগ্রাউন্ড" },
    { key: "sideText", label: "সাইডবার টেক্সট" },
    { key: "sideMenu", label: "মেনু কালার (আইডল)" },
    { key: "sideHover", label: "মেনু হোভার" },
  ]},
  { group: "টেক্সট", items: [
    { key: "text", label: "মূল টেক্সট" },
    { key: "muted", label: "সেকেন্ডারি টেক্সট" },
  ]},
  { group: "অ্যাকসেন্ট ও বাটন", items: [
    { key: "accent", label: "অ্যাকসেন্ট (অ্যাকটিভ মেনু)" },
    { key: "icon", label: "আইকন কালার" },
    { key: "btnBg", label: "বাটন কালার" },
  ]},
];

const THEME_PRESETS = {
  "মিডনাইট ব্লু (ডিফল্ট)": {
    bg: "#070d17", panel: "#0e1a29", line: "#1d3149", sideBg: "#091320", sideText: "#e6eef7",
    sideMenu: "#93a8bd", sideHover: "#ffffff", text: "#e6eef7", muted: "#8aa0b6",
    accent: "#4d8dff", icon: "#8aa0b6", btnBg: "#4d8dff",
  },
  "ডার্ক গোল্ড (আগের)": {
    bg: "#0a0a10", panel: "#12121b", line: "#232330", sideBg: "#0e0e16", sideText: "#ece9e2",
    sideMenu: "#98917f", sideHover: "#ece9e2", text: "#ece9e2", muted: "#98917f",
    accent: "#d4af7a", icon: "#98917f", btnBg: "#d4af7a",
  },
  "লাইট": {
    bg: "#f6f4ef", panel: "#ffffff", line: "#e2ddd2", sideBg: "#ffffff", sideText: "#1d1b16",
    sideMenu: "#6b6558", sideHover: "#1d1b16", text: "#1d1b16", muted: "#6f6a5e",
    accent: "#a2743a", icon: "#6f6a5e", btnBg: "#a2743a",
  },
  "ইমারেল্ড": {
    bg: "#06110d", panel: "#0b1f18", line: "#1c3a2e", sideBg: "#081813", sideText: "#e5f2ea",
    sideMenu: "#8aab9b", sideHover: "#ffffff", text: "#e5f2ea", muted: "#8aab9b",
    accent: "#3fbf87", icon: "#8aab9b", btnBg: "#3fbf87",
  },
};

const THEME_DEFAULT = { ...THEME_PRESETS["মিডনাইট ব্লু (ডিফল্ট)"] };
const THEME_KEY_LIST = THEME_FIELDS.reduce((keys, group) => keys.concat(group.items.map((f) => f.key)), []);
let adminTheme = { ...THEME_DEFAULT };
let activePreset = "মিডনাইট ব্লু (ডিফল্ট)";

function matchPreset(theme) {
  return Object.keys(THEME_PRESETS).find((name) =>
    THEME_KEY_LIST.every((key) => String(THEME_PRESETS[name][key]).toLowerCase() === String(theme[key] || "").toLowerCase())
  ) || null;
}

function hexRgb(hex) {
  const h = String(hex || "").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function themeMix(a, b, t) {
  const A = hexRgb(a);
  const B = hexRgb(b);
  const to = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return "#" + to(A.r + (B.r - A.r) * t) + to(A.g + (B.g - A.g) * t) + to(A.b + (B.b - A.b) * t);
}

function themeRgba(hex, alpha) {
  const c = hexRgb(hex);
  return "rgba(" + c.r + "," + c.g + "," + c.b + "," + alpha + ")";
}

function themeLum(hex) {
  const c = hexRgb(hex);
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function themeRatio(a, b) {
  const l1 = themeLum(a);
  const l2 = themeLum(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function themeVars(theme) {
  const t = theme;
  const btnText = themeRatio(t.btnBg, "#ffffff") >= themeRatio(t.btnBg, "#17110a") ? "#ffffff" : "#17110a";
  return {
    "--bg": t.bg,
    "--bg-2": themeMix(t.panel, t.bg, 0.35),
    "--panel": t.panel,
    "--panel-2": themeMix(t.panel, t.text, 0.04),
    "--line": t.line,
    "--line-soft": themeMix(t.line, t.panel, 0.45),
    "--gold": t.accent,
    "--gold-2": themeMix(t.accent, "#000000", 0.18),
    "--gold-soft": themeRgba(t.accent, 0.12),
    "--text": t.text,
    "--muted": t.muted,
    "--side-bg": t.sideBg,
    "--side-text": t.sideText,
    "--side-menu": t.sideMenu,
    "--side-hover": t.sideHover,
    "--side-hover-bg": themeRgba(t.sideHover, 0.08),
    "--icon": t.icon,
    "--btn-bg": t.btnBg,
    "--btn-text": btnText,
    "--input-bg": themeMix(t.panel, t.text, 0.06),
    "--row-hover": themeRgba(t.accent, 0.045),
    "--accent-glow": themeRgba(t.accent, 0.14),
  };
}

function applyTheme(theme) {
  const vars = themeVars(theme);
  const root = document.documentElement;
  Object.keys(vars).forEach((key) => root.style.setProperty(key, vars[key]));
  try { localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(vars)); } catch { /* storage off */ }
  renderThemeChecks(theme);
}

function renderThemeChecks(theme) {
  const el = $("themeChecks");
  if (!el) return;
  const checks = [
    ["টেক্সট / বডি", theme.text, theme.bg, 4.5],
    ["টেক্সট / কার্ড", theme.text, theme.panel, 4.5],
    ["সেকেন্ডারি / কার্ড", theme.muted, theme.panel, 3],
    ["মেনু / সাইডবার", theme.sideMenu, theme.sideBg, 3.5],
  ];
  el.innerHTML = checks
    .map(([label, fg, bg, min]) => {
      const r = themeRatio(fg, bg);
      const ok = r >= min;
      return '<span class="theme-chip ' + (ok ? "ok" : "warn") + '">' + esc(label) + " · " + r.toFixed(1) + ":1</span>";
    })
    .join("");
}

function syncThemeInputs() {
  document.querySelectorAll(".theme-sw input[data-key]").forEach((el) => {
    el.value = adminTheme[el.dataset.key];
    el.closest(".theme-sw").style.background = adminTheme[el.dataset.key];
  });
  document.querySelectorAll(".theme-hex[data-key]").forEach((el) => {
    if (document.activeElement !== el) el.value = adminTheme[el.dataset.key].toUpperCase();
  });
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.preset === activePreset);
  });
}

function buildThemeControls() {
  const groups = $("themeGroups");
  if (groups) {
    groups.innerHTML = THEME_FIELDS.map((group) =>
      '<div class="theme-group"><div class="theme-group-title">' + esc(group.group) + "</div>" +
      group.items.map((f) =>
        '<div class="theme-row">' +
          '<span class="theme-sw"><input type="color" data-key="' + f.key + '" aria-label="' + esc(f.label) + '" /></span>' +
          '<label for="theme-hex-' + f.key + '">' + esc(f.label) + "</label>" +
          '<input class="theme-hex" id="theme-hex-' + f.key + '" data-key="' + f.key + '" type="text" maxlength="7" spellcheck="false" />' +
        "</div>"
      ).join("") + "</div>"
    ).join("");

    groups.querySelectorAll(".theme-sw input").forEach((el) => {
      el.addEventListener("input", () => setThemeColor(el.dataset.key, el.value));
    });
    groups.querySelectorAll(".theme-hex").forEach((el) => {
      el.addEventListener("input", () => {
        const v = el.value.trim().replace(/^([0-9a-f]{6})$/i, "#$1");
        if (/^#[0-9a-f]{6}$/i.test(v)) setThemeColor(el.dataset.key, v);
      });
    });
  }

  const presets = $("themePresets");
  if (presets) {
    presets.innerHTML = Object.keys(THEME_PRESETS)
      .map((name) => '<button class="preset-btn" type="button" data-preset="' + esc(name) + '">' + esc(name) + "</button>")
      .join("");
    presets.querySelectorAll(".preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        activePreset = btn.dataset.preset;
        adminTheme = { ...THEME_PRESETS[activePreset] };
        applyTheme(adminTheme);
        syncThemeInputs();
        themeNote("প্রিসেট বাছা হয়েছে — সেভ করলে থেকে যাবে", "");
      });
    });
  }

  const saveBtn = $("themeSaveBtn");
  if (saveBtn) saveBtn.addEventListener("click", saveTheme);
  const resetBtn = $("themeResetBtn");
  if (resetBtn) resetBtn.addEventListener("click", () => {
    activePreset = "মিডনাইট ব্লু (ডিফল্ট)";
    adminTheme = { ...THEME_DEFAULT };
    applyTheme(adminTheme);
    syncThemeInputs();
    themeNote("ডিফল্টে ফেরানো হলো — সেভ চাপো", "");
  });
}

function setThemeColor(key, value) {
  adminTheme[key] = String(value).toLowerCase();
  activePreset = null;
  applyTheme(adminTheme);
  syncThemeInputs();
  themeNote("সেভ হয়নি", "");
}

let themeNoteTimer;
function themeNote(text, type) {
  const el = $("themeNote");
  if (!el) return;
  el.textContent = text;
  el.className = "theme-note " + (type || "");
  clearTimeout(themeNoteTimer);
  themeNoteTimer = setTimeout(() => { el.textContent = ""; el.className = "theme-note"; }, 2800);
}

async function loadTheme() {
  try {
    const data = await api("/api/admin/settings/theme");
    adminTheme = { ...THEME_DEFAULT, ...(data && data.theme) };
    activePreset = matchPreset(adminTheme);
    applyTheme(adminTheme);
  } catch {
    applyTheme(adminTheme);
  }
  buildThemeControls();
  syncThemeInputs();
}

async function saveTheme() {
  const btn = $("themeSaveBtn");
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "সেভ হচ্ছে...";
  try {
    const data = await api("/api/admin/settings/theme", {
      method: "PUT",
      body: JSON.stringify({ theme: adminTheme }),
    });
    adminTheme = { ...THEME_DEFAULT, ...(data && data.theme) };
    activePreset = matchPreset(adminTheme);
    applyTheme(adminTheme);
    syncThemeInputs();
    themeNote("কালার সেভ হয়েছে", "ok");
  } catch (err) {
    themeNote(err.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "সেভ করুন";
  }
}

/* ---------- landing page branding ---------- */

function imageNode(src) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  return img;
}

function setPanelFavicon(url) {
  let link = document.querySelector('link[rel="icon"]');
  if (!url) {
    if (link && link.dataset.dynamic) link.remove();
    return;
  }
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.dataset.dynamic = "1";
  link.href = url;
}

function setSidebarLogo(url) {
  const brand = document.querySelector(".sb-brand");
  const mark = brand && brand.querySelector(".mark");
  if (!brand || !mark) return;
  brand.classList.toggle("has-logo", !!url);
  mark.classList.toggle("has-logo", !!url);
  if (url) {
    mark.textContent = "";
    mark.appendChild(imageNode(url));
  } else {
    mark.textContent = "L";
  }
}

function setPreview(el, url, fallback) {
  if (!el) return;
  if (url) {
    el.classList.add("has-image");
    el.textContent = "";
    el.appendChild(imageNode(url));
  } else {
    el.classList.remove("has-image");
    el.textContent = fallback;
  }
}

function renderLanding(branding) {
  const b = branding || {};
  $("lbTitle").value = b.title || "";
  $("lbFooterLeft").value = b.footerLeft || "";
  $("lbCopyright").value = b.copyright || "";
  $("lbFooterRight").value = b.footerRight || "";
  setPreview($("lbLogoPreview"), b.logo, "LUXE.");
  setPreview($("lbFaviconPreview"), b.favicon, "—");
  $("lbLogoRemove").disabled = !b.logo;
  $("lbFaviconRemove").disabled = !b.favicon;
  setSidebarLogo(b.logo);
  setPanelFavicon(b.favicon);

  // the "view landing" button must leave the api/admin host
  const landingLink = document.querySelector(".sb-bottom .sb-ghost");
  if (landingLink) {
    const host = location.hostname;
    const isIP = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
    const labels = host.split(".");
    if (!isIP && labels.length > 2) landingLink.href = "https://" + labels.slice(1).join(".");
  }
}

let landingNoteTimer;
function landingNote(text, type) {
  const el = $("landingNote");
  if (!el) return;
  el.textContent = text;
  el.className = "theme-note " + (type || "");
  clearTimeout(landingNoteTimer);
  landingNoteTimer = setTimeout(() => { el.textContent = ""; el.className = "theme-note"; }, 3000);
}

async function loadLanding() {
  try {
    const data = await api("/api/admin/settings/landing");
    renderLanding(data && data.branding);
  } catch (err) {
    toast(err.message, "err");
  }
}

async function saveLanding() {
  const btn = $("landingSaveBtn");
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "সেভ হচ্ছে...";
  try {
    const data = await api("/api/admin/settings/landing", {
      method: "PUT",
      body: JSON.stringify({
        branding: {
          title: $("lbTitle").value,
          footerLeft: $("lbFooterLeft").value,
          copyright: $("lbCopyright").value,
          footerRight: $("lbFooterRight").value,
        },
      }),
    });
    renderLanding(data && data.branding);
    landingNote("সেভ হয়েছে — ল্যান্ডিং পেজে লাইভ", "ok");
  } catch (err) {
    landingNote(err.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "সেভ করুন";
  }
}

async function uploadLandingImage(field, file) {
  const input = field === "logo" ? $("lbLogoInput") : $("lbFaviconInput");
  if (!file) return;
  const form = new FormData();
  form.append(field, file);
  landingNote("আপলোড হচ্ছে...", "");
  try {
    let res;
    try {
      res = await fetch("/api/admin/settings/landing/" + field, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: form,
      });
    } catch {
      throw new Error("সার্ভারের সাথে যোগাযোগ হচ্ছে না — সার্ভার চালু আছে কিনা দেখুন");
    }
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {
      data = { message: /^\s*</.test(text) ? "সার্ভার এই অনুরোধ চিনছে না — সার্ভার রিস্টার্ট করুন" : "" };
    }
    if (!res.ok) throw new Error(data.message || "আপলোড হয়নি");
    renderLanding(data.branding);
    landingNote(field === "logo" ? "লোগো আপলোড হয়েছে" : "ফ্যাভিকন আপলোড হয়েছে", "ok");
  } catch (err) {
    landingNote(err.message, "err");
  } finally {
    if (input) input.value = "";
  }
}

async function removeLandingImage(field) {
  try {
    const data = await api("/api/admin/settings/landing/" + field, { method: "DELETE" });
    renderLanding(data.branding);
    landingNote(field === "logo" ? "লোগো সরানো হয়েছে" : "ফ্যাভিকন সরানো হয়েছে", "ok");
  } catch (err) {
    landingNote(err.message, "err");
  }
}

$("landingSaveBtn").addEventListener("click", saveLanding);
$("lbLogoInput").addEventListener("change", (e) => {
  uploadLandingImage("logo", e.target.files && e.target.files[0]);
});
$("lbFaviconInput").addEventListener("change", (e) => {
  uploadLandingImage("favicon", e.target.files && e.target.files[0]);
});
$("lbLogoRemove").addEventListener("click", () => removeLandingImage("logo"));
$("lbFaviconRemove").addEventListener("click", () => removeLandingImage("favicon"));

/* ---------- platform payments ---------- */
const PAY_STATUS = {
  pending: { label: "অপেক্ষমাণ", cls: "warn" },
  approved: { label: "অনুমোদিত", cls: "on" },
  rejected: { label: "বাতিল", cls: "rejected" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || isNaN(d)) return "—";
  return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
}

const num = (n) => Number(n || 0).toLocaleString("en-IN");

let payRows = [];
let payStatus = "pending";
let payQuery = "";
let payDebounce;

async function loadPayments() {
  const params = new URLSearchParams();
  if (payStatus) params.set("status", payStatus);
  if (payQuery) params.set("q", payQuery);
  try {
    const data = await api("/api/admin/billing/payments?" + params.toString());
    payRows = data.payments || [];
    renderPayments(data.counts || {});
  } catch (e) {
    toast(e.message, "err");
  }
}

function renderPayments(counts) {
  $("payCount").textContent =
    "যাচাইয়ের অপেক্ষায় " + num(counts.pending) + " টি · অনুমোদিত " + num(counts.approved) + " টি";

  const tbody = $("payBody");
  if (!payRows.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty">এই তালিকায় কোনো পেমেন্ট নেই</div></td></tr>';
    return;
  }

  tbody.innerHTML = payRows
    .map((row) => {
      const st = PAY_STATUS[row.status] || { label: row.status, cls: "off" };
      const owner = row.user ? row.user.name + (row.user.email ? " · " + row.user.email : "") : "—";
      const storeLine = row.storeSlug ? "/" + row.storeSlug : "অনুমোদনের পর তৈরি হবে";
      const actions = [
        '<a class="btn-mini link" href="' + esc(row.invoiceUrl) + '" target="_blank" rel="noopener">ইনভয়েস</a>',
        '<a class="btn-mini link" href="' + esc(row.invoiceUrl) + '" target="_blank" rel="noopener">ডাউনলোড</a>',
      ];
      if (row.status === "pending") {
        actions.push('<button class="btn-mini ok" type="button" data-approve="' + esc(row.id) + '">অনুমোদন</button>');
        actions.push('<button class="btn-mini no" type="button" data-reject="' + esc(row.id) + '">বাতিল</button>');
      }

      return `
      <tr>
        <td>
          <div class="pay-inv">${esc(row.invoiceNo)}</div>
          <div class="pay-when">${esc(fmtDate(row.invoiceDate))}</div>
        </td>
        <td>
          <div class="pay-store">${esc(row.storeName)}</div>
          <div class="pay-sub">${esc(storeLine)}</div>
          <div class="pay-sub" title="${esc(owner)}">${esc(owner)}</div>
        </td>
        <td>
          <div>${esc(row.planName || "—")}</div>
          <div class="pay-sub">${row.kind === "existing" ? "আপগ্রেড" : "নতুন দোকান"}</div>
        </td>
        <td class="pay-amount">৳ ${num(row.amount)}</td>
        <td class="pay-method">${esc(row.methodLabel || row.method)}
          <small>${esc(row.trxid || "—")}</small>
        </td>
        <td>
          <span class="badge ${st.cls}">${esc(st.label)}</span>
          <div class="pay-sub">${esc(fmtDate(row.nextDueDate))}</div>
        </td>
        <td><div class="pay-actions">${actions.join("")}</div></td>
      </tr>`;
    })
    .join("");
}

$("payTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-status]");
  if (!btn) return;
  payStatus = btn.dataset.status;
  document.querySelectorAll(".pay-tab").forEach((t) => t.classList.toggle("on", t === btn));
  loadPayments();
});

$("paySearch").addEventListener("input", (e) => {
  const value = e.target.value.trim();
  clearTimeout(payDebounce);
  payDebounce = setTimeout(() => {
    payQuery = value;
    loadPayments();
  }, 350);
});

$("payBody").addEventListener("click", async (e) => {
  const approveBtn = e.target.closest("[data-approve]");
  if (approveBtn) {
    if (!confirm("এই পেমেন্ট অনুমোদন করবেন? দোকান/প্ল্যান সাথে সাথে আপডেট হবে।")) return;
    approveBtn.disabled = true;
    try {
      const out = await api("/api/admin/billing/payments/" + approveBtn.dataset.approve + "/approve", {
        method: "PUT",
      });
      toast(
        out.slugAdjusted
          ? "অনুমোদিত — ঠিকানাটি নেওয়া ছিল, /" + out.storeSlug + " দেওয়া হয়েছে"
          : "পেমেন্ট অনুমোদিত হয়েছে",
        "ok"
      );
      await Promise.all([loadPayments(), loadStores(), loadStats()]);
    } catch (err) {
      toast(err.message, "err");
      approveBtn.disabled = false;
    }
    return;
  }

  const rejectBtn = e.target.closest("[data-reject]");
  if (rejectBtn) openReject(rejectBtn.dataset.reject);
});

/* ---------- reject modal ---------- */
let rejectId = null;

function openReject(id) {
  const row = payRows.find((r) => r.id === id);
  rejectId = id;
  $("rejectSub").textContent = row ? row.invoiceNo + " · " + row.storeName + " · ৳ " + num(row.amount) : "";
  $("rejectReason").value = "";
  $("rejectMsg").textContent = "";
  $("rejectMsg").className = "msg";
  $("rejectOverlay").classList.add("open");
  $("rejectReason").focus();
}

function closeReject() {
  $("rejectOverlay").classList.remove("open");
  rejectId = null;
}

$("rejectCancelBtn").addEventListener("click", closeReject);
$("rejectOverlay").addEventListener("click", (e) => {
  if (e.target === $("rejectOverlay")) closeReject();
});

$("rejectSubmitBtn").addEventListener("click", async () => {
  if (!rejectId) return;
  const reason = $("rejectReason").value.trim();
  const msg = $("rejectMsg");
  if (reason.length < 3) {
    msg.textContent = "বাতিলের কারণ লিখুন";
    msg.className = "msg err";
    return;
  }

  const btn = $("rejectSubmitBtn");
  btn.disabled = true;
  try {
    await api("/api/admin/billing/payments/" + rejectId + "/reject", {
      method: "PUT",
      body: JSON.stringify({ reason }),
    });
    toast("পেমেন্ট বাতিল হয়েছে", "ok");
    closeReject();
    await loadPayments();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "msg err";
  } finally {
    btn.disabled = false;
  }
});

/* ---------- payment settings ---------- */
const BILLING_CARDS = [
  {
    id: "bkash",
    title: "বিকাশ",
    fields: [
      { key: "number", label: "নম্বর", placeholder: "01XXXXXXXXX" },
      { key: "accountName", label: "অ্যাকাউন্টের নাম", placeholder: "LUXE" },
      { key: "instructions", label: "ইন্সট্রাকশন (কাস্টমার যা পড়বে)", textarea: true, placeholder: "সেন্ড মানি করে ট্রানজেকশন আইডি দিন" },
    ],
  },
  {
    id: "nagad",
    title: "নগদ",
    fields: [
      { key: "number", label: "নম্বর", placeholder: "01XXXXXXXXX" },
      { key: "accountName", label: "অ্যাকাউন্টের নাম", placeholder: "LUXE" },
      { key: "instructions", label: "ইন্সট্রাকশন (কাস্টমার যা পড়বে)", textarea: true },
    ],
  },
  {
    id: "bank",
    title: "ব্যাংক ট্রান্সফার",
    fields: [
      { key: "bankName", label: "ব্যাংকের নাম", placeholder: "Islami Bank" },
      { key: "accountName", label: "অ্যাকাউন্টের নাম" },
      { key: "accountNumber", label: "অ্যাকাউন্ট নম্বর" },
      { key: "branch", label: "শাখা" },
      { key: "routingNumber", label: "রাউটিং নম্বর" },
      { key: "instructions", label: "ইন্সট্রাকশন (কাস্টমার যা পড়বে)", textarea: true },
    ],
  },
  {
    id: "qr",
    title: "বাংলা QR",
    fields: [
      { key: "accountName", label: "অ্যাকাউন্টের নাম" },
      { key: "imageUrl", label: "QR ছবি (আপলোড বা লিংক)", placeholder: "/uploads/..." },
      { key: "instructions", label: "ইন্সট্রাকশন (কাস্টমার যা পড়বে)", textarea: true },
    ],
    qr: true,
  },
];

function bmField(id, f, value) {
  const attrs =
    ' data-field="' + f.key + '" placeholder="' + esc(f.placeholder || "") + '" spellcheck="false"';
  const control = f.textarea
    ? '<textarea' + attrs + ">" + esc(value) + "</textarea>"
    : '<input type="text"' + attrs + ' value="' + esc(value) + '" />';
  return '<div class="field"><label>' + esc(f.label) + "</label>" + control + "</div>";
}

function billingCard(m, data) {
  const on = Boolean(data.enabled);
  const qr = m.qr
    ? '<div class="bm-qr">' +
      (data.imageUrl
        ? '<img id="bmQrImg" src="' + esc(data.imageUrl) + '" alt="QR" />'
        : '<div class="bm-qr-empty" id="bmQrImg">QR<br />নেই</div>') +
      '<div><input type="file" id="bmQrFile" accept="image/*" style="font-size:12px;width:100%;" />' +
      '<p class="billing-hint" style="margin-top:6px;">QR ছবি আপলোড করুন (2MB এর নিচে) — অথবা নিচে লিংক বসান</p></div>' +
      "</div>"
    : "";

  return (
    '<div class="bm-card' + (on ? " on" : "") + '" data-card="' + m.id + '">' +
      '<div class="bm-head"><h4><span class="bm-dot"></span>' + esc(m.title) + "</h4>" +
        '<label class="switch"><input type="checkbox" data-method="' + m.id + '"' + (on ? " checked" : "") + ' /><span class="slider"></span></label>' +
      "</div>" +
      '<div class="bm-fields">' +
        qr +
        m.fields.map((f) => bmField(m.id, f, data[f.key] || "")).join("") +
      "</div>" +
    "</div>"
  );
}

function billingApiCard(api) {
  const on = Boolean(api.enabled);
  const field = (key, label, value, placeholder) =>
    '<div class="field"><label>' + esc(label) + "</label>" +
    '<input type="text" data-api="' + key + '" value="' + esc(value) + '" placeholder="' + esc(placeholder || "") + '" spellcheck="false" /></div>';

  return (
    '<div class="bm-card api' + (on ? " on" : "") + '" data-card="api">' +
      '<div class="bm-head"><h4><span class="bm-dot"></span>API পেমেন্ট গেটওয়ে (ফেজ ২)</h4>' +
        '<label class="switch"><input type="checkbox" data-method="api"' + (on ? " checked" : "") + ' /><span class="slider"></span></label>' +
      "</div>" +
      '<div class="bm-fields">' +
        '<div class="bm-2">' +
          field("provider", "গেটওয়ে", api.provider, "bkash / sslcommerz") +
          '<div class="field"><label>মোড</label><select data-api="sandbox" style="width:100%;background:var(--panel);border:1px solid var(--line-soft);border-radius:9px;padding:10px 12px;color:var(--text);font-size:13.5px;">' +
            '<option value="1"' + (api.sandbox !== false ? " selected" : "") + ">Sandbox</option>" +
            '<option value="0"' + (api.sandbox === false ? " selected" : "") + ">Live</option>" +
          "</select></div>" +
        "</div>" +
        '<div class="bm-2">' +
          field("publicKey", "Public / App key", api.publicKey, "••••") +
          field("secretKey", "Secret key", api.secretKey, "••••") +
        "</div>" +
        '<div class="field"><label>নোট</label><textarea data-api="note">' + esc(api.note || "") + "</textarea></div>" +
      "</div>" +
    "</div>"
  );
}

function renderBilling(settings) {
  $("bManualOn").checked = settings.manualEnabled !== false;
  $("billingGrid").innerHTML =
    BILLING_CARDS.map((m) => billingCard(m, settings[m.id] || {})).join("") + billingApiCard(settings.api || {});
  const file = $("bmQrFile");
  if (file) file.addEventListener("change", uploadQr);
}

function collectBilling() {
  const out = {
    manualEnabled: $("bManualOn").checked,
    api: {
      enabled: Boolean(document.querySelector('[data-method="api"]').checked),
      sandbox: document.querySelector('[data-api="sandbox"]').value !== "0",
    },
  };
  ["provider", "publicKey", "secretKey", "note"].forEach((key) => {
    out.api[key] = document.querySelector('[data-api="' + key + '"]').value;
  });

  BILLING_CARDS.forEach((m) => {
    const card = document.querySelector('[data-card="' + m.id + '"]');
    const row = { enabled: Boolean(card.querySelector('[data-method="' + m.id + '"]').checked) };
    m.fields.forEach((f) => {
      row[f.key] = card.querySelector('[data-field="' + f.key + '"]').value;
    });
    out[m.id] = row;
  });

  return out;
}

async function uploadQr(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("image", file);
  try {
    const res = await fetch("/api/settings/upload", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: fd,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.path) throw new Error((data && data.message) || "ছবি আপলোড হয়নি");
    const input = document.querySelector('[data-field="imageUrl"]');
    if (input) input.value = data.path;
    const img = $("bmQrImg");
    if (img && img.tagName === "IMG") img.src = data.path;
    else renderBilling(collectBilling());
    billingNote("QR আপলোড হয়েছে — সেভ চাপুন", "ok");
  } catch (err) {
    toast(err.message, "err");
  }
}

$("billingGrid").addEventListener("change", (e) => {
  const sw = e.target.closest("[data-method]");
  if (!sw) return;
  const card = sw.closest(".bm-card");
  if (card) card.classList.toggle("on", sw.checked);
});

let billingNoteTimer;
function billingNote(text, type) {
  const el = $("billingNote");
  if (!el) return;
  el.textContent = text;
  el.className = "theme-note " + (type || "");
  clearTimeout(billingNoteTimer);
  billingNoteTimer = setTimeout(() => {
    el.textContent = "";
    el.className = "theme-note";
  }, 3000);
}

async function loadBillingSettings() {
  try {
    const data = await api("/api/admin/billing/settings");
    renderBilling(data.settings || {});
  } catch (e) {
    toast(e.message, "err");
  }
}

$("billingSaveBtn").addEventListener("click", async () => {
  const btn = $("billingSaveBtn");
  btn.disabled = true;
  btn.textContent = "সেভ হচ্ছে...";
  try {
    const data = await api("/api/admin/billing/settings", {
      method: "PUT",
      body: JSON.stringify({ settings: collectBilling() }),
    });
    renderBilling(data.settings || {});
    billingNote("পেমেন্ট সেটিংস সেভ হয়েছে", "ok");
  } catch (err) {
    billingNote(err.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "সেভ করুন";
  }
});

/* ---------- misc ---------- */
$("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  location.href = "/admin-login.html";
});

const sidebar = $("sidebar");
const sbOverlay = $("sbOverlay");
document.querySelector(".menu-btn")?.addEventListener("click", () => {
  sidebar.classList.add("open");
  sbOverlay.classList.add("show");
});
sbOverlay.addEventListener("click", () => {
  sidebar.classList.remove("open");
  sbOverlay.classList.remove("show");
});
