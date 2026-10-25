/* ==========================================================================
   Storefront home — admin-managed cinematic hero slider + new arrivals
   ========================================================================== */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORE_KEY = "luxe_store_slug";
  const AUTOPLAY_MS = 5000;
  const TAKA = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  // folder address (/demo-store) primary, tarpor ?store=, tarpor last used
  const pathSlug = decodeURIComponent(location.pathname.split("/").filter(Boolean)[0] || "");
  const querySlug = new URLSearchParams(location.search).get("store") || "";
  // kono slug-i nei na mane domain theke asche — store ta server thik korbe, localStorage chole na
  const hosted = !pathSlug && !querySlug;
  let storeSlug = String(querySlug || pathSlug || (hosted ? "" : localStorage.getItem(STORE_KEY) || "")).trim();
  let store = null;
  let slides = [];
  let slideIndex = 0;
  let timer = null;
  let paused = false;
  let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function withStore(path) {
    return path + (path.includes("?") ? "&" : "?") + "store=" + encodeURIComponent(storeSlug);
  }

  async function api(path) {
    const res = await fetch(withStore(path));
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function money(value) {
    return "৳" + TAKA.format(Math.max(0, Number(value) || 0));
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function setLinks() {
    const q = "?store=" + encodeURIComponent(storeSlug);
    $("hmBrand").href = "/" + encodeURIComponent(storeSlug);
    $("hmCart").href = "/checkout.html" + q;
    $("hmFooterCheckout").href = "/checkout.html" + q;
  }

  /* ---------------------------------------------------------------- branding */
  function applyBranding(branding) {
    const b = branding || {};
    const title = b.title || store.name;

    document.title = title;
    if (b.favicon) {
      let link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = b.favicon;
    }

    const brand = $("hmBrand");
    if (b.logo) {
      brand.textContent = "";
      const img = document.createElement("img");
      img.className = "hm-logo";
      img.src = b.logo;
      img.alt = title;
      img.style.maxWidth = (Number(b.logoWidth) || 120) + "px";
      img.style.maxHeight = (Number(b.logoHeight) || 40) + "px";
      brand.appendChild(img);
    } else {
      brand.textContent = title;
    }

    const footerLogo = $("hmFooterLogo");
    if (footerLogo) {
      footerLogo.hidden = !b.footerLogo;
      if (b.footerLogo) footerLogo.src = b.footerLogo;
    }
    $("hmFooterStore").textContent = b.footerCopyright || "© " + new Date().getFullYear() + " " + store.name;
  }

  /* ------------------------------------------------------------------ gate */
  function showGate(message) {
    $("hmBoot").hidden = true;
    $("hmContent").hidden = true;
    const gate = $("hmGate");
    gate.hidden = false;
    const error = $("hmGateError");
    error.textContent = message || "";
    error.hidden = !message;
    $("hmGateStore").value = storeSlug || "";
    $("hmGateStore").focus();
  }

  $("hmGateForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const slug = $("hmGateStore").value.trim().toLowerCase();
    if (!slug) return;
    storeSlug = slug;
    localStorage.setItem(STORE_KEY, slug);
    location.href = "/" + encodeURIComponent(slug);
  });

  /* ------------------------------------------------------------------ boot */
  async function boot() {
    $("hmGate").hidden = true;
    $("hmFatal").hidden = true;
    $("hmBoot").hidden = false;

    let info;
    try {
      if (storeSlug) {
        info = await api("/api/storefront/" + encodeURIComponent(storeSlug));
      } else {
        // domain theke asche (mystore.com/) — server nije thik dokan ta bojhe
        const res = await fetch("/api/storefront/current");
        info = { res, data: await res.json().catch(() => ({})) };
      }
    } catch {
      $("hmBoot").hidden = true;
      $("hmFatal").textContent = "Store load korte parlam na. Internet connection check korun.";
      $("hmFatal").hidden = false;
      return;
    }

    if (!info.res.ok || !info.data.store) {
      localStorage.removeItem(STORE_KEY);
      showGate(
        info.res.status === 404
          ? "Ei slug e kono store pawa jayni. Slug ta check korun."
          : info.data.message || "Store khulte parlam na."
      );
      return;
    }

    store = info.data.store;
    if (!storeSlug) storeSlug = store.slug;
    localStorage.setItem(STORE_KEY, store.slug);
    setLinks();
    applyBranding(info.data.branding);

    const [slideRes, productRes] = await Promise.all([
      api("/api/storefront/" + encodeURIComponent(store.slug) + "/hero-slides"),
      api("/api/storefront/" + encodeURIComponent(store.slug) + "/products?limit=8"),
    ]);

    slides = slideRes.res.ok && Array.isArray(slideRes.data.slides) ? slideRes.data.slides : [];
    const products =
      productRes.res.ok && Array.isArray(productRes.data.products) ? productRes.data.products : [];

    renderHero();
    renderProducts(products);

    $("hmBoot").hidden = true;
    $("hmContent").hidden = false;
  }

  /* ---------------------------------------------------------------- hero */
  function clearTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function startTimer() {
    clearTimer();
    if (reduced || paused || slides.length < 2 || document.hidden) return;
    timer = setInterval(() => showSlide(slideIndex + 1), AUTOPLAY_MS);
  }

  function renderFallbackHero() {
    const hero = $("hmHero");
    hero.classList.add("is-empty");

    const layer = document.createElement("div");
    layer.className = "hm-slide hm-fallback is-active";
    $("hmSlides").appendChild(layer);

    $("hmKicker").textContent = "Storefront";
    $("hmTitle").textContent = store.name;
    $("hmTitle").hidden = false;
    $("hmSub").textContent = "Curated pieces for everyday living.";
    $("hmSub").hidden = false;
    $("hmCopy").hidden = false;

    const cta = $("hmCta");
    cta.textContent = "Explore the collection";
    cta.href = "#hmProducts";
    cta.hidden = false;

    $("hmPrev").hidden = true;
    $("hmNext").hidden = true;
    $("hmDots").hidden = true;
    $("hmCount").hidden = true;
  }

  function renderHero() {
    const slidesRoot = $("hmSlides");
    slidesRoot.textContent = "";
    $("hmDots").textContent = "";
    $("hmHero").classList.remove("is-empty");

    if (!slides.length) {
      renderFallbackHero();
      return;
    }

    slides.forEach((slide, index) => {
      const layer = document.createElement("div");
      layer.className = "hm-slide";
      layer.setAttribute("role", "group");
      layer.setAttribute("aria-roledescription", "slide");
      layer.setAttribute("aria-label", `${index + 1} / ${slides.length}`);
      const url = String(slide.image || "").replace(/"/g, "%22");
      layer.style.backgroundImage = `url("${url}")`;
      slidesRoot.appendChild(layer);

      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "hm-dot";
      dot.setAttribute("role", "tab");
      dot.setAttribute("aria-label", "Slide " + (index + 1));
      dot.addEventListener("click", () => showSlide(index));
      $("hmDots").appendChild(dot);
    });

    const multiple = slides.length > 1;
    $("hmPrev").hidden = !multiple;
    $("hmNext").hidden = !multiple;
    $("hmDots").hidden = !multiple;
    $("hmCount").hidden = !multiple;

    showSlide(0);
  }

  function updateCopy(slide) {
    const hasCopy = !!(slide.title || slide.subtitle);
    $("hmCopy").hidden = !hasCopy;
    if (!hasCopy) return;

    $("hmKicker").textContent = "Featured";
    $("hmTitle").textContent = slide.title || "";
    $("hmTitle").hidden = !slide.title;

    $("hmSub").textContent = slide.subtitle || "";
    $("hmSub").hidden = !slide.subtitle;

    const cta = $("hmCta");
    const hasLink = slide.linkUrl && /^(\/|https?:\/\/)/.test(slide.linkUrl);
    cta.hidden = !hasLink;
    if (hasLink) {
      cta.textContent = slide.buttonLabel || "Shop now";
      cta.href = slide.linkUrl;
    }
  }

  function showSlide(next) {
    if (!slides.length) return;
    slideIndex = ((next % slides.length) + slides.length) % slides.length;

    const layers = $("hmSlides").children;
    for (let i = 0; i < layers.length; i++) {
      layers[i].classList.toggle("is-active", i === slideIndex);
    }

    const dots = $("hmDots").children;
    for (let i = 0; i < dots.length; i++) {
      const active = i === slideIndex;
      dots[i].classList.toggle("on", active);
      dots[i].setAttribute("aria-selected", String(active));
    }

    $("hmCount").textContent = pad2(slideIndex + 1) + " / " + pad2(slides.length);
    updateCopy(slides[slideIndex]);
    startTimer();
  }

  $("hmPrev").addEventListener("click", () => showSlide(slideIndex - 1));
  $("hmNext").addEventListener("click", () => showSlide(slideIndex + 1));

  const hero = $("hmHero");
  hero.addEventListener("mouseenter", () => {
    paused = true;
    clearTimer();
  });
  hero.addEventListener("mouseleave", () => {
    paused = false;
    startTimer();
  });
  hero.addEventListener("focusin", () => {
    paused = true;
    clearTimer();
  });
  hero.addEventListener("focusout", (event) => {
    if (!hero.contains(event.relatedTarget)) {
      paused = false;
      startTimer();
    }
  });
  hero.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showSlide(slideIndex - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      showSlide(slideIndex + 1);
    }
  });

  let touchStart = null;
  hero.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button, a")) return;
    touchStart = { x: event.clientX, y: event.clientY };
  });
  hero.addEventListener("pointerup", (event) => {
    if (!touchStart) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy)) return;
    showSlide(dx < 0 ? slideIndex + 1 : slideIndex - 1);
  });
  hero.addEventListener("pointercancel", () => {
    touchStart = null;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimer();
    else startTimer();
  });

  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (event) => {
    reduced = event.matches;
    startTimer();
  });

  /* ------------------------------------------------------------ products */
  function renderProducts(products) {
    const grid = $("hmProductGrid");
    grid.textContent = "";
    const list = products.slice(0, 8);
    $("hmProductsEmpty").hidden = list.length > 0;

    list.forEach((product) => {
      const card = document.createElement("a");
      card.className = "hm-card";
      card.href =
        "/product.html?store=" +
        encodeURIComponent(storeSlug) +
        "&product=" +
        encodeURIComponent(product.slug || product.id);

      const media = document.createElement("div");
      media.className = "hm-card-media";

      const fallback = document.createElement("span");
      fallback.className = "hm-card-empty";
      fallback.textContent = String(product.name || "L").slice(0, 1).toUpperCase();
      media.appendChild(fallback);

      if (product.image) {
        const img = document.createElement("img");
        img.alt = product.name || "Product";
        img.loading = "lazy";
        img.addEventListener("load", () => {
          fallback.hidden = true;
        });
        img.addEventListener("error", () => {
          img.remove();
        });
        img.src = product.image;
        media.appendChild(img);
      }

      const badgeText =
        product.flashSale && product.flashSale.title
          ? "Flash sale"
          : product.wholesaleBadge || "";
      if (badgeText) {
        const badge = document.createElement("span");
        badge.className = "hm-badge";
        badge.textContent = badgeText;
        media.appendChild(badge);
      }

      const body = document.createElement("div");
      body.className = "hm-card-body";

      const name = document.createElement("h3");
      name.textContent = product.name || "Unnamed product";

      const priceRow = document.createElement("div");
      priceRow.className = "hm-price-row";
      const price = document.createElement("span");
      price.className = "hm-price";
      price.textContent = money(product.price);
      priceRow.appendChild(price);

      body.appendChild(name);
      body.appendChild(priceRow);

      if (product.inStock === false) {
        const out = document.createElement("div");
        out.className = "hm-out";
        out.textContent = "Out of stock";
        body.appendChild(out);
      }

      card.appendChild(media);
      card.appendChild(body);
      grid.appendChild(card);
    });
  }

  if (!storeSlug && !hosted) showGate("");
  else boot();
})();
