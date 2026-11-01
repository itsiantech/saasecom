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

  /* ------------------------------------------------------------- render */
  function renderSummary() {
    $("pcPlanName").textContent = plan.name;
    $("pcPlanDur").textContent = Number(plan.durationDays || 30) + " দিন" + (plan.trialDays > 0 ? " + " + plan.trialDays + " দিন ট্রায়াল" : "");
    $("pcTotal").textContent = "৳ " + num(plan.price);
    $("pcSumStore").textContent = store ? "/" + store.slug : $("pcStoreSlug").value.trim() || "—";
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
        const detail = m.id === "bank" ? (m.bankName || "ব্যাংক অ্যাকাউন্ট") : m.id === "qr" ? "স্ক্যান করে পেমেন্ট" : m.number || "";
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
          "<p>QR স্ক্যান করে ঠিক <b>৳ " + num(plan.price) + "</b> পাঠান, তারপর নিচে আপনার নম্বর ও TRXID দিন।</p>" +
          "</div></div>"
      );
    } else {
      parts.push(copyRow("নম্বর", m.number));
      parts.push(copyRow("অ্যাকাউন্ট", m.accountName));
    }

    parts.push(
      "<p><b>৳ " + num(plan.price) + "</b> পাঠান — " +
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
    $("pcSenderWrap").hidden = selected.needsSender === false;
    renderSummary();
    showError("");
    $("pcSender").focus();
  }

  function showDone(payment) {
    $("pcLoading").hidden = true;
    $("pcGrid").hidden = true;
    $("pcDone").hidden = false;

    const pending = payment.status === "pending";
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
    } else {
      text =
        "অ্যাডমিন TRXID মিলিয়ে দেখে অনুমোদন দিলে " +
        (payment.kind === "existing" ? "আপনার প্যাকেজ আপডেট হবে।" : "আপনার দোকান স্বয়ংক্রিয়ভাবে তৈরি হবে।") +
        " সাধারণত কিছুক্ষণের মধ্যেই হয়ে যায়।";
    }
    $("pcDoneText").textContent = text;
    $("pcDoneInvoice").href = payment.invoiceUrl;
    if (pending) $("pcDoneInvoice").textContent = "ইনভয়েস ডাউনলোড";
  }

  /* ---------------------------------------------------------------- boot */
  async function boot() {
    if (!planSlug) return fatal("কোনো প্যাকেজ বাছা হয়নি — ল্যান্ডিং পেজ থেকে প্যাকেজ বেছে নিন।");

    let me;
    let plans;
    let methodData;
    let mine;
    try {
      [me, plans, methodData, mine] = await Promise.all([
        api("/api/auth/me"),
        api("/api/plans"),
        api("/api/billing/methods"),
        api("/api/billing/payments/mine").catch(() => ({ payments: [] })),
      ]);
    } catch (err) {
      return fatal(err.message);
    }

    $("pcWho").textContent = me.name + (me.email ? " · " + me.email : "");
    plan = (plans || []).find((p) => p.slug === planSlug);
    if (!plan) return fatal("এই প্যাকেজটি পাওয়া যায়নি — ল্যান্ডিং পেজ থেকে আবার বেছে নিন।");
    if (Number(plan.price) <= 0) {
      return fatal("এই প্যাকেজটি ফ্রি — পেমেন্ট লাগবে না। /setup.html থেকে সরাসরি দোকান খুলুন।");
    }

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
      $("pcLede").textContent = "/" + store.slug + " দোকানের প্যাকেজ " + plan.name + " — পেমেন্ট যাচাই হলে প্যাকেজ চালু হবে।";
    } else {
      $("storeStep").hidden = false;
      $("pcLede").textContent = plan.name + " প্যাকেজে দোকান খুলতে পেমেন্ট মেথড বেছে নিন।";
      const preName = qs.get("name") || "";
      const preSlug = (qs.get("slug") || "").toLowerCase();
      $("pcStoreName").value = preName;
      $("pcStoreSlug").value = preSlug;
      $("pcHostPrefix").textContent = location.host + "/";
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
  $("pcSubmit").addEventListener("click", async () => {
    showError("");
    const btn = $("pcSubmit");

    if (!selected) return showError("পেমেন্ট মেথড বেছে নিন");

    const sender = $("pcSender").value.replace(/[\s-]/g, "");
    const trxid = $("pcTrx").value.trim();

    if (selected.needsSender !== false && !/^01[3-9]\d{8}$/.test(sender)) {
      return showError("যে নম্বর থেকে টাকা পাঠিয়েছেন সেটি ১১ ডিজিটে লিখুন (যেমন 01712345678)");
    }
    if (!/^[A-Za-z0-9-]{6,40}$/.test(trxid)) {
      return showError("TRXID ঠিকভাবে লিখুন — ৬–৪০ অক্ষর, শুধু ইংরেজি অক্ষর/সংখ্যা");
    }

    const body = {
      planSlug: plan.slug,
      method: selected.id,
      senderNumber: sender,
      trxid,
    };

    if (!store) {
      const name = $("pcStoreName").value.trim();
      const slug = $("pcStoreSlug").value.trim().toLowerCase();
      if (!name) return showError("দোকানের নাম লিখুন");
      if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(slug)) {
        return showError("ঠিকানা ৩–৬৩ অক্ষরের হতে হবে — ছোট হাতের অক্ষর, সংখ্যা বা hyphen");
      }
      body.storeName = name;
      body.storeSlug = slug;
    } else {
      body.storeId = String(store._id);
    }

    btn.disabled = true;
    btn.textContent = "জমা হচ্ছে...";
    try {
      const data = await api("/api/billing/payments", { method: "POST", body: JSON.stringify(body) });
      showDone(data.payment);
    } catch (err) {
      if (err.data && err.data.payment) {
        showDone(err.data.payment);
        return;
      }
      showError(err.message);
      btn.disabled = false;
      btn.textContent = "পেমেন্ট জমা দিন";
    }
  });

  $("pcLogout").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    location.href = "/login.html";
  });

  boot();
})();
