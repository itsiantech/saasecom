const TOKEN_KEY = "luxe_token";

const form = document.getElementById("authForm");
const formTitle = document.getElementById("formTitle");
const formSub = document.getElementById("formSub");
const submitBtn = document.getElementById("submitBtn");
const nameField = document.getElementById("nameField");
const toggleBtn = document.getElementById("toggleMode");
const switchLabel = document.getElementById("switchLabel");
const msg = document.getElementById("msg");

let mode = "login";

function safeNext() {
  const next = new URLSearchParams(location.search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  return next;
}

// ?next thakle seta (panel chara), na hole role onujayi — superadmin panel e, customer portal e
function landingFor(user) {
  const isSuper = !!user && user.role === "superadmin";
  const next = safeNext();
  if (next && (isSuper || !next.startsWith("/admin"))) return next;
  return isSuper ? "/admin.html" : "/portal.html";
}

const landingLabel = (dest) =>
  dest === "/admin.html" ? "সুপার অ্যাডমিন প্যানেলে" : dest === "/portal.html" ? "আপনার অ্যাকাউন্টে" : "ড্যাশবোর্ডে";

// age theke valid token thakle role onujayi page e chole jay
(async function checkSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  try {
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: "Bearer " + token },
    });
    if (res.ok) location.href = landingFor(await res.json());
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* offline thakle login page e thako */ }
})();

function setMode(next) {
  mode = next;
  const isLogin = mode === "login";
  nameField.hidden = isLogin;
  formTitle.textContent = isLogin ? "Welcome back" : "Create account";
  formSub.textContent = isLogin
    ? "Admin dashboard e login korun"
    : "নতুন অ্যাকাউন্ট খুলুন — প্রথম ইউজার admin হবে";
  submitBtn.textContent = isLogin ? "Login" : "Register";
  switchLabel.textContent = isLogin ? "নতুন অ্যাকাউন্ট?" : "অ্যাকাউন্ট আছে?";
  toggleBtn.textContent = isLogin ? "রেজিস্টার করুন" : "লগইন করুন";
  showMsg("");
}

toggleBtn.addEventListener("click", () => setMode(mode === "login" ? "register" : "login"));

// demo account — click korle autofill hoye dashboard e chole jabe
document.getElementById("demoBtn").addEventListener("click", () => {
  document.getElementById("email").value = "admin@test.com";
  document.getElementById("password").value = "demo1234";
  form.requestSubmit();
});

function showMsg(text, type) {
  msg.textContent = text;
  msg.className = "msg" + (type ? " " + type : "");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showMsg("");
  submitBtn.disabled = true;
  submitBtn.textContent = "অপেক্ষা করুন...";
  try {
    const body = {
      email: document.getElementById("email").value.trim(),
      password: document.getElementById("password").value,
    };
    if (mode === "register") body.name = document.getElementById("name").value.trim();

    const res = await fetch("/api/auth/" + mode, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "কিছু একটা ভুল হয়েছে");

    localStorage.setItem(TOKEN_KEY, data.token);
    // purono account er dokan slug notun account e carry kori na
    localStorage.removeItem("luxe_store_slug");
    const dest = landingFor(data.user);
    showMsg("সফল! " + landingLabel(dest) + " নিয়ে যাওয়া হচ্ছে...", "ok");
    setTimeout(() => (location.href = dest), 400);
  } catch (err) {
    showMsg(err.message, "err");
    submitBtn.disabled = false;
    submitBtn.textContent = mode === "login" ? "Login" : "Register";
  }
});

/* ---- google login ---- */
(async function initGoogle() {
  const wrap = document.getElementById("gWrap");
  try {
    const res = await fetch("/api/auth/config");
    const cfg = await res.json();
    if (!cfg.googleClientId) {
      wrap.innerHTML =
        '<button class="g-fallback" type="button" disabled>' + googleSvg() +
        '<span>Google login — সেটআপ করা নেই</span></button>' +
        '<p class="g-hint">.env ফাইলে GOOGLE_CLIENT_ID বসালে বাটন চালু হবে</p>';
      return;
    }
    if (typeof google === "undefined") {
      wrap.innerHTML = '<p class="g-hint">Google script লোড হচ্ছে, একটু অপেক্ষা করুন...</p>';
      return;
    }
    google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      callback: handleGoogle,
    });
    google.accounts.id.renderButton(
      document.getElementById("gBtn"),
      { theme: "filled_black", size: "large", width: 340, shape: "pill", text: "continue_with" }
    );
  } catch {
    wrap.innerHTML = '<p class="g-hint">Google login লোড হয়নি — refresh করে আবার চেষ্টা করুন</p>';
  }
})();

async function handleGoogle(response) {
  showMsg("");
  try {
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: response.credential }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Google login fail");
    localStorage.setItem(TOKEN_KEY, data.token);
    // purono account er dokan slug notun account e carry kori na
    localStorage.removeItem("luxe_store_slug");
    const dest = landingFor(data.user);
    showMsg("সফল! " + landingLabel(dest) + " নিয়ে যাওয়া হচ্ছে...", "ok");
    setTimeout(() => (location.href = dest), 400);
  } catch (err) {
    showMsg(err.message, "err");
  }
}

function googleSvg() {
  return (
    '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41 35.4 44 30.2 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>'
  );
}
