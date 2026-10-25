/* ==========================================================================
   Marketing — Flash sale campaigns + Coupons (admin dashboard)
   window.flashSalesPage / window.couponsPage dashboard.js switchView theke open hoy
   ========================================================================== */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => window.esc(String(s == null ? "" : s));

  const state = {
    options: null,
    optionsPromise: null,
    flashSales: [],
    coupons: [],
    editingFlash: null,
    editingCoupon: null,
    fsTarget: "product",
    fsSelected: { products: new Set(), categories: new Set() },
    cpSelected: { products: new Set(), categories: new Set() },
  };

  const STATUS_LABEL = { live: "Live", upcoming: "Upcoming", ended: "Ended", draft: "Draft" };

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */
  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toLocalInput(value) {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return "";
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function toDateInput(value) {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return "";
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function dateStartISO(value) {
    const d = new Date(value + "T00:00:00");
    return Number.isFinite(d.getTime()) ? d.toISOString() : "";
  }

  function dateEndISO(value) {
    const d = new Date(value + "T23:59:59.999");
    return Number.isFinite(d.getTime()) ? d.toISOString() : "";
  }

  function fmtDateTime(value) {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function fmtDate(value) {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return "—";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  async function getJSON(url) {
    const res = await window.api(url);
    if (!res) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Load hoyni");
    return data;
  }

  async function sendJSON(url, method, payload) {
    const res = await window.api(url, { method, body: JSON.stringify(payload) });
    if (!res) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || "Save hoyni");
    return data;
  }

  function showError(id, message) {
    const el = $(id);
    if (!el) return;
    el.hidden = !message;
    el.textContent = message || "";
  }

  function statCard(label, value, tone) {
    return `<div class="promo-stat"><div class="label">${esc(label)}</div><div class="value ${
      tone || ""
    }">${esc(value)}</div></div>`;
  }

  function renderStats(rootId, items) {
    const root = $(rootId);
    if (!root) return;
    const count = (status) => items.filter((it) => it.status === status).length;
    root.innerHTML =
      statCard("Total", items.length) +
      statCard("Live now", count("live"), "ok") +
      statCard("Upcoming", count("upcoming"), "gold") +
      statCard("Ended", count("ended"), "danger");
  }

  function chips(names, emptyText) {
    const list = (names || []).filter(Boolean);
    if (!list.length) return `<span class="promo-chip">${esc(emptyText)}</span>`;
    const shown = list.slice(0, 4);
    return (
      shown.map((n) => `<span class="promo-chip" title="${esc(n)}">${esc(n)}</span>`).join("") +
      (list.length > 4 ? `<span class="promo-chip more">+${list.length - 4} more</span>` : "")
    );
  }

  function svgEdit() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
  }

  function svgDelete() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
  }

  /* ------------------------------------------------------------------ *
   * Shared options + pickers
   * ------------------------------------------------------------------ */
  function flattenCategories(nodes, depth = 0) {
    const out = [];
    (nodes || []).forEach((node) => {
      out.push({
        id: String(node._id || node.id || ""),
        name: node.name || "Untitled category",
        depth,
      });
      out.push(...flattenCategories(node.children, depth + 1));
    });
    return out;
  }

  async function loadOptions(force) {
    if (state.optionsPromise) return state.optionsPromise;
    if (state.options && !force) return state.options;
    state.optionsPromise = (async () => {
      const data = await getJSON("/api/promotions/options");
      if (!data) return null;
      state.options = {
        products: (data.products || []).map((p) => ({
          id: String(p.id || ""),
          name: p.name || "Untitled product",
          image: p.image || "",
        })),
        categories: flattenCategories(data.categories || []),
      };
      return state.options;
    })();
    try {
      return await state.optionsPromise;
    } catch (err) {
      window.toast(err.message, "err");
      return null;
    } finally {
      state.optionsPromise = null;
    }
  }

  function updateCount(id, selected, total, optionalText) {
    const el = $(id);
    if (!el) return;
    el.textContent = selected.size
      ? `${selected.size} selected`
      : optionalText || "0 selected";
  }

  function renderPicker({ rootId, searchId, countId, items, selected, optionalText, type }) {
    const root = $(rootId);
    const search = $(searchId);
    if (!root) return;
    const emptyText = root.dataset.empty || "Kichu nei";
    root.innerHTML = items.length
      ? items
          .map((item) => {
            const indent = item.depth ? `<span class="opt-depth">${"— ".repeat(item.depth)}</span>` : "";
            const thumb =
              type === "product" && item.image
                ? `<img src="${esc(item.image)}" alt="" loading="lazy" />`
                : "";
            const tag = type === "category" && item.depth === 0 ? '<span class="opt-tag">Top</span>' : "";
            return `<label class="promo-option" data-name="${esc(item.name.toLowerCase())}">
              <input type="checkbox" value="${esc(item.id)}" ${selected.has(item.id) ? "checked" : ""} />
              ${thumb}
              <span class="opt-name">${indent}${esc(item.name)}</span>
              ${tag}
            </label>`;
          })
          .join("")
      : `<div class="promo-picker-empty">${esc(emptyText)}</div>`;

    if (search) {
      search.value = "";
      search.oninput = () => {
        const q = search.value.trim().toLowerCase();
        root.querySelectorAll(".promo-option").forEach((row) => {
          row.classList.toggle("is-hidden", q && !row.dataset.name.includes(q));
        });
      };
    }

    root.querySelectorAll('input[type="checkbox"]').forEach((box) => {
      box.addEventListener("change", () => {
        if (box.checked) selected.add(box.value);
        else selected.delete(box.value);
        updateCount(countId, selected, items.length, optionalText);
      });
    });

    updateCount(countId, selected, items.length, optionalText);
  }

  /* ------------------------------------------------------------------ *
   * Flash sale modal
   * ------------------------------------------------------------------ */
  function setFsTarget(target) {
    state.fsTarget = target === "category" ? "category" : "product";
    document.querySelectorAll("#fsTargetSeg button").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.target === state.fsTarget);
    });
    const productField = $("fsProductField");
    const categoryField = $("fsCategoryField");
    if (productField) productField.hidden = state.fsTarget !== "product";
    if (categoryField) categoryField.hidden = state.fsTarget !== "category";
  }

  function fillFlashPickers() {
    if (!state.options) return;
    renderPicker({
      rootId: "fsProductPicker",
      searchId: "fsProductSearch",
      countId: "fsProductCount",
      items: state.options.products,
      selected: state.fsSelected.products,
      type: "product",
    });
    renderPicker({
      rootId: "fsCategoryPicker",
      searchId: "fsCategorySearch",
      countId: "fsCategoryCount",
      items: state.options.categories,
      selected: state.fsSelected.categories,
      type: "category",
    });
  }

  function openFlashModal(item) {
    state.editingFlash = item || null;
    state.fsSelected.products = new Set((item && item.products || []).map(String));
    state.fsSelected.categories = new Set((item && item.categories || []).map(String));
    showError("fsFormError", "");

    $("fsModalTitle").textContent = item ? "Edit campaign" : "Create campaign";
    $("fsModalSub").textContent = item
      ? "Update campaign schedule, target ba discount"
      : "Product ba category select kore campaign chalu korun";
    $("fsTitle").value = item ? item.title || "" : "";
    $("fsDesc").value = item ? item.description || "" : "";
    $("fsPercent").value = item ? item.discountPercent || "" : "";

    const now = new Date();
    $("fsStart").value = item ? toLocalInput(item.startAt) : toLocalInput(now);
    $("fsEnd").value = item
      ? toLocalInput(item.endAt)
      : toLocalInput(new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000));

    setFsTarget(item ? item.targetType : "product");
    loadOptions().then((options) => {
      if (!options) return;
      fillFlashPickers();
      setFsTarget(state.fsTarget);
    });

    $("fsSave").disabled = false;
    $("fsSave").textContent = item ? "Update campaign" : "Save campaign";
    $("fsOverlay").classList.add("open");
    $("fsTitle").focus();
  }

  function closeFlashModal() {
    $("fsOverlay").classList.remove("open");
    state.editingFlash = null;
  }

  async function saveFlashSale(e) {
    e.preventDefault();
    showError("fsFormError", "");

    const title = $("fsTitle").value.trim();
    const start = $("fsStart").value;
    const end = $("fsEnd").value;
    const percent = Number($("fsPercent").value);

    if (!title) return showError("fsFormError", "Campaign title din");
    if (!start || !end) return showError("fsFormError", "Start ar end date-time din");
    if (new Date(end).getTime() <= new Date(start).getTime()) {
      return showError("fsFormError", "End time start time er pore hote hobe");
    }
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
      return showError("fsFormError", "Discount 1–100% er moddhe din");
    }
    if (state.fsTarget === "product" && !state.fsSelected.products.size) {
      return showError("fsFormError", "At least ekta product select korun");
    }
    if (state.fsTarget === "category" && !state.fsSelected.categories.size) {
      return showError("fsFormError", "At least ekta category select korun");
    }

    const payload = {
      title,
      description: $("fsDesc").value.trim(),
      startAt: new Date(start).toISOString(),
      endAt: new Date(end).toISOString(),
      discountPercent: Math.round(percent),
      targetType: state.fsTarget,
      products: state.fsTarget === "product" ? [...state.fsSelected.products] : [],
      categories: state.fsTarget === "category" ? [...state.fsSelected.categories] : [],
    };

    const btn = $("fsSave");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const editing = state.editingFlash;
      await sendJSON(
        editing ? "/api/flash-sales/" + editing.id : "/api/flash-sales",
        editing ? "PUT" : "POST",
        payload
      );
      closeFlashModal();
      window.toast(editing ? "Campaign update hoyeche" : "Campaign create hoyeche", "ok");
      await loadFlashSales();
    } catch (err) {
      showError("fsFormError", err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = state.editingFlash ? "Update campaign" : "Save campaign";
    }
  }

  /* ------------------------------------------------------------------ *
   * Flash sale list
   * ------------------------------------------------------------------ */
  function flashCard(item) {
    const targetNames =
      item.targetType === "category"
        ? item.categoryNames && item.categoryNames.length
          ? item.categoryNames
          : ["Selected categories"]
        : item.productNames && item.productNames.length
        ? item.productNames
        : ["Selected products"];
    return `<article class="promo-card" data-id="${esc(item.id)}">
      <div class="promo-card-head">
        <div class="promo-card-title">
          <h4>${esc(item.title)}</h4>
          <p>${esc(item.description || "No description")}</p>
        </div>
        <span class="promo-pill ${esc(item.status)}">${esc(STATUS_LABEL[item.status] || item.status)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span class="promo-discount">−${esc(item.discountPercent)}%</span>
        <span class="promo-chip">${item.targetType === "category" ? "Category campaign" : "Product campaign"}</span>
      </div>
      <div class="promo-meta">
        <span>Starts<strong>${esc(fmtDateTime(item.startAt))}</strong></span>
        <span>Ends<strong>${esc(fmtDateTime(item.endAt))}</strong></span>
      </div>
      <div class="promo-chips">${chips(targetNames, "No target")}</div>
      <div class="promo-card-actions">
        <button type="button" class="promo-btn" data-edit="${esc(item.id)}">${svgEdit()}Edit</button>
        <button type="button" class="promo-btn danger" data-delete="${esc(item.id)}">${svgDelete()}Delete</button>
      </div>
    </article>`;
  }

  async function loadFlashSales() {
    const root = $("fsListRoot");
    if (root) root.innerHTML = '<div class="promo-empty">Loading…</div>';
    try {
      const data = await getJSON("/api/flash-sales");
      if (!data) return;
      state.flashSales = data.items || [];
      renderStats("fsStats", state.flashSales);
      if (!root) return;
      root.innerHTML = state.flashSales.length
        ? state.flashSales.map(flashCard).join("")
        : '<div class="promo-empty">Kono campaign nei. “Create campaign” diye prothom flash sale banan.</div>';
    } catch (err) {
      if (root) root.innerHTML = `<div class="promo-empty">${esc(err.message)}</div>`;
      window.toast(err.message, "err");
    }
  }

  async function deleteFlashSale(id) {
    const item = state.flashSales.find((x) => String(x.id) === String(id));
    const ok = await window.confirmDialog({
      title: "Delete campaign?",
      text: item ? `“${item.title}” campaign muche felbe. Ei kaj ferot asbe na.` : "Campaign delete hobe.",
      okLabel: "Delete",
    });
    if (!ok) return;
    try {
      await sendJSON("/api/flash-sales/" + id, "DELETE");
      window.toast("Campaign delete hoyeche", "ok");
      await loadFlashSales();
    } catch (err) {
      window.toast(err.message, "err");
    }
  }

  /* ------------------------------------------------------------------ *
   * Coupon modal
   * ------------------------------------------------------------------ */
  function fillCouponPickers() {
    if (!state.options) return;
    renderPicker({
      rootId: "cpCategoryPicker",
      searchId: "cpCategorySearch",
      countId: "cpCategoryCount",
      items: state.options.categories,
      selected: state.cpSelected.categories,
      optionalText: "0 selected — sob category eligible",
      type: "category",
    });
    renderPicker({
      rootId: "cpProductPicker",
      searchId: "cpProductSearch",
      countId: "cpProductCount",
      items: state.options.products,
      selected: state.cpSelected.products,
      optionalText: "0 selected — sob product eligible",
      type: "product",
    });
  }

  function openCouponModal(item) {
    state.editingCoupon = item || null;
    state.cpSelected.products = new Set((item && item.products || []).map(String));
    state.cpSelected.categories = new Set((item && item.categories || []).map(String));
    showError("cpFormError", "");

    $("cpModalTitle").textContent = item ? "Edit coupon" : "Add coupon";
    $("cpCode").value = item ? item.code || "" : "";
    $("cpType").value = item && item.discountType === "fixed" ? "fixed" : "percent";
    $("cpValue").value = item ? item.discountValue || "" : "";
    $("cpMin").value = item ? item.minOrderAmount || 0 : 0;
    $("cpFreeDelivery").checked = !!(item && item.freeDelivery);

    const today = new Date();
    const weekLater = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    $("cpStart").value = item ? toDateInput(item.startAt) : toDateInput(today);
    $("cpEnd").value = item ? toDateInput(item.endAt) : toDateInput(weekLater);

    loadOptions().then((options) => {
      if (!options) return;
      fillCouponPickers();
    });

    $("cpSave").disabled = false;
    $("cpSave").textContent = item ? "Update coupon" : "Save coupon";
    $("cpOverlay").classList.add("open");
    $("cpCode").focus();
  }

  function closeCouponModal() {
    $("cpOverlay").classList.remove("open");
    state.editingCoupon = null;
  }

  async function saveCoupon(e) {
    e.preventDefault();
    showError("cpFormError", "");

    const code = $("cpCode").value.trim().toUpperCase();
    const discountType = $("cpType").value === "fixed" ? "fixed" : "percent";
    const discountValue = Number($("cpValue").value) || 0;
    const minOrderAmount = Math.max(0, Number($("cpMin").value) || 0);
    const freeDelivery = $("cpFreeDelivery").checked;
    const start = $("cpStart").value;
    const end = $("cpEnd").value;

    if (!code) return showError("cpFormError", "Coupon code din");
    if (!start || !end) return showError("cpFormError", "Start ar end date din");
    if (new Date(end + "T23:59:59").getTime() <= new Date(start + "T00:00:00").getTime()) {
      return showError("cpFormError", "End date start date er pore hote hobe");
    }
    if (discountType === "percent" && (discountValue < 0 || discountValue > 100)) {
      return showError("cpFormError", "Percent discount 0–100 er moddhe din");
    }
    if (!discountValue && !freeDelivery) {
      return showError("cpFormError", "Discount value din ba free delivery on korun");
    }

    const payload = {
      code,
      discountType,
      discountValue,
      minOrderAmount,
      freeDelivery,
      startAt: dateStartISO(start),
      endAt: dateEndISO(end),
      products: [...state.cpSelected.products],
      categories: [...state.cpSelected.categories],
    };

    const btn = $("cpSave");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const editing = state.editingCoupon;
      await sendJSON(
        editing ? "/api/coupons/" + editing.id : "/api/coupons",
        editing ? "PUT" : "POST",
        payload
      );
      closeCouponModal();
      window.toast(editing ? "Coupon update hoyeche" : "Coupon create hoyeche", "ok");
      await loadCoupons();
    } catch (err) {
      showError("cpFormError", err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = state.editingCoupon ? "Update coupon" : "Save coupon";
    }
  }

  /* ------------------------------------------------------------------ *
   * Coupon list
   * ------------------------------------------------------------------ */
  function couponBenefit(item) {
    const parts = [];
    if (item.discountType === "fixed") parts.push(`৳${item.discountValue} off`);
    else if (item.discountValue > 0) parts.push(`${item.discountValue}% off`);
    if (item.freeDelivery) parts.push("free delivery");
    return parts.join(" + ") || "No benefit";
  }

  function couponCard(item) {
    const names = [...(item.categoryNames || []), ...(item.productNames || [])];
    return `<article class="promo-card" data-id="${esc(item.id)}">
      <div class="promo-card-head">
        <div class="promo-card-title">
          <span class="promo-code">${esc(item.code)}</span>
          <p style="margin-top:8px;">${esc(couponBenefit(item))}${
            item.minOrderAmount > 0 ? ` · min order ৳${esc(item.minOrderAmount)}` : ""
          }</p>
        </div>
        <span class="promo-pill ${esc(item.status)}">${esc(STATUS_LABEL[item.status] || item.status)}</span>
      </div>
      <div class="promo-meta">
        <span>Starts<strong>${esc(fmtDate(item.startAt))}</strong></span>
        <span>Ends<strong>${esc(fmtDate(item.endAt))}</strong></span>
      </div>
      <div class="promo-chips">${chips(names, "All products")}</div>
      <div class="promo-card-actions">
        <button type="button" class="promo-btn" data-edit="${esc(item.id)}">${svgEdit()}Edit</button>
        <button type="button" class="promo-btn danger" data-delete="${esc(item.id)}">${svgDelete()}Delete</button>
      </div>
    </article>`;
  }

  async function loadCoupons() {
    const root = $("cpListRoot");
    if (root) root.innerHTML = '<div class="promo-empty">Loading…</div>';
    try {
      const data = await getJSON("/api/coupons");
      if (!data) return;
      state.coupons = data.items || [];
      renderStats("cpStats", state.coupons);
      if (!root) return;
      root.innerHTML = state.coupons.length
        ? state.coupons.map(couponCard).join("")
        : '<div class="promo-empty">Kono coupon nei. “Add coupon” diye prothom code banan.</div>';
    } catch (err) {
      if (root) root.innerHTML = `<div class="promo-empty">${esc(err.message)}</div>`;
      window.toast(err.message, "err");
    }
  }

  async function deleteCoupon(id) {
    const item = state.coupons.find((x) => String(x.id) === String(id));
    const ok = await window.confirmDialog({
      title: "Delete coupon?",
      text: item ? `“${item.code}” coupon muche felbe. Ei kaj ferot asbe na.` : "Coupon delete hobe.",
      okLabel: "Delete",
    });
    if (!ok) return;
    try {
      await sendJSON("/api/coupons/" + id, "DELETE");
      window.toast("Coupon delete hoyeche", "ok");
      await loadCoupons();
    } catch (err) {
      window.toast(err.message, "err");
    }
  }

  /* ------------------------------------------------------------------ *
   * Wire up
   * ------------------------------------------------------------------ */
  function wire() {
    $("fsCreateBtn").addEventListener("click", () => openFlashModal(null));
    $("fsRefresh").addEventListener("click", () => {
      state.options = null;
      loadFlashSales();
    });
    $("fsClose").addEventListener("click", closeFlashModal);
    $("fsCancel").addEventListener("click", closeFlashModal);
    $("fsOverlay").addEventListener("click", (e) => {
      if (e.target === $("fsOverlay")) closeFlashModal();
    });
    $("fsForm").addEventListener("submit", saveFlashSale);
    $("fsTargetSeg").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-target]");
      if (btn) setFsTarget(btn.dataset.target);
    });
    $("fsListRoot").addEventListener("click", (e) => {
      const edit = e.target.closest("[data-edit]");
      const del = e.target.closest("[data-delete]");
      if (edit) {
        const item = state.flashSales.find((x) => String(x.id) === String(edit.dataset.edit));
        if (item) openFlashModal(item);
      } else if (del) {
        deleteFlashSale(del.dataset.delete);
      }
    });

    $("cpCreateBtn").addEventListener("click", () => openCouponModal(null));
    $("cpRefresh").addEventListener("click", () => {
      state.options = null;
      loadCoupons();
    });
    $("cpClose").addEventListener("click", closeCouponModal);
    $("cpCancel").addEventListener("click", closeCouponModal);
    $("cpOverlay").addEventListener("click", (e) => {
      if (e.target === $("cpOverlay")) closeCouponModal();
    });
    $("cpForm").addEventListener("submit", saveCoupon);
    $("cpCode").addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/\s+/g, "");
    });
    $("cpListRoot").addEventListener("click", (e) => {
      const edit = e.target.closest("[data-edit]");
      const del = e.target.closest("[data-delete]");
      if (edit) {
        const item = state.coupons.find((x) => String(x.id) === String(edit.dataset.edit));
        if (item) openCouponModal(item);
      } else if (del) {
        deleteCoupon(del.dataset.delete);
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if ($("fsOverlay").classList.contains("open")) closeFlashModal();
      if ($("cpOverlay").classList.contains("open")) closeCouponModal();
    });

    const fsManage = $("flashSalesManageBtn");
    if (fsManage) {
      fsManage.addEventListener("click", () => {
        if (typeof window.switchView === "function") window.switchView("flash-sales");
      });
    }
    const cpManage = $("couponsManageBtn");
    if (cpManage) {
      cpManage.addEventListener("click", () => {
        if (typeof window.switchView === "function") window.switchView("coupons");
      });
    }
  }

  wire();

  window.flashSalesPage = {
    open() {
      loadOptions();
      loadFlashSales();
    },
  };
  window.couponsPage = {
    open() {
      loadOptions();
      loadCoupons();
    },
  };
})();
