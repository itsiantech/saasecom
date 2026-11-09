/* Sidebar menu scroll helper: keeps the current page's menu item in view when
   the menu is taller than the screen or a submenu opens. Layout/scroll itself
   is pure CSS (sidebar-scroll.css). */
(function () {
  const sidebar = document.getElementById("sidebar");
  const nav = sidebar && sidebar.querySelector(".sb-nav");
  if (!nav) return;

  function revealActive() {
    const active = nav.querySelector(".nav-item.active");
    if (!active) return;
    const navBox = nav.getBoundingClientRect();
    const itemBox = active.getBoundingClientRect();
    const pad = 12;
    if (itemBox.top < navBox.top + pad) {
      nav.scrollTo({ top: Math.max(0, nav.scrollTop - (navBox.top + pad - itemBox.top)), behavior: "smooth" });
    } else if (itemBox.bottom > navBox.bottom - pad) {
      nav.scrollTo({ top: nav.scrollTop + (itemBox.bottom - navBox.bottom + pad), behavior: "smooth" });
    }
  }

  // view switches move .active between rows; keep the highlighted row visible
  new MutationObserver(revealActive).observe(nav, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  // expanding a submenu pushes rows down
  nav.addEventListener("click", (event) => {
    if (event.target.closest(".nav-toggle")) setTimeout(revealActive, 240);
  });

  // mobile drawer slides in over 300ms
  new MutationObserver(() => {
    if (sidebar.classList.contains("open")) setTimeout(revealActive, 320);
  }).observe(sidebar, { attributes: true, attributeFilter: ["class"] });

  revealActive();
  window.addEventListener("load", revealActive);

  // window resize / phone rotation changes how much of the menu fits
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(revealActive, 150);
  });
})();
