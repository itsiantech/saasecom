/* ==========================================================================
   Category Management — Frontend Logic
   Handles: form, tree list, drag-drop, bulk actions, modals, API calls
   Wrapped in an IIFE so it never collides with dashboard.js globals
   (dashboard.js declares its own `api`, `toast`, `form`, ...).
   ========================================================================== */
(function () {
"use strict";

/* ---- State ---- */
let categories = [];
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
// cannot execute — this keeps pasted SVG safe.
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

/* ---- Load categories ---- */
async function loadCategories() {
  const params = new URLSearchParams();
  if (currentFilter.status) params.set("status", currentFilter.status);
  if (currentFilter.search) params.set("search", currentFilter.search);
  params.set("tree", "true");

  console.log("Loading categories with params:", params.toString());

  try {
    const { tree, counts } = await api("GET", `/api/categories?${params}`);
    console.log("Categories loaded:", tree);
    categories = tree;
    updateCounts(counts);
    renderTree();
  } catch (err) {
    console.error("Load categories error:", err);
    toast(err.message, "error");
  }
}

/* ---- Update tab badges ---- */
function updateCounts(counts) {
  document.getElementById("countAll").textContent = counts.all || 0;
  document.getElementById("countPublished").textContent = counts.published || 0;
  document.getElementById("countDraft").textContent = counts.draft || 0;
  document.getElementById("countTrashed").textContent = counts.trashed || 0;
}

/* ---- Render tree ---- */
function renderTree() {
  const container = document.getElementById("catTreeBody");
  if (!categories.length) {
    container.innerHTML = `<div class="cat-empty">No categories found</div>`;
    return;
  }
  container.innerHTML = renderNodes(categories);
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

  const listEl = container || document.getElementById("catTreeBody");
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
  const fromContainer = dragItem.closest(".cat-children") || document.getElementById("catTreeBody");
  if (fromContainer !== listEl) {
    const fromParent = fromContainer.dataset.children || null;
    [...fromContainer.children]
      .filter((el) => el.classList.contains("cat-node"))
      .map((el) => el.dataset.id)
      .filter((id) => id !== sourceId)
      .forEach((id, i) => items.push({ id, parent: fromParent, order: i }));
  }

  try {
    await api("PATCH", "/api/categories/reorder", { items });
    toast("Category moved", "success");
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
const form = document.getElementById("categoryForm");
const catIdInput = document.getElementById("catId");
const catNameInput = document.getElementById("catName");
const catSlugInput = document.getElementById("catSlug");
const catParentSelect = document.getElementById("catParent");
const catOrderInput = document.getElementById("catOrder");
const catMsg = document.getElementById("catMsg");

/* ==========================================================================
   Reusable searchable dropdown — used by the Parent selector and any future
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
const catParentSelectEl = document.getElementById("catParentSelect");
const catParentTrigger = document.getElementById("catParentTrigger");
const catParentPanel = document.getElementById("catParentPanel");
const catParentList = document.getElementById("catParentList");
const catParentSearch = document.getElementById("catParentSearch");
const catParentValue = document.getElementById("catParentValue");
let parentTree = [];

// Flatten the tree into { id, path, disabled }. The category being edited and
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
const PARENT_PLACEHOLDER = "Select Category";

function getParentOptions() {
  const excludeId = catIdInput.value || null;
  return [{ id: "", path: PARENT_PLACEHOLDER }, ...collectParentOptions(parentTree, "", [], excludeId)];
}

function updateParentTrigger() {
  const id = catParentSelect.value;
  const found = collectParentOptions(parentTree).find((o) => o.id === id);
  catParentValue.textContent = found ? found.path : PARENT_PLACEHOLDER;
}

const parentDropdown = createDropdown({
  root: catParentSelectEl,
  trigger: catParentTrigger,
  panel: catParentPanel,
  search: catParentSearch,
  list: catParentList,
  getSelected: () => catParentSelect.value,
  getOptions: getParentOptions,
  onSelect: (id) => { catParentSelect.value = id; updateParentTrigger(); },
});

async function populateParentSelect() {
  try {
    const { tree } = await api("GET", "/api/categories?tree=true");
    parentTree = tree;
    parentDropdown.render();
    updateParentTrigger();
  } catch (err) {
    console.error("Load parent categories error:", err);
  }
}

/* ---- Icon picker ---- */
const iconSearch = document.getElementById("iconSearch");
const iconGrid = document.getElementById("iconGrid");
const iconLibraryPanel = document.getElementById("iconLibraryPanel");
const iconCustomPanel = document.getElementById("iconCustomPanel");
const iconPreview = document.getElementById("iconPreview");
const iconPreviewLabel = document.getElementById("iconPreviewLabel");

let selectedIcon = { type: "none", value: "" };

function renderIconGrid(filter = "") {
  const filtered = ICON_LIBRARY.filter((icon) =>
    icon.toLowerCase().includes(filter.toLowerCase())
  );
  iconGrid.innerHTML = filtered
    .map((icon) => {
      const full = "fa-solid " + icon;
      const active = selectedIcon.type === "library" && selectedIcon.value === full ? "active" : "";
      return `<div class="icon-item ${active}" data-icon="${full}"><i class="${full}"></i></div>`;
    })
    .join("");
}

iconSearch.addEventListener("input", (e) => renderIconGrid(e.target.value));

iconGrid.addEventListener("click", (e) => {
  const item = e.target.closest(".icon-item");
  if (item) {
    selectedIcon = { type: "library", value: item.dataset.icon };
    updateIconPreview();
    renderIconGrid(iconSearch.value);
  }
});

document.querySelectorAll(".icon-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".icon-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const type = tab.dataset.icontype;
    iconLibraryPanel.hidden = type !== "library";
    iconCustomPanel.hidden = type !== "custom";
  });
});

document.querySelectorAll(".icon-mode").forEach((mode) => {
  mode.addEventListener("click", () => {
    document.querySelectorAll(".icon-mode").forEach((m) => m.classList.remove("active"));
    mode.classList.add("active");
    const modeType = mode.dataset.mode;
    document.getElementById("iconSvgInput").hidden = modeType !== "svg";
    document.getElementById("iconClassInput").hidden = modeType !== "class";
    document.getElementById("iconUploadBtn").hidden = modeType !== "upload";
  });
});

document.getElementById("iconSvgInput").addEventListener("input", (e) => {
  selectedIcon = { type: "custom", value: e.target.value };
  updateIconPreview();
});

document.getElementById("iconClassInput").addEventListener("input", (e) => {
  selectedIcon = { type: "custom", value: e.target.value };
  updateIconPreview();
});

document.getElementById("iconUploadInput").addEventListener("change", (e) => {
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

document.getElementById("iconUploadBtn").addEventListener("click", () => {
  document.getElementById("iconUploadInput").click();
});

function updateIconPreview() {
  if (selectedIcon.type === "none") {
    iconPreview.innerHTML = "<span>No icon</span>";
    iconPreviewLabel.textContent = "No icon selected";
  } else if (selectedIcon.type === "library") {
    iconPreview.innerHTML = `<i class="${selectedIcon.value}"></i>`;
    iconPreviewLabel.textContent = selectedIcon.value;
  } else if (selectedIcon.type === "custom") {
    if (selectedIcon.value.startsWith("<svg")) {
      iconPreview.innerHTML = `<img src="${svgToImg(selectedIcon.value)}" alt="" />`;
      iconPreviewLabel.textContent = "Custom SVG";
    } else if (selectedIcon.value.startsWith("fa-")) {
      iconPreview.innerHTML = `<i class="${selectedIcon.value}"></i>`;
      iconPreviewLabel.textContent = selectedIcon.value;
    } else {
      iconPreview.innerHTML = `<img src="${selectedIcon.value}" alt="" />`;
      iconPreviewLabel.textContent = "Custom image";
    }
  }
}

/* ---- Image upload ---- */
const catImageInput = document.getElementById("catImageInput");
const catImagePreview = document.getElementById("catImagePreview");
const catImageBtn = document.getElementById("catImageBtn");
const catImageRemove = document.getElementById("catImageRemove");
let uploadedImage = null;
let imageRemoved = false;

catImageBtn.addEventListener("click", () => catImageInput.click());

catImageInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    if (file.size > 2 * 1024 * 1024) {
      toast("Image must be under 2MB", "error");
      return;
    }
    uploadedImage = file;
    const reader = new FileReader();
    reader.onload = (ev) => {
      catImagePreview.innerHTML = `<img src="${ev.target.result}" alt="" />`;
      catImageRemove.hidden = false;
    };
    reader.readAsDataURL(file);
  }
});

catImageRemove.addEventListener("click", () => {
  uploadedImage = null;
  imageRemoved = true;
  catImageInput.value = "";
  catImagePreview.innerHTML = "<span>No image</span>";
  catImageRemove.hidden = true;
});

/* ---- Form submit ---- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  catMsg.textContent = "";

  const isEdit = !!catIdInput.value;
  const formData = new FormData();
  formData.append("name", catNameInput.value || "");
  formData.append("slug", catSlugInput.value || "");
  formData.append("parent", catParentSelect.value || "");
  formData.append("order", catOrderInput.value || "0");
  formData.append("iconType", selectedIcon.type || "none");
  formData.append("iconValue", selectedIcon.value || "");

  const submitter = e.submitter;
  const status = submitter && submitter.id === "catPublish" ? "published" : "draft";
  formData.append("status", status);

  if (uploadedImage) {
    formData.append("image", uploadedImage);
  }

  // Only remove the stored image when the user explicitly clicked "Remove".
  if (imageRemoved) {
    formData.append("imageRemove", "true");
  }

  console.log("Submitting category:", {
    isEdit,
    name: catNameInput.value,
    slug: catSlugInput.value,
    parent: catParentSelect.value,
    status,
    icon: selectedIcon,
  });

  try {
    const url = isEdit ? `/api/categories/${catIdInput.value}` : "/api/categories";
    const method = isEdit ? "PUT" : "POST";
    const result = await api(method, url, formData, true);
    console.log("API response:", result);
    toast(isEdit ? "Category updated" : "Category created", "success");
    resetForm();
    loadCategories();
  } catch (err) {
    console.error("Submit error:", err);
    catMsg.textContent = err.message;
    toast(err.message, "error");
  }
});

/* ---- Reset form ---- */
function resetForm() {
  form.reset();
  updateParentTrigger();
  catIdInput.value = "";
  catMsg.textContent = "";
  uploadedImage = null;
  imageRemoved = false;
  catImagePreview.innerHTML = "<span>No image</span>";
  catImageRemove.hidden = true;
  selectedIcon = { type: "none", value: "" };
  updateIconPreview();
  renderIconGrid();
  document.getElementById("catFormTitle").textContent = "Add Category";
}

document.getElementById("catResetBtn").addEventListener("click", resetForm);

/* ---- Load category for edit ---- */
async function loadCategoryForEdit(id) {
  try {
    const cat = await api("GET", `/api/categories/${id}`);
    imageRemoved = false;
    catIdInput.value = cat.category._id;
    catNameInput.value = cat.category.name;
    catSlugInput.value = cat.category.slug;
    catParentSelect.value = cat.category.parent || "";
    updateParentTrigger();
    catOrderInput.value = cat.category.order;

    if (cat.category.icon) {
      selectedIcon = { type: cat.category.icon.type, value: cat.category.icon.value };
      updateIconPreview();
      if (selectedIcon.type === "library") {
        renderIconGrid(iconSearch.value);
      }
    }

    if (cat.category.image) {
      catImagePreview.innerHTML = `<img src="${cat.category.image}" alt="" />`;
      catImageRemove.hidden = false;
    }

    const status = cat.category.status;
    form.querySelector(`input[name="catStatus"][value="${status}"]`).checked = true;

    document.getElementById("catFormTitle").textContent = "Edit Category";
  } catch (err) {
    toast(err.message, "error");
  }
}

/* ---- View category modal ---- */
async function viewCategory(id) {
  try {
    const data = await api("GET", `/api/categories/${id}`);
    const cat = data.category;
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
            ? c.children.map((sc) => `<div class="lvl2">• ${sc.name || "Untitled"}</div>`).join("")
            : "";
          return `<div class="lvl1">• ${c.name || "Untitled"}${subChildren}</div>`;
        })
        .join("");
    } else {
      childrenHtml = "<p>No sub-categories</p>";
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
          <div class="cat-view-label">Sub-categories</div>
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
    viewCategory(id);
  } else if (action === "edit") {
    loadCategoryForEdit(id);
  } else if (action === "trash") {
    confirmModal("Move to Trash?", "This will also trash all sub-categories.", async () => {
      try {
        await api("DELETE", `/api/categories/${id}`);
        toast("Moved to trash", "success");
        loadCategories();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  } else if (action === "restore") {
    try {
      await api("PATCH", `/api/categories/${id}/restore`);
      toast("Restored", "success");
      loadCategories();
    } catch (err) {
      toast(err.message, "error");
    }
  } else if (action === "permanent") {
    confirmModal("Delete Permanently?", "This cannot be undone and will delete all sub-categories.", async () => {
      try {
        await api("DELETE", `/api/categories/${id}/permanent`);
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

document.getElementById("catSelectAll").addEventListener("change", (e) => {
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
  const bar = document.getElementById("catBulkBar");
  const count = document.getElementById("catSelectedCount");
  count.textContent = `${selectedIds.size} selected`;
  bar.hidden = selectedIds.size === 0;
}

document.getElementById("catBulkBar").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-bulk]");
  if (!btn) return;

  const action = btn.dataset.bulk;
  const ids = [...selectedIds];

  if (action === "permanent") {
    confirmModal("Delete Permanently?", "This cannot be undone.", async () => {
      try {
        await api("PATCH", "/api/categories/bulk", { action, ids });
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
      await api("PATCH", "/api/categories/bulk", { action, ids });
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
document.getElementById("catTabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".cat-tab");
  if (!tab) return;

  document.querySelectorAll(".cat-tab").forEach((t) => t.classList.remove("active"));
  tab.classList.add("active");

  currentFilter.status = tab.dataset.status;
  loadCategories();
});

/* ---- Search (debounced) ---- */
let searchTimer = null;
document.getElementById("catSearch").addEventListener("input", (e) => {
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
