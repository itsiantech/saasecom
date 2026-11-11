/* ==========================================================================
   ApiSession — shared admin API client.

   - Adds the bearer token and JSON content type.
   - On 401 tries a silent token refresh first, then a re-login modal.
   - Never navigates away: an open form must survive an expired session.
   - Rejects nothing: callers keep using `if (!res) return;` for cancelled login.
   ========================================================================== */
(function () {
  "use strict";

  const TOKEN_KEY = "luxe_token";
  const STORE_KEY = "luxe_store_slug";
  const RE_LOGIN_ID = "apiSessionRelogin";

  let refreshPromise = null;
  let loginPromise = null;

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function setToken(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode */
    }
  }

  function clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private mode */
    }
  }

  function decode(token) {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    try {
      const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
      return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    } catch {
      return null;
    }
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function hasHeader(headers, name) {
    const wanted = name.toLowerCase();
    return Object.keys(headers).some(function (key) {
      return key.toLowerCase() === wanted;
    });
  }

  function buildHeaders(options) {
    const opts = options || {};
    const headers = Object.assign({}, opts.headers || {});
    const body = opts.body;
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    if (!isForm && body !== undefined && !hasHeader(headers, "Content-Type")) {
      headers["Content-Type"] = "application/json";
    }
    const token = getToken();
    if (token && !hasHeader(headers, "Authorization")) headers.Authorization = "Bearer " + token;
    return headers;
  }

  function rawFetch(url, options) {
    const opts = options || {};
    return fetch(url, Object.assign({}, opts, { headers: buildHeaders(opts) }));
  }

  function refresh() {
    if (!refreshPromise) {
      refreshPromise = (async function () {
        const token = getToken();
        if (!token) return false;
        const headers = { "Content-Type": "application/json", Authorization: "Bearer " + token };
        try {
          const slug = localStorage.getItem(STORE_KEY);
          if (slug) headers["x-store-slug"] = slug;
        } catch {
          /* private mode */
        }
        try {
          const res = await fetch("/api/auth/refresh", {
            method: "POST",
            headers: headers,
            body: "{}",
          });
          if (!res.ok) return false;
          const data = await res.json().catch(function () {
            return null;
          });
          if (!data || !data.token) return false;
          setToken(data.token);
          return true;
        } catch {
          return false;
        }
      })().finally(function () {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  function reloginModal() {
    return new Promise(function (resolve) {
      const previous = document.getElementById(RE_LOGIN_ID);
      if (previous) previous.remove();

      const overlay = document.createElement("div");
      overlay.id = RE_LOGIN_ID;
      overlay.className = "fg-relogin";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "Session expired");
      overlay.innerHTML =
        '<div class="fg-relogin-box">' +
        '<div class="fg-relogin-head"><h3>Session expired</h3>' +
        '<button type="button" class="fg-relogin-x" data-cancel aria-label="Close">×</button></div>' +
        '<p class="fg-relogin-text">Ei form open roye abar login korun. Login kora maptro save abar chesta korbe — apnar type kora data hariye jabe na.</p>' +
        '<form class="fg-relogin-form" novalidate>' +
        '<label><span>Email ba phone</span><input type="text" name="identifier" autocomplete="username" required /></label>' +
        '<label><span>Password</span><input type="password" name="password" autocomplete="current-password" required /></label>' +
        '<p class="fg-relogin-error" data-error role="alert"></p>' +
        '<div class="fg-relogin-actions">' +
        '<button type="button" class="btn-ghost" data-cancel>Cancel</button>' +
        '<button type="submit" class="btn-gold" data-submit>Log in</button>' +
        "</div></form></div>";
      document.body.appendChild(overlay);

      const box = overlay.querySelector(".fg-relogin-box");
      const form = overlay.querySelector("form");
      const identifier = form.querySelector('input[name="identifier"]');
      const password = form.querySelector('input[name="password"]');
      const errorEl = overlay.querySelector("[data-error]");
      const submit = overlay.querySelector("[data-submit]");
      const focusables = box.querySelectorAll("button, input");

      const finish = function (value) {
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        resolve(value);
      };

      const onKey = function (e) {
        if (e.key === "Escape") {
          e.stopPropagation();
          finish(false);
          return;
        }
        if (e.key !== "Tab" || !focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      };

      overlay.querySelectorAll("[data-cancel]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          finish(false);
        });
      });
      document.addEventListener("keydown", onKey, true);

      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        errorEl.textContent = "";
        const body = {
          identifier: identifier.value.trim(),
          password: password.value,
        };
        if (!body.identifier || !body.password) {
          errorEl.textContent = "Email/phone ar password din";
          return;
        }
        submit.disabled = true;
        submit.textContent = "Logging in...";
        try {
          const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await res.json().catch(function () {
            return {};
          });
          if (!res.ok) throw new Error(data.message || "Login hoyni");
          if (!data.token) throw new Error("Login hoyni");
          setToken(data.token);
          finish(true);
        } catch (err) {
          errorEl.textContent = err.message;
          submit.disabled = false;
          submit.textContent = "Log in";
          password.focus();
          password.select();
        }
      });

      identifier.focus();
    });
  }

  function promptLogin() {
    if (!loginPromise) {
      loginPromise = reloginModal().finally(function () {
        loginPromise = null;
      });
    }
    return loginPromise;
  }

  function finish(res) {
    // 403 = onno dokaner data er onumoti nei — session rakhi, logout kori na
    if (res && res.status === 403 && typeof window.toast === "function") {
      window.toast("এই দোকানের ডেটা দেখার অনুমতি নেই", "err");
    }
    return res;
  }

  async function request(url, options) {
    let res = await rawFetch(url, options);
    if (res.status !== 401) return finish(res);

    if (await refresh()) {
      res = await rawFetch(url, options);
      if (res.status !== 401) return finish(res);
    }

    const loggedIn = await promptLogin();
    if (!loggedIn) return null;

    res = await rawFetch(url, options);
    if (res.status === 401 && typeof window.toast === "function") {
      window.toast("Login hoyeche kintu request fail — abar chesta korun", "err");
      return null;
    }
    return finish(res);
  }

  // Token expire hoye gele form kholar agei chupchap notun token niye nei.
  async function ensureFresh() {
    const payload = decode(getToken());
    if (!payload || !payload.exp) return false;
    const left = payload.exp * 1000 - Date.now();
    if (left > 10 * 60 * 1000) return true;
    return refresh();
  }

  // Re-login cancel hoye gele caller ke ekta "failed response" din — jate
// `res.ok` / `res.json()` pattern gulo TypeError chara kaj kore.
  function cancelled() {
    const payload = { message: "Session shesh — abar login korun" };
    return {
      ok: false,
      status: 401,
      cancelled: true,
      headers: new Headers(),
      json: function () {
        return Promise.resolve(payload);
      },
      text: function () {
        return Promise.resolve(JSON.stringify(payload));
      },
      blob: function () {
        return Promise.resolve(new Blob([JSON.stringify(payload)]));
      },
    };
  }

  window.ApiSession = {
    request: request,
    refresh: refresh,
    ensureFresh: ensureFresh,
    cancelled: cancelled,
    token: getToken,
    clear: clear,
    decode: decode,
  };
})();