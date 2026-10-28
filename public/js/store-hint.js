// Panel pages are per store. Remember ?store=<slug> and put it on every admin
// API call, so a user with more than one shop edits the shop they opened.
(function () {
  "use strict";
  const KEY = "luxe_store_slug";
  const urlSlug = String(new URLSearchParams(location.search).get("store") || "").trim().toLowerCase();
  if (urlSlug) localStorage.setItem(KEY, urlSlug);
  const active = urlSlug || localStorage.getItem(KEY) || "";
  if (!active) return;

  const original = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.startsWith("/api/")) {
      const headers = new Headers((init && init.headers) || (input && input.headers) || {});
      if (headers.has("Authorization") && !headers.has("x-store-slug")) {
        headers.set("x-store-slug", active);
      }
      init = Object.assign({}, init, { headers });
    }
    return original.call(this, input, init);
  };
})();
