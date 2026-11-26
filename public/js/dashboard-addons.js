/* Store dashboard add-ons: enabled packages become sidebar items and open in
   a sandboxed iframe. The plugin never runs on our origin — it asks for a
   store-scoped API token via postMessage (addon:hello → addon:context). */
(function () {
  const frames = new Map();

  const PUZZLE_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3h4v3a2 2 0 1 0 4 0h3v4h-3a2 2 0 1 0 0 4h3v4h-4v-3a2 2 0 1 0-4 0v3H6v-4H3v-4h3a2 2 0 1 0 0-4H3V6h4V3z"/></svg>';

  function navIcon(addon) {
    if (addon.icon) {
      const img = document.createElement("img");
      img.src = addon.icon;
      img.alt = "";
      img.style.cssText = "width:18px;height:18px;object-fit:contain;border-radius:4px;flex:0 0 auto;";
      return img;
    }
    const wrap = document.createElement("span");
    wrap.innerHTML = PUZZLE_SVG;
    return wrap.firstChild;
  }

  function buildView(addon, viewName) {
    const section = document.createElement("section");
    section.className = "view";
    section.id = "view-" + viewName;
    section.hidden = true;

    const topbar = document.createElement("div");
    topbar.className = "topbar";
    const left = document.createElement("div");
    left.style.cssText = "display:flex;align-items:center;gap:14px;";
    const menuBtn = document.createElement("button");
    menuBtn.className = "menu-btn";
    menuBtn.setAttribute("aria-label", "Menu");
    menuBtn.innerHTML =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
    menuBtn.addEventListener("click", () => {
      document.getElementById("sidebar").classList.add("open");
      document.getElementById("sbOverlay").classList.add("show");
    });
    const titles = document.createElement("div");
    const h1 = document.createElement("h1");
    h1.textContent = addon.name;
    const crumb = document.createElement("p");
    crumb.className = "crumb";
    crumb.textContent = "অ্যাড-অন · v" + (addon.version || "1.0.0");
    titles.appendChild(h1);
    titles.appendChild(crumb);
    left.appendChild(menuBtn);
    left.appendChild(titles);
    topbar.appendChild(left);
    section.appendChild(topbar);

    const iframe = document.createElement("iframe");
    iframe.className = "addon-frame";
    iframe.title = addon.name;
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-modals");
    iframe.style.cssText =
      "width:100%;height:calc(100vh - 150px);min-height:480px;border:0;border-radius:12px;background:#fff;";
    section.appendChild(iframe);
    return { section, iframe };
  }

  async function load() {
    let list = [];
    try {
      const res = await window.api("/api/addons");
      if (res && res.ok) list = await res.json();
    } catch {
      return;
    }
    if (!Array.isArray(list) || !list.length) return;
    const nav = document.querySelector(".sb-nav");
    const main = document.querySelector("main.main");
    if (!nav || !main) return;

    list.forEach((addon) => {
      if (!addon || !addon.key || !addon.entry || frames.has(addon.key)) return;
      const viewName = "addon-" + addon.key;

      const link = document.createElement("a");
      link.href = "#";
      link.className = "nav-item";
      link.dataset.view = viewName;
      link.appendChild(navIcon(addon));
      link.appendChild(document.createTextNode(addon.name));
      link.addEventListener("click", (e) => {
        e.preventDefault();
        window.switchView(viewName);
      });
      nav.appendChild(link);

      const { section, iframe } = buildView(addon, viewName);
      main.appendChild(section);
      frames.set(addon.key, { addon, iframe, loaded: false });
    });
  }

  // iframe src lazy-set prothom open-e — page load e shob plugin load hoy na
  function open(key) {
    const f = frames.get(key);
    if (!f) return;
    if (!f.loaded) {
      f.iframe.src = f.addon.entry;
      f.loaded = true;
    }
  }

  window.addEventListener("message", (e) => {
    const data = e.data;
    if (!data || data.type !== "addon:hello") return;
    for (const f of frames.values()) {
      if (e.source !== f.iframe.contentWindow) continue;
      let token = "";
      let slug = "";
      try {
        token = localStorage.getItem("luxe_token") || "";
        slug = localStorage.getItem("luxe_store_slug") || "";
      } catch {
        /* private mode */
      }
      const brand = document.querySelector(".sb-brand .name");
      e.source.postMessage(
        {
          type: "addon:context",
          token,
          apiBase: location.origin + "/api",
          store: { slug, name: brand ? brand.textContent : "" },
        },
        "*"
      );
      return;
    }
  });

  window.dashboardAddons = { load, open };
})();