/* ==========================================================================
   Super admin branding for the platform pages (landing, login, portal, setup,
   super-admin panel). One source: /api/public/branding.

   Markup hooks (all optional):
     data-pb-logo       → whole element is replaced by the logo image (kept as
                          text when no logo is uploaded)
     data-pb-logo-wrap  → gets a "has-logo" class while a logo is set
     data-pb-mark       → the little square letter mark ("L") — logo image, or
                          the first letter of the brand name
     data-pb-name       → brand name text
     data-pb-copyright  → full copyright line
     data-pb-title      → <title> whose default "LUXE" is swapped for the name

   window.PlatformBrand.apply(branding) re-runs the same pass so the admin
   panel can refresh the sidebar right after a save.
   ========================================================================== */
(function () {
  "use strict";

  let titleBase = null;

  function imageNode(src, alt) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = alt || "";
    return img;
  }

  function setFavicon(url) {
    if (!url) return;
    let link = document.querySelector('link[rel="icon"]');
    if (link && link.dataset.store) return; // the page has its own icon
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = url;
  }

  function apply(branding) {
    const b = branding || {};
    const name = b.name || "LUXE";
    const logo = b.logo || "";

    if (titleBase === null) {
      const el = document.querySelector("title[data-pb-title]");
      if (el) titleBase = el.textContent;
    }
    if (titleBase) {
      document.title = titleBase.replace(/LUXE/g, () => name);
    }

    document.querySelectorAll("[data-pb-logo-wrap]").forEach((el) => {
      el.classList.toggle("has-logo", !!logo);
    });

    document.querySelectorAll("[data-pb-name]").forEach((el) => {
      el.textContent = name;
    });

    document.querySelectorAll("[data-pb-logo]").forEach((el) => {
      if (!logo) return; // no logo → the inner data-pb-name text stays
      el.classList.add("has-logo");
      el.textContent = "";
      el.appendChild(imageNode(logo, name));
    });

    document.querySelectorAll("[data-pb-mark]").forEach((el) => {
      el.classList.toggle("has-logo", !!logo);
      if (logo) {
        el.textContent = "";
        el.appendChild(imageNode(logo, name));
      } else {
        el.textContent = (name.charAt(0) || "L").toUpperCase();
      }
    });

    const copyright = b.copyright || "© " + new Date().getFullYear() + " " + name;
    document.querySelectorAll("[data-pb-copyright]").forEach((el) => {
      el.textContent = copyright;
    });

    setFavicon(b.favicon);
  }

  async function load() {
    try {
      const res = await fetch("/api/public/branding", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      apply((data && data.branding) || {});
    } catch {
      /* offline — the hardcoded defaults stay */
    }
  }

  window.PlatformBrand = { apply };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
