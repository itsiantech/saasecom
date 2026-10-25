/* ==========================================================================
   Add Product — embedded dashboard view (#view-add-product)
   Exposed as window.productForm.open([id]) so dashboard.js can switch to it.
   ========================================================================== */
(function () {
  "use strict";

  const TOKEN_KEY = "luxe_token";
  const token = localStorage.getItem(TOKEN_KEY);

  const $ = (id) => document.getElementById(id);

  /* ---------------- state ---------------- */
  const state = {
    ready: false,
    loading: false,
    meta: null,
    dirty: false,
    editId: null,
    selectedCategories: new Set(),
    tags: [],
    attribute: { name: "", terms: [] },
    variationData: {}, // { [term]: { image, regularPrice, salePrice, stock } }
    swatches: [], // { id, name, price, stock, images: [] }
    tiers: { __product__: [] }, // { [term|__product__]: [{ minQty, maxQty, price }] }
    tierTarget: "__product__",
  };

  /* ---------------- helpers ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // dashboard.js er global toast() use kori, na thakle fallback
  function notify(msg, type) {
    if (typeof window.toast === "function") {
      window.toast(msg, type === "err" ? "err" : "ok");
    } else {
      // eslint-disable-next-line no-console
      console.log(msg);
    }
  }

  async function api(method, url, body, isForm) {
    const headers = { Authorization: "Bearer " + token };
    if (!isForm) headers["Content-Type"] = "application/json";
    const res = await fetch(url, {
      method,
      headers,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) throw new Error((data && data.message) || "Request fail");
    return data;
  }

  function markDirty() { state.dirty = true; }

  async function uploadImage(file) {
    const fd = new FormData();
    fd.append("image", file);
    const data = await api("POST", "/api/product-form/upload", fd, true);
    return data.path;
  }

  /* ---------------- categories ---------------- */
  function renderCategoryTree() {
    const tree = state.meta.categories || [];
    const container = $("pfCategoryTree");
    container.innerHTML = "";
    if (!tree.length) container.innerHTML = '<p class="pf-note" style="border:none;padding:0;">No categories yet</p>';
    buildCategoryNodes(tree, container, 0);
  }

  function buildCategoryNodes(nodes, container, depth) {
    nodes.forEach((node) => {
      const row = document.createElement("div");
      row.className = "pf-tree-node";

      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = node._id;
      cb.checked = state.selectedCategories.has(String(node._id));
      cb.addEventListener("change", () => {
        if (cb.checked) state.selectedCategories.add(String(node._id));
        else state.selectedCategories.delete(String(node._id));
        markDirty();
      });

      label.appendChild(cb);
      label.appendChild(document.createTextNode(node.name || "Untitled"));
      row.appendChild(label);
      container.appendChild(row);

      if (node.children && node.children.length) {
        const childWrap = document.createElement("div");
        childWrap.className = "pf-tree-children";
        buildCategoryNodes(node.children, childWrap, depth + 1);
        container.appendChild(childWrap);
      }
    });
  }

  function renderParentOptions() {
    const sel = $("newCatParent");
    sel.innerHTML = '<option value="">(Root)</option>';
    (function walk(nodes, prefix) {
      nodes.forEach((n) => {
        const opt = document.createElement("option");
        opt.value = n._id;
        opt.textContent = (prefix ? prefix + " > " : "") + (n.name || "Untitled");
        sel.appendChild(opt);
        if (n.children && n.children.length) walk(n.children, (prefix ? prefix + " > " : "") + (n.name || "Untitled"));
      });
    })(state.meta.categories || [], "");
  }

  /* ---------------- tags ---------------- */
  function renderTags() {
    const wrap = $("pfTagChips");
    wrap.innerHTML = "";
    state.tags.forEach((tag, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = esc(tag) + ' <button type="button" aria-label="Remove tag">&times;</button>';
      chip.querySelector("button").addEventListener("click", () => {
        state.tags.splice(i, 1);
        renderTags();
        markDirty();
      });
      wrap.appendChild(chip);
    });
  }

  function addTagFromInput() {
    const input = $("pfTagInput");
    const v = input.value.trim();
    if (!v) return;
    if (!state.tags.some((t) => t.toLowerCase() === v.toLowerCase())) {
      state.tags.push(v);
      renderTags();
      markDirty();
    }
    input.value = "";
  }

  /* ---------------- attributes ---------------- */
  function renderAttributeSelect() {
    const sel = $("pfAttrSelect");
    const attrs = state.meta.attributes || [];
    sel.innerHTML = '<option value="">Select attribute…</option>';
    attrs.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.name;
      opt.textContent = a.name;
      sel.appendChild(opt);
    });
    const create = document.createElement("option");
    create.value = "__new__";
    create.textContent = "+ Create new attribute";
    sel.appendChild(create);
  }

  function selectAttribute(name) {
    if (state.attribute.name !== name) {
      state.attribute.name = name;
      state.attribute.terms = [];
      state.variationData = {};
    }
    renderTermChips();
    renderVariationTable();
  }

  function renderTermChips() {
    const wrap = $("pfTermChips");
    wrap.innerHTML = "";
    state.attribute.terms.forEach((term, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = esc(term) + ' <button type="button" aria-label="Remove term">&times;</button>';
      chip.querySelector("button").addEventListener("click", () => {
        state.attribute.terms.splice(i, 1);
        delete state.variationData[term];
        renderTermChips();
        renderVariationTable();
        markDirty();
      });
      wrap.appendChild(chip);
    });
    renderTierTargets();
    renderTierRows();
  }

  function addTerm() {
    const input = $("pfTermInput");
    const v = input.value.trim();
    if (!v || !state.attribute.name) return;
    if (!state.attribute.terms.includes(v)) {
      state.attribute.terms.push(v);
      state.variationData[v] = state.variationData[v] || { image: "", regularPrice: "", salePrice: "", stock: "" };
      renderTermChips();
      renderVariationTable();
      markDirty();
    }
    input.value = "";
    input.focus();
  }

  function renderVariationTable() {
    const wrap = $("variationTableWrap");
    const tbody = $("pfVariationRows");
    const show = $("pfPerTerm").checked && state.attribute.terms.length > 0;
    wrap.hidden = !show;
    if (!show) { tbody.innerHTML = ""; return; }

    tbody.innerHTML = state.attribute.terms
      .map((term) => {
        const d = state.variationData[term] || {};
        return `
        <tr>
          <td>
            <div class="pf-img-slot" data-term="${esc(term)}" role="button" tabindex="0" aria-label="Upload image for ${esc(term)}">
              ${d.image ? `<img src="${esc(d.image)}" alt="">` : "<span>Add</span>"}
            </div>
            <input type="file" accept="image/*" hidden data-file="${esc(term)}" />
          </td>
          <td><strong>${esc(term)}</strong></td>
          <td><input type="number" min="0" step="0.01" placeholder="0.00" data-price="${esc(term)}" value="${esc(d.regularPrice || "")}" /></td>
          <td><input type="number" min="0" step="0.01" placeholder="0.00" data-sale="${esc(term)}" value="${esc(d.salePrice || "")}" /></td>
          <td><input type="number" min="0" placeholder="0" data-stock="${esc(term)}" value="${esc(d.stock || "")}" /></td>
        </tr>`;
      })
      .join("");

    tbody.querySelectorAll(".pf-img-slot").forEach((slot) => {
      const term = slot.dataset.term;
      const file = slot.parentElement.querySelector('input[type="file"]');
      if (state.variationData[term] && state.variationData[term].image) slot.dataset.image = state.variationData[term].image;
      slot.addEventListener("click", () => file.click());
      slot.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); }
      });
      file.addEventListener("change", async () => {
        if (!file.files[0]) return;
        try {
          const path = await uploadImage(file.files[0]);
          state.variationData[term] = state.variationData[term] || {};
          state.variationData[term].image = path;
          slot.dataset.image = path;
          slot.innerHTML = `<img src="${esc(path)}" alt="">`;
          markDirty();
        } catch (err) { notify(err.message, "err"); }
      });
    });

    tbody.querySelectorAll("input[data-price]").forEach((inp) =>
      inp.addEventListener("input", () => {
        const t = inp.dataset.price;
        state.variationData[t] = state.variationData[t] || {};
        state.variationData[t].regularPrice = inp.value;
        markDirty();
      })
    );
    tbody.querySelectorAll("input[data-sale]").forEach((inp) =>
      inp.addEventListener("input", () => {
        const t = inp.dataset.sale;
        state.variationData[t] = state.variationData[t] || {};
        state.variationData[t].salePrice = inp.value;
        markDirty();
      })
    );
    tbody.querySelectorAll("input[data-stock]").forEach((inp) =>
      inp.addEventListener("input", () => {
        const t = inp.dataset.stock;
        state.variationData[t] = state.variationData[t] || {};
        state.variationData[t].stock = inp.value;
        markDirty();
      })
    );
  }

  /* ---------------- swatches ---------------- */
  function addSwatch() {
    state.swatches.push({ id: "s" + Date.now(), name: "", price: "", stock: "", images: [] });
    renderSwatches();
    markDirty();
  }

  function renderSwatches() {
    const wrap = $("pfSwatches");
    wrap.innerHTML = "";
    state.swatches.forEach((sw, idx) => {
      const card = document.createElement("div");
      card.className = "pf-swatch";
      card.innerHTML = `
        <div class="pf-swatch-top"><span>Swatch ${idx + 1}</span><strong data-remove="${idx}">Remove</strong></div>
        <div class="pf-gallery" data-gallery="${idx}"></div>
        <button type="button" class="pf-btn-sm" data-addimg="${idx}">+ Add image</button>
        <input type="file" accept="image/*" hidden data-file="${idx}" multiple />
        <div class="pf-field" style="margin-top:0;"><label>Swatch name</label><input type="text" data-name="${idx}" value="${esc(sw.name)}" placeholder="Swatch name" /></div>
        <div class="pf-grid-2">
          <div class="pf-field"><label>Price</label><input type="number" min="0" step="0.01" data-price="${idx}" value="${esc(sw.price)}" placeholder="0.00" /></div>
          <div class="pf-field"><label>Stock</label><input type="number" min="0" data-stock="${idx}" value="${esc(sw.stock)}" placeholder="0" /></div>
        </div>`;
      wrap.appendChild(card);
      renderSwatchGallery(idx);
    });

    wrap.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => {
      state.swatches.splice(Number(b.dataset.remove), 1);
      renderSwatches();
      markDirty();
    }));
    wrap.querySelectorAll("[data-addimg]").forEach((b) => b.addEventListener("click", () => {
      wrap.querySelector(`input[data-file="${b.dataset.addimg}"]`).click();
    }));
    wrap.querySelectorAll("input[data-file]").forEach((file) => file.addEventListener("change", async () => {
      const i = Number(file.dataset.file);
      for (const f of file.files) {
        try { state.swatches[i].images.push(await uploadImage(f)); } catch (err) { notify(err.message, "err"); }
      }
      renderSwatchGallery(i);
      markDirty();
    }));
    wrap.querySelectorAll("[data-name],[data-price],[data-stock]").forEach((inp) => inp.addEventListener("input", () => {
      const i = Number(inp.dataset.name ?? inp.dataset.price ?? inp.dataset.stock);
      if (inp.dataset.name !== undefined) state.swatches[i].name = inp.value;
      if (inp.dataset.price !== undefined) state.swatches[i].price = inp.value;
      if (inp.dataset.stock !== undefined) state.swatches[i].stock = inp.value;
      markDirty();
    }));
  }

  function renderSwatchGallery(idx) {
    const sw = state.swatches[idx];
    const g = $("pfSwatches").querySelector(`[data-gallery="${idx}"]`);
    if (!g) return;
    g.innerHTML = sw.images.map((src) => `<div class="pf-img-slot"><img src="${esc(src)}" alt=""></div>`).join("");
  }

  /* ---------------- wholesale quantity tiers ---------------- */
  const PRODUCT_TIER_KEY = "__product__";

  function wholesaleMeta() {
    return (state.meta && state.meta.wholesale) || { enabled: false, moq: 1 };
  }

  function setTierError(message) {
    const el = $("pfTierError");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("show", !!message);
  }

  function tierTargets() {
    const terms = state.attribute && state.attribute.name ? state.attribute.terms : [];
    return [PRODUCT_TIER_KEY, ...terms];
  }

  function tierRows() {
    if (!state.tiers[state.tierTarget]) state.tiers[state.tierTarget] = [];
    return state.tiers[state.tierTarget];
  }

  function isOpenEnded(row) {
    return row.maxQty === null || row.maxQty === undefined || row.maxQty === "";
  }

  // First From qty is fixed; every next From qty = previous To qty + 1.
  function recalcTierFrom(rows) {
    if (!rows.length) return;
    const moq = Math.max(1, Math.round(Number(wholesaleMeta().moq) || 1));
    let next = Math.max(1, Math.round(Number(rows[0].minQty) || moq));
    rows.forEach((row) => {
      row.minQty = next;
      next = isOpenEnded(row) ? null : Math.round(Number(row.maxQty)) + 1;
    });
  }

  function renderTierTargets() {
    const card = $("pfTiersCard");
    const sel = $("pfTierTarget");
    if (!card || !sel) return;

    if (!wholesaleMeta().enabled) {
      card.hidden = true;
      return;
    }
    card.hidden = false;

    const targets = tierTargets();
    // Removed terms should not keep dangling tier sets.
    Object.keys(state.tiers).forEach((key) => {
      if (key !== PRODUCT_TIER_KEY && !targets.includes(key)) delete state.tiers[key];
    });
    if (!targets.includes(state.tierTarget)) state.tierTarget = PRODUCT_TIER_KEY;

    sel.innerHTML = targets
      .map((key) => `<option value="${esc(key)}">${key === PRODUCT_TIER_KEY ? "Product (default)" : "Variation — " + esc(key)}</option>`)
      .join("");
    sel.value = state.tierTarget;
  }

  function updateTierFromInputs() {
    const rows = tierRows();
    const tbody = $("pfTierRows");
    if (!tbody) return;
    tbody.querySelectorAll("input[data-tier-from]").forEach((inp) => {
      const row = rows[Number(inp.dataset.tierFrom)];
      inp.value = row && row.minQty != null ? row.minQty : "";
    });
  }

  function renderTierRows() {
    const tbody = $("pfTierRows");
    if (!tbody) return;
    if (!wholesaleMeta().enabled) {
      tbody.innerHTML = "";
      return;
    }

    const rows = tierRows();
    recalcTierFrom(rows);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="pf-note" style="border:none;">No tiers yet — add the first quantity break.</td></tr>';
      return;
    }

    tbody.innerHTML = rows
      .map((row, index) => `
        <tr>
          <td><input type="number" data-tier-from="${index}" value="${row.minQty != null ? esc(row.minQty) : ""}" readonly aria-label="From quantity" /></td>
          <td><input type="number" min="${row.minQty || 1}" step="1" placeholder="Unlimited" data-tier-to="${index}" value="${isOpenEnded(row) ? "" : esc(row.maxQty)}" aria-label="To quantity" /></td>
          <td><input type="number" min="0" step="0.01" placeholder="0.00" data-tier-price="${index}" value="${esc(row.price)}" aria-label="Price per unit" /></td>
          <td><button type="button" class="pf-btn-sm" data-tier-remove="${index}" aria-label="Remove tier">Remove</button></td>
        </tr>`)
      .join("");

    tbody.querySelectorAll("input[data-tier-to]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const row = tierRows()[Number(inp.dataset.tierTo)];
        if (!row) return;
        row.maxQty = inp.value.trim() === "" ? null : Math.round(Number(inp.value));
        recalcTierFrom(tierRows());
        updateTierFromInputs();
        setTierError("");
        markDirty();
      });
    });
    tbody.querySelectorAll("input[data-tier-price]").forEach((inp) => {
      inp.addEventListener("input", () => {
        const row = tierRows()[Number(inp.dataset.tierPrice)];
        if (!row) return;
        row.price = inp.value;
        setTierError("");
        markDirty();
      });
    });
    tbody.querySelectorAll("[data-tier-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const index = Number(btn.dataset.tierRemove);
        tierRows().splice(index, 1);
        renderTierRows();
        markDirty();
      });
    });
  }

  function addTierRow() {
    const rows = tierRows();
    if (!rows.length) {
      const moq = Math.max(1, Math.round(Number(wholesaleMeta().moq) || 1));
      rows.push({ minQty: moq, maxQty: null, price: "" });
    } else {
      const last = rows[rows.length - 1];
      if (isOpenEnded(last)) {
        setTierError("Unlimited To qty wala tier shudhu last hote pare.");
        return;
      }
      rows.push({ minQty: Math.round(Number(last.maxQty)) + 1, maxQty: null, price: "" });
    }
    recalcTierFrom(rows);
    renderTierRows();
    setTierError("");
    markDirty();
  }

  function readTierPayload() {
    if (!wholesaleMeta().enabled) return undefined;
    const payload = [];
    for (const key of tierTargets()) {
      const rows = state.tiers[key] || [];
      recalcTierFrom(rows);
      const tiers = rows.map((row, index) => {
        const label = `${key === PRODUCT_TIER_KEY ? "Product" : key} tier ${index + 1}`;
        const minQty = Number(row.minQty);
        if (!Number.isInteger(minQty) || minQty < 1) throw new Error(`${label}: From qty valid hote hobe`);
        const openEnded = isOpenEnded(row);
        const maxQty = openEnded ? null : Number(row.maxQty);
        if (maxQty !== null && (!Number.isInteger(maxQty) || maxQty < minQty)) {
          throw new Error(`${label}: To qty From qty er cheye boro hote hobe`);
        }
        if (openEnded && index !== rows.length - 1) {
          throw new Error(`${label}: Unlimited To qty shudhu last tier e hobe`);
        }
        const price = Number(row.price);
        if (row.price === "" || !Number.isFinite(price) || price < 0) {
          throw new Error(`${label}: Price valid hote hobe`);
        }
        return { minQty, maxQty, pricePaisa: Math.round(price * 100) };
      });
      payload.push({ term: key === PRODUCT_TIER_KEY ? null : key, tiers });
    }
    return payload;
  }

  function renderTiers() {
    renderTierTargets();
    renderTierRows();
    setTierError("");
  }

  /* ---------------- product settings (Settings page theke control hoy) ---------------- */
  function applySettings(s) {
    $("attributesCard").hidden = !s.productAttributesEnabled;
    $("swatchesCard").hidden = !s.productSwatchesEnabled;
  }

  /* ---------------- inline category create ---------------- */
  async function createCategoryInline(e) {
    e.preventDefault();
    const name = $("newCatName").value.trim();
    const errEl = document.querySelector('[data-error="newCatName"]');
    if (!name) {
      errEl.textContent = "Category name lagbe";
      errEl.classList.add("show");
      return;
    }
    errEl.classList.remove("show");
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ name, parent: $("newCatParent").value || null, status: "published" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Category toiri hoyni");
      const meta = await api("GET", "/api/product-form/meta");
      state.meta = meta;
      renderParentOptions();
      renderCategoryTree();
      state.selectedCategories.add(String(data._id));
      const node = $("pfCategoryTree").querySelector(`input[value="${data._id}"]`);
      if (node) node.checked = true;
      $("createCategoryForm").hidden = true;
      $("newCatName").value = "";
      notify("Category added & selected");
      markDirty();
    } catch (err) { notify(err.message, "err"); }
  }

  /* ---------------- payload + save ---------------- */
  function collectPayload(status) {
    const perTerm = $("pfPerTerm").checked;

    const attributes = [];
    if (state.attribute.name && state.attribute.terms.length) {
      attributes.push({
        attribute: state.attribute.name,
        terms: state.attribute.terms,
        perTermPricing: perTerm,
        variations: state.attribute.terms.map((t) => ({
          term: t,
          ...(perTerm ? {
            image: (state.variationData[t] || {}).image || "",
            regularPrice: Number((state.variationData[t] || {}).regularPrice) || 0,
            salePrice: Number((state.variationData[t] || {}).salePrice) || 0,
            stock: Number((state.variationData[t] || {}).stock) || 0,
          } : {}),
        })),
      });
    }

    const swatches = state.swatches
      .filter((s) => s.name || s.images.length)
      .map((s) => ({
        name: s.name,
        price: Number(s.price) || 0,
        stock: Number(s.stock) || 0,
        images: s.images,
      }));

    return {
      title: $("pfTitle").value.trim(),
      description: $("pfDesc").innerHTML,
      shortDescription: $("pfShortDesc").value.trim(),
      sku: $("pfSku").value.trim(),
      regularPrice: Number($("pfRegular").value) || 0,
      salePrice: Number($("pfSale").value) || 0,
      stock: Number($("pfStock").value) || 0,
      weightKg: Number($("pfWeight").value) || 0,
      ...(wholesaleMeta().enabled ? { tiers: readTierPayload() } : {}),
      status,
      categories: [...state.selectedCategories],
      tags: state.tags,
      attributes,
      swatches,
    };
  }

  function validate() {
    const errEl = document.querySelector('[data-error="pfTitle"]');
    if (!$("pfTitle").value.trim()) {
      errEl.textContent = "Product title lagbe";
      errEl.classList.add("show");
      $("pfTitle").focus();
      return false;
    }
    errEl.classList.remove("show");

    if (wholesaleMeta().enabled) {
      try {
        readTierPayload();
        setTierError("");
      } catch (err) {
        setTierError(err.message);
        $("pfTiersCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
        return false;
      }
    }
    return true;
  }

  async function save(status) {
    if (!validate() || state.loading) return;
    state.loading = true;
    const buttons = [$("saveDraftBtn"), $("publishBtn")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      const url = state.editId ? "/api/product-form/" + state.editId : "/api/product-form";
      const method = state.editId ? "PUT" : "POST";
      await api(method, url, collectPayload(status));
      state.dirty = false;
      state.ready = false; // porer bar meta (tags/attributes) freshly load hobe
      notify(status === "published" ? "Product published!" : "Draft saved!", "ok");
      resetForm();
      // dashboard er Products list-e fire jao
      if (typeof window.switchView === "function") window.switchView("products");
    } catch (err) {
      notify(err.message, "err");
    } finally {
      state.loading = false;
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  /* ---------------- reset / load ---------------- */
  function resetForm() {
    state.editId = null;
    state.selectedCategories = new Set();
    if (state.meta && state.meta.uncategorized) state.selectedCategories.add(String(state.meta.uncategorized._id));
    state.tags = [];
    state.attribute = { name: "", terms: [] };
    state.variationData = {};
    state.swatches = [];
    state.tiers = { __product__: [] };
    state.tierTarget = "__product__";

    $("pfTitle").value = "";
    $("pfDesc").innerHTML = "";
    $("pfShortDesc").value = "";
    $("pfSku").value = "";
    $("pfRegular").value = "";
    $("pfSale").value = "";
    $("pfStock").value = "";
    $("pfWeight").value = "";
    $("pfAttrSelect").value = "";
    $("pfTermInput").value = "";
    $("pfPerTerm").checked = false;
    $("pfTagInput").value = "";
    $("newCatName").value = "";
    $("createCategoryForm").hidden = true;
    document.querySelector('[data-error="pfTitle"]').classList.remove("show");
    document.querySelector('[data-error="newCatName"]').classList.remove("show");

    renderCategoryTree();
    renderTags();
    renderTermChips();
    renderVariationTable();
    renderSwatches();
    renderTiers();
  }

  async function loadProduct(id) {
    const data = await api("GET", "/api/product-form/" + id);
    const p = data.product || {};
    state.editId = p._id || id;

    $("pfTitle").value = p.title || p.name || "";
    $("pfDesc").innerHTML = p.description || "";
    $("pfShortDesc").value = p.shortDescription || "";
    $("pfSku").value = p.sku || "";
    $("pfRegular").value = p.regularPrice || p.price || "";
    $("pfSale").value = p.salePrice || "";
    $("pfStock").value = p.stock || "";
    $("pfWeight").value = p.weightKg || "";

    state.selectedCategories = new Set((data.categories || []).map(String));
    const tagNames = new Map((state.meta.tags || []).map((t) => [String(t._id), t.name]));
    state.tags = (data.tags || []).map((t) => tagNames.get(String(t)) || String(t));

    const vars = data.variations || [];
    if (vars.length) {
      state.attribute.name = vars[0].attributeName || "";
      state.attribute.terms = [];
      state.variationData = {};
      vars.forEach((v) => {
        const t = v.termName;
        if (!t) return;
        state.attribute.terms.push(t);
        state.variationData[t] = {
          image: v.image || "",
          regularPrice: v.regularPrice || "",
          salePrice: v.salePrice || "",
          stock: v.stock || "",
        };
      });
      $("pfAttrSelect").value = state.attribute.name;
      $("pfPerTerm").checked = true;
    } else {
      state.attribute = { name: "", terms: [] };
      state.variationData = {};
      $("pfAttrSelect").value = "";
      $("pfPerTerm").checked = false;
    }

    state.swatches = (data.swatches || []).map((s) => ({
      id: s._id,
      name: s.name,
      price: s.price,
      stock: s.stock,
      images: s.images || [],
    }));

    state.tiers = { __product__: [] };
    (data.tierSets || []).forEach((set) => {
      const key = set.term || "__product__";
      state.tiers[key] = (set.tiers || []).map((tier) => ({
        minQty: tier.minQty,
        maxQty: tier.maxQty,
        price: tier.pricePaisa == null ? "" : String(tier.pricePaisa / 100),
      }));
    });
    state.tierTarget = "__product__";

    renderCategoryTree();
    renderTags();
    renderTermChips();
    renderVariationTable();
    renderSwatches();
    renderTiers();
  }

  /* ---------------- init ---------------- */
  async function init() {
    if (state.ready) return;
    const meta = await api("GET", "/api/product-form/meta");
    state.meta = meta;
    renderAttributeSelect();
    renderParentOptions();
    applySettings(meta.settings);
    if (meta.uncategorized) state.selectedCategories.add(String(meta.uncategorized._id));
    renderCategoryTree();
    renderTags();
    renderTermChips();
    renderSwatches();
    renderTiers();
    state.ready = true;
  }

  async function open(id) {
    try {
      if (!state.ready) await init();
      if (id) await loadProduct(id);
    } catch (err) {
      notify(err.message, "err");
    }
  }

  /* ---------------- event wiring (once) ---------------- */
  $("pfTagInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addTagFromInput(); }
  });
  $("pfTermInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addTerm(); }
  });
  $("pfAttrSelect").addEventListener("change", (e) => {
    if (e.target.value === "__new__") {
      const name = prompt("New attribute name (e.g. Size, Color):");
      if (name && name.trim()) {
        const clean = name.trim();
        if (!(state.meta.attributes || []).some((a) => a.name.toLowerCase() === clean.toLowerCase())) {
          state.meta.attributes.push({ _id: "local-" + Date.now(), name: clean, terms: [] });
          renderAttributeSelect();
        }
        $("pfAttrSelect").value = clean;
        selectAttribute(clean);
        markDirty();
      } else {
        e.target.value = "";
      }
    } else {
      selectAttribute(e.target.value);
      markDirty();
    }
  });
  $("pfPerTerm").addEventListener("change", () => { renderVariationTable(); markDirty(); });
  $("addSwatchBtn").addEventListener("click", addSwatch);
  $("pfTierTarget").addEventListener("change", () => {
    state.tierTarget = $("pfTierTarget").value || PRODUCT_TIER_KEY;
    renderTierRows();
    markDirty();
  });
  $("addTierBtn").addEventListener("click", addTierRow);

  // Settings page e Product settings save hole live update
  window.addEventListener("settings:saved", (e) => {
    const s = (e.detail && e.detail.settings) || {};
    const next = {
      productAttributesEnabled: String(s.attributes_enabled !== undefined ? s.attributes_enabled : true) !== "false",
      productSwatchesEnabled: String(s.swatches_enabled !== undefined ? s.swatches_enabled : true) !== "false",
    };
    if (state.meta) state.meta.settings = next;
    applySettings(next);
  });
  $("createCategoryBtn").addEventListener("click", () => { $("createCategoryForm").hidden = false; $("newCatName").focus(); });
  $("cancelCreateCat").addEventListener("click", () => { $("createCategoryForm").hidden = true; $("newCatName").value = ""; });
  $("createCategoryForm").addEventListener("submit", createCategoryInline);
  document.querySelectorAll("#view-add-product .rt-toolbar button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.execCommand(btn.dataset.cmd, false, null);
      $("pfDesc").focus();
    });
  });
  $("saveDraftBtn").addEventListener("click", () => save("draft"));
  $("publishBtn").addEventListener("click", () => save("published"));

  // unsaved changes warning (page close / reload)
  window.addEventListener("beforeunload", (e) => {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  window.productForm = { open, reset: resetForm, save };
})();
