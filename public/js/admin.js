const TOKEN_KEY = "luxe_token";
const token = localStorage.getItem(TOKEN_KEY);

if (!token) location.href = "/login.html";

const $ = (id) => document.getElementById(id);

/* ---------- helpers ---------- */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error((data && data.message) || "Request fail hoyeche");
  return data;
}

function toast(text, type) {
  const el = $("toast");
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
    location.href = "/login.html";
    return;
  }

  $("uName").textContent = me.name;
  $("uEmail").textContent = me.email;
  $("avatar").textContent = (me.name || "A")[0].toUpperCase();

  if (me.role !== "superadmin") {
    document.body.innerHTML =
      '<div style="min-height:100vh;display:grid;place-items:center;text-align:center;padding:24px;">' +
      '<div><h1 style="font-size:28px;">403 — অনুমতি নেই</h1>' +
      '<p style="color:#98917f;margin:12px 0 24px;">এই পেজে শুধু Super Admin ঢুকতে পারবেন।</p>' +
      '<a href="/dashboard.html" style="color:#d4af7a;">← ড্যাশবোর্ডে ফিরুন</a></div></div>';
    return;
  }

  await Promise.all([loadStats(), loadPlans(), loadStores(), loadSaas()]);
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

/* ---------- misc ---------- */
$("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  location.href = "/login.html";
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
