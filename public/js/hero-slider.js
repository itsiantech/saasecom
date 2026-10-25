/* ==========================================================================
   Admin — Storefront hero slider manager
   window.heroSliderPage dashboard.js switchView theke open hoy
   ========================================================================== */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = "luxe_token";
  const MAX_BYTES = 2 * 1024 * 1024;

  const state = {
    items: [],
    editing: null,
    image: "",
    busy: false,
    storeSlug: "",
    sortable: null,
  };

  async function api(path, options = {}) {
    const headers = {
      Authorization: "Bearer " + (localStorage.getItem(TOKEN_KEY) || ""),
      ...(options.headers || {}),
    };
    if (options.body && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(path, { ...options, headers });
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem(TOKEN_KEY);
      location.href = "/login.html";
      return null;
    }
    return res;
  }

  async function json(path, options = {}) {
    const res = await api(path, options);
    if (!res) throw new Error("Login session shesh");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Request fail hoyeche");
    return data;
  }

  function toast(text, type) {
    if (typeof window.toast === "function") window.toast(text, type);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showFormError(message) {
    const error = $("hsFormError");
    error.textContent = message || "";
    error.hidden = !message;
  }

  /* ------------------------------------------------------------------ list */
  function renderThumb(item) {
    const thumb = el("div", "hs-thumb");
    const empty = el("span", "hs-thumb-empty", "No image");
    thumb.appendChild(empty);
    if (item.image) {
      const img = document.createElement("img");
      img.alt = item.alt || item.title || "Slide image";
      img.addEventListener("load", () => {
        empty.hidden = true;
      });
      img.addEventListener("error", () => {
        img.remove();
      });
      img.src = item.image;
      thumb.appendChild(img);
    }
    return thumb;
  }

  function renderItem(item, index) {
    const row = el("div", "hs-item");
    row.dataset.id = String(item.id);

    row.appendChild(el("span", "hs-grip", "⋮⋮"));
    row.appendChild(renderThumb(item));

    const info = el("div", "hs-info");
    const title = el("h4", item.title ? "" : "muted", item.title || "Untitled slide");
    info.appendChild(title);

    const meta = el("div", "hs-meta");
    const pill = el("span", "hs-pill" + (item.active ? " on" : ""), item.active ? "Active" : "Hidden");
    meta.appendChild(pill);
    meta.appendChild(el("span", "", `Slide ${index + 1}`));
    const link = el("span", "hs-link", item.linkUrl || "No link");
    link.title = item.linkUrl || "";
    meta.appendChild(link);
    info.appendChild(meta);
    row.appendChild(info);

    const side = el("div", "hs-side");

    const toggle = el("button", "hs-toggle" + (item.active ? " on" : ""));
    toggle.type = "button";
    toggle.dataset.hs = "toggle";
    toggle.setAttribute("aria-pressed", String(!!item.active));
    toggle.setAttribute("aria-label", item.active ? "Hide slide" : "Show slide");
    toggle.title = item.active ? "Hide from storefront" : "Show on storefront";
    side.appendChild(toggle);

    const up = el("button", "hs-act", "↑");
    up.type = "button";
    up.dataset.hs = "up";
    up.disabled = index === 0;
    up.setAttribute("aria-label", "Move slide up");
    side.appendChild(up);

    const down = el("button", "hs-act", "↓");
    down.type = "button";
    down.dataset.hs = "down";
    down.disabled = index === state.items.length - 1;
    down.setAttribute("aria-label", "Move slide down");
    side.appendChild(down);

    const edit = el("button", "hs-act", "✎");
    edit.type = "button";
    edit.dataset.hs = "edit";
    edit.setAttribute("aria-label", "Edit slide");
    edit.title = "Edit";
    side.appendChild(edit);

    const del = el("button", "hs-act danger", "✕");
    del.type = "button";
    del.dataset.hs = "delete";
    del.setAttribute("aria-label", "Delete slide");
    del.title = "Delete";
    side.appendChild(del);

    row.appendChild(side);
    return row;
  }

  function render() {
    const root = $("hsListRoot");
    root.textContent = "";

    if (!state.items.length) {
      const empty = el("div", "hs-empty");
      empty.appendChild(el("h4", "", "Ekhono kono slide nei"));
      empty.appendChild(el("p", "", "Add slide diye home page er first hero image upload korun."));
      root.appendChild(empty);
      return;
    }

    state.items.forEach((item, index) => root.appendChild(renderItem(item, index)));
  }

  async function load() {
    const root = $("hsListRoot");
    root.textContent = "";
    root.appendChild(el("p", "hs-loading", "Loading slides…"));
    try {
      const data = await json("/api/hero-slides");
      state.items = Array.isArray(data.items) ? data.items : [];
      render();
    } catch (err) {
      root.textContent = "";
      const empty = el("div", "hs-empty");
      empty.appendChild(el("h4", "", "Slides load hoyni"));
      empty.appendChild(el("p", "", err.message));
      root.appendChild(empty);
      toast(err.message, "err");
    }
  }

  async function loadStoreLink() {
    try {
      const res = await api("/api/stores/mine");
      if (!res || !res.ok) return;
      const stores = await res.json();
      if (!Array.isArray(stores) || !stores.length || !stores[0].slug) return;
      state.storeSlug = stores[0].slug;
      const link = $("hsStorefrontLink");
      link.href = "/?store=" + encodeURIComponent(state.storeSlug);
    } catch {
      // preview link optional
    }
  }

  /* -------------------------------------------------------------- ordering */
  async function saveOrder(ids) {
    try {
      const data = await json("/api/hero-slides/reorder", {
        method: "PUT",
        body: JSON.stringify({ ids }),
      });
      state.items = Array.isArray(data.items) ? data.items : state.items;
      render();
      toast("Slide order update hoyeche", "ok");
    } catch (err) {
      toast(err.message, "err");
      await load();
    }
  }

  function move(index, direction) {
    const next = index + direction;
    if (next < 0 || next >= state.items.length) return;
    const ids = state.items.map((item) => String(item.id));
    [ids[index], ids[next]] = [ids[next], ids[index]];
    const byId = new Map(state.items.map((item) => [String(item.id), item]));
    state.items = ids.map((id) => byId.get(id)).filter(Boolean);
    render();
    saveOrder(ids);
  }

  async function toggleActive(item, button) {
    if (state.busy) return;
    state.busy = true;
    button.disabled = true;
    try {
      const data = await json("/api/hero-slides/" + encodeURIComponent(item.id), {
        method: "PUT",
        body: JSON.stringify({ active: !item.active }),
      });
      const updated = data.item || {};
      item.active = updated.active !== false;
      toast(item.active ? "Slide storefront e dekhabe" : "Slide hidden kora holo", "ok");
      render();
    } catch (err) {
      toast(err.message, "err");
      button.disabled = false;
    } finally {
      state.busy = false;
    }
  }

  async function deleteSlide(item) {
    const ok = await window.confirmDialog({
      title: "Slide delete korben?",
      text: item.title || "Ei slide ta hero slider theke muche jabe.",
      okLabel: "Delete",
    });
    if (!ok) return;
    try {
      await json("/api/hero-slides/" + encodeURIComponent(item.id), { method: "DELETE" });
      toast("Slide delete hoyeche", "ok");
      await load();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  $("hsListRoot").addEventListener("click", (event) => {
    const button = event.target.closest("[data-hs]");
    if (!button) return;
    const row = button.closest("[data-id]");
    if (!row) return;
    const index = state.items.findIndex((item) => String(item.id) === row.dataset.id);
    if (index < 0) return;
    const item = state.items[index];

    if (button.dataset.hs === "toggle") toggleActive(item, button);
    else if (button.dataset.hs === "up") move(index, -1);
    else if (button.dataset.hs === "down") move(index, 1);
    else if (button.dataset.hs === "edit") openModal(item);
    else if (button.dataset.hs === "delete") deleteSlide(item);
  });

  /* ----------------------------------------------------------------- modal */
  function setPreview(image) {
    const img = $("hsPreviewImg");
    const empty = $("hsPreviewEmpty");
    if (image) {
      img.src = image;
      img.hidden = false;
      empty.hidden = true;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      empty.hidden = false;
    }
  }

  function openModal(item) {
    state.editing = item || null;
    state.image = item ? item.image : "";

    $("hsModalTitle").textContent = item ? "Edit slide" : "Add slide";
    $("hsTitle").value = (item && item.title) || "";
    $("hsSubtitle").value = (item && item.subtitle) || "";
    $("hsButton").value = (item && item.buttonLabel) || "";
    $("hsLink").value = (item && item.linkUrl) || "";
    $("hsAlt").value = (item && item.alt) || "";
    $("hsActive").checked = item ? item.active !== false : true;
    $("hsFile").value = "";
    $("hsPreviewEmpty").textContent = "No image";
    showFormError("");
    setPreview(state.image);

    $("hsOverlay").classList.add("open");
    $("hsTitle").focus();
  }

  function closeModal() {
    $("hsOverlay").classList.remove("open");
    state.editing = null;
    state.image = "";
    $("hsFile").value = "";
    $("hsPreviewEmpty").textContent = "No image";
  }

  $("hsCreateBtn").addEventListener("click", () => openModal(null));
  $("hsRefresh").addEventListener("click", () => load());
  $("hsClose").addEventListener("click", closeModal);
  $("hsCancel").addEventListener("click", closeModal);
  $("hsOverlay").addEventListener("click", (event) => {
    if (event.target === $("hsOverlay")) closeModal();
  });

  $("hsPickBtn").addEventListener("click", () => $("hsFile").click());

  $("hsFile").addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      showFormError("Shudhu image file upload korun");
      return;
    }
    if (file.size > MAX_BYTES) {
      showFormError("Image 2MB er beshi hote parbe na");
      return;
    }

    showFormError("");
    const empty = $("hsPreviewEmpty");
    empty.textContent = "Uploading…";
    empty.hidden = false;
    $("hsPreviewImg").hidden = true;
    $("hsPickBtn").disabled = true;

    try {
      const form = new FormData();
      form.append("image", file);
      const res = await api("/api/settings/upload", { method: "POST", body: form });
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Upload fail hoyeche");
      state.image = data.path;
      empty.textContent = "No image";
      setPreview(state.image);
      toast("Image upload hoyeche", "ok");
    } catch (err) {
      empty.textContent = "No image";
      setPreview(state.image);
      showFormError(err.message);
    } finally {
      $("hsPickBtn").disabled = false;
      $("hsFile").value = "";
    }
  });

  $("hsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) return;

    if (!state.image) {
      showFormError("Prothome slide image upload korun");
      return;
    }

    const payload = {
      image: state.image,
      alt: $("hsAlt").value.trim(),
      title: $("hsTitle").value.trim(),
      subtitle: $("hsSubtitle").value.trim(),
      buttonLabel: $("hsButton").value.trim(),
      linkUrl: $("hsLink").value.trim(),
      active: $("hsActive").checked,
    };

    showFormError("");
    state.busy = true;
    const save = $("hsSave");
    save.disabled = true;
    save.textContent = "Saving…";

    try {
      const path = state.editing
        ? "/api/hero-slides/" + encodeURIComponent(state.editing.id)
        : "/api/hero-slides";
      await json(path, {
        method: state.editing ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      toast(state.editing ? "Slide update hoyeche" : "Slide create hoyeche", "ok");
      closeModal();
      await load();
    } catch (err) {
      showFormError(err.message);
    } finally {
      state.busy = false;
      save.disabled = false;
      save.textContent = "Save slide";
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("hsOverlay").classList.contains("open")) closeModal();
  });

  /* ------------------------------------------------------------------ init */
  if (window.Sortable) {
    state.sortable = window.Sortable.create($("hsListRoot"), {
      handle: ".hs-grip",
      animation: 160,
      ghostClass: "hs-sortable-ghost",
      dragClass: "hs-sortable-drag",
      delay: 120,
      delayOnTouchOnly: true,
      touchStartThreshold: 4,
      onEnd() {
        const ids = [...$("hsListRoot").querySelectorAll("[data-id]")].map((row) => row.dataset.id);
        const byId = new Map(state.items.map((item) => [String(item.id), item]));
        state.items = ids.map((id) => byId.get(id)).filter(Boolean);
        saveOrder(ids);
      },
    });
  }

  window.heroSliderPage = {
    open() {
      loadStoreLink();
      load();
    },
  };
})();
