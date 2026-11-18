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

  // platform branding (logo / name / favicon / copyright) comes from
  // /js/platform-brand.js, included before this file

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
