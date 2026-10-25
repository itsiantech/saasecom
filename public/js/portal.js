/* ==========================================================================
   Customer portal — merchant sees own stores, plan, address; upgrades plan
   ========================================================================== */
(function () {
  "use strict";

  const TOKEN_KEY = "luxe_token";
  let token = localStorage.getItem(TOKEN_KEY);
  const LOGIN_URL = "/login.html?next=" + encodeURIComponent("/portal.html");

  if (!token) location.href = LOGIN_URL;

  const $ = (id) => document.getElementById(id);
  const enc = encodeURIComponent;

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const num = (n) => Number(n || 0).toLocaleString("en-IN");
  const limit = (n) => (Number(n) === 0 ? "আনলিমিটেড" : num(n));

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(value) {
    const d = value ? new Date(value) : null;
    if (!d || isNaN(d)) return "—";
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  }
  function daysLeft(value) {
    const d = value ? new Date(value) : null;
    if (!d || isNaN(d)) return null;
    return Math.ceil((d.getTime() - Date.now()) / 86400000);
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
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      location.href = LOGIN_URL;
      throw new Error("Session expire hoyeche");
    }
    if (!res.ok) throw new Error((data && data.message) || "Request fail korlo");
    return data;
  }

  function toast(text, kind) {
    const el = $("ptToast");
    el.textContent = text;
    el.className = "pt-toast show " + (kind || "");
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.className = "pt-toast"), 3200);
  }

  $("ptYear").textContent = new Date().getFullYear();

  /* ------------------------------------------------------------- account */
  async function loadWho() {
    try {
      const me = await api("/api/auth/me");
      $("ptWho").textContent = me.name + (me.email ? " · " + me.email : "");
    } catch {
      /* api() already redirected on 401 */
    }
  }

  /* --------------------------------------------------------------- stores */
  let stores = [];
  let plans = [];

  const STATUS_LABEL = { active: "চালু", trial: "ট্রায়ালে", expired: "মেয়াদ শেষ", cancelled: "বাতিল" };

  function addrRow(store) {
    const url = location.origin + "/" + store.slug;
    return `
      <div>
        <span class="pt-addr-label">দোকানের ঠিকানা</span>
        <div class="pt-addr-row">
          <span class="pt-addr-pre">${esc(location.host)}/</span>
          <input class="pt-addr-input" id="addr-${esc(store._id)}" value="${esc(store.slug)}" maxlength="63"
                 spellcheck="false" autocomplete="off" aria-label="দোকানের ঠিকানা" />
          <button class="pt-btn pt-btn-ghost pt-btn-sm" type="button" data-save="${esc(store._id)}">সংরক্ষণ</button>
        </div>
        <div class="pt-addr-foot">
          <a class="pt-addr-link" href="/${esc(store.slug)}" target="_blank" rel="noopener">দোকান খুলে দেখুন →</a>
          <button class="pt-btn pt-btn-quiet pt-btn-sm pt-copy" type="button" data-copy="${esc(url)}">লিংক কপি</button>
        </div>
        <p class="pt-warn" data-warn="${esc(store._id)}" hidden>ঠিকানা বদলালে আগের লিংক আর কাজ করবে না।</p>
      </div>`;
  }

  function metaRows(store) {
    const sub = store.subscription;
    const plan = store.plan || {};
    const status = sub ? sub.status : "active";
    const left = sub ? daysLeft(status === "trial" ? sub.trialEndsAt : sub.endDate) : null;
    const when = sub
      ? (status === "trial" && sub.trialEndsAt ? fmtDate(sub.trialEndsAt) : fmtDate(sub.endDate)) + " পর্যন্ত"
      : "সাবস্ক্রিপশন নেই";
    const l = plan.limits || {};
    return `
      <div class="pt-meta">
        <div class="pt-meta-row"><span>মেয়াদ</span><b>${esc(when)}${left !== null && left >= 0 ? " · " + left + " দিন বাকি" : ""}</b></div>
        ${sub ? '<div class="pt-meta-row"><span>প্যাকেজ নেওয়া তারিখ</span><b>' + esc(fmtDate(sub.startDate)) + "</b></div>" : ""}
        <div class="pt-chips">
          <span class="pt-chip">প্রোডাক্ট ${esc(limit(l.products))}</span>
          <span class="pt-chip">অর্ডার ${esc(limit(l.orders))}</span>
          <span class="pt-chip">স্টাফ ${esc(limit(l.staffMembers))}</span>
          <span class="pt-chip">স্টোরেজ ${esc(limit(l.storageMB))}MB</span>
        </div>
      </div>`;
  }

  /* --------------------------------------------------------------- domain */
  let domainCfg = { platformDomain: null, target: null, ready: false };
  const openDomains = new Set();
  const DOMAIN_STATUS = { none: "যুক্ত নেই", pending: "DNS বাকি", verified: "চালু", failed: "যাচাই হয়নি" };

  function recordRows(kind, name, value) {
    return `
      <tr><td>${esc(kind)}</td><td><code>${esc(name)}</code></td><td><code>${esc(value)}</code>
        <button class="pt-btn pt-btn-quiet pt-btn-sm" type="button" data-copy="${esc(value)}">কপি</button></td></tr>`;
  }

  function customDomainBlock(store) {
    const main = domainCfg.platformDomain;
    const alias = main ? "alias." + main : "alias.<আপনার-প্ল্যাটফর্ম-ডোমেইন>";
    const target = domainCfg.target || "<VPS এর IP>";
    const domain = store.customDomain;
    const status = store.customDomainStatus || "none";

    if (!domain) {
      return `
        <div class="pt-dom-step">
          <h4>৩. নিজের ডোমেইন যুক্ত করুন</h4>
          <p class="pt-dom-note">যেমন <code>myshop.com</code> — ডোমেইন কিনে registrar এর DNS এ ৩টা record বসাতে হবে, নিচের টেবিলে সেগুলোই দেখানো হবে।</p>
          <div class="pt-addr-row">
            <input class="pt-addr-input" id="dom-${esc(store._id)}" placeholder="myshop.com" spellcheck="false" autocomplete="off" aria-label="নিজের ডোমেইন" />
            <button class="pt-btn pt-btn-ghost pt-btn-sm" type="button" data-dom-add="${esc(store._id)}">যোগ করুন</button>
          </div>
        </div>`;
    }

    return `
      <div class="pt-dom-step">
        <h4>৩. নিজের ডোমেইন: ${esc(domain)}
          <span class="pt-badge ${esc(status)}">${esc(DOMAIN_STATUS[status] || status)}</span>
        </h4>
        <p class="pt-dom-note">Registrar এর DNS settings এ এই ৩টা record বসান। TXT record টাই মালিকানা যাচাই করে — B/C শুধু <code>www</code> আর মূল ঠিকানার জন্য।</p>
        <table class="pt-rec">
          <thead><tr><th>টাইপ</th><th>নাম</th><th>মান</th></tr></thead>
          <tbody>
            ${recordRows("TXT", "_luxe-verify." + domain, store.domainToken || "—")}
            ${recordRows("CNAME", "www", alias)}
            ${recordRows("A", "@", target)}
          </tbody>
        </table>
        <div class="pt-dom-actions">
          <button class="pt-btn pt-btn-primary pt-btn-sm" type="button" data-dom-verify="${esc(store._id)}">যাচাই করুন</button>
          <button class="pt-btn pt-btn-quiet pt-btn-sm" type="button" data-dom-del="${esc(store._id)}">সরান</button>
          ${status === "verified" ? '<a class="pt-addr-link" href="http://' + esc(domain) + '" target="_blank" rel="noopener">ডোমেইন খুলুন →</a>' : ""}
        </div>
        <p class="pt-dom-note">যাচাইয়ের পরেও খুলতে না পারলে: এখনো server (VPS) এ এই ডোমেইনের জন্য HTTPS cert বসানো হয়নি — server ওঠার পর এটা স্বয়ংক্রিয় হবে।</p>
      </div>`;
  }

  function domainPanel(store) {
    const main = domainCfg.platformDomain;
    const plan = store.plan || {};
    const canCustom = !!(plan.features && plan.features.customDomain);
    const sub = store.subdomain || "";
    const host = sub ? (main ? sub + "." + main : sub + ".<আপনার-ডোমেইন>") : "";

    return `
      <div class="pt-dom" id="dom-panel-${esc(store._id)}" ${openDomains.has(store._id) ? "" : "hidden"}>
        <div class="pt-dom-step">
          <h4>১. ফোল্ডার ঠিকানা (চালু)</h4>
          <p class="pt-dom-note"><code>${esc(location.host)}/${esc(store.slug)}</code> — এটা সবসময় কাজ করবে, ডোমেইন যোগ করলেও এটা থেকে যাবে।</p>
        </div>

        <div class="pt-dom-step">
          <h4>২. সাব-ডোমেইন (তাৎক্ষণিক, DNS লাগে না)</h4>
          <div class="pt-addr-row">
            <input class="pt-addr-input" id="sub-${esc(store._id)}" value="${esc(sub)}" placeholder="amar-dokan" maxlength="63" spellcheck="false" autocomplete="off" aria-label="সাব-ডোমেইন" />
            <span class="pt-addr-pre">${main ? "." + esc(main) : ".<আপনার-ডোমেইন>"}</span>
            <button class="pt-btn pt-btn-ghost pt-btn-sm" type="button" data-sub-save="${esc(store._id)}">${sub ? "আপডেট" : "নিন"}</button>
            ${sub ? '<button class="pt-btn pt-btn-quiet pt-btn-sm" type="button" data-sub-save="' + esc(store._id) + '" data-clear="1">ছাড়ুন</button>' : ""}
          </div>
          ${host ? '<a class="pt-addr-link" href="http://' + esc(host) + (main && main.endsWith("localtest.me") ? ":3000" : "") + '" target="_blank" rel="noopener">' + esc(host) + " →</a>" : ""}
          ${main ? "" : '<p class="pt-dom-warn">প্ল্যাটফর্মের নিজের ডোমেইন এখনো সেট করা হয়নি — VPS + domain কেনার পর সেট করলে এখানে আসল ঠিকানা দেখাবে। এখন নাম শুধু reserve হিসেবেই থাকবে।</p>'}
        </div>

        ${canCustom
          ? customDomainBlock(store)
          : '<div class="pt-dom-step"><h4>৩. নিজের ডোমেইন</h4><p class="pt-dom-warn">এই প্যাকেজে কাস্টম ডোমেইন নেই। আপগ্রেড করলে DNS দিয়ে নিজের ঠিকানা যুক্ত করা যাবে।</p></div>'}

        <div class="pt-dom-step">
          <h4>৪. এখন থেকে VPS পর্যন্ত</h4>
          <ol class="pt-dom-list">
            <li>একটা domain কিনুন (যেমন <code>luxeshop.com</code>) + একটা VPS/server।</li>
            <li>DNS: <code>A *@&lt;domain&gt;</code> → server IP, আর <code>A &lt;domain&gt;</code> → server IP। এতেই <code>যেকোনো-nাম.&lt;domain&gt;</code> আপনার server এ আসবে।</li>
            <li>Server এ Caddy/nginx বসিয়ে HTTPS cert চালু করুন (Caddy auto cert দেয়)।</li>
            <li>Super admin প্যানেল/setting এ <code>platformDomain</code> = <code>&lt;domain&gt;</code> আর <code>platformIp</code> = server IP বসালেই উপরের সব ঘর আসল মান দেখাবে।</li>
          </ol>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------- rendering */
  function renderStores() {
    const grid = $("ptCards");
    if (!stores.length) {
      $("ptEmpty").hidden = false;
      $("ptCount").textContent = "";
      grid.innerHTML = "";
      return;
    }
    $("ptEmpty").hidden = true;
    $("ptCount").textContent = stores.length + " টি দোকান";

    grid.innerHTML = stores
      .map((store) => {
        const plan = store.plan || {};
        const status = store.subscription ? store.subscription.status : "active";
        const price = Number(plan.price || 0);
        return `
        <article class="pt-card">
          <div class="pt-card-top">
            <div>
              <h3 class="pt-card-name">${esc(store.name)}</h3>
              <span class="pt-badge ${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>
            </div>
            <div class="pt-plan">
              <b>${esc(plan.name || "—")}</b>
              <span>৳ ${num(price)} /মাস</span>
            </div>
          </div>
          ${addrRow(store)}
          ${metaRows(store)}
          ${domainPanel(store)}
          <div class="pt-card-actions">
            <button class="pt-btn pt-btn-primary" type="button" data-plan="${esc(store._id)}">প্যাকেজ পরিবর্তন</button>
            <a class="pt-btn pt-btn-ghost" href="/dashboard.html">অ্যাডমিন প্যানেল →</a>
            <button class="pt-btn pt-btn-quiet" type="button" data-dom-toggle="${esc(store._id)}">${openDomains.has(store._id) ? "ডোমেইন সংযোগ বন্ধ" : "ডোমেইন সংযোগ"}</button>
          </div>
        </article>`;
      })
      .join("");
  }

  async function loadAll() {
    try {
      const [mine, planList, cfg] = await Promise.all([
        api("/api/stores/mine"),
        api("/api/plans"),
        api("/api/stores/domain-config").catch(() => null),
      ]);
      stores = Array.isArray(mine) ? mine : [];
      plans = Array.isArray(planList) ? planList : [];
      if (cfg && cfg.platformDomain !== undefined) domainCfg = cfg;
      renderStores();
      showPlanIntent();
    } catch (err) {
      $("ptCards").innerHTML = '<div class="pt-load-fail">' + esc(err.message) + "</div>";
    }
  }

  /* ------------------------------------------------------ plan intent (?) */
  function showPlanIntent() {
    const wanted = String(new URLSearchParams(location.search).get("plan") || "").toLowerCase();
    if (!wanted) return;
    const plan = plans.find((p) => p.slug === wanted);
    const notice = $("ptNotice");
    notice.hidden = false;
    notice.innerHTML =
      "আপনি <b>" + esc(plan ? plan.name : wanted) + "</b> প্যাকেজটি বেছেছিলেন। " +
      (stores.length
        ? '<button class="pt-btn pt-btn-ghost pt-btn-sm" type="button" id="ptIntentChange">প্যাকেজ পরিবর্তন করুন</button>'
        : '<a class="pt-btn pt-btn-primary pt-btn-sm" href="/setup.html?plan=' + esc(wanted) + '">এই প্যাকেজে দোকান খুলুন</a>');

    const btn = $("ptIntentChange");
    if (btn) btn.addEventListener("click", () => openModal(stores[0]));
    if (!stores.length) $("ptEmptyCta").href = "/setup.html?plan=" + enc(wanted);
  }

  /* ------------------------------------------------------------ upgrade */
  let modalStore = null;

  function openModal(store) {
    if (!store) return;
    modalStore = store;
    const current = store.plan && typeof store.plan === "object" ? store.plan.slug : store.plan;
    $("ptModalTitle").textContent = "প্যাকেজ পরিবর্তন — " + store.name;
    $("ptModalSub").textContent = "বর্তমান: " + ((store.plan && store.plan.name) || "—");
    $("ptModalList").innerHTML = plans.length
      ? plans
          .map((p) => {
            const price = Number(p.price || 0);
            return `
            <button class="pt-opt" type="button" data-pick="${esc(p.slug)}" ${p.slug === current ? "disabled" : ""}>
              <span><b>${esc(p.name)}</b><small>${esc(limit((p.limits || {}).products))} প্রোডাক্ট · ${esc(limit((p.limits || {}).orders))} অর্ডার · ${esc(limit((p.limits || {}).storageMB))}MB${p.trialDays > 0 ? " · " + esc(p.trialDays) + " দিন ট্রায়াল" : ""}</small></span>
              <span class="pt-opt-price">${p.slug === current ? "বর্তমান" : "৳ " + num(price) + "/মাস"}</span>
            </button>`;
          })
          .join("")
      : '<div class="pt-loading">কোনো প্যাকেজ নেই।</div>';
    $("ptModal").hidden = false;
  }

  function closeModal() {
    $("ptModal").hidden = true;
    modalStore = null;
  }

  $("ptModalClose").addEventListener("click", closeModal);
  $("ptModalBack").addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("ptModal").hidden) closeModal();
  });

  $("ptModalList").addEventListener("click", async (e) => {
    const opt = e.target.closest("[data-pick]");
    if (!opt || !modalStore) return;
    const planSlug = opt.dataset.pick;
    opt.disabled = true;
    try {
      await api("/api/subscriptions/upgrade?store=" + enc(modalStore.slug), {
        method: "POST",
        body: JSON.stringify({ planSlug }),
      });
      toast("প্যাকেজ পরিবর্তন হয়েছে", "ok");
      closeModal();
      await loadAll();
    } catch (err) {
      opt.disabled = false;
      toast(err.message, "err");
    }
  });

  /* ------------------------------------------------------------- actions */
  $("ptCards").addEventListener("click", async (e) => {
    const toggle = e.target.closest("[data-dom-toggle]");
    if (toggle) {
      const id = toggle.dataset.domToggle;
      const panel = $("dom-panel-" + id);
      const open = panel.hidden;
      panel.hidden = !open;
      if (open) openDomains.add(id); else openDomains.delete(id);
      toggle.textContent = open ? "ডোমেইন সংযোগ বন্ধ" : "ডোমেইন সংযোগ";
      return;
    }

    const subBtn = e.target.closest("[data-sub-save]");
    if (subBtn) {
      const id = subBtn.dataset.subSave;
      const input = $("sub-" + id);
      const value = subBtn.dataset.clear ? "" : String(input.value || "").trim().toLowerCase();
      subBtn.disabled = true;
      try {
        await api("/api/stores/" + enc(id) + "/subdomain", { method: "PUT", body: JSON.stringify({ subdomain: value }) });
        toast(value ? "সাব-ডোমেইন যুক্ত হয়েছে" : "সাব-ডোমেইন ছেড়ে দেওয়া হয়েছে", "ok");
        await loadAll();
      } catch (err) {
        toast(err.message, "err");
        subBtn.disabled = false;
      }
      return;
    }

    const addBtn = e.target.closest("[data-dom-add]");
    if (addBtn) {
      const id = addBtn.dataset.domAdd;
      const value = String($("dom-" + id).value || "").trim();
      addBtn.disabled = true;
      try {
        await api("/api/stores/" + enc(id) + "/custom-domain", { method: "PUT", body: JSON.stringify({ domain: value }) });
        toast("ডোমেইন যোগ হয়েছে — এখন DNS record বসান", "ok");
        await loadAll();
      } catch (err) {
        toast(err.message, "err");
        addBtn.disabled = false;
      }
      return;
    }

    const verifyBtn = e.target.closest("[data-dom-verify]");
    if (verifyBtn) {
      const id = verifyBtn.dataset.domVerify;
      verifyBtn.disabled = true;
      try {
        const out = await api("/api/stores/" + enc(id) + "/custom-domain/verify", { method: "POST" });
        toast(out.status === "verified" ? "ডোমেইন যাচাই হয়েছে" : "যাচাই হয়নি — " + (out.detail || "DNS record এখনো বসেনি"), out.status === "verified" ? "ok" : "err");
        await loadAll();
      } catch (err) {
        toast(err.message, "err");
      }
      verifyBtn.disabled = false;
      return;
    }

    const delBtn = e.target.closest("[data-dom-del]");
    if (delBtn) {
      const id = delBtn.dataset.domDel;
      delBtn.disabled = true;
      try {
        await api("/api/stores/" + enc(id) + "/custom-domain", { method: "DELETE" });
        toast("ডোমেইন সরানো হয়েছে", "ok");
        await loadAll();
      } catch (err) {
        toast(err.message, "err");
        delBtn.disabled = false;
      }
      return;
    }

    const planBtn = e.target.closest("[data-plan]");
    if (planBtn) {
      openModal(stores.find((s) => String(s._id) === planBtn.dataset.plan));
      return;
    }

    const copyBtn = e.target.closest("[data-copy]");
    if (copyBtn) {
      try {
        await navigator.clipboard.writeText(copyBtn.dataset.copy);
        toast("লিংক কপি হয়েছে", "ok");
      } catch {
        toast("কপি করা যায়নি — লিংক টেনে নিন", "err");
      }
      return;
    }

    const saveBtn = e.target.closest("[data-save]");
    if (saveBtn) {
      const id = saveBtn.dataset.save;
      const store = stores.find((s) => String(s._id) === id);
      const input = $("addr-" + id);
      const slug = String(input.value || "").trim().toLowerCase();
      if (store && slug === store.slug) {
        toast("ঠিকানা একই আছে", "err");
        return;
      }
      saveBtn.disabled = true;
      try {
        await api("/api/stores/" + enc(id) + "/slug", { method: "PATCH", body: JSON.stringify({ slug }) });
        toast("ঠিকানা বদলেছে", "ok");
        await loadAll();
      } catch (err) {
        toast(err.message, "err");
        saveBtn.disabled = false;
      }
    }
  });

  // warn once the slug is actually edited
  $("ptCards").addEventListener("input", (e) => {
    const input = e.target.closest(".pt-addr-input");
    if (!input) return;
    const id = input.id.replace("addr-", "");
    const store = stores.find((s) => String(s._id) === id);
    const warn = document.querySelector('[data-warn="' + id + '"]');
    if (warn && store) warn.hidden = input.value.trim().toLowerCase() === store.slug;
  });

  $("ptLogout").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    location.href = "/login.html";
  });

  loadWho();
  loadAll();
})();
