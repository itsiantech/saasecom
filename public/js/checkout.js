/* ==========================================================================
   Public checkout controller
   - Settings theke fields / payment / login config pore
   - District diye area shipping auto quote
   - Login/registration gate (jodi settings e on thake)
   ========================================================================== */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const TOKEN_KEY = "luxe_customer_token";
  const SESSION_KEY = "luxe_cart_session";
  const STORE_KEY = "luxe_store_slug";

  const BD_PHONE_RE = /^01[3-9]\d{8}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const DISTRICTS = [
    "Dhaka", "Gazipur", "Narayanganj", "Tangail", "Kishoreganj", "Manikganj", "Munshiganj", "Narsingdi",
    "Faridpur", "Gopalganj", "Madaripur", "Rajbari", "Shariatpur", "Chattogram", "Cox's Bazar", "Cumilla",
    "Brahmanbaria", "Chandpur", "Feni", "Lakshmipur", "Noakhali", "Rangamati", "Khagrachhari", "Bandarban",
    "Sylhet", "Habiganj", "Moulvibazar", "Sunamganj", "Rajshahi", "Bogura", "Joypurhat", "Naogaon",
    "Natore", "Chapainawabganj", "Pabna", "Sirajganj", "Khulna", "Bagerhat", "Chuadanga", "Jashore",
    "Jhenaidah", "Kushtia", "Magura", "Meherpur", "Narail", "Satkhira", "Barishal", "Barguna",
    "Bhola", "Jhalokati", "Patuakhali", "Pirojpur", "Rangpur", "Dinajpur", "Gaibandha", "Kurigram",
    "Lalmonirhat", "Nilphamari", "Panchagarh", "Thakurgaon", "Mymensingh", "Jamalpur", "Netrokona", "Sherpur",
  ];

  const COUNTRIES = [
    "Bangladesh", "India", "Pakistan", "Nepal", "Bhutan", "Sri Lanka", "Maldives", "Afghanistan",
    "United States", "Canada", "United Kingdom", "Ireland", "Germany", "France", "Italy", "Spain",
    "Netherlands", "Belgium", "Switzerland", "Austria", "Sweden", "Norway", "Denmark", "Finland",
    "Poland", "Portugal", "Greece", "Turkey", "Russia", "Ukraine", "United Arab Emirates", "Saudi Arabia",
    "Qatar", "Kuwait", "Bahrain", "Oman", "Jordan", "Lebanon", "Israel", "Egypt",
    "South Africa", "Nigeria", "Kenya", "Ghana", "Morocco", "China", "Japan", "South Korea",
    "Singapore", "Malaysia", "Thailand", "Vietnam", "Indonesia", "Philippines", "Australia", "New Zealand",
    "Brazil", "Argentina", "Chile", "Mexico", "Colombia", "Peru",
  ];

  let storeSlug = new URLSearchParams(location.search).get("store") || localStorage.getItem(STORE_KEY) || "";
  let token = localStorage.getItem(TOKEN_KEY) || "";
  let config = null;
  let user = null;
  let cart = [];
  let guestItems = [];
  let shippingOptions = [];
  let selectedShipping = "";
  let selectedPayment = "";
  let shipTimer = null;
  let booting = false;
  let wholesaleConfig = null;
  let wholesaleQuote = null;
  let selectedSpeedId = "";
  let installmentConfig = null;
  let installmentPreview = null;
  let selectedPlanId = "";
  let coupon = null;
  let couponBusy = false;

  const withStore = (path) =>
    path + (path.includes("?") ? "&" : "?") + "store=" + encodeURIComponent(storeSlug);

  function detectSource() {
    const utm = (new URLSearchParams(location.search).get("utm_source") || "").toLowerCase();
    const ref = String(document.referrer || "").toLowerCase();
    if (/instagram|\big\b/.test(utm) || ref.includes("instagram")) return "instagram";
    if (/facebook|\bfb\b|\bmeta\b/.test(utm) || ref.includes("facebook") || ref.includes("fb.")) return "facebook";
    if (/youtube|\byt\b/.test(utm) || ref.includes("youtube") || ref.includes("youtu.be")) return "youtube";
    if (/google|adwords|gclid/.test(utm) || ref.includes("google.") || ref.includes("googleadservices")) return "google";
    return ref ? "other" : "direct";
  }

  function detectDevice() {
    const ua = navigator.userAgent || "";
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
    if (/Mobi|Android|iPhone|iPod|IEMobile|BlackBerry|Opera Mini/i.test(ua)) return "mobile";
    return "desktop";
  }

  function sessionId() {
    let s = localStorage.getItem(SESSION_KEY);
    if (!s) {
      s = "co-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(SESSION_KEY, s);
    }
    return s;
  }

  function headers(extra) {
    const h = { "Content-Type": "application/json", ...(extra || {}) };
    if (token) h.Authorization = "Bearer " + token;
    else h["x-session-id"] = sessionId();
    return h;
  }

  async function api(path, opts = {}) {
    const res = await fetch(withStore(path), {
      ...opts,
      headers: headers(opts.headers),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function money(n) {
    return "৳" + (Number(n) || 0).toLocaleString("en-US");
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function showFatal(message) {
    $("coLoading").hidden = true;
    $("checkoutWrap").hidden = true;
    $("authGate").hidden = true;
    $("coSuccess").hidden = true;
    const el = $("coFatal");
    el.textContent = message;
    el.hidden = false;
  }

  /* ------------------------------------------------------------------ *
   * Site chrome
   * ------------------------------------------------------------------ */
  function applySite() {
    const site = (config && config.site) || {};
    const title = site.siteTitle || "Store";
    document.title = "Checkout — " + title;
    setText("coTitle", title);
    setText("coFooter", "© " + new Date().getFullYear() + " " + title);
    applyAccountLinks();

    const img = $("coLogo");
    const titleEl = $("coTitle");
    if (site.logo) {
      img.src = site.logo;
      img.alt = title;
      img.hidden = false;
      titleEl.hidden = true;
      img.style.width = (Number(site.logoWidth) || 120) + "px";
      img.style.height = (Number(site.logoHeight) || 40) + "px";
    } else {
      img.hidden = true;
      titleEl.hidden = false;
    }
  }

  function renderUser() {
    const u = $("coUser");
    const l = $("coLogout");
    if (token && user) {
      u.textContent = user.name + (user.email ? " · " + user.email : user.phone ? " · " + user.phone : "");
      u.hidden = false;
      l.hidden = false;
    } else {
      u.hidden = true;
      l.hidden = true;
    }
  }

  function applyAccountLinks() {
    const suffix = storeSlug ? "?store=" + encodeURIComponent(storeSlug) : "";
    const account = $("coAccount");
    if (account) account.href = "/account.html" + suffix;
    const success = $("successAccount");
    if (success) success.href = "/account.html" + suffix;
  }

  function fillDatalists() {
    const extraDistricts = ((config && config.shipping && config.shipping.areas) || [])
      .map((a) => a.district)
      .filter(Boolean);
    const districts = [...new Set(DISTRICTS.concat(extraDistricts))];
    const d = $("coDistrictList");
    if (d) d.innerHTML = districts.map((x) => `<option value="${esc(x)}"></option>`).join("");
    const c = $("coCountryList");
    if (c) c.innerHTML = COUNTRIES.map((x) => `<option value="${esc(x)}"></option>`).join("");
  }

  /* ------------------------------------------------------------------ *
   * Auth gate
   * ------------------------------------------------------------------ */
  function showAuthGate() {
    $("coLoading").hidden = true;
    $("checkoutWrap").hidden = true;
    $("coSuccess").hidden = true;
    $("coFatal").hidden = true;
    $("authGate").hidden = false;

    const { email, phone } = config.login;
    const idLabel = email && phone ? "Email or phone" : email ? "Email" : "Phone number";
    setText("loginIdLabel", idLabel);
    const idInput = $("loginId");
    idInput.type = email && phone ? "text" : email ? "email" : "tel";
    idInput.placeholder = email && phone ? "you@example.com ba 01XXXXXXXXX" : email ? "you@example.com" : "01XXXXXXXXX";

    $("regEmailWrap").hidden = !email;
    $("regPhoneWrap").hidden = !phone;
    $("regEmail").required = false;
    $("regPhone").required = false;

    renderUser();
  }

  document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-auth-tab]").forEach((b) => b.classList.toggle("active", b === btn));
      const tab = btn.dataset.authTab;
      $("loginForm").hidden = tab !== "login";
      $("registerForm").hidden = tab !== "register";
    });
  });

  async function mergeGuestCart() {
    if (!guestItems.length) return;
    // user cart already te item thakle merge korbo na (duplicate avoid)
    const cur = await api("/api/cart");
    if (cur.res.ok && (cur.data.items || []).length) return;

    for (const it of guestItems) {
      const productId = it.product && it.product._id ? it.product._id : it.product;
      if (!productId) continue;
      const body = { productId, quantity: it.quantity };
      if (it.variation) body.variationId = it.variation._id || it.variation;
      if (it.swatch) body.swatchId = it.swatch._id || it.swatch;
      await api("/api/cart/items", { method: "POST", body: JSON.stringify(body) });
    }
    guestItems = [];
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("loginError");
    err.hidden = true;
    const identifier = $("loginId").value.trim();
    const password = $("loginPassword").value;
    if (!identifier || !password) {
      err.textContent = "Email/phone ar password din";
      err.hidden = false;
      return;
    }
    const btn = e.submitter || $("loginForm").querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const { res, data } = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password }),
      });
      if (!res.ok) {
        err.textContent = data.message || "Login fail hoyeche";
        err.hidden = false;
        return;
      }
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      user = data.user;
      await mergeGuestCart();
      await boot();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  $("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("registerError");
    err.hidden = true;
    const name = $("regName").value.trim();
    const email = $("regEmail").value.trim();
    const phone = $("regPhone").value.trim();
    const password = $("regPassword").value;

    const emailOn = !$("regEmailWrap").hidden;
    const phoneOn = !$("regPhoneWrap").hidden;

    if (!name || !password) {
      err.textContent = "Name ar password lagbe";
      err.hidden = false;
      return;
    }
    if (emailOn && !email && phoneOn && !phone) {
      err.textContent = "Email ba phone number er ekta din";
      err.hidden = false;
      return;
    }
    if (email && !EMAIL_RE.test(email)) {
      err.textContent = "Email valid na";
      err.hidden = false;
      return;
    }
    if (phone && !BD_PHONE_RE.test(phone)) {
      err.textContent = "Phone number 01XXXXXXXXX format e din";
      err.hidden = false;
      return;
    }

    const payload = { name, password };
    if (emailOn && email) payload.email = email;
    if (phoneOn && phone) payload.phone = phone;

    const btn = e.submitter || $("registerForm").querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const { res, data } = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        err.textContent = data.message || "Register fail hoyeche";
        err.hidden = false;
        return;
      }
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      user = data.user;
      await mergeGuestCart();
      await boot();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  $("coLogout").addEventListener("click", () => {
    token = "";
    user = null;
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  });

  /* ------------------------------------------------------------------ *
   * Checkout fields
   * ------------------------------------------------------------------ */
  function fieldInput(f) {
    const id = "co-" + f.key;
    const ph = esc(f.label);
    if (f.key === "address") {
      return `<textarea id="${id}" rows="3" placeholder="${ph}" autocomplete="street-address"></textarea>`;
    }
    if (f.key === "district") {
      return `<input id="${id}" list="coDistrictList" placeholder="Dhaka" autocomplete="address-level2" />`;
    }
    if (f.key === "country") {
      return `<input id="${id}" list="coCountryList" placeholder="Bangladesh" autocomplete="country-name" />`;
    }
    if (f.key === "phone") {
      return `<input id="${id}" type="tel" placeholder="01XXXXXXXXX" autocomplete="tel" />`;
    }
    if (f.key === "email") {
      return `<input id="${id}" type="email" placeholder="you@example.com" autocomplete="email" />`;
    }
    if (f.key === "postCode") {
      return `<input id="${id}" placeholder="1207" autocomplete="postal-code" />`;
    }
    if (f.key === "name") {
      return `<input id="${id}" placeholder="${ph}" autocomplete="name" />`;
    }
    return `<input id="${id}" placeholder="${ph}" />`;
  }

  function renderFields() {
    const wrap = $("coFields");
    wrap.innerHTML = config.fields
      .map(
        (f) => `
        <div class="co-field" data-field="${esc(f.key)}">
          <label for="co-${esc(f.key)}">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ""}</label>
          ${fieldInput(f)}
          <p class="co-field-error" hidden></p>
        </div>`
      )
      .join("");

    const prefill = config.prefill || {};
    config.fields.forEach((f) => {
      const el = $("co-" + f.key);
      if (el && prefill[f.key]) el.value = prefill[f.key];
    });

    config.fields.forEach((f) => {
      const el = $("co-" + f.key);
      if (!el) return;
      el.addEventListener("input", () => {
        clearFieldError(f.key);
        if (f.key === "district" || f.key === "country") {
          clearTimeout(shipTimer);
          shipTimer = setTimeout(loadShipping, 400);
        }
      });
      if (f.key === "district") el.addEventListener("change", loadShipping);
    });
  }

  function getCustomer() {
    const out = {};
    (config ? config.fields : []).forEach((f) => {
      const el = $("co-" + f.key);
      out[f.key] = el ? el.value.trim() : "";
    });
    return out;
  }

  function setFieldError(key, msg) {
    const wrap = document.querySelector(`[data-field="${key}"]`);
    if (!wrap) return;
    wrap.classList.add("has-error");
    const p = wrap.querySelector(".co-field-error");
    if (p) {
      p.textContent = msg;
      p.hidden = false;
    }
  }

  function clearFieldError(key) {
    const wrap = document.querySelector(`[data-field="${key}"]`);
    if (!wrap) return;
    wrap.classList.remove("has-error");
    const p = wrap.querySelector(".co-field-error");
    if (p) p.hidden = true;
  }

  function clearAllFieldErrors() {
    document.querySelectorAll(".co-field.has-error").forEach((w) => w.classList.remove("has-error"));
    document.querySelectorAll(".co-field-error").forEach((p) => (p.hidden = true));
  }

  function showGlobalError(msg) {
    const el = $("checkoutError");
    el.textContent = msg;
    el.hidden = false;
  }

  function clearGlobalError() {
    $("checkoutError").hidden = true;
  }

  /* ------------------------------------------------------------------ *
   * Cart summary
   * ------------------------------------------------------------------ */
  function subtotal() {
    return cart.reduce((sum, it) => sum + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0), 0);
  }

  function itemName(it) {
    const p = it.product;
    return (p && p.name) || "Product";
  }

  function renderCart() {
    const wrap = $("cartItems");
    const count = cart.reduce((n, it) => n + (Number(it.quantity) || 0), 0);
    setText("coCartCount", count + (count === 1 ? " item" : " items"));

    if (!cart.length) {
      wrap.innerHTML = `<p class="co-empty">Cart faka. Age product add korun.</p>`;
      return;
    }

    wrap.innerHTML = cart
      .map((it) => {
        const p = it.product || {};
        const img = it.image || (p.images && p.images[0]) || "";
        const variant = (it.variation && it.variation.name) || (it.swatch && it.swatch.name) || "";
        const line = (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0);
        return `
          <div class="co-cart-item">
            <div class="co-cart-img">${img ? `<img src="${esc(img)}" alt="" />` : "—"}</div>
            <div class="co-cart-info">
              <div class="co-cart-name">${esc(itemName(it))}</div>
              <div class="co-cart-meta">${variant ? esc(variant) + " · " : ""}Qty ${esc(it.quantity)}</div>
            </div>
            <div class="co-cart-price">${money(line)}</div>
          </div>`;
      })
      .join("");
  }

  /* ------------------------------------------------------------------ *
   * Coupon
   * ------------------------------------------------------------------ */
  function couponActive() {
    return !!(coupon && coupon.code && !coupon.error);
  }

  function couponDiscountAmount() {
    if (!couponActive()) return 0;
    return Math.max(0, Number(coupon.discount) || 0);
  }

  function renderCoupon() {
    const applied = $("coCouponApplied");
    const form = $("coCouponForm");
    const msg = $("coCouponMsg");
    if (!applied || !form || !msg) return;

    const active = couponActive();
    applied.hidden = !active;
    form.hidden = active;

    if (active) {
      setText("coCouponCode", coupon.code);
      setText(
        "coCouponLabel",
        coupon.label || (coupon.freeDelivery ? "Free delivery" : "")
      );
    }

    if (coupon && coupon.error) {
      msg.textContent = coupon.error;
      msg.hidden = false;
    } else {
      msg.textContent = "";
      msg.hidden = true;
    }
  }

  async function applyCouponCode(e) {
    e.preventDefault();
    if (couponBusy) return;
    const input = $("coCouponInput");
    const msg = $("coCouponMsg");
    const btn = $("coCouponApply");
    const code = input.value.trim().toUpperCase();
    if (!code) {
      msg.textContent = "Coupon code din";
      msg.hidden = false;
      return;
    }

    couponBusy = true;
    btn.disabled = true;
    btn.textContent = "Applying…";
    try {
      const { res, data } = await api("/api/cart/coupon", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      if (!res.ok) throw new Error(data.message || "Coupon apply hoyni");
      coupon = data.coupon || null;
      input.value = "";
      renderCoupon();
      if (selectedPlanId) await refreshInstallmentPreview();
      updateTotals();
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    } finally {
      couponBusy = false;
      btn.disabled = false;
      btn.textContent = "Apply";
    }
  }

  async function removeCoupon() {
    if (couponBusy) return;
    couponBusy = true;
    try {
      const { res, data } = await api("/api/cart/coupon", { method: "DELETE" });
      if (!res.ok) throw new Error(data.message || "Coupon remove hoyni");
      coupon = null;
      renderCoupon();
      if (selectedPlanId) await refreshInstallmentPreview();
      updateTotals();
    } catch (err) {
      const msg = $("coCouponMsg");
      msg.textContent = err.message;
      msg.hidden = false;
    } finally {
      couponBusy = false;
    }
  }

  /* ------------------------------------------------------------------ *
   * Shipping quote (district theke auto area price)
   * ------------------------------------------------------------------ */
  function renderShipping() {
    const wrap = $("shippingOptions");
    if (!shippingOptions.length) {
      wrap.innerHTML = `<p class="co-empty">Kono shipping option nei — free shipping.</p>`;
      selectedShipping = "";
      return;
    }

    wrap.innerHTML = shippingOptions
      .map(
        (o) => `
        <label class="co-option ${selectedShipping === o.label ? "selected" : ""}" data-ship-label="${esc(o.label)}">
          <input type="radio" name="shipping" value="${esc(o.label)}" ${selectedShipping === o.label ? "checked" : ""} />
          <span class="co-opt-main"><strong>${esc(o.label)}</strong></span>
          <span class="co-opt-price">${money(o.amount)}</span>
        </label>`
      )
      .join("");

    wrap.querySelectorAll('input[name="shipping"]').forEach((inp) => {
      inp.addEventListener("change", () => {
        selectedShipping = inp.value;
        wrap.querySelectorAll(".co-option").forEach((el) => {
          el.classList.toggle("selected", el.dataset.shipLabel === selectedShipping);
        });
        updateTotals();
      });
    });
  }

  async function loadShipping() {
    if (!config) return;
    if (wholesaleConfig && wholesaleConfig.enabled) return loadWholesaleShipping();
    const c = getCustomer();
    const { res, data } = await api("/api/settings/shipping-quote", {
      method: "POST",
      body: JSON.stringify({
        district: c.district || "",
        country: c.country || "",
        orderTotal: Math.max(0, subtotal() - couponDiscountAmount()),
      }),
    });
    shippingOptions = res.ok ? data.options || [] : [];

    // Area shipping on + district deya thakle automatically select
    const area = shippingOptions.find((o) => o.type === "area");
    if (config.shipping.enabled.area && area && c.district) {
      selectedShipping = area.label;
    } else if (!shippingOptions.some((o) => o.label === selectedShipping)) {
      selectedShipping = shippingOptions.length ? shippingOptions[0].label : "";
    }

    renderShipping();
    updateTotals();
  }

  /* ------------------------------------------------------------------ *
   * Wholesale shipping — category + vehicle + delivery speed
   * ------------------------------------------------------------------ */
  function fromPaisaValue(paisa) {
    return (Number(paisa) || 0) / 100;
  }

  function selectedWholesaleOption() {
    if (!wholesaleQuote) return null;
    return (wholesaleQuote.options || []).find(
      (opt) => String(opt.speedId) === String(selectedSpeedId)
    ) || null;
  }

  function wholesaleNote() {
    if (!wholesaleQuote) return "";
    const option = selectedWholesaleOption();
    const extra = option ? Number(option.extraPaisa) || 0 : 0;
    const total = option ? Number(option.totalPaisa) || 0 : Number(wholesaleQuote.totalPaisa) || 0;
    const bits = ["Weight " + wholesaleQuote.weightKg + " kg"];
    if (wholesaleQuote.categoryPaisa) {
      bits.push("Category " + money(fromPaisaValue(wholesaleQuote.categoryPaisa)));
    }
    if (wholesaleQuote.vehiclePaisa) {
      bits.push(
        "Vehicle " +
          money(fromPaisaValue(wholesaleQuote.vehiclePaisa)) +
          " (" +
          wholesaleQuote.vehicleCount +
          " vehicle" +
          (wholesaleQuote.vehicleCount === 1 ? "" : "s") +
          ")"
      );
    }
    if (extra) bits.push("Speed " + money(fromPaisaValue(extra)));
    bits.push("Shipping " + money(fromPaisaValue(total)));
    return bits.join(" · ");
  }

  function renderWholesaleShipping() {
    const wrap = $("shippingOptions");
    const opts = wholesaleQuote && wholesaleQuote.options ? wholesaleQuote.options : [];
    if (!opts.length) {
      wrap.innerHTML = `<p class="co-empty">Kono wholesale shipping option nei — free shipping.</p>`;
      return;
    }

    wrap.innerHTML = opts
      .map(
        (opt) => `
        <label class="co-option ${String(selectedSpeedId) === String(opt.speedId) ? "selected" : ""}" data-ship-id="${esc(opt.speedId)}">
          <input type="radio" name="shipping" value="${esc(opt.speedId)}" ${String(selectedSpeedId) === String(opt.speedId) ? "checked" : ""} />
          <span class="co-opt-main">
            <strong>${esc(opt.name)}</strong>
            ${opt.etaDays ? `<small>${esc(opt.etaDays)} days</small>` : ""}
          </span>
          <span class="co-opt-price">${money(fromPaisaValue(opt.totalPaisa))}</span>
        </label>`
      )
      .join("");

    wrap.querySelectorAll('input[name="shipping"]').forEach((inp) => {
      inp.addEventListener("change", () => {
        selectedSpeedId = inp.value;
        wrap.querySelectorAll(".co-option").forEach((el) => {
          el.classList.toggle("selected", el.dataset.shipId === selectedSpeedId);
        });
        $("shippingNote").textContent = wholesaleNote();
        updateTotals();
        if (selectedPlanId) refreshInstallmentPreview();
      });
    });
  }

  async function loadWholesaleShipping() {
    selectedShipping = "";
    shippingOptions = [];
    if (!cart.length) {
      wholesaleQuote = null;
      renderWholesaleShipping();
      $("shippingNote").textContent = "";
      updateTotals();
      return;
    }

    const { res, data } = await api("/api/cart/shipping-quote");
    if (!res.ok) {
      wholesaleQuote = null;
      $("shippingOptions").innerHTML = `<p class="co-empty">${esc(
        data.message || "Shipping quote load hoyni"
      )}</p>`;
      $("shippingNote").textContent = "";
      updateTotals();
      return;
    }

    wholesaleQuote = data;
    const opts = wholesaleQuote.options || [];
    if (!opts.some((opt) => String(opt.speedId) === String(selectedSpeedId))) {
      selectedSpeedId = opts.length ? opts[0].speedId : "";
    }
    renderWholesaleShipping();
    $("shippingNote").textContent = wholesaleNote();
    updateTotals();
    if (selectedPlanId) refreshInstallmentPreview();
  }

  function updateTotals() {
    const sub = subtotal();
    const hasItems = cart.length > 0;
    const wholesaleOn = !!(wholesaleConfig && wholesaleConfig.enabled);
    const discount = couponDiscountAmount();
    const freeDelivery = couponActive() && coupon.freeDelivery === true;
    let ship = 0;

    if (wholesaleOn) {
      const opt = selectedWholesaleOption();
      const paisa = opt
        ? Number(opt.totalPaisa) || 0
        : wholesaleQuote
        ? Number(wholesaleQuote.totalPaisa) || 0
        : 0;
      ship = fromPaisaValue(paisa);
    } else {
      const opt = shippingOptions.find((o) => o.label === selectedShipping);
      ship = hasItems && opt ? Number(opt.amount) || 0 : 0;
    }
    if (freeDelivery) ship = 0;

    setText("coSubtotal", money(sub));

    const couponRow = $("coCouponRow");
    if (couponRow) {
      const showRow = couponActive() && (discount > 0 || freeDelivery);
      couponRow.hidden = !showRow;
      if (showRow) {
        setText("coCouponRowLabel", "Coupon " + coupon.code);
        setText("coCouponDiscount", discount > 0 ? "−" + money(discount) : "Free delivery");
      }
    }

    setText(
      "coShipping",
      hasItems && (wholesaleOn || selectedShipping) ? money(ship) : "—"
    );
    if (installmentSelected()) {
      const first = fromPaisaValue(installmentPreview.firstPaisa);
      const total = fromPaisaValue(installmentPreview.totalPaisa);
      setText("coPayNow", money(first));
      setText("coDueLater", money(Math.max(0, total - first)));
      $("coPayNowRow").hidden = false;
      $("coDueLaterRow").hidden = false;
      setText("coTotal", money(total));
    } else {
      $("coPayNowRow").hidden = true;
      $("coDueLaterRow").hidden = true;
      setText("coTotal", money(Math.max(0, sub - discount) + ship));
    }

    const placeBtn = $("placeOrderBtn");
    if (placeBtn && placeBtn.textContent !== "Placing order…") {
      placeBtn.textContent = installmentSelected() ? "Place installment order" : "Place order";
    }
  }

  function installmentSelected() {
    return !!(selectedPlanId && installmentPreview);
  }

  function planAdvanceLabel(plan) {
    if (plan.advanceType === "percent") {
      return (Number(plan.advanceValue) / 100).toLocaleString("en-US") + "% advance";
    }
    return money(fromPaisaValue(plan.advanceValue)) + " advance";
  }

  async function loadInstallmentConfig() {
    selectedPlanId = "";
    installmentPreview = null;
    installmentConfig = null;
    $("installmentSection").hidden = true;
    const { res, data } = await api("/api/installments/plans");
    if (!res.ok || !data || !data.enabled) return;
    installmentConfig = data;
    renderInstallmentOptions();
  }

  function renderInstallmentOptions() {
    const section = $("installmentSection");
    const wrap = $("installmentOptions");
    const note = $("installmentNote");
    section.hidden = false;

    const plans = (installmentConfig && installmentConfig.plans) || [];
    const eligible = !!(installmentConfig && installmentConfig.eligible);
    const itemsPaisa = Number((installmentConfig && installmentConfig.itemsAmountPaisa) || 0);

    let html = `
      <label class="co-option selected" data-plan-id="">
        <input type="radio" name="installmentPlan" value="" checked />
        <span class="co-opt-main">
          <strong>Pay full amount</strong>
          <small>No installment schedule</small>
        </span>
      </label>`;

    plans.forEach((plan) => {
      const minPaisa = Number(plan.minOrderAmountPaisa) || 0;
      const belowMin = itemsPaisa < minPaisa;
      const disabled = !eligible || belowMin;
      const bits = [plan.installmentsCount + " installments", planAdvanceLabel(plan)];
      if (plan.gapDays) bits.push("every " + plan.gapDays + " days");
      if (belowMin) bits.push("Min order " + money(fromPaisaValue(minPaisa)));
      if (plan.feeType !== "none" && Number(plan.feeValue) > 0) {
        bits.push(
          plan.feeType === "percent"
            ? "Fee " + (Number(plan.feeValue) / 100).toLocaleString("en-US") + "%"
            : "Fee " + money(fromPaisaValue(plan.feeValue))
        );
      }
      html += `
        <label class="co-option ${disabled ? "disabled" : ""}" data-plan-id="${esc(plan.id)}">
          <input type="radio" name="installmentPlan" value="${esc(plan.id)}" ${disabled ? "disabled" : ""} />
          <span class="co-opt-main">
            <strong>${esc(plan.name)}</strong>
            <small>${esc(bits.join(" · "))}</small>
          </span>
        </label>`;
    });

    wrap.innerHTML = html;
    if (eligible) {
      note.textContent = "First installment ekhon pay korben — baki gulo schedule onujayi.";
    } else {
      const accountHref =
        "/account.html" + (storeSlug ? "?store=" + encodeURIComponent(storeSlug) : "");
      note.innerHTML =
        esc((installmentConfig && installmentConfig.reason) || "") +
        ' <a class="co-link" href="' +
        esc(accountHref) +
        '">My account</a>';
    }

    wrap.querySelectorAll('input[name="installmentPlan"]').forEach((inp) => {
      inp.addEventListener("change", () => {
        selectedPlanId = inp.value;
        wrap.querySelectorAll(".co-option").forEach((el) => {
          el.classList.toggle("selected", (el.dataset.planId || "") === selectedPlanId);
        });
        clearGlobalError();
        renderPayments();
        refreshInstallmentPreview();
        updateTotals();
      });
    });
  }

  async function refreshInstallmentPreview() {
    if (!selectedPlanId) {
      installmentPreview = null;
      renderInstallmentPreview();
      updateTotals();
      return;
    }
    const box = $("installmentPreview");
    box.hidden = false;
    box.innerHTML = `<p class="co-empty">Schedule load hocche…</p>`;
    const { res, data } = await api("/api/installments/preview", {
      method: "POST",
      body: JSON.stringify({ planId: selectedPlanId, speedId: selectedSpeedId || "" }),
    });
    if (!res.ok) {
      installmentPreview = null;
      box.innerHTML = `<p class="co-error">${esc(data.message || "Schedule load hoyni")}</p>`;
      updateTotals();
      return;
    }
    installmentPreview = data;
    renderInstallmentPreview();
    updateTotals();
  }

  function renderInstallmentPreview() {
    const box = $("installmentPreview");
    if (!selectedPlanId || !installmentPreview) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    const rows = installmentPreview.schedule || [];
    box.hidden = false;
    box.innerHTML = `
      <div class="co-plan-head">
        <strong>${esc(installmentPreview.plan.name)}</strong>
        <span>${installmentPreview.plan.installmentsCount} installments</span>
      </div>
      <table class="co-schedule-table">
        <thead><tr><th>#</th><th>Due date</th><th>Amount</th><th></th></tr></thead>
        <tbody>
          ${rows
            .map(
              (row) => `
            <tr>
              <td>${row.number}</td>
              <td>${new Date(row.dueDate).toLocaleDateString("en-GB")}</td>
              <td>${money(fromPaisaValue(row.amountPaisa))}</td>
              <td>${row.number === 1 ? '<span class="co-pill">Pay now</span>' : ""}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
      <p class="co-muted co-plan-note">
        Pay now ${money(fromPaisaValue(installmentPreview.firstPaisa))} ·
        Due later ${money(fromPaisaValue(installmentPreview.remainingPaisa))}
        ${installmentPreview.feePaisa > 0 ? " · Fee included" : ""}
      </p>`;
  }

  /* ------------------------------------------------------------------ *
   * Payment options
   * ------------------------------------------------------------------ */
  function needsSender() {
    if (selectedPlanId) {
      return !!(
        selectedPayment &&
        (selectedPayment.startsWith("mobile:") || selectedPayment.startsWith("bank:"))
      );
    }
    return !!(config && config.payments && config.payments.askSender && selectedPayment.startsWith("mobile:"));
  }

  function toggleSender() {
    const show = needsSender();
    $("senderFields").hidden = !show;
    $("senderNumber").required = show;
    $("transactionId").required = show;
  }

  function renderPayments() {
    const wrap = $("paymentOptions");
    const pay = config.payments || {};
    const opts = [];
    const manualOnly = !!selectedPlanId;

    if (pay.cod && pay.cod.enabled && !manualOnly) {
      opts.push({ method: "cod", title: "Cash on delivery", sub: pay.cod.instruction || "" });
    }
    (pay.mobileManual || []).forEach((r) => {
      const meta = [r.accountType, r.number].filter(Boolean).join(" · ");
      opts.push({
        method: "mobile:" + r.name,
        title: "Mobile banking — " + r.name,
        sub: [meta, r.instruction].filter(Boolean).join(" — "),
      });
    });
    (pay.bankManual || []).forEach((r) => {
      const meta = [r.accountName, r.accountNumber, r.branch].filter(Boolean).join(" · ");
      opts.push({
        method: "bank:" + r.name,
        title: "Bank transfer — " + r.name,
        sub: [meta, r.instruction].filter(Boolean).join(" — "),
      });
    });
    (pay.apiGateways || []).forEach((g) => {
      if (manualOnly) return;
      opts.push({
        method: "gateway:" + g.name,
        title: g.name + " (" + g.mode + ")",
        sub: "Pay online",
      });
    });

    if (!opts.length) {
      wrap.innerHTML = `<p class="co-empty">${
        manualOnly
          ? "Installment er jonno manual mobile/bank payment enable korun."
          : "Kono payment method enable nei."
      }</p>`;
      selectedPayment = "";
      toggleSender();
      return;
    }

    if (!selectedPayment || !opts.some((o) => o.method === selectedPayment)) {
      selectedPayment = opts[0].method;
    }

    wrap.innerHTML = opts
      .map(
        (o) => `
        <label class="co-option ${selectedPayment === o.method ? "selected" : ""}" data-pay-method="${esc(o.method)}">
          <input type="radio" name="payment" value="${esc(o.method)}" ${selectedPayment === o.method ? "checked" : ""} />
          <span class="co-opt-main">
            <strong>${esc(o.title)}</strong>
            ${o.sub ? `<small>${esc(o.sub)}</small>` : ""}
          </span>
        </label>`
      )
      .join("");

    wrap.querySelectorAll('input[name="payment"]').forEach((inp) => {
      inp.addEventListener("change", () => {
        selectedPayment = inp.value;
        wrap.querySelectorAll(".co-option").forEach((el) => {
          el.classList.toggle("selected", el.dataset.payMethod === selectedPayment);
        });
        clearGlobalError();
        toggleSender();
      });
    });

    toggleSender();
  }

  /* ------------------------------------------------------------------ *
   * Validation + submit
   * ------------------------------------------------------------------ */
  function validateCheckout() {
    clearAllFieldErrors();
    clearGlobalError();
    let ok = true;

    const c = getCustomer();
    (config ? config.fields : []).forEach((f) => {
      const v = c[f.key] || "";
      if (f.required && !v) {
        setFieldError(f.key, f.label + " lagbe");
        ok = false;
      } else if (f.key === "phone" && v && !BD_PHONE_RE.test(v)) {
        setFieldError(f.key, "Phone number 01XXXXXXXXX format e din");
        ok = false;
      } else if (f.key === "email" && v && !EMAIL_RE.test(v)) {
        setFieldError(f.key, "Email valid na");
        ok = false;
      }
    });

    if (needsSender()) {
      const sn = $("senderNumber").value.trim();
      const tx = $("transactionId").value.trim();
      const snErr = $("senderNumberError");
      const txErr = $("transactionIdError");
      if (!BD_PHONE_RE.test(sn)) {
        snErr.textContent = "Sender number 01XXXXXXXXX format e din";
        snErr.hidden = false;
        ok = false;
      }
      if (!tx) {
        txErr.textContent = "Transaction ID lagbe";
        txErr.hidden = false;
        ok = false;
      }
    }

    if (selectedPlanId) {
      if (!token) {
        showGlobalError("Installment order dite age login korun");
        ok = false;
      }
      if (!installmentConfig || !installmentConfig.eligible) {
        showGlobalError(
          (installmentConfig && installmentConfig.reason) || "Installment eligible nei"
        );
        ok = false;
      }
      if (!installmentPreview) {
        showGlobalError("Installment schedule load hoyni — abar try korun");
        ok = false;
      }
      const phone = c.phone || (user && user.phone) || "";
      if (!BD_PHONE_RE.test(phone)) {
        if (c.phone !== undefined) {
          setFieldError("phone", "Installment er jonno valid phone number lagbe");
        } else {
          showGlobalError("Account e valid phone number add korun");
        }
        ok = false;
      }
      if (!/^(mobile|bank):/.test(selectedPayment)) {
        showGlobalError("Installment er first payment manual mobile/bank diye din");
        ok = false;
      }
    }

    if (!selectedPayment) {
      showGlobalError("Payment method select korun");
      ok = false;
    }
    if (!cart.length) {
      showGlobalError("Cart faka — age product add korun");
      ok = false;
    }
    return ok;
  }

  function showSuccess(order) {
    $("checkoutWrap").hidden = true;
    $("authGate").hidden = true;
    $("coFatal").hidden = true;
    $("coSuccess").hidden = false;
    setText("successOrder", order.orderNumber || "—");
    const bits = [
      "Total " + money(order.totalAmount),
      "Payment: " + (order.paymentLabel || "—"),
    ];
    if (order.shippingLabel) bits.push("Shipping: " + order.shippingLabel);
    if (order.paymentMode === "installment" && order.installmentPlan) {
      const plan = order.installmentPlan;
      bits.push(
        "Plan: " +
          (plan.name || "Installment") +
          " · " +
          plan.installmentsCount +
          " installments"
      );
      if (plan.firstPaisa != null) bits.push("Pay now " + money(fromPaisaValue(plan.firstPaisa)));
      const link = $("successAccount");
      if (link) link.hidden = false;
    }
    setText("successMeta", bits.join(" · "));
    cart = [];
    guestItems = [];
    coupon = null;
    renderCart();
    renderCoupon();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("coCouponForm").addEventListener("submit", applyCouponCode);
  $("coCouponRemove").addEventListener("click", removeCoupon);

  $("checkoutForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateCheckout()) return;

    const btn = $("placeOrderBtn");
    btn.disabled = true;
    btn.textContent = "Placing order…";

    const customer = getCustomer();
    const payment = { method: selectedPayment };
    if (needsSender()) {
      payment.senderNumber = $("senderNumber").value.trim();
      payment.transactionId = $("transactionId").value.trim();
    }

    const body = {
      customer,
      payment,
      meta: { source: detectSource(), device: detectDevice() },
    };
    if (selectedPlanId) {
      body.paymentMode = "installment";
      body.planId = selectedPlanId;
    }
    if (wholesaleConfig && wholesaleConfig.enabled) {
      body.shipping = { speedId: selectedSpeedId || "" };
    } else if (selectedShipping) {
      body.shipping = {
        label: selectedShipping,
        context: { district: customer.district || "", country: customer.country || "" },
      };
    }

    try {
      const { res, data } = await api("/api/cart/checkout", {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        if (res.status === 401 && config.login.enabled) {
          token = "";
          user = null;
          localStorage.removeItem(TOKEN_KEY);
          await boot();
          return;
        }
        showGlobalError(data.message || "Order dite parlam na");
        return;
      }

      showSuccess(data.order || {});
    } catch (ex) {
      showGlobalError(ex.message);
    } finally {
      btn.disabled = false;
      btn.textContent = installmentSelected() ? "Place installment order" : "Place order";
    }
  });

  $("successAgain").addEventListener("click", () => location.reload());

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  async function boot() {
    if (booting) return;
    if (!storeSlug) {
      $("coLoading").hidden = true;
      $("checkoutWrap").hidden = true;
      $("authGate").hidden = true;
      $("storeGate").hidden = false;
      return;
    }

    booting = true;
    localStorage.setItem(STORE_KEY, storeSlug);

    $("storeGate").hidden = true;
    $("coFatal").hidden = true;
    $("coSuccess").hidden = true;
    $("authGate").hidden = true;
    $("checkoutWrap").hidden = true;
    $("coLoading").hidden = false;
    $("placeOrderBtn").disabled = true;

    try {
      const { res, data } = await api("/api/settings/checkout");
      if (!res.ok) {
        showFatal(data.message || "Checkout load hoyni");
        return;
      }
      config = data;
      applySite();
      fillDatalists();

      // token valid kina
      if (token) {
        const me = await api("/api/auth/me");
        if (me.res.ok) {
          user = me.data;
        } else {
          token = "";
          user = null;
          localStorage.removeItem(TOKEN_KEY);
        }
      }
      renderUser();

      const cartRes = await api("/api/cart");
      cart = cartRes.res.ok ? cartRes.data.items || [] : [];
      wholesaleConfig = cartRes.res.ok ? cartRes.data.wholesale || null : null;
      coupon = cartRes.res.ok ? cartRes.data.coupon || null : null;
      renderCart();
      renderCoupon();
      await loadInstallmentConfig();

      // Login required hole age auth gate
      if (config.login.enabled && !token) {
        guestItems = cart.slice();
        showAuthGate();
        return;
      }

      $("coLoading").hidden = true;
      $("checkoutWrap").hidden = false;
      renderFields();
      renderPayments();
      await loadShipping();
      updateTotals();
      $("placeOrderBtn").disabled = cart.length === 0;
    } catch (ex) {
      showFatal(ex.message || "Kichhu ekta bhul hoyeche");
    } finally {
      booting = false;
    }
  }

  $("storeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("storeSlug").value.trim();
    if (!v) return;
    storeSlug = v;
    localStorage.setItem(STORE_KEY, v);
    const url = new URL(location.href);
    url.searchParams.set("store", v);
    history.replaceState(null, "", url);
    boot();
  });

  boot();
})();
