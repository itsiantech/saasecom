/* ==========================================================================
   SaaS landing — public plan list + signup entry
   ========================================================================== */
(function () {
  "use strict";

  const TOKEN_KEY = "luxe_token";
  const grid = document.getElementById("ldPlanGrid");
  const foot = document.getElementById("ldPlansFoot");

  document.getElementById("ldYear").textContent = new Date().getFullYear();

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const orderHref = (slug) => "/login.html?next=" + encodeURIComponent("/portal.html?plan=" + slug);

  const num = (n) => Number(n || 0).toLocaleString("en-IN");
  const limit = (n) => (Number(n) === 0 ? "আনলিমিটেড" : num(n));

  function rows(plan) {
    const l = plan.limits || {};
    const f = plan.features || {};
    return [
      { on: true, text: "প্রোডাক্ট: " + limit(l.products) + "টি" },
      { on: true, text: "মাসে অর্ডার: " + limit(l.orders) + "টি" },
      { on: true, text: "স্টাফ অ্যাকাউন্ট: " + limit(l.staffMembers) + "জন" },
      { on: true, text: "স্টোরেজ: " + limit(l.storageMB) + "MB" },
      { on: !!f.customDomain, text: "কাস্টম ডোমেইন" },
      { on: !!f.analytics, text: "বিক্রি অ্যানালিটিক্স" },
      { on: !!f.apiAccess, text: "API অ্যাক্সেস" },
      { on: !!f.prioritySupport, text: "প্রায়োরিটি সাপোর্ট" },
    ];
  }

  function card(plan, flag) {
    const price = Number(plan.price || 0);
    return `
      <article class="ld-card${price === 0 ? " is-free" : ""}">
        ${flag ? '<span class="ld-card-flag">' + esc(flag) + "</span>" : ""}
        <div>
          <div class="ld-card-name">${esc(plan.name)}</div>
          <div class="ld-card-price">
            <b>৳ ${num(price)}</b><span>/মাস</span>
          </div>
          ${plan.trialDays > 0 ? '<div class="ld-card-trial">' + esc(plan.trialDays) + " দিন ফ্রি ট্রায়াল</div>" : ""}
        </div>
        <ul class="ld-card-list">
          ${rows(plan)
            .map((r) => `<li class="${r.on ? "" : "off"}"><span class="ld-tick">${r.on ? "✓" : ""}</span>${esc(r.text)}</li>`)
            .join("")}
        </ul>
        <a class="ld-btn ld-btn-primary ld-card-cta" href="${orderHref(plan.slug)}">
          ${price === 0 ? "ফ্রি দোকান খুলুন" : "এই প্যাকেজ নিন"}
        </a>
      </article>`;
  }

  async function loadPlans() {
    let plans;
    try {
      const res = await fetch("/api/plans");
      plans = await res.json();
      if (!res.ok) throw new Error((plans && plans.message) || "প্যাকেজ লোড হয়নি");
    } catch (err) {
      grid.innerHTML = '<div class="ld-plan-empty err">' + esc(err.message) + "</div>";
      return;
    }
    if (!Array.isArray(plans) || !plans.length) {
      grid.innerHTML = '<div class="ld-plan-empty">এখনো কোনো প্যাকেজ চালু করা হয়নি।</div>';
      foot.textContent = "প্যাকেজ যোগ হলে এখানে দেখা যাবে।";
      return;
    }

    const paid = plans.filter((p) => Number(p.price || 0) > 0);
    const top = paid.length ? paid.reduce((a, b) => (Number(b.price) > Number(a.price) ? b : a)) : null;

    grid.innerHTML = plans
      .map((p) => {
        const flag = Number(p.price || 0) === 0 ? "শুরু করুন" : top && p.slug === top.slug ? "সবচেয়ে বেশি ফিচার" : "";
        return card(p, flag);
      })
      .join("");

    foot.textContent = "যেকোনো প্যাকেজে শুরু করে পরে আপগ্রেড করা যায় — দোকানের ডেটা ঠিক থাকে।";
  }

  async function markSession() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    try {
      const res = await fetch("/api/auth/me", { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) return;
      const me = await res.json();
      const login = document.getElementById("ldLogin");
      login.textContent = "ড্যাশবোর্ড";
      login.href = me.role === "superadmin" ? "/admin.html" : "/dashboard.html";
      document.getElementById("ldStart").href = "/setup.html";
    } catch {
      /* offline hole landing-i thakbe */
    }
  }

  loadPlans();
  markSession();
})();
