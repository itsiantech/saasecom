(function () {
  "use strict";
  const TOKEN_KEY = "luxe_token";
  const form = document.getElementById("authForm");
  const msg = document.getElementById("msg");
  const submitBtn = document.getElementById("submitBtn");

  // api.amarbazaar.bd → amarbazaar.bd (IP / localhost e link dekhabo na)
  const backLink = document.getElementById("backLink");
  const host = location.hostname;
  const isIP = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
  const labels = host.split(".");
  if (backLink && !isIP && labels.length > 2) {
    backLink.href = "https://" + labels.slice(1).join(".");
    backLink.hidden = false;
  }

  // platform branding — same logo/favicon as the landing page
  (async function loadBranding() {
    try {
      const res = await fetch("/api/public/branding", { cache: "no-store" });
      if (!res.ok) return;
      const branding = ((await res.json()) || {}).branding || {};
      const mark = document.querySelector(".brand-mark");
      if (mark && branding.logo) {
        const img = document.createElement("img");
        img.src = branding.logo;
        img.alt = "";
        mark.textContent = "";
        mark.appendChild(img);
        mark.classList.add("has-logo");
        document.querySelector(".brand-panel")?.classList.add("has-logo");
      }
      if (branding.favicon) {
        const link = document.createElement("link");
        link.rel = "icon";
        link.href = branding.favicon;
        document.head.appendChild(link);
      }
    } catch {
      /* offline — default LUXE mark stays */
    }
  })();

  function show(text, kind) {
    msg.textContent = text || "";
    msg.className = "msg" + (kind ? " " + kind : "");
  }

  // already a superadmin on this origin? go straight to the panel
  (async function checkSession() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    try {
      const res = await fetch("/api/auth/me", { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) {
        localStorage.removeItem(TOKEN_KEY);
        return;
      }
      const me = await res.json();
      if (me.role === "superadmin") location.href = "/admin.html";
      else localStorage.removeItem(TOKEN_KEY);
    } catch { /* offline hole login page e thakuk */ }
  })();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    show("");
    submitBtn.disabled = true;
    submitBtn.textContent = "অপেক্ষা করুন...";
    try {
      const res = await fetch("/api/auth/platform-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.getElementById("email").value.trim(),
          password: document.getElementById("password").value,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "লগইন হয়নি");
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.removeItem("luxe_store_slug");
      location.href = "/admin.html";
    } catch (err) {
      show(err.message, "err");
      submitBtn.disabled = false;
      submitBtn.textContent = "Login";
    }
  });
})();
