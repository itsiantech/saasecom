/* ==========================================================================
   Brand Management â€” Frontend Logic
   Handles: form, tree list, drag-drop, bulk actions, modals, API calls
   Wrapped in an IIFE so it never collides with dashboard.js globals
   (dashboard.js declares its own `api`, `toast`, `form`, ...).
   ========================================================================== */
(function () {
"use strict";

/* ---- State ---- */
let brands = [];
let selectedIds = new Set();
let currentFilter = { status: "", search: "" };
let dragItem = null;
let dragOverMode = null; // "before", "after", "into"

/* ---- Icon library (Font Awesome free icons subset) ---- */
const ICON_LIBRARY = [
  "fa-shirt", "fa-shoe-prints", "fa-bag-shopping", "fa-gem", "fa-clock",
  "fa-glasses", "fa-watch", "fa-mobile-screen", "fa-laptop", "fa-gamepad",
  "fa-book", "fa-pen", "fa-palette", "fa-music", "fa-camera", "fa-video",
  "fa-dumbbell", "fa-bicycle", "fa-car", "fa-plane", "fa-utensils",
  "fa-mug-hot", "fa-cookie", "fa-ice-cream", "fa-pizza-slice", "fa-burger",
  "fa-bed", "fa-couch", "fa-chair", "fa-lamp", "fa-fan", "fa-snowflake",
  "fa-sun", "fa-cloud-sun", "fa-cloud-rain", "fa-fire", "fa-droplet",
  "fa-leaf", "fa-tree", "fa-seedling", "fa-cat", "fa-dog", "fa-fish",
  "fa-crow", "fa-dove", "fa-spider", "fa-bug", "fa-hippo", "fa-otter",
  "fa-box", "fa-boxes-stacked", "fa-dolly", "fa-truck", "fa-ship",
  "fa-heart", "fa-star", "fa-thumbs-up", "fa-flag", "fa-bookmark",
  "fa-bell", "fa-envelope", "fa-phone", "fa-location-dot", "fa-house",
  "fa-building", "fa-shop", "fa-store", "fa-cart-shopping", "fa-credit-card",
  "fa-wallet", "fa-gift", "fa-tag", "fa-percent", "fa-arrow-right-to-bracket",
  "fa-user", "fa-users", "fa-user-gear", "fa-shield-halved", "fa-gear",
  "fa-wrench", "fa-screwdriver-wrench", "fa-hammer", "fa-toolbox", "fa-key",
  "fa-lock", "fa-unlock", "fa-eye", "fa-eye-slash", "fa-magnifying-glass",
  "fa-filter", "fa-sort", "fa-ellipsis", "fa-rotate", "fa-rotate-left",
  "fa-rotate-right", "fa-xmark", "fa-check", "fa-plus", "fa-minus",
  "fa-circle-plus", "fa-circle-minus", "fa-circle-xmark", "fa-circle-check",
  "fa-trash", "fa-trash-can", "fa-eraser", "fa-file", "fa-file-lines",
  "fa-folder", "fa-folder-open", "fa-cloud", "fa-cloud-arrow-up", "fa-cloud-arrow-down",
  "fa-wifi", "fa-bluetooth", "fa-battery-full", "fa-battery-half", "fa-battery-quarter",
  "fa-signal", "fa-volume-high", "fa-volume-low", "fa-volume-xmark", "fa-microphone",
  "fa-microphone-slash", "fa-camera", "fa-video", "fa-image", "fa-images",
  "fa-film", "fa-tv", "fa-desktop", "fa-keyboard", "fa-mouse",
  "fa-print", "fa-fax", "fa-copy", "fa-paste", "fa-scissors",
  "fa-eraser", "fa-highlighter", "fa-pen-ruler", "fa-ruler", "fa-compass",
  "fa-map", "fa-map-location-dot", "fa-location-arrow", "fa-share-nodes",
  "fa-link", "fa-chain-broken", "fa-unlink", "fa-external-link", "fa-download",
  "fa-upload", "fa-inbox", "fa-paper-plane", "fa-envelope-open", "fa-at",
  "fa-hashtag", "fa-a", "fa-b", "fa-c", "fa-d", "fa-e", "fa-f", "fa-g", "fa-h",
  "fa-i", "fa-j", "fa-k", "fa-l", "fa-m", "fa-n", "fa-o", "fa-p", "fa-q",
  "fa-r", "fa-s", "fa-t", "fa-u", "fa-v", "fa-w", "fa-x", "fa-y", "fa-z",
  "fa-0", "fa-1", "fa-2", "fa-3", "fa-4", "fa-5", "fa-6", "fa-7", "fa-8", "fa-9",
];

/* ---- API helpers ---- */
async function api(method, url, data = null, isFormData = false) {
  const token = localStorage.getItem("luxe_token");
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!isFormData) headers["Content-Type"] = "application/json";

  const options = { method, headers };
  if (data) {
    options.body = isFormData ? data : JSON.stringify(data);
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "API error");
  }
  return res.json();
}

// Render a user-supplied SVG as an <img> (never inline) so embedded scripts
// cannot execute â€” this keeps pasted SVG safe.
function svgToImg(svg) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* ---- Toast notifications ---- */
function toast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show " + (type === "success" ? "ok" : type === "error" ? "err" : "");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3000);
}

/* ---- Confirm modal ---- */
function confirmModal(title, text, onOk) {
  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmText").textContent = text;
  document.getElementById("confirmOverlay").style.display = "flex";

  const okBtn = document.getElementById("confirmOk");
  const cancelBtn = document.getElementById("confirmCancel");

  const cleanup = () => {
    okBtn.removeEventListener("click", onOkClick);
    cancelBtn.removeEventListener("click", onCancelClick);
    document.getElementById("confirmOverlay").style.display = "none";
  };

  const onOkClick = () => {
    cleanup();
    onOk();
  };
  const onCancelClick = () => {
    cleanup();
  };

  okBtn.addEventListener("click", onOkClick);
  cancelBtn.addEventListener("click", onCancelClick);
}

/* ---- Load brands ---- */
async function loadCategories() {
  const params = new URLSearchParams();
  if (currentFilter.status) params.set("status", currentFilter.status);
  if (currentFilter.search) params.set("search", currentFilter.search);
  params.set("tree", "true");

  console.log("Loading brands with params:", params.toString());

  try {
    const { tree, counts } = await api("GET", `/api/brands?${params}`);
    console.log("Categories loaded:", tree);
    brands = tree;
    updateCounts(counts);
    renderTree();
  } catch (err) {
    console.error("Load brands error:", err);
    toast(err.message, "error");
  }
}

/* ---- Update tab badges ---- */
function updateCounts(counts) {
  document.getElementById("brandCountAll").textContent = counts.all || 0;
  document.getElementById("brandCountPublished").textContent = counts.published || 0;
  document.getElementById("brandCountDraft").textContent = counts.draft || 0;
  document.getElementById("brandCountTrashed").textContent = counts.trashed || 0;
}

/* ---- Render tree ---- */
function renderTree() {
  const container = document.getElementById("brandTreeBody");
  if (!brands.length) {
    container.innerHTML = `<div class="cat-empty">No brands found</div>`;
    return;
  }
  container.innerHTML = renderNodes(brands);
  attachDragListeners();
}

function renderNodes(nodes, level = 0) {
  return nodes
    .map((node) => {
      const hasChildren = node.children && node.children.length;
      const statusClass = `st-${node.status}`;
      const displayName = node.name || "Untitled";
      const isUntitled = !node.name;

      let iconHtml = "";
      if (node.icon && node.icon.type === "library" && node.icon.value) {
        iconHtml = `<i class="${node.icon.value}"></i>`;
      } else if (node.icon && node.icon.type === "custom" && node.icon.value) {
        if (node.icon.value.startsWith("<svg")) {
          iconHtml = `<img src="${svgToImg(node.icon.value)}" alt="" />`;
        } else if (node.icon.value.startsWith("fa-")) {
          iconHtml = `<i class="${node.icon.value}"></i>`;
        } else {
          iconHtml = `<img src="${node.icon.value}" alt="" />`;
        }
      } else if (node.image) {
        iconHtml = `<img src="${node.image}" alt="" />`;
      }

      const selected = selectedIds.has(node._id) ? "checked" : "";
      const actions = node.status === "trashed"
        ? `<button class="btn-ghost sm" data-action="restore" data-id="${node._id}">Restore</button>
           <button class="btn-ghost sm danger" data-action="permanent" data-id="${node._id}">Delete</button>`
        : `<button class="btn-ghost sm" data-action="view" data-id="${node._id}">View</button>
           <button class="btn-ghost sm" data-action="edit" data-id="${node._id}">Edit</button>
           <button class="btn-ghost sm danger" data-action="trash" data-id="${node._id}">Trash</button>`;

      return `
        <div class="cat-node" data-id="${node._id}" data-level="${level}">
          <div class="cat-row" draggable="true" data-id="${node._id}">
            <div class="cat-handle" title="Drag to reorder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>
            </div>
            <button class="cat-toggle ${hasChildren ? "" : "leaf"}" data-toggle="${node._id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
            <input type="checkbox" class="cat-check" ${selected} data-check="${node._id}" />
            <div class="cat-thumb">${iconHtml || "<span>No icon</span>"}</div>
            <div class="cat-main">
              <div class="cat-name ${isUntitled ? "untitled" : ""}">${displayName}</div>
              <div class="cat-slug">${node.slug || ""}</div>
            </div>
            <div class="cat-badges">
              <span class="badge st ${statusClass}">${node.status}</span>
            </div>
            <div class="cat-counts">
              <span>${node.childrenCount || 0} children</span>
              <span>${node.productCount || 0} products</span>
            </div>
            <div class="cat-actions">${actions}</div>
          </div>
          ${hasChildren ? `<div class="cat-children" data-children="${node._id}">${renderNodes(node.children, level + 1)}</div>` : ""}
        </div>
      `;
    })
    .join("");
}

/* ---- Attach drag listeners ---- */
function attachDragListeners() {
  const rows = document.querySelectorAll(".cat-row[draggable]");
  rows.forEach((row) => {
    row.addEventListener("dragstart", handleDragStart);
    row.addEventListener("dragend", handleDragEnd);
    row.addEventListener("dragover", handleDragOver);
    row.addEventListener("dragleave", handleDragLeave);
    row.addEventListener("drop", handleDrop);
  });
}

function handleDragStart(e) {
  dragItem = e.currentTarget;
  dragItem.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragItem.dataset.id);
}

function handleDragEnd(e) {
  dragItem.classList.remove("dragging");
  document.querySelectorAll(".cat-row").forEach((r) => {
    r.classList.remove("drop-before", "drop-after", "drop-into");
  });
  dragItem = null;
  dragOverMode = null;
}

function handleDragOver(e) {
  e.preventDefault();
  if (!dragItem || dragItem === e.currentTarget) return;

  const rect = e.currentTarget.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const threshold = rect.height * 0.25;

  e.currentTarget.classList.remove("drop-before", "drop-after", "drop-into");

  if (y < threshold) {
    dragOverMode = "before";
    e.currentTarget.classList.add("drop-before");
  } else if (y > rect.height - threshold) {
    dragOverMode = "after";
    e.currentTarget.classList.add("drop-after");
  } else {
    dragOverMode = "into";
    e.currentTarget.classList.add("drop-into");
  }
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove("drop-before", "drop-after", "drop-into");
}

async function handleDrop(e) {
  e.preventDefault();
  if (!dragItem || dragItem === e.currentTarget) return;

  const sourceId = dragItem.dataset.id;
  const targetRow = e.currentTarget;
  const targetId = targetRow.dataset.id;
  if (sourceId === targetId) return;

  const dragNode = dragItem.closest(".cat-node");
  // Prevent dropping into our own subtree (cycle prevention, mirrored server-side).
  if (dragNode && dragNode.contains(targetRow)) return;

  // Resolve the target container and the new parent.
  let container = targetRow.closest(".cat-children");
  let newParent = container ? container.dataset.children : null;
  if (dragOverMode === "into") {
    newParent = targetId;
    container = targetRow.closest(".cat-node").querySelector(":scope > .cat-children") || null;
  }

  const listEl = container || document.getElementById("brandTreeBody");
  const ids = [...listEl.children]
    .filter((el) => el.classList.contains("cat-node"))
    .map((el) => el.dataset.id);

  // Remove the dragged id from its old position (same container only).
  const sIdx = ids.indexOf(sourceId);
  if (sIdx >= 0) ids.splice(sIdx, 1);

  let insertAt = ids.length; // "into" -> append at the end
  if (dragOverMode === "before" || dragOverMode === "after") {
    const tIdx = ids.indexOf(targetId);
    if (tIdx >= 0) insertAt = dragOverMode === "before" ? tIdx : tIdx + 1;
  }
  ids.splice(insertAt, 0, sourceId);

  const items = ids.map((id, i) => ({ id, parent: newParent, order: i }));

  // If the item moved between containers, normalise the source container too.
  const fromContainer = dragItem.closest(".cat-children") || document.getElementById("brandTreeBody");
  if (fromContainer !== listEl) {
    const fromParent = fromContainer.dataset.children || null;
    [...fromContainer.children]
      .filter((el) => el.classList.contains("cat-node"))
      .map((el) => el.dataset.id)
      .filter((id) => id !== sourceId)
      .forEach((id, i) => items.push({ id, parent: fromParent, order: i }));
  }

  try {
    await api("PATCH", "/api/brands/reorder", { items });
    toast("Brand moved", "success");
    loadCategories();
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ---- Toggle expand/collapse ---- */
document.addEventListener("click", (e) => {
  const toggle = e.target.closest(".cat-toggle");
  if (toggle && !toggle.classList.contains("leaf")) {
    const id = toggle.dataset.toggle;
    const children = document.querySelector(`.cat-children[data-children="${id}"]`);
    if (children) {
      children.style.display = children.style.display === "none" ? "block" : "none";
      toggle.classList.toggle("open");
    }
  }
});

/* ---- Form handling ---- */
const form = document.getElementById("brandForm");
const brandIdInput = document.getElementById("brandId");
const brandNameInput = document.getElementById("brandName");
const brandSlugInput = document.getElementById("brandSlug");
const brandParentSelect = document.getElementById("brandParent");
const brandOrderInput = document.getElementById("brandOrder");
const brandMsg = document.getElementById("brandMsg");

/* ==========================================================================
   Reusable searchable dropdown â€” used by the Parent selector and any future
   "Move to..." selector. The `hidden` attribute is the SINGLE source of truth
   for open/closed; the `open` class is styling-only and always kept in sync.
   ========================================================================== */
function createDropdown(cfg) {
  const { root, trigger, panel, search, list } = cfg;
  let isOpen = false;
  let activeIndex = -1;
  let filtered = [];

  const selectedId = () => cfg.getSelected();

  function setOpen(open) {
    isOpen = open;
    panel.hidden = !open;                 // single source of truth
    root.classList.toggle("open", open);  // styling only, always in sync
    trigger.setAttribute("aria-expanded", String(open));
  }

  function render(filterText = "") {
    const q = (filterText || "").trim().toLowerCase();
    const all = cfg.getOptions();
    const shown = q ? all.filter((o) => (o.path || o.label).toLowerCase().includes(q)) : all;
    filtered = shown.filter((o) => !o.disabled);

    if (!shown.length) {
      list.innerHTML = '<div class="cat-select-empty">No matches</div>';
      return;
    }
    list.innerHTML = shown
      .map((o) => {
        const sel = String(o.id) === String(selectedId()) ? " selected" : "";
        const dis = o.disabled ? " disabled" : "";
        const ariaSel = o.disabled ? "" : ` aria-selected="${sel ? "true" : "false"}"`;
        const ariaDis = o.disabled ? ' aria-disabled="true"' : "";
        return `<div class="cat-select-option${sel}${dis}" role="option" data-id="${o.id}"${ariaSel}${ariaDis}>${esc(o.path || o.label)}</div>`;
      })
      .join("");
    setActiveIndex(-1);
  }

  function setActiveIndex(i) {
    activeIndex = i;
    list.querySelectorAll(".cat-select-option").forEach((el, idx) => {
      el.classList.toggle("active", idx === i && !el.classList.contains("disabled"));
    });
    const active = list.querySelectorAll(".cat-select-option")[i];
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  function open() {
    if (isOpen) return;
    if (search) search.value = "";
    render();
    setOpen(true);
    if (search) search.focus();
  }

  function close() {
    if (!isOpen) return;
    setOpen(false);
    trigger.focus();
  }

  function selectOption(opt) {
    if (!opt || opt.classList.contains("disabled")) return;
    cfg.onSelect(opt.dataset.id);
    if (search) search.value = "";
    setOpen(false);
    trigger.focus();
  }

  function move(delta) {
    if (!filtered.length) return;
    let i = activeIndex < 0 ? (delta > 0 ? 0 : filtered.length - 1) : activeIndex + delta;
    if (i < 0) i = filtered.length - 1;
    if (i >= filtered.length) i = 0;
    setActiveIndex(i);
  }

  function selectActive() {
    const opt = filtered[activeIndex];
    if (!opt) return;
    const el = list.querySelector(`.cat-select-option[data-id="${opt.id}"]:not(.disabled)`);
    if (el) selectOption(el);
  }

  // stopPropagation on the trigger so the outside-click handler doesn't re-open it.
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    isOpen ? close() : open();
  });

  if (search) {
    search.addEventListener("input", () => render(search.value));
    search.addEventListener("click", (e) => e.stopPropagation());
    search.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1); }
      else if (e.key === "Enter") { e.preventDefault(); selectActive(); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
  }

  list.addEventListener("click", (e) => {
    const opt = e.target.closest(".cat-select-option");
    if (!opt || opt.classList.contains("disabled")) return;
    selectOption(opt);
  });

  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!isOpen) open(); move(e.key === "ArrowDown" ? 1 : -1); }
    else if (e.key === "Enter" && isOpen) { e.preventDefault(); selectActive(); }
    else if (e.key === "Escape" && isOpen) { e.preventDefault(); close(); }
  });

  // Document-level: click outside closes; Escape closes.
  document.addEventListener("click", (e) => {
    if (!root.contains(e.target)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) close();
  });

  return { open, close, render, isOpen: () => isOpen };
}

/* ---- Parent selector instance ---- */
const brandParentSelectEl = document.getElementById("brandParentSelect");
const brandParentTrigger = document.getElementById("brandParentTrigger");
const brandParentPanel = document.getElementById("brandParentPanel");
const brandParentList = document.getElementById("brandParentList");
const brandParentSearch = document.getElementById("brandParentSearch");
const brandParentValue = document.getElementById("brandParentValue");
let parentTree = [];

// Flatten the tree into { id, path, disabled }. The brand being edited and
// its entire subtree are marked disabled so they cannot be chosen as a parent
// (prevents cycles). Root is always selectable.
function collectParentOptions(nodes, prefix = "", out = [], excludeId = null, subtreeDisabled = false) {
  nodes.forEach((node) => {
    const disabled = subtreeDisabled || (excludeId && String(node._id) === String(excludeId));
    const name = node.name || "Untitled";
    const path = prefix ? prefix + " > " + name : name;
    out.push({ id: node._id, path, disabled });
    if (node.children && node.children.length) {
      collectParentOptions(node.children, path, out, excludeId, disabled);
    }
  });
  return out;
}

// Placeholder shown when no parent is selected (root level).
const PARENT_PLACEHOLDER = "Select Brand";

function getParentOptions() {
  const excludeId = brandIdInput.value || null;
  return [{ id: "", path: PARENT_PLACEHOLDER }, ...collectParentOptions(parentTree, "", [], excludeId)];
}

function updateParentTrigger() {
  const id = brandParentSelect.value;
  const found = collectParentOptions(parentTree).find((o) => o.id === id);
  brandParentValue.textContent = found ? found.path : PARENT_PLACEHOLDER;
}

const parentDropdown = createDropdown({
  root: brandParentSelectEl,
  trigger: brandParentTrigger,
  panel: brandParentPanel,
  search: brandParentSearch,
  list: brandParentList,
  getSelected: () => brandParentSelect.value,
  getOptions: getParentOptions,
  onSelect: (id) => { brandParentSelect.value = id; updateParentTrigger(); },
});

async function populateParentSelect() {
  try {
    const { tree } = await api("GET", "/api/brands?tree=true");
    parentTree = tree;
    parentDropdown.render();
    updateParentTrigger();
  } catch (err) {
    console.error("Load parent brands error:", err);
  }
}

/* ---- Icon picker ---- */
const brandIconSearch = document.getElementById("brandIconSearch");
const brandIconGrid = document.getElementById("brandIconGrid");
const brandIconLibraryPanel = document.getElementById("brandIconLibraryPanel");
const brandIconCustomPanel = document.getElementById("brandIconCustomPanel");
const brandIconPreview = document.getElementById("brandIconPreview");
const brandIconPreviewLabel = document.getElementById("brandIconPreviewLabel");

let selectedIcon = { type: "none", value: "" };

function renderIconGrid(filter = "") {
  const filtered = ICON_LIBRARY.filter((icon) =>
    icon.toLowerCase().includes(filter.toLowerCase())
  );
  brandIconGrid.innerHTML = filtered
    .map((icon) => {
      const full = "fa-solid " + icon;
      const active = selectedIcon.type === "library" && selectedIcon.value === full ? "active" : "";
      return `<div class="icon-item ${active}" data-icon="${full}"><i class="${full}"></i></div>`;
    })
    .join("");
}

brandIconSearch.addEventListener("input", (e) => renderIconGrid(e.target.value));

brandIconGrid.addEventListener("click", (e) => {
  const item = e.target.closest(".icon-item");
  if (item) {
    selectedIcon = { type: "library", value: item.dataset.icon };
    updateIconPreview();
    renderIconGrid(brandIconSearch.value);
  }
});

document.querySelectorAll(".icon-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".icon-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const type = tab.dataset.icontype;
    brandIconLibraryPanel.hidden = type !== "library";
    brandIconCustomPanel.hidden = type !== "custom";
  });
});

document.querySelectorAll(".icon-mode").forEach((mode) => {
  mode.addEventListener("click", () => {
    document.querySelectorAll(".icon-mode").forEach((m) => m.classList.remove("active"));
    mode.classList.add("active");
    const modeType = mode.dataset.mode;
    document.getElementById("brandIconSvgInput").hidden = modeType !== "svg";
    document.getElementById("brandIconClassInput").hidden = modeType !== "class";
    document.getElementById("brandIconUploadBtn").hidden = modeType !== "upload";
  });
});

document.getElementById("brandIconSvgInput").addEventListener("input", (e) => {
  selectedIcon = { type: "custom", value: e.target.value };
  updateIconPreview();
});

document.getElementById("brandIconClassInput").addEventListener("input", (e) => {
  selectedIcon = { type: "custom", value: e.target.value };
  updateIconPreview();
});

document.getElementById("brandIconUploadInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      selectedIcon = { type: "custom", value: ev.target.result };
      updateIconPreview();
    };
    reader.readAsDataURL(file);
  }
});

document.getElementById("brandIconUploadBtn").addEventListener("click", () => {
  document.getElementById("brandIconUploadInput").click();
});

function updateIconPreview() {
  if (selectedIcon.type === "none") {
    brandIconPreview.innerHTML = "<span>No icon</span>";
    brandIconPreviewLabel.textContent = "No icon selected";
  } else if (selectedIcon.type === "library") {
    brandIconPreview.innerHTML = `<i class="${selectedIcon.value}"></i>`;
    brandIconPreviewLabel.textContent = selectedIcon.value;
  } else if (selectedIcon.type === "custom") {
    if (selectedIcon.value.startsWith("<svg")) {
      brandIconPreview.innerHTML = `<img src="${svgToImg(selectedIcon.value)}" alt="" />`;
      brandIconPreviewLabel.textContent = "Custom SVG";
    } else if (selectedIcon.value.startsWith("fa-")) {
      brandIconPreview.innerHTML = `<i class="${selectedIcon.value}"></i>`;
      brandIconPreviewLabel.textContent = selectedIcon.value;
    } else {
      brandIconPreview.innerHTML = `<img src="${selectedIcon.value}" alt="" />`;
      brandIconPreviewLabel.textContent = "Custom image";
    }
  }
}

/* ---- Image upload ---- */
const brandImageInput = document.getElementById("brandImageInput");
const brandImagePreview = document.getElementById("brandImagePreview");
const brandImageBtn = document.getElementById("brandImageBtn");
const brandImageRemove = document.getElementById("brandImageRemove");
let uploadedImage = null;
let imageRemoved = false;

brandImageBtn.addEventListener("click", () => brandImageInput.click());

brandImageInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    if (file.size > 2 * 1024 * 1024) {
      toast("Image must be under 2MB", "error");
      return;
    }
    uploadedImage = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      brandImagePreview.innerHTML = `<img src="${ev.target.result}" alt="" />`;
      brandImageRemove.hidden = false;
    };
    reader.readAsDataURL(file);
  }
});

brandImageRemove.addEventListener("click", () => {
  uploadedImage = null;
  imageRemoved = true;
  brandImageInput.value = "";
  brandImagePreview.innerHTML = "<span>No image</span>";
  brandImageRemove.hidden = true;
});

/* ---- Form submit ---- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  brandMsg.textContent = "";

  const isEdit = !!brandIdInput.value;
  const formData = new FormData();
  formData.append("name", brandNameInput.value || "");
  formData.append("slug", brandSlugInput.value || "");
  formData.append("parent", brandParentSelect.value || "");
  formData.append("order", brandOrderInput.value || "0");
  formData.append("iconType", selectedIcon.type || "none");
  formData.append("iconValue", selectedIcon.value || "");

  const submitter = e.submitter;
  const status = submitter && submitter.id === "brandPublish" ? "published" : "draft";
  formData.append("status", status);

  if (uploadedImage) {
    formData.append("image", uploadedImage);
  }

  // Only remove the stored image when the user explicitly clicked "Remove".
  if (imageRemoved) {
    formData.append("imageRemove", "true");
  }

  console.log("Submitting brand:", {
    isEdit,
    name: brandNameInput.value,
    slug: brandSlugInput.value,
    parent: brandParentSelect.value,
    status,
    icon: selectedIcon,
  });

  try {
    const url = isEdit ? `/api/brands/${brandIdInput.value}` : "/api/brands";
    const method = isEdit ? "PUT" : "POST";
    const result = await api(method, url, formData, true);
    console.log("API response:", result);
    toast(isEdit ? "Brand updated" : "Brand created", "success");
    resetForm();
    loadCategories();
  } catch (err) {
    console.error("Submit error:", err);
    brandMsg.textContent = err.message;
    toast(err.message, "error");
  }
});

/* ---- Reset form ---- */
function resetForm() {
  form.reset();
  updateParentTrigger();
  brandIdInput.value = "";
  brandMsg.textContent = "";
  uploadedImage = null;
  imageRemoved = false;
  brandImagePreview.innerHTML = "<span>No image</span>";
  brandImageRemove.hidden = true;
  selectedIcon = { type: "none", value: "" };
  updateIconPreview();
  renderIconGrid();
  document.getElementById("brandFormTitle").textContent = "Add Brand";
}

document.getElementById("brandResetBtn").addEventListener("click", resetForm);

/* ---- Load brand for edit ---- */
async function loadBrandForEdit(id) {
  try {
    const cat = await api("GET", `/api/brands/${id}`);
    imageRemoved = false;
    brandIdInput.value = cat.brand._id;
    brandNameInput.value = cat.brand.name;
    brandSlugInput.value = cat.brand.slug;
    brandParentSelect.value = cat.brand.parent || "";
    updateParentTrigger();
    brandOrderInput.value = cat.brand.order;

    if (cat.brand.icon) {
      selectedIcon = { type: cat.brand.icon.type, value: cat.brand.icon.value };
      updateIconPreview();
      if (selectedIcon.type === "library") {
        renderIconGrid(brandIconSearch.value);
      }
    }

    if (cat.brand.image) {
      brandImagePreview.innerHTML = `<img src="${cat.brand.image}" alt="" />`;
      brandImageRemove.hidden = false;
    }

    const status = cat.brand.status;
    form.querySelector(`input[name="catStatus"][value="${status}"]`).checked = true;

    document.getElementById("brandFormTitle").textContent = "Edit Brand";
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ---- View brand modal ---- */
async function viewBrand(id) {
  try {
    const data = await api("GET", `/api/brands/${id}`);
    const cat = data.brand;
    const breadcrumb = data.breadcrumb.map((b) => b.name || "Untitled").join(" > ");

    let iconHtml = "";
    if (cat.icon && cat.icon.type === "library" && cat.icon.value) {
      iconHtml = `<i class="${cat.icon.value}"></i>`;
    } else if (cat.icon && cat.icon.type === "custom" && cat.icon.value) {
      iconHtml = cat.icon.value.startsWith("<svg") ? `<img src="${svgToImg(cat.icon.value)}" alt="" />` : `<img src="${cat.icon.value}" alt="" />`;
    }

    let childrenHtml = "";
    if (data.children && data.children.length) {
      childrenHtml = data.children
        .map((c) => {
          const subChildren = c.children && c.children.length
            ? c.children.map((sc) => `<div class="lvl2">â€¢ ${sc.name || "Untitled"}</div>`).join("")
            : "";
          return `<div class="lvl1">â€¢ ${c.name || "Untitled"}${subChildren}</div>`;
        })
        .join("");
    } else {
      childrenHtml = "<p>No sub-brands</p>";
    }

    document.getElementById("catViewTitle").textContent = cat.name || "Untitled";
    document.getElementById("catViewBody").innerHTML = `
      <div class="cat-view-grid">
        <div>
          <div class="cat-view-label">Breadcrumb</div>
          <div class="cat-view-value">${breadcrumb}</div>
        </div>
        <div>
          <div class="cat-view-label">Slug</div>
          <div class="cat-view-value">${cat.slug || ""}</div>
        </div>
        <div>
          <div class="cat-view-label">Status</div>
          <div class="cat-view-value">${cat.status}</div>
        </div>
        <div>
          <div class="cat-view-label">Level</div>
          <div class="cat-view-value">${cat.level}</div>
        </div>
        <div class="full">
          <div class="cat-view-label">Icon</div>
          <div class="cat-view-value" style="font-size:24px;">${iconHtml || "None"}</div>
        </div>
        <div class="full">
          <div class="cat-view-label">Image</div>
          ${cat.image ? `<img src="${cat.image}" class="cat-view-thumb" />` : "<div class=\"cat-view-value\">No image</div>"}
        </div>
        <div class="full">
          <div class="cat-view-label">Sub-brands</div>
          <div class="cat-mini-tree">${childrenHtml}</div>
        </div>
        <div class="full">
          <div class="cat-view-label">Products (${data.products.length})</div>
          <div class="cat-view-value">${data.products.map((p) => p.name).join(", ") || "None"}</div>
        </div>
      </div>
    `;
    document.getElementById("catViewOverlay").style.display = "flex";
  } catch (err) {
    toast(err.message, "error");
  }
}

document.getElementById("catViewClose").addEventListener("click", () => {
  document.getElementById("catViewOverlay").style.display = "none";
});

/* ---- Actions (view, edit, trash, restore, permanent) ---- */
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === "view") {
    viewBrand(id);
  } else if (action === "edit") {
    loadBrandForEdit(id);
  } else if (action === "trash") {
    confirmModal("Move to Trash?", "This will also trash all sub-brands.", async () => {
      try {
        await api("DELETE", `/api/brands/${id}`);
        toast("Moved to trash", "success");
        loadCategories();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  } else if (action === "restore") {
    try {
      await api("PATCH", `/api/brands/${id}/restore`);
      toast("Restored", "success");
      loadCategories();
    } catch (err) {
      toast(err.message, "error");
    }
  } else if (action === "permanent") {
    confirmModal("Delete Permanently?", "This cannot be undone and will delete all sub-brands.", async () => {
      try {
        await api("DELETE", `/api/brands/${id}/permanent`);
        toast("Deleted permanently", "success");
        loadCategories();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }
});

/* ---- Bulk actions ---- */
document.addEventListener("change", (e) => {
  const check = e.target.closest(".cat-check");
  if (check) {
    const id = check.dataset.check;
    if (check.checked) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
    updateBulkBar();
  }
});

document.getElementById("brandSelectAll").addEventListener("change", (e) => {
  const all = e.target.checked;
  document.querySelectorAll(".cat-check").forEach((check) => {
    check.checked = all;
    const id = check.dataset.check;
    if (all) selectedIds.add(id);
    else selectedIds.delete(id);
  });
  updateBulkBar();
});

function updateBulkBar() {
  const bar = document.getElementById("brandBulkBar");
  const count = document.getElementById("brandSelectedCount");
  count.textContent = `${selectedIds.size} selected`;
  bar.hidden = selectedIds.size === 0;
}

document.getElementById("brandBulkBar").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-bulk]");
  if (!btn) return;

  const action = btn.dataset.bulk;
  const ids = [...selectedIds];

  if (action === "permanent") {
    confirmModal("Delete Permanently?", "This cannot be undone.", async () => {
      try {
        await api("PATCH", "/api/brands/bulk", { action, ids });
        toast("Deleted permanently", "success");
        selectedIds.clear();
        updateBulkBar();
        loadCategories();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  } else {
    try {
      await api("PATCH", "/api/brands/bulk", { action, ids });
      toast("Bulk action completed", "success");
      selectedIds.clear();
      updateBulkBar();
      loadCategories();
    } catch (err) {
      toast(err.message, "error");
    }
  }
});

/* ---- Tabs ---- */
document.getElementById("brandTabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".cat-tab");
  if (!tab) return;

  document.querySelectorAll(".cat-tab").forEach((t) => t.classList.remove("active"));
  tab.classList.add("active");

  currentFilter.status = tab.dataset.status;
  loadCategories();
});

/* ---- Search (debounced) ---- */
let searchTimer = null;
document.getElementById("brandSearch").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentFilter.search = e.target.value;
    loadCategories();
  }, 300);
});

/* ---- Initialize ---- */
populateParentSelect();
renderIconGrid();
loadCategories();

})();

