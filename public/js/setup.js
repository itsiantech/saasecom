const TOKEN_KEY = "luxe_token";

const token = localStorage.getItem(TOKEN_KEY);
if (!token) location.href = "/login.html";

const planList = document.getElementById("planList");
const form = document.getElementById("setupForm");
const submitBtn = document.getElementById("submitBtn");
const msg = document.getElementById("msg");
const cycleField = document.getElementById("cycleField");
const cycleSelect = document.getElementById("sCycle");
const cycleTotal = document.getElementById("sCycleTotal");

let selectedPlan = null;
let selectedPlanData = null;
let selectedCycle = "1m";

// server sends the cycle list with each plan; this mirrors it for a stale cache
const FALLBACK_CYCLES = [
  { key: "1m", months: 1, days: 30, label: "১ মাস" },
  { key: "3m", months: 3, days: 90, label: "৩ মাস" },
  { key: "6m", months: 6, days: 180, label: "৬ মাস" },
  { key: "1y", months: 12, days: 365, label: "১ বছর" },
  { key: "2y", months: 24, days: 730, label: "২ বছর" },
];

function planCyclesFor(p) {
  if (p && Array.isArray(p.cycles) && p.cycles.length) return p.cycles;
  const monthly = Number((p && p.price) || 0);
  return FALLBACK_CYCLES.map((c) => ({ ...c, price: monthly * c.months }));
}

function updateCycleTotal() {
  const opts = planCyclesFor(selectedPlanData);
  const c = opts.find((x) => x.key === selectedCycle) || null;
  if (!c) {
    cycleTotal.textContent = "";
    return;
  }
  const trial = selectedPlanData && selectedPlanData.trialDays > 0 ? " + " + selectedPlanData.trialDays + " দিন ট্রায়াল" : "";
  cycleTotal.textContent =
    "মোট ৳ " + Number(c.price || 0).toLocaleString("en-IN") + " — " + c.days + " দিন" + trial;
}

function renderCycles() {
  const paid = selectedPlanData && Number(selectedPlanData.price || 0) > 0;
  cycleField.hidden = !paid;
  if (!paid) {
    cycleSelect.innerHTML = "";
    cycleTotal.textContent = "";
    selectedCycle = "1m";
    return;
  }
  const opts = planCyclesFor(selectedPlanData);
  if (!opts.some((c) => c.key === selectedCycle)) selectedCycle = "1m";
  cycleSelect.innerHTML = opts
    .map((c) => `<option value="${esc(c.key)}">${esc(c.label)} — ৳ ${Number(c.price || 0).toLocaleString("en-IN")}</option>`)
    .join("");
  cycleSelect.value = selectedCycle;
  updateCycleTotal();
}

cycleSelect.addEventListener("change", () => {
  selectedCycle = cycleSelect.value;
  updateCycleTotal();
});

function showMsg(text, type) {
  msg.textContent = text;
  msg.className = "msg" + (type ? " " + type : "");
}

/* ---- live shop address ---- */
const addressField = window.ShopAddressField.mount({
  input: document.getElementById("sSlug"),
  nameInput: document.getElementById("sName"),
  suffixEl: document.getElementById("sSlugSuffix"),
  urlEl: document.getElementById("sSlugUrl"),
  statusEl: document.getElementById("sSlugStatus"),
  suggestionsEl: document.getElementById("sSlugSuggest"),
  ruleEl: document.getElementById("sSlugRule"),
});

(async function loadDomain() {
  try {
    const res = await fetch("/api/stores/domain-config", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.platformDomain) addressField.setDomain(data.platformDomain);
  } catch {
    /* suffix hidden; the field still validates the name */
  }
})();

/* ---- logged in user ---- */
(async function initUser() {
  try {
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) throw new Error();
    const me = await res.json();
    document.getElementById("whoLine").textContent =
      "হ্যালো " + me.name + ", প্ল্যান বেছে দোকান চালু করুন";
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    location.href = "/login.html";
  }
})();

/* ---- load plans ---- */
(async function loadPlans() {
  try {
    const res = await fetch("/api/plans");
    const plans = await res.json();
    if (!Array.isArray(plans) || !plans.length) {
      planList.innerHTML = '<div class="plan-skeleton">কোনো সক্রিয় প্ল্যান নেই</div>';
      return;
    }
    renderPlans(plans);
  } catch {
    planList.innerHTML = '<div class="plan-skeleton">প্ল্যান লোড করা যায়নি</div>';
  }
})();

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderPlans(plans) {
  planList.innerHTML = plans
    .map((p) => {
      const limits = [];
      const fmt = (n) => (n === 0 ? "আনলিমিটেড" : n.toLocaleString("en-IN"));
      if (p.limits) {
        limits.push("প্রোডাক্ট " + fmt(p.limits.products));
        limits.push("অর্ডার " + fmt(p.limits.orders));
        limits.push("স্টাফ " + fmt(p.limits.staffMembers));
        limits.push("স্টোরেজ " + fmt(p.limits.storageMB) + "MB");
      }
      const feats = [];
      if (p.features) {
        if (p.features.customDomain) feats.push("কাস্টম ডোমেইন");
        if (p.features.analytics) feats.push("অ্যানালিটিক্স");
        if (p.features.apiAccess) feats.push("API");
        if (p.features.prioritySupport) feats.push("প্রায়োরিটি সাপোর্ট");
      }

      return `
        <button type="button" class="plan-card" data-slug="${esc(p.slug)}" data-name="${esc(p.name)}">
          <span class="radio"></span>
          <span class="p-body">
            <span class="p-top">
              <span class="p-name">${esc(p.name)}</span>
              <span class="p-price">৳ ${Number(p.price || 0)}<small>/মাস</small></span>
            </span>
            <span class="p-limits">
              ${limits.map((l) => `<span class="chip">${esc(l)}</span>`).join("")}
              ${feats.map((f) => `<span class="chip on">${esc(f)}</span>`).join("")}
            </span>
          </span>
        </button>`;
    })
    .join("");

  planList.querySelectorAll(".plan-card").forEach((card) => {
    card.addEventListener("click", () => {
      planList.querySelectorAll(".plan-card").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      selectedPlan = card.dataset.slug;
      selectedPlanData = plans.find((p) => p.slug === selectedPlan) || null;
      selectedCycle = "1m";
      renderCycles();
    });
  });

  // ডিফল্ট: ?plan= থেকে প্রি-সিলেক্ট, না থাকলে প্রথম প্ল্যান
  const wanted = String(new URLSearchParams(location.search).get("plan") || "").toLowerCase();
  const initial =
    (wanted && planList.querySelector('.plan-card[data-slug="' + CSS.escape(wanted) + '"]')) ||
    planList.querySelector(".plan-card");
  if (initial) {
    initial.classList.add("active");
    selectedPlan = initial.dataset.slug;
    selectedPlanData = plans.find((p) => p.slug === selectedPlan) || null;
    renderCycles();
  }
}

/* ---- submit ---- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showMsg("");

  const name = document.getElementById("sName").value.trim();
  if (!name) return showMsg("দোকানের নাম লিখুন", "err");
  if (!selectedPlan) return showMsg("একটা প্ল্যান বেছে নিন", "err");

  const slug = addressField.value();
  if (!slug) return showMsg("দোকানের ঠিকানা লিখুন", "err");

  submitBtn.disabled = true;
  submitBtn.textContent = "চেক করা হচ্ছে...";
  let ok = false;
  try {
    ok = await addressField.ensureAvailable();
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "দোকান তৈরি করুন";
  }
  if (!ok) {
    showMsg(addressField.message() || "এই ঠিকানাটি ব্যবহার করা যাচ্ছে না", "err");
    return;
  }

  // paid plan: dokan ekhoni toiri na — prothome payment checkout
  if (selectedPlanData && Number(selectedPlanData.price || 0) > 0) {
    location.href =
      "/plan-checkout.html?plan=" + encodeURIComponent(selectedPlan) +
      "&cycle=" + encodeURIComponent(selectedCycle) +
      "&name=" + encodeURIComponent(name) +
      "&slug=" + encodeURIComponent(slug);
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "তৈরি হচ্ছে...";

  try {
    const res = await fetch("/api/stores", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ name, slug, planSlug: selectedPlan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "দোকান তৈরি হয়নি");

    showMsg("দোকান তৈরি হয়েছে! আপনার অ্যাকাউন্টে নিয়ে যাওয়া হচ্ছে...", "ok");
    setTimeout(() => (location.href = "/portal.html"), 500);
  } catch (err) {
    showMsg(err.message, "err");
    submitBtn.disabled = false;
    submitBtn.textContent = "দোকান তৈরি করুন";
  }
});

document.getElementById("goDash").addEventListener("click", () => {
  location.href = "/dashboard.html";
});
