/* ==========================================================================
   Plan checkout — paid plan er manual payment (bKash / Nagad / bank / QR)
   ========================================================================== */
(function () {
  "use strict";

  const TOKEN_KEY = "luxe_token";
  const token = localStorage.getItem(TOKEN_KEY);
  const nextUrl = location.pathname + location.search;
  if (!token) {
    location.href = "/login.html?next=" + encodeURIComponent(nextUrl);
    return;
  }

  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const planSlug = String(qs.get("plan") || "").toLowerCase();
  const storeId = String(qs.get("store") || "");
  // PayGate ফেরত আসা পেজ — ?pp= থাকলে শুধু পেমেন্টের ফলাফল দেখানো হয়
  const ppId = String(qs.get("pp") || "");

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const num = (n) => Number(n || 0).toLocaleString("en-IN");
  const MONTHS = ["জানু", "ফেব", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ", "অক্টো", "নভে", "ডিসে"];
  const fmtDate = (value) => {
    const d = value ? new Date(value) : null;
    if (!d || isNaN(d)) return "—";
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
  };

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
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      location.href = "/login.html?next=" + encodeURIComponent(nextUrl);
      throw new Error("Session expire hoyeche");
    }
    if (!res.ok) {
      const err = new Error((data && data.message) || "Request fail korlo");
      err.data = data;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function fatal(text) {
    $("pcLoading").hidden = true;
    $("pcGrid").hidden = true;
    $("pcFatal").hidden = false;
    $("pcFatal").textContent = text;
  }

  function showError(text) {
    const el = $("pcError");
    el.textContent = text;
    el.hidden = !text;
  }

  let plan = null;
  let methods = [];
  let store = null;
  let selected = null;
  let addressField = null;
  let platformDomain = "";
  let cycleKey = "1m";

  // HTML-এ লেখা ম্যানুয়াল-মেথড টেক্সট, gateway method বেছে নিলে বদলায়
  const STATIC_TEXT = {
    senderLabel: $("pcSenderWrap").querySelector("label").textContent,
    hint: $("pcSubmitHint").textContent,
    submit: $("pcSubmit").textContent,
  };

  // server sends the cycle list with each plan; this mirrors it for a stale cache
  const FALLBACK_CYCLES = [
    { key: "1m", months: 1, days: 30, label: "১ মাস" },
    { key: "3m", months: 3, days: 90, label: "৩ মাস" },
    { key: "6m", months: 6, days: 180, label: "৬ মাস" },
    { key: "1y", months: 12, days: 365, label: "১ বছর" },
    { key: "2y", months: 24, days: 730, label: "২ বছর" },
  ];

  function planCycles() {
    if (plan && Array.isArray(plan.cycles) && plan.cycles.length) return plan.cycles;
    const monthly = Number((plan && plan.price) || 0);
    return FALLBACK_CYCLES.map((c) => ({ ...c, price: monthly * c.months }));
  }

  function currentCycle() {
    const opts = planCycles();
    return opts.find((c) => c.key === cycleKey) || opts[0];
  }

  function cyclePrice() {
    const c = currentCycle();
    return Number(c && c.price) || 0;
  }

  function fullAddress(slug) {
    const shared = window.ShopAddress;
    return shared ? shared.fullAddress(slug, platformDomain) : "";
  }

  /* ------------------------------------------------------------- render */
  function renderCycle() {
    const opts = planCycles();
    if (!opts.some((c) => c.key === cycleKey)) cycleKey = opts[0] ? opts[0].key : "1m";
    const sel = $("pcCycle");
    sel.innerHTML = opts
      .map((c) => `<option value="${esc(c.key)}">${esc(c.label)} — ৳ ${num(c.price)}</option>`)
      .join("");
    sel.value = cycleKey;
    sel.addEventListener("change", () => {
      cycleKey = sel.value;
      renderSummary();
      if (selected) renderInstructions(selected);
    });
  }

  function renderSummary() {
    const c = currentCycle();
    $("pcPlanName").textContent = plan.name;
    $("pcPlanDur").textContent = c.days + " দিন" + (plan.trialDays > 0 ? " + " + plan.trialDays + " দিন ট্রায়াল" : "");
    $("pcTotal").textContent = "৳ " + num(cyclePrice());
    const slug = store ? store.slug : addressField ? addressField.value() : "";
    $("pcSumStore").textContent = fullAddress(slug) || slug || "—";
    $("pcSumMethod").textContent = selected ? selected.label : "—";
  }

  function renderMethods() {
    const box = $("pcMethods");
    if (!methods.length) {
      box.innerHTML = "";
      $("pcNoMethods").hidden = false;
      return;
    }
    $("pcNoMethods").hidden = true;
    box.innerHTML = methods
      .map((m) => {
        const detail = m.gateway
          ? "অটো SMS যাচাই"
          : m.id === "bank" ? (m.bankName || "ব্যাংক অ্যাকাউন্ট") : m.id === "qr" ? "স্ক্যান করে পেমেন্ট" : m.number || "";
        return (
          '<button class="pc-method" type="button" data-method="' + esc(m.id) + '">' +
            "<b>" + esc(m.label) + "</b><small>" + esc(detail) + "</small>" +
          "</button>"
        );
      })
      .join("");

    box.querySelectorAll(".pc-method").forEach((btn) => {
      btn.addEventListener("click", () => selectMethod(btn.dataset.method));
    });
  }

  function copyRow(label, value) {
    if (!value) return "";
    return (
      '<div class="pc-copy-row"><span>' + esc(label) + ":</span> <code>" + esc(value) + "</code>" +
      '<button class="pc-copy" type="button" data-copy="' + esc(value) + '">কপি</button></div>'
    );
  }

  function renderInstructions(m) {
    const parts = [];
    parts.push("<h3>" + esc(m.label) + "</h3>");

    if (m.gateway) {
      parts.push(
        "<p><b>৳ " + num(cyclePrice()) + "</b> — বিকাশ বা নগদ অ্যাপ থেকে এই টাকটা পাঠালে আপনার ফোনের SMS মিলিয়ে পেমেন্টটি নিজেই যাচাই হয়ে যায়।</p>" +
          "<p>TRXID লিখতে হবে না। নিচে আপনার পেমেন্ট নম্বর দিয়ে “পেমেন্ট পেজ খুলুন” চাপুন।</p>"
      );
      if (m.instructions) parts.push("<p>" + esc(m.instructions) + "</p>");
      $("pcInstr").innerHTML = parts.join("");
      return;
    }

    if (m.id === "bank") {
      parts.push(copyRow("ব্যাংক", m.bankName));
      parts.push(copyRow("অ্যাকাউন্ট নাম", m.accountName));
      parts.push(copyRow("অ্যাকাউন্ট নম্বর", m.accountNumber));
      parts.push(copyRow("শাখা", m.branch));
      parts.push(copyRow("রাউটিং", m.routingNumber));
    } else if (m.id === "qr") {
      parts.push(
        '<div class="pc-qr"><img src="' + esc(m.imageUrl) + '" alt="ভাষা QR" />' +
          "<div>" +
          (m.accountName ? copyRow("অ্যাকাউন্ট", m.accountName) : "") +
          "<p>QR স্ক্যান করে ঠিক <b>৳ " + num(cyclePrice()) + "</b> পাঠান, তারপর নিচে আপনার নম্বর ও TRXID দিন।</p>" +
          "</div></div>"
      );
    } else {
      parts.push(copyRow("নম্বর", m.number));
      parts.push(copyRow("অ্যাকাউন্ট", m.accountName));
    }

    parts.push(
      "<p><b>৳ " + num(cyclePrice()) + "</b> পাঠান — " +
        (m.id === "bank" ? "ট্রান্সফার" : "সেন্ড মানি") +
        " করে ট্রানজেকশন আইডি (TRXID) সংগ্রহ করুন।</p>"
    );
    if (m.instructions) parts.push("<p>" + esc(m.instructions) + "</p>");

    const box = $("pcInstr");
    box.innerHTML = parts.join("");
    box.querySelectorAll("[data-copy]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.copy);
          btn.textContent = "কপি হয়েছে";
          setTimeout(() => (btn.textContent = "কপি"), 1600);
        } catch {
          /* clipboard blocked — user can select the code manually */
        }
      });
    });
  }

  function selectMethod(id) {
    selected = methods.find((m) => m.id === id) || null;
    document.querySelectorAll(".pc-method").forEach((btn) => btn.classList.toggle("on", btn.dataset.method === id));
    if (!selected) return;

    renderInstructions(selected);
    $("instrStep").hidden = false;
    const gateway = Boolean(selected.gateway);
    $("pcTrxWrap").hidden = gateway;
    $("pcSenderWrap").hidden = selected.needsSender === false;
    $("pcSenderWrap").querySelector("label").textContent = gateway ? "যে নম্বর থেকে পেমেন্ট করবেন" : STATIC_TEXT.senderLabel;
    $("pcSubmitHint").textContent = gateway
      ? "পেমেন্ট পেজে টাকা পাঠালে SMS মিলিয়ে দোকান / প্যাকেজ স্বয়ংক্রিয়ভাবে চালু হয়ে যাবে — ট্যাবটি খোলা রাখুন।"
      : STATIC_TEXT.hint;
    $("pcSubmit").textContent = gateway ? "পেমেন্ট পেজ খুলুন" : STATIC_TEXT.submit;
    renderSummary();
    showError("");
    $("pcSender").focus();
  }

  function showDone(payment) {
    $("pcLoading").hidden = true;
    $("pcGrid").hidden = true;
    $("pcDone").hidden = false;

    const pending = payment.status === "pending";
    const rejected = payment.status === "rejected";
    const icon = $("pcDoneIcon");
    icon.textContent = rejected ? "✕" : "✓";
    icon.classList.toggle("bad", rejected);
    $("pcDoneTitle").textContent = rejected ? "পেমেন্ট সম্পন্ন হয়নি" : "পেমেন্ট জমা হয়েছে";
    $("pcDoneLine").innerHTML =
      "ইনভয়েস <b>" + esc(payment.invoiceNo) + "</b> · " +
      (payment.status === "approved"
        ? '<span class="pc-badge" style="background:rgba(72,211,159,.14);color:#48d39f;">অনুমোদিত</span>'
        : payment.status === "rejected"
        ? '<span class="pc-badge" style="background:rgba(240,138,118,.16);color:#f08a76;">বাতিল</span>'
        : '<span class="pc-badge">যাচাইয়ের অপেক্ষায়</span>');

    let text = "";
    if (payment.status === "approved") {
      text = "পেমেন্ট গৃহীত। পরবর্তী বিল: " + fmtDate(payment.nextDueDate) + "।";
    } else if (payment.status === "rejected") {
      text = "পেমেন্ট বাতিল হয়েছে।" + (payment.rejectReason ? " কারণ: " + payment.rejectReason : "") + " আবার জমা দিতে পারেন।";
    } else if (payment.gateway === "paygate") {
      text =
        "টাকা পাঠালে আপনার ফোনের SMS মিলিয়ে " +
        (payment.kind === "existing" ? "আপনার প্যাকেজ" : "আপনার দোকান") +
        " নিজেই চালু হয়ে যাবে। এই পেজটি কিছুক্ষণ খোলা রাখুন।";
    } else {
      text =
        "অ্যাডমিন TRXID মিলিয়ে দেখে অনুমোদন দিলে " +
        (payment.kind === "existing" ? "আপনার প্যাকেজ আপডেট হবে।" : "আপনার দোকান স্বয়ংক্রিয়ভাবে তৈরি হবে।") +
        " সাধারণত কিছুক্ষণের মধ্যেই হয়ে যায়।";
    }
    $("pcDoneText").textContent = text;
    $("pcDoneInvoice").href = payment.invoiceUrl;
    if (pending) $("pcDoneInvoice").textContent = "ইনভয়েস ডাউনলোড";
    const retry = $("pcDoneRetry");
    retry.hidden = !rejected;
    if (rejected && planSlug) retry.href = "/plan-checkout.html?plan=" + encodeURIComponent(planSlug);
  }

  /* ----------------------------------------------------------- paygate */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const PP_TRIES = 15;
  const PP_EVERY_MS = 4000;

  // PayGate থেকে ফেরা পেজ। webhook প্রায় আগেই পেমেন্ট মেলায়, তবু নিজেও জিজ্ঞেস
  // করি — ৬০ সেকেন্ড পর্যন্ত।
  async function showPaygateReturn(id) {
    showDone({ id, invoiceNo: "—", status: "pending", kind: "new", gateway: "paygate", invoiceUrl: "#" });
    let last = null;
    for (let tryNo = 0; tryNo < PP_TRIES; tryNo++) {
      try {
        const data = await api("/api/billing/paygate/" + encodeURIComponent(id) + "/status");
        const view = data && data.payment;
        if (view) {
          if (view.status !== "pending") {
            showDone(view);
            return view.status;
          }
          if (!last) showDone(view);
          last = view;
        }
      } catch (err) {
        if (err.status === 404) return fatal("পেমেন্টটি খুঁজে পাওয়া যায়নি — ল্যান্ডিং পেজ থেকে আবার শুরু করুন।");
        if (err.status === 403) return fatal("এই পেমেন্ট দেখার অনুমতি নেই — ওই অ্যাকাউন্ট দিয়েই লগিন আছেন তো?");
        // 401 api() নিজেই login page নিয়ে যায়; বাকি সব (network) — অপেক্ষা করি
      }
      await sleep(PP_EVERY_MS);
    }
    if (last) showDone(last);
    return "pending";
  }

  /* ---------------------------------------------------------------- boot */
  async function boot() {
    if (ppId) return showPaygateReturn(ppId);
    if (!planSlug) return fatal("কোনো প্যাকেজ বাছা হয়নি — ল্যান্ডিং পেজ থেকে প্যাকেজ বেছে নিন।");

    let me;
    let plans;
    let methodData;
    let mine;
    let domainConfig;
    try {
      [me, plans, methodData, mine, domainConfig] = await Promise.all([
        api("/api/auth/me"),
        api("/api/plans"),
        api("/api/billing/methods"),
        api("/api/billing/payments/mine").catch(() => ({ payments: [] })),
        api("/api/stores/domain-config").catch(() => null),
      ]);
    } catch (err) {
      return fatal(err.message);
    }

    platformDomain = (domainConfig && domainConfig.platformDomain) || "";

    $("pcWho").textContent = me.name + (me.email ? " · " + me.email : "");
    plan = (plans || []).find((p) => p.slug === planSlug);
    if (!plan) return fatal("এই প্যাকেজটি পাওয়া যায়নি — ল্যান্ডিং পেজ থেকে আবার বেছে নিন।");
    if (Number(plan.price) <= 0) {
      return fatal("এই প্যাকেজটি ফ্রি — পেমেন্ট লাগবে না। /setup.html থেকে সরাসরি দোকান খুলুন।");
    }

    const wantedCycle = String(qs.get("cycle") || "").toLowerCase();
    cycleKey = planCycles().some((c) => c.key === wantedCycle) ? wantedCycle : "1m";
    renderCycle();

    methods = methodData.methods || [];

    if (storeId) {
      try {
        const rows = await api("/api/stores/mine");
        store = (rows || []).find((row) => String(row._id) === storeId) || null;
      } catch {
        store = null;
      }
      if (!store) return fatal("দোকানটি পাওয়া যায়নি — প্যানেল থেকে আবার চেষ্টা করুন।");
      $("storeStep").hidden = true;
      $("pcLede").textContent = (fullAddress(store.slug) || "/" + store.slug) + " দোকানের প্যাকেজ " + plan.name + " — পেমেন্ট যাচাই হলে প্যাকেজ চালু হবে।";
    } else {
      $("storeStep").hidden = false;
      $("pcLede").textContent = plan.name + " প্যাকেজে দোকান খুলতে পেমেন্ট মেথড বেছে নিন।";
      const preName = qs.get("name") || "";
      const preSlug = qs.get("slug") || "";
      $("pcStoreName").value = preName;
      $("pcStoreSlug").value = preSlug;

      addressField = window.ShopAddressField.mount({
        input: $("pcStoreSlug"),
        nameInput: $("pcStoreName"),
        suffixEl: $("pcHostSuffix"),
        urlEl: $("pcStoreUrl"),
        statusEl: $("pcStoreStatus"),
        suggestionsEl: $("pcStoreSuggest"),
        ruleEl: $("pcStoreRule"),
        domain: platformDomain,
        onState: renderSummary,
      });
    }

    if (!store) {
      $("pcStoreName").addEventListener("input", renderSummary);
      $("pcStoreSlug").addEventListener("input", renderSummary);
    }

    // age theke pending payment thakle notun ta dewa jabe na — status dekhai
    const pending = (mine.payments || []).find(
      (p) => p.status === "pending" && p.planSlug === plan.slug && (storeId ? p.storeId === storeId : !p.storeId)
    );
    if (pending) {
      showDone(pending);
      return;
    }

    renderSummary();
    renderMethods();
    $("pcLoading").hidden = true;
    $("pcGrid").hidden = false;
  }

  /* -------------------------------------------------------------- submit */
  const submitLabel = () => (selected && selected.gateway ? "পেমেন্ট পেজ খুলুন" : STATIC_TEXT.submit);

  $("pcSubmit").addEventListener("click", async () => {
    showError("");
    const btn = $("pcSubmit");

    if (!selected) return showError("পেমেন্ট মেথড বেছে নিন");

    const sender = $("pcSender").value.replace(/[\s-]/g, "");
    const gateway = Boolean(selected.gateway);

    if (selected.needsSender !== false && !/^01[3-9]\d{8}$/.test(sender)) {
      return showError("যে নম্বর থেকে টাকা পাঠিয়েছেন সেটি ১১ ডিজিটে লিখুন (যেমন 01712345678)");
    }
    if (!gateway && !/^[A-Za-z0-9-]{6,40}$/.test($("pcTrx").value.trim())) {
      return showError("TRXID ঠিকভাবে লিখুন — ৬–৪০ অক্ষর, শুধু ইংরেজি অক্ষর/সংখ্যা");
    }

    const body = gateway
      ? { planSlug: plan.slug, cycle: cycleKey, senderNumber: sender }
      : { planSlug: plan.slug, cycle: cycleKey, method: selected.id, senderNumber: sender, trxid: $("pcTrx").value.trim() };

    if (!store) {
      const name = $("pcStoreName").value.trim();
      if (!name) return showError("দোকানের নাম লিখুন");
    } else {
      body.storeId = String(store._id);
    }

    btn.disabled = true;
    btn.textContent = "চেক করা হচ্ছে...";

    if (!store) {
      const available = await addressField.ensureAvailable();
      if (!available) {
        showError(addressField.message() || "এই ঠিকানাটি ব্যবহার করা যাচ্ছে না");
        btn.disabled = false;
        btn.textContent = submitLabel();
        return;
      }
      body.storeName = $("pcStoreName").value.trim();
      body.storeSlug = addressField.value();
    }

    btn.textContent = gateway ? "পেমেন্ট পেজ খুলছি..." : "জমা হচ্ছে...";
    try {
      if (gateway) {
        const data = await api("/api/billing/paygate", { method: "POST", body: JSON.stringify(body) });
        if (data && data.checkoutUrl) {
          showDone(data.payment);
          location.href = data.checkoutUrl;
          return;
        }
        throw new Error("পেমেন্ট পেজের ঠিকানা পাওয়া যায়নি");
      }
      const data = await api("/api/billing/payments", { method: "POST", body: JSON.stringify(body) });
      showDone(data.payment);
    } catch (err) {
      if (err.data && err.data.payment) {
        showDone(err.data.payment);
        return;
      }
      showError(err.message);
      btn.disabled = false;
      btn.textContent = submitLabel();
    }
  });

  $("pcLogout").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    location.href = "/login.html";
  });

  boot();
})();
