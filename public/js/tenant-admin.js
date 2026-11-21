/* White-label store admin login — talks only to this host.
   Loads the store's own name/logo/colors from /api/public/tenant-meta and
   signs in through /api/auth/tenant-login (host-only httpOnly cookie). */
(function () {
  "use strict";

  const TEXT = {
    bn: {
      sub: "দোকান পরিচালনা করতে লগইন করুন",
      identifier: "ইমেইল বা ফোন",
      password: "পাসওয়ার্ড",
      submit: "লগইন করুন",
      working: "লগইন হচ্ছে…",
      required: "ইমেইল/ফোন আর পাসওয়ার্ড দুটোই দিন",
      bad: "লগইন তথ্য সঠিক নয়",
      locked: "অনেকবার ভুল পাসওয়ার্ড — কিছুক্ষণ পরে আবার চেষ্টা করুন",
      nopanel: "এই ঠিকানায় অ্যাডমিন প্যানেল পাওয়া যায়নি",
      suspended: "পেমেন্ট বাকির কারণে দোকানটি বন্ধ আছে। লগইন করে পেমেন্ট সম্পন্ন করলে আবার চালু হবে।",
      network: "সার্ভারে পৌঁছানো যায়নি — আবার চেষ্টা করুন",
      lang: "English",
    },
    en: {
      sub: "Sign in to manage your store",
      identifier: "Email or phone",
      password: "Password",
      submit: "Sign in",
      working: "Signing in…",
      required: "Enter both email/phone and password",
      bad: "The login details are not correct",
      locked: "Too many wrong passwords — try again in a few minutes",
      nopanel: "No admin panel is available at this address",
      suspended: "This store is paused for an unpaid bill. Sign in and complete the payment to reopen it.",
      network: "Could not reach the server — please try again",
      lang: "বাংলা",
    },
  };

  const $ = (id) => document.getElementById(id);
  const form = $("taForm");
  const identifier = $("taIdentifier");
  const password = $("taPassword");
  const submit = $("taSubmit");
  const msg = $("taMsg");
  const notice = $("taNotice");

  let language = "bn";
  let ready = false;

  function t(key) {
    return (TEXT[language] && TEXT[language][key]) || TEXT.bn[key] || key;
  }

  function applyLanguage() {
    document.documentElement.lang = language;
    document.querySelectorAll("[data-bn]").forEach((el) => {
      const text = el.getAttribute("data-" + language);
      if (text) el.textContent = text;
    });
    $("taLang").textContent = t("lang");
  }

  function setLogo(branding, fallbackName) {
    const name = String(branding.title || fallbackName || "").trim();
    $("taName").textContent = name || "Store";
    $("taFootName").textContent = name || "";
    document.title = (name || "Admin") + " — Admin";

    const logo = $("taLogo");
    const mark = $("taMark");
    if (branding.logo) {
      logo.src = branding.logo;
      logo.alt = name;
      logo.hidden = false;
      mark.hidden = true;
    } else {
      logo.hidden = true;
      mark.hidden = false;
      mark.textContent = (name.charAt(0) || "S").toUpperCase();
    }

    if (branding.favicon) {
      let link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = branding.favicon;
    }
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    const colors = {
      "--ta-accent": theme.accent,
      "--ta-accent-dark": theme.accentDark || theme.accent,
      "--ta-bg": theme.bg,
      "--ta-surface": theme.surface,
      "--ta-ink": theme.ink,
      "--ta-font": theme.font,
    };
    Object.keys(colors).forEach((key) => {
      if (colors[key]) root.style.setProperty(key, colors[key]);
    });
  }

  function disableForm(reason) {
    form.hidden = true;
    msg.textContent = reason;
  }

  function setBusy(busy) {
    submit.disabled = busy;
    submit.textContent = busy ? t("working") : t("submit");
  }

  async function loadMeta() {
    try {
      const res = await fetch("/api/public/tenant-meta", { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        disableForm(t("nopanel"));
        msg.textContent = data.message && res.status >= 500 ? data.message : t("nopanel");
        return false;
      }
      const meta = await res.json();
      language = meta.language === "en" ? "en" : "bn";
      applyLanguage();
      setLogo(meta.branding || {}, meta.store && meta.store.name);
      applyTheme(meta.theme || {});
      if (meta.suspended) {
        notice.textContent = t("suspended");
        notice.hidden = false;
      }
      ready = true;
      return true;
    } catch {
      disableForm(t("network"));
      return false;
    }
  }

  async function alreadySignedIn() {
    let marked = false;
    try {
      marked = localStorage.getItem("luxe_tenant") === "1";
    } catch {
      /* private mode */
    }
    if (!marked) return;
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.ok) location.replace("/dashboard.html");
    } catch {
      /* stay on the form */
    }
  }

  async function submitLogin(event) {
    event.preventDefault();
    msg.textContent = "";
    const body = {
      identifier: identifier.value.trim(),
      password: password.value,
    };
    if (!body.identifier || !body.password) {
      msg.textContent = t("required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/tenant-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        msg.textContent = res.status === 429 ? t("locked") : res.status === 403 ? t("nopanel") : data.message || t("bad");
        setBusy(false);
        password.select();
        return;
      }
      try {
        localStorage.setItem("luxe_tenant", "1");
        // the cookie is the session now; a stale bearer token must not win
        localStorage.removeItem("luxe_token");
        localStorage.removeItem("luxe_store_slug");
        localStorage.removeItem("luxe_store_id");
      } catch {
        /* private mode */
      }
      location.href = "/dashboard.html";
    } catch {
      msg.textContent = t("network");
      setBusy(false);
    }
  }

  $("taLang").addEventListener("click", () => {
    language = language === "bn" ? "en" : "bn";
    applyLanguage();
    if (!ready) return;
    if (!notice.hidden) notice.textContent = t("suspended");
    setBusy(submit.disabled);
  });

  form.addEventListener("submit", submitLogin);

  (async function init() {
    applyLanguage();
    await loadMeta();
    await alreadySignedIn();
  })();
})();
