/* ==========================================================================
   Storefront product page
   - /api/storefront/:slug/products/:key theke product + tiers
   - Wholesale mode e tier price, MOQ, tier table
   - Add to cart (customer token ba guest session)
   ========================================================================== */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = "luxe_customer_token";
  const SESSION_KEY = "luxe_cart_session";
  const STORE_KEY = "luxe_store_slug";

  const TAKA_FORMAT = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  const params = new URLSearchParams(location.search);
  let storeSlug = String(params.get("store") || localStorage.getItem(STORE_KEY) || "").trim();
  const productKey = String(params.get("product") || params.get("id") || "").trim();
  let token = localStorage.getItem(TOKEN_KEY) || "";

  let page = null;
  let variation = null;
  let quantity = 1;
  let adding = false;
  let resetTimer = null;
  let flashTimer = null;

  const pad2 = (n) => String(n).padStart(2, "0");

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function withStore(path) {
    return path + (path.includes("?") ? "&" : "?") + "store=" + encodeURIComponent(storeSlug);
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
    const res = await fetch(withStore(path), { ...opts, headers: headers(opts.headers) });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function money(taka) {
    return "৳" + TAKA_FORMAT.format(Math.max(0, Number(taka) || 0));
  }

  function moneyPaisa(paisa) {
    return money((Number(paisa) || 0) / 100);
  }

  function checkoutUrl() {
    return "/checkout.html?store=" + encodeURIComponent(storeSlug);
  }

  function error(message) {
    const el = $("pdError");
    el.textContent = message;
    el.hidden = !message;
  }

  function sanitizeHtml(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = String(html || "");
    tpl.content
      .querySelectorAll("script,style,iframe,object,embed,link,meta,form,input,button,textarea,select")
      .forEach((node) => node.remove());
    tpl.content.querySelectorAll("*").forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = String(attr.value || "").trim().toLowerCase();
        const dangerousUrl =
          (name === "href" || name === "src" || name === "xlink:href") &&
          (value.startsWith("javascript:") || value.startsWith("data:text/html"));
        if (name.startsWith("on") || name === "srcdoc" || dangerousUrl) {
          el.removeAttribute(attr.name);
        }
      });
    });
    return tpl.innerHTML;
  }

  /* ------------------------------------------------------------------ *
   * Pricing
   * ------------------------------------------------------------------ */
  function wholesale() {
    return (page && page.wholesale) || { enabled: false };
  }

  function wholesaleOn() {
    return wholesale().enabled === true;
  }

  function selectedTiers() {
    const wh = wholesale();
    if (!wh.enabled) return [];
    if (variation) {
      const own = (wh.variationTiers || []).find(
        (row) => String(row.variation) === String(variation.id)
      );
      if (own && Array.isArray(own.tiers) && own.tiers.length) return own.tiers;
    }
    return Array.isArray(wh.tiers) ? wh.tiers : [];
  }

  function minimumQty() {
    if (!wholesaleOn()) return 1;
    const moq = Math.max(1, Math.round(Number(wholesale().moq) || 1));
    const tiers = selectedTiers();
    const first = tiers.length ? Math.max(1, Number(tiers[0].minQty) || 1) : 1;
    return Math.max(moq, first);
  }

  function baseRetailPrice() {
    if (!page) return 0;
    if (variation) {
      return Number(variation.salePrice) || Number(variation.regularPrice) || 0;
    }
    const p = page.product;
    return Number(p.salePrice) || Number(p.regularPrice) || Number(p.price) || 0;
  }

  function stockCount() {
    if (!page) return 0;
    if (variation) return Math.max(0, Number(variation.stock) || 0);
    return Math.max(0, Number(page.product.stock) || 0);
  }

  function resolveTier(tiers, qty) {
    for (const tier of tiers || []) {
      if (qty < tier.minQty) continue;
      if (tier.maxQty === null || tier.maxQty === undefined || qty <= tier.maxQty) return tier;
    }
    return null;
  }

  function flashInfo() {
    const f = page && page.flashSale;
    if (!f || f.status !== "live") return null;
    const percent = Number(f.discountPercent) || 0;
    if (percent <= 0) return null;
    if (new Date(f.endAt).getTime() <= Date.now()) return null;
    const retail = baseRetailPrice();
    const basePaisa = Math.round(retail * 100);
    const discountPaisa = Math.round((basePaisa * percent) / 100);
    return { ...f, percent, retail, price: (basePaisa - discountPaisa) / 100 };
  }

  function pricing() {
    const retail = baseRetailPrice();
    const tiers = selectedTiers();
    const tier = wholesaleOn() ? resolveTier(tiers, Math.max(quantity, minimumQty())) : null;
    const tierUnit = tier ? (Number(tier.pricePaisa) || 0) / 100 : null;
    const flash = flashInfo();

    let unit = retail;
    let mode = "retail";
    if (tierUnit !== null && tierUnit <= unit) {
      unit = tierUnit;
      mode = "tier";
    }
    if (flash && flash.price < unit - 0.0001) {
      unit = flash.price;
      mode = "flash";
    }

    const showRetail =
      retail > unit &&
      (mode === "flash" ? true : mode === "tier" ? wholesale().showRetailPrice === true : false);

    return {
      retail,
      unit,
      tier,
      tiers,
      flash,
      mode,
      showRetail,
      saving: Math.max(0, retail - unit),
    };
  }

  function clampQty(value) {
    const min = minimumQty();
    const stock = stockCount();
    const max = stock > 0 ? stock : min;
    const qty = Math.round(Number(value) || min);
    return Math.min(Math.max(qty, min), Math.max(min, max));
  }

  /* ------------------------------------------------------------------ *
   * Render
   * ------------------------------------------------------------------ */
  function renderChrome() {
    const storeName = (page.store && page.store.name) || storeSlug;
    const title = page.product.title || page.product.name || "Product";
    document.title = title + " — " + storeName;
    $("pdStoreName").textContent = storeName;
    $("pdFooterStore").textContent = storeName;
    $("pdBrandLink").href = checkoutUrl();
    $("pdCartLink").href = checkoutUrl();
    $("pdFooterCheckout").href = checkoutUrl();
  }

  function renderWholesaleBadges() {
    const on = wholesaleOn();
    const label = wholesale().badgeText || "Wholesale";
    const badges = [$("pdHeaderBadge"), $("pdBadge"), $("pdWholesaleBadge")];
    badges.forEach((el) => {
      if (!el) return;
      el.textContent = label;
      el.hidden = !on;
    });
    $("pdWholesaleBox").hidden = !on;
  }

  function renderVariations() {
    const list = Array.isArray(page.variations) ? page.variations : [];
    const wrap = $("pdVariationWrap");
    const select = $("pdVariation");

    if (!list.length) {
      wrap.hidden = true;
      variation = null;
      return;
    }

    wrap.hidden = false;
    select.innerHTML = list
      .map((v) => `<option value="${v.id}">${escapeHtml(v.termName || "Variation")}</option>`)
      .join("");

    if (!variation || !list.some((v) => String(v.id) === String(variation.id))) {
      variation = list[0];
    }
    select.value = variation.id;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function renderProduct() {
    const p = page.product;
    $("pdTitle").textContent = p.title || p.name || "Product";
    $("pdSku").textContent = p.sku ? "SKU · " + p.sku : p.slug ? "SKU · " + p.slug : "";
    $("pdShort").textContent = p.shortDescription || "";

    const desc = $("pdDesc");
    desc.innerHTML = sanitizeHtml(p.description || "");

    renderImage();
    renderWholesaleBadges();
    renderVariations();
    quantity = minimumQty();
    updateBuy(true);
  }

  function renderImage() {
    const p = page.product;
    const src = (variation && variation.image) || (p.images && p.images[0]) || "";
    const img = $("pdImage");
    const empty = $("pdImageEmpty");

    if (!src) {
      img.hidden = true;
      img.removeAttribute("src");
      empty.hidden = false;
      return;
    }

    empty.hidden = true;
    img.hidden = false;
    img.alt = p.title || p.name || "Product image";
    img.onerror = () => {
      img.hidden = true;
      empty.hidden = false;
    };
    img.src = src;
  }

  function renderTiers() {
    const tiers = selectedTiers();
    const tbody = $("pdTierRows");
    const wrap = tbody.closest(".pd-tier-wrap");

    if (!wholesaleOn() || !tiers.length) {
      tbody.innerHTML = "";
      if (wrap) wrap.hidden = true;
      return;
    }

    if (wrap) wrap.hidden = false;
    tbody.innerHTML = tiers
      .map(
        (t) =>
          `<tr data-min="${t.minQty}"${
            t.maxQty === null || t.maxQty === undefined ? "" : ` data-max="${t.maxQty}"`
          }><td>${t.minQty}</td><td>${
            t.maxQty === null || t.maxQty === undefined ? "∞" : t.maxQty
          }</td><td>${moneyPaisa(t.pricePaisa)}</td></tr>`
      )
      .join("");
  }

  function highlightTier(tier) {
    [...$("pdTierRows").children].forEach((row) => {
      const active = !!tier && Number(row.dataset.min) === Number(tier.minQty);
      row.classList.toggle("is-active", active);
    });
  }

  function renderMoq() {
    if (!wholesaleOn()) {
      $("pdMoq").textContent = "";
      return;
    }
    const parts = ["Minimum " + minimumQty() + " pcs"];
    if (wholesale().buyers === "approved") parts.push("Approved buyers only");
    $("pdMoq").textContent = parts.join(" · ");
  }

  function syncAddState() {
    const stock = stockCount();
    const parsed = parseInt($("pdQty").value, 10);
    const valid =
      Number.isFinite(parsed) &&
      parsed >= minimumQty() &&
      (stock <= 0 || parsed <= stock) &&
      parsed === Math.round(parsed);

    $("pdAdd").disabled = adding || stock <= 0 || !valid;
    $("pdMinus").disabled = adding || quantity <= minimumQty();
    $("pdPlus").disabled = adding || (stock > 0 && quantity >= stock) || stock <= 0;

    if (stock <= 0) {
      $("pdBuyNote").textContent = "Out of stock";
    } else if (minimumQty() > stock) {
      $("pdBuyNote").textContent = `MOQ ${minimumQty()} pcs — stock e sudhu ${stock} pcs ache`;
    } else if (wholesaleOn()) {
      $("pdBuyNote").textContent =
        `Wholesale price active · ${stock} pcs in stock` +
        (wholesale().buyers === "approved" && !token ? " · login with an approved account" : "");
    } else if (flashInfo()) {
      $("pdBuyNote").textContent = `Flash sale price · ${stock} pcs in stock`;
    } else {
      $("pdBuyNote").textContent = stock + " pcs in stock";
    }
  }

  function stopFlashTimer() {
    if (flashTimer) {
      clearInterval(flashTimer);
      flashTimer = null;
    }
  }

  function startFlashTimer(endAt) {
    stopFlashTimer();
    const tick = () => {
      const ms = new Date(endAt).getTime() - Date.now();
      if (!Number.isFinite(ms) || ms <= 0) {
        stopFlashTimer();
        if (page && page.flashSale) page.flashSale.status = "ended";
        updateBuy(false);
        return;
      }
      const total = Math.floor(ms / 1000);
      const days = Math.floor(total / 86400);
      const hours = Math.floor((total % 86400) / 3600);
      const mins = Math.floor((total % 3600) / 60);
      const secs = total % 60;
      $("pdFlashTimer").textContent =
        (days ? days + "d " : "") + `${pad2(hours)}:${pad2(mins)}:${pad2(secs)} left`;
    };
    tick();
    flashTimer = setInterval(tick, 1000);
  }

  function renderFlash() {
    const box = $("pdFlash");
    if (!box) return;
    const flash = flashInfo();
    if (!flash) {
      box.hidden = true;
      stopFlashTimer();
      return;
    }
    box.hidden = false;
    $("pdFlashTitle").textContent = `${flash.title || "Flash sale"} — ${flash.percent}% OFF`;
    startFlashTimer(flash.endAt);
  }

  function updateBuy(writeInput) {
    const price = pricing();
    $("pdPrice").textContent = money(price.unit);
    renderFlash();

    const retailEl = $("pdRetail");
    const saveEl = $("pdSave");
    if (price.showRetail) {
      retailEl.hidden = false;
      retailEl.textContent = money(price.retail);
      if (price.saving > 0) {
        saveEl.hidden = false;
        saveEl.textContent = "Save " + money(price.saving) + " / unit";
      } else {
        saveEl.hidden = true;
      }
    } else {
      retailEl.hidden = true;
      saveEl.hidden = true;
    }

    const qtyForTotal = Math.max(quantity, minimumQty());
    $("pdTotal").textContent = money(price.unit * qtyForTotal);

    renderTiers();
    renderMoq();
    highlightTier(price.tier);

    if (writeInput) {
      $("pdQty").min = String(minimumQty());
      $("pdQty").max = String(Math.max(stockCount(), minimumQty()));
      $("pdQty").value = String(quantity);
    }
    syncAddState();
  }

  /* ------------------------------------------------------------------ *
   * Actions
   * ------------------------------------------------------------------ */
  function selectVariation(id) {
    const list = page.variations || [];
    const next = list.find((v) => String(v.id) === String(id));
    if (!next) return;
    variation = next;
    quantity = minimumQty();
    renderImage();
    updateBuy(true);
    error("");
  }

  function changeQty(delta) {
    quantity = clampQty(quantity + delta);
    updateBuy(true);
    error("");
  }

  function onQtyInput() {
    const parsed = parseInt($("pdQty").value, 10);
    quantity = clampQty(Number.isFinite(parsed) ? parsed : minimumQty());
    updateBuy(false);
    error(
      Number.isFinite(parsed) && parsed < minimumQty()
        ? `Minimum order quantity ${minimumQty()} piece`
        : ""
    );
  }

  function onQtyCommit() {
    const parsed = parseInt($("pdQty").value, 10);
    quantity = clampQty(Number.isFinite(parsed) ? parsed : minimumQty());
    updateBuy(true);
    error("");
  }

  async function loadCartCount() {
    try {
      const { res, data } = await api("/api/cart");
      if (!res.ok) return;
      const count = (data.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
      $("pdCartCount").textContent = String(count);
    } catch {
      /* cart count fail hoile page block hobe na */
    }
  }

  async function addToCart() {
    if (!page || adding) return;
    error("");

    const parsed = parseInt($("pdQty").value, 10);
    const qty = clampQty(Number.isFinite(parsed) ? parsed : minimumQty());
    quantity = qty;
    updateBuy(true);

    if (qty < minimumQty()) {
      error(`Minimum order quantity ${minimumQty()} piece`);
      return;
    }

    adding = true;
    const btn = $("pdAdd");
    btn.disabled = true;
    btn.textContent = "Adding…";

    try {
      const { res, data } = await api("/api/cart/items", {
        method: "POST",
        body: JSON.stringify({
          productId: page.product._id,
          variationId: variation ? variation.id : null,
          quantity: qty,
        }),
      });

      if (!res.ok) throw new Error(data.message || "Cart e add korte parlam na");

      await loadCartCount();
      btn.textContent = "Added to cart ✓";
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        adding = false;
        btn.textContent = "Add to cart";
        updateBuy(false);
      }, 1600);
    } catch (err) {
      adding = false;
      btn.textContent = "Add to cart";
      updateBuy(false);
      error(err.message || "Cart e add korte parlam na");
    }
  }

  /* ------------------------------------------------------------------ *
   * Boot
   * ------------------------------------------------------------------ */
  function showGate() {
    $("pdLoading").hidden = true;
    $("pdWrap").hidden = true;
    $("pdFatal").hidden = true;
    $("pdGate").hidden = false;
    $("pdGateStore").value = storeSlug;
    $("pdGateProduct").value = productKey;
  }

  function showFatal(message) {
    $("pdLoading").hidden = true;
    $("pdWrap").hidden = true;
    $("pdGate").hidden = true;
    $("pdFatal").textContent = message;
    $("pdFatal").hidden = false;
  }

  async function loadProduct() {
    $("pdLoading").hidden = false;
    $("pdGate").hidden = true;
    $("pdFatal").hidden = true;

    try {
      const res = await fetch(
        `/api/storefront/${encodeURIComponent(storeSlug)}/products/${encodeURIComponent(productKey)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Product load hoyni");

      page = data;
      localStorage.setItem(STORE_KEY, storeSlug);
      $("pdLoading").hidden = true;
      $("pdWrap").hidden = false;
      renderChrome();
      renderProduct();
      loadCartCount();
    } catch (err) {
      showFatal(err.message || "Product load hoyni");
    }
  }

  function wireEvents() {
    $("pdGateForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const store = $("pdGateStore").value.trim();
      const product = $("pdGateProduct").value.trim();
      if (!store || !product) return;
      location.href =
        "/product.html?store=" + encodeURIComponent(store) + "&product=" + encodeURIComponent(product);
    });

    $("pdVariation").addEventListener("change", (e) => selectVariation(e.target.value));
    $("pdMinus").addEventListener("click", () => changeQty(-1));
    $("pdPlus").addEventListener("click", () => changeQty(1));
    $("pdQty").addEventListener("input", onQtyInput);
    $("pdQty").addEventListener("change", onQtyCommit);
    $("pdQty").addEventListener("blur", onQtyCommit);
    $("pdQty").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addToCart();
      }
    });
    $("pdAdd").addEventListener("click", addToCart);

    $("pdError").setAttribute("role", "alert");
  }

  function init() {
    storeSlug = storeSlug.toLowerCase();
    wireEvents();
    if (!storeSlug || !productKey) {
      showGate();
      return;
    }
    loadProduct();
  }

  init();
})();
