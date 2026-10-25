const TOKEN_KEY = "luxe_token";

const token = localStorage.getItem(TOKEN_KEY);
if (!token) location.href = "/login.html";

const planList = document.getElementById("planList");
const form = document.getElementById("setupForm");
const submitBtn = document.getElementById("submitBtn");
const msg = document.getElementById("msg");

let selectedPlan = null;

function showMsg(text, type) {
  msg.textContent = text;
  msg.className = "msg" + (type ? " " + type : "");
}

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
  }
}

/* ---- submit ---- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showMsg("");

  const name = document.getElementById("sName").value.trim();
  const slug = document.getElementById("sSlug").value.trim();
  if (!name) return showMsg("দোকানের নাম লিখুন", "err");
  if (!selectedPlan) return showMsg("একটা প্ল্যান বেছে নিন", "err");

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
