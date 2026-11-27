/* ==========================================================================
   Book / Ebook module — admin screens.
     window.bookPeople.open("authors" | "publishers")  server-paginated people
     window.bookGenres.open()                          genre shortcut (Category API)
   Everything is paginated, searched and filtered on the server; the page never
   loads the whole list. Exposes window.bookModule for the product form and the
   settings pane so all three screens agree on one gate answer.
   ========================================================================== */
(function () {
  "use strict";

  const api = window.api;
  const toast = window.toast;
  const esc = window.esc;

  const PAGE_SIZES = [10, 20, 50];
  const MAX_OPTION_ROWS = 50; // the options endpoint caps at 50 too

  const ICONS = {
    search:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    edit:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
    restore:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
    merge:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3v6a4 4 0 0 0 4 4h6"/><path d="M17 13l3 3-3 3"/><path d="M7 21v-6"/></svg>',
    eye:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  };

  /* ---------------- transport ---------------- */
  async function call(url, options) {
    const res = await api(url, options);
    if (!res) throw new Error("Session shesh — abar login korun");
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const err = new Error((data && data.message) || "Request fail (" + res.status + ")");
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }
    return data;
  }

  /* ---------------- module gate (shared) ---------------- */
  let stateCache = null;

  async function moduleState(force) {
    if (stateCache && !force) return stateCache;
    try {
      const data = await call("/api/books/state");
      stateCache = data.books || null;
    } catch (err) {
      // /state is reachable even with the owner switch off, so this only fires for a
      // locked package or a failed request — both hide the nav, only the first is
      // permanent, so the banner text differs.
      const reason = err.code === "feature_locked" ? "plan" : err.code === "books_module_off" ? "toggle" : "";
      const fallback = { plan: reason === "toggle", toggle: false, reason, error: err.message };
      if (err.status === 403) stateCache = fallback;
      else return fallback;
    }
    return stateCache;
  }

  function gateBanner(state, what) {
    if (!state) return "";
    if (state.reason === "plan") {
      return `<div class="bk-locked err">
        <div class="bk-locked-text"><b>${esc(what)}</b> — আপনার প্যাকেজে Book / Ebook module নেই। প্যাকেজ আপগ্রেড করলে এই স্ক্রিন চালু হবে।</div>
      </div>`;
    }
    if (state.reason === "toggle") {
      return `<div class="bk-locked">
        <div class="bk-locked-text"><b>${esc(what)}</b> — মডিউলটি এখন বন্ধ। Settings → Book / Ebook module চালু করলেই এখানে তালিকা দেখা যাবে।</div>
        <button type="button" class="btn-gold" data-bk-goto="settings">Settings খুলুন</button>
      </div>`;
    }
    if (state.reason === "theme") {
      return `<div class="bk-locked">
        <div class="bk-locked-text">লেখা যোগ করা চলছে, কিন্তু এখন যে theme চালু আছে তা বইয়ের পেজ দেখায় না। Storefront-এ বই দেখাতে book-support করা theme বেছে নিন।</div>
        <button type="button" class="btn-gold" data-bk-goto="style-settings">Theme change করুন</button>
      </div>`;
    }
    return "";
  }

  function bindGateBanner(root) {
    root.querySelectorAll("[data-bk-goto]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (window.switchView) window.switchView(btn.dataset.bkGoto);
      });
    });
  }

  /* ---------------- shared modal ---------------- */
  function openPop(extraClass, options) {
    const opts = options || {};
    const pop = document.createElement("div");
    pop.className = "pc-pop bk-pop";
    const box = document.createElement("div");
    box.className = "pc-pop-box bk-modal " + (extraClass || "");
    pop.appendChild(box);
    document.body.appendChild(pop);
    const close = () => {
      document.removeEventListener("keydown", onKey);
      pop.remove();
    };
    function onKey(e) {
      if (e.key === "Escape" && !opts.locked) close();
    }
    document.addEventListener("keydown", onKey);
    pop.addEventListener("click", (e) => {
      if (e.target === pop && !opts.locked) close();
    });
    pop._close = close;
    pop._box = box;
    return pop;
  }

  function pageFromHash(kindKey) {
    try {
      const raw = new URLSearchParams(location.search).get(kindKey + "_page");
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
    } catch {
      return 1;
    }
  }

  // Deep links: ?authors_page=3 — a refresh or a shared link lands on the same page.
  function writePageParam(kindKey, page) {
    try {
      const url = new URL(location.href);
      if (page > 1) url.searchParams.set(kindKey + "_page", String(page));
      else url.searchParams.delete(kindKey + "_page");
      history.replaceState(history.state, "", url.toString());
    } catch {
      /* file:// or a blocked History API — the pager still works */
    }
  }

  function sizeKey(kindKey) {
    return "bk_" + kindKey + "_page_size";
  }

  function initialLimit(kindKey) {
    try {
      const n = Number(localStorage.getItem(sizeKey(kindKey)));
      return PAGE_SIZES.includes(n) ? n : 20;
    } catch {
      return 20;
    }
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }

  /* ==========================================================================
     People pages (authors + publishers share one implementation)
     ========================================================================== */
  const PEOPLE = {
    authors: {
      path: "authors",
      title: "Authors",
      singular: "Author",
      record: "author",
      root: "authorRoot",
      optionKey: "authorOptions",
      picture: "photo",
      pictureLabel: "Author photo",
      empty: "এখনো কোনো লেখক যোগ করা হয়নি।",
      hint: "লেখক একই সাথে অনেক বইয়ে থাকতে পারে — বই ফর্মে একাধিক লেখক বেছে নিতে পারবেন।",
    },
    publishers: {
      path: "publishers",
      title: "Publishers",
      singular: "Publisher",
      record: "publisher",
      root: "publisherRoot",
      optionKey: "publisherOptions",
      picture: "logo",
      pictureLabel: "Publisher logo",
      empty: "এখনো কোনো প্রকাশক যোগ করা হয়নি।",
      hint: "প্রতিটি বইয়ে একজন প্রকাশক থাকে; একই প্রকাশক অনেক বইয়ে ব্যবহার করা যায়।",
    },
  };

  const peoplePages = {};

  function buildPeoplePage(cfg) {
    const state = {
      rows: [],
      meta: { page: 1, pages: 1, total: 0, limit: initialLimit(cfg.path) },
      counts: { all: 0, draft: 0, published: 0, trashed: 0 },
      status: "",
      search: "",
      sort: "name",
      page: pageFromHash(cfg.path),
      limit: initialLimit(cfg.path),
      selected: new Set(),
      requestId: 0,
    };

    const root = document.getElementById(cfg.root);

    function shell() {
      root.innerHTML = `
        <div class="bk-wrap">
          <div id="${cfg.path}Gate"></div>
          <div class="bk-tabs" id="${cfg.path}Tabs">
            <button type="button" class="bk-tab active" data-status="">All <span class="badge" id="${cfg.path}CountAll">0</span></button>
            <button type="button" class="bk-tab" data-status="published">Published <span class="badge" id="${cfg.path}CountPublished">0</span></button>
            <button type="button" class="bk-tab" data-status="draft">Draft <span class="badge" id="${cfg.path}CountDraft">0</span></button>
            <button type="button" class="bk-tab" data-status="trashed">Trash <span class="badge" id="${cfg.path}CountTrashed">0</span></button>
          </div>
          <div class="bk-toolbar">
            <span class="bk-total"><b id="${cfg.path}Total">—</b> ${esc(cfg.title)}</span>
            <label class="bk-pick">Sort
              <select class="bk-sort" id="${cfg.path}Sort">
                <option value="name">Name A–Z</option>
                <option value="-name">Name Z–A</option>
                <option value="-books">Most books</option>
                <option value="books">Fewest books</option>
                <option value="-created">Newest first</option>
                <option value="created">Oldest first</option>
              </select>
            </label>
            <div class="pc-search bk-search">${ICONS.search}
              <input type="search" id="${cfg.path}Search" placeholder="Search ${esc(cfg.singular.toLowerCase())} name or slug…" aria-label="Search ${esc(cfg.title)}" />
            </div>
            <div class="bk-actions">
              <button type="button" class="btn-add" id="${cfg.path}AddBtn">+ ${esc(cfg.singular)}</button>
            </div>
          </div>
          <div class="bk-bulk" id="${cfg.path}Bulk" hidden>
            <span><b id="${cfg.path}SelCount">0</b> selected</span>
            <button type="button" class="btn-ghost sm" data-bulk="publish">Publish</button>
            <button type="button" class="btn-ghost sm" data-bulk="draft">Draft</button>
            <button type="button" class="btn-ghost sm" data-bulk="restore">Restore</button>
            <button type="button" class="btn-ghost sm" data-bulk="trash">Trash</button>
            <button type="button" class="btn-ghost sm danger" data-bulk="permanent">Delete forever</button>
          </div>
          <div id="${cfg.path}Table"><div class="pc-empty">Loading…</div></div>
          <div class="pc-foot" id="${cfg.path}Foot"></div>
        </div>`;

      root.querySelectorAll("#" + cfg.path + "Tabs .bk-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          root.querySelectorAll("#" + cfg.path + "Tabs .bk-tab").forEach((t) => t.classList.toggle("active", t === tab));
          state.status = tab.dataset.status;
          state.page = 1;
          load();
        });
      });
      root.querySelector("#" + cfg.path + "Sort").value = state.sort;
      root.querySelector("#" + cfg.path + "Sort").addEventListener("change", (e) => {
        state.sort = e.target.value;
        state.page = 1;
        load();
      });
      const input = root.querySelector("#" + cfg.path + "Search");
      let timer = null;
      input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          state.search = input.value.trim();
          state.page = 1;
          load();
        }, 320);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        clearTimeout(timer);
        state.search = input.value.trim();
        state.page = 1;
        load();
      });
      root.querySelector("#" + cfg.path + "AddBtn").addEventListener("click", () => openForm(null));
      bindGateBanner(root);
      root.querySelectorAll("#" + cfg.path + "Bulk [data-bulk]").forEach((btn) => {
        btn.addEventListener("click", () => runBulk(btn.dataset.bulk));
      });
    }

    async function load() {
      const wrap = root.querySelector("#" + cfg.path + "Table");
      if (!wrap) return;
      const requestId = ++state.requestId;
      wrap.innerHTML = '<div class="pc-empty">Loading…</div>';

      const params = new URLSearchParams({ page: String(state.page), limit: String(state.limit), sort: state.sort });
      if (state.search) params.set("search", state.search);
      if (state.status) params.set("status", state.status);

      try {
        const data = await call("/api/books/" + cfg.path + "?" + params.toString());
        if (requestId !== state.requestId) return;
        state.rows = data[cfg.path] || [];
        state.meta = data.meta || state.meta;
        state.counts = data.counts || state.counts;
        if (state.meta.outOfRange) {
          state.page = Math.max(1, state.meta.pages);
          return load();
        }
        writePageParam(cfg.path, state.page);
        state.selected.clear();
        renderCounts();
        renderTable();
        renderFoot();
      } catch (err) {
        if (requestId !== state.requestId) return;
        if (err.code === "books_module_off" || err.code === "feature_locked") {
          state.rows = [];
          renderTable();
          renderFoot();
          const gate = root.querySelector("#" + cfg.path + "Gate");
          gate.innerHTML = gateBanner({ reason: err.code === "feature_locked" ? "plan" : "toggle" }, cfg.title);
          bindGateBanner(gate);
          return;
        }
        wrap.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>`;
      }
    }

    function renderCounts() {
      const c = state.counts;
      const set = (id, v) => {
        const el = root.querySelector("#" + cfg.path + id);
        if (el) el.textContent = String(v);
      };
      set("CountAll", c.all);
      set("CountPublished", c.published);
      set("CountDraft", c.draft);
      set("CountTrashed", c.trashed);
      set("Total", state.meta.total);
    }

    function cols() {
      if (cfg.record === "author") return ["pick", "name", "slug", "life", "books", "status", "actions"];
      return ["pick", "name", "slug", "contact", "books", "status", "actions"];
    }

    function headerFor(col) {
      return (
        {
          name: cfg.singular,
          slug: "Slug",
          life: "Born / Died",
          contact: "Contact",
          books: "Books",
          status: "Status",
          actions: "Action",
          pick: "",
        }[col] || ""
      );
    }

    function cellHtml(row, col) {
      const id = esc(String(row._id));
      if (col === "pick") {
        if (state.status === "trashed") return "";
        return `<input type="checkbox" class="bk-row-check" data-check="${id}" aria-label="Select ${esc(row.name || "")}" ${
          state.selected.has(id) ? "checked" : ""
        } />`;
      }
      if (col === "name") {
        const pic = row[cfg.picture];
        return `<div class="bk-name">
          <span class="bk-avatar${cfg.record === "publisher" ? " sq" : ""}">${
            pic ? `<img src="${esc(pic)}" alt="">` : esc(initials(row.name || row.nameBn))
          }</span>
          <div>
            <b>${esc(row.name || row.nameBn || "—")}${row.isDemo ? '<span class="bk-flag">demo</span>' : ""}</b>
            <small>${esc(row.nameBn || "")}</small>
          </div>
        </div>`;
      }
      if (col === "slug") return `<span class="bk-slug">/${esc(row.slug || "—")}</span>`;
      if (col === "life") {
        const born = row.birthYear || "—";
        const died = row.deathYear ? "– " + row.deathYear : "";
        return `<span>${esc(born)} ${esc(died)}</span>${row.country ? `<div class="bk-muted" style="font-size:11.5px;">${esc(row.country)}</div>` : ""}`;
      }
      if (col === "contact") {
        const bits = [row.phone, row.email].filter(Boolean);
        return bits.length
          ? bits.map((v) => `<div class="bk-muted" style="font-size:11.5px;">${esc(v)}</div>`).join("")
          : '<span class="bk-muted">—</span>';
      }
      if (col === "books")
        return `<button type="button" class="bk-count bk-count-btn" data-detail="${id}" title="View books">${Number(row.bookCount) || 0}</button>`;
      if (col === "status") return `<span class="bk-state ${esc(row.status)}">${esc(row.status)}</span>`;
      const acts = [];
      if (state.status === "trashed") {
        acts.push(`<button type="button" class="icon-btn edit" data-restore="${id}" title="Restore">${ICONS.restore}</button>`);
        acts.push(`<button type="button" class="icon-btn del" data-permanent="${id}" title="Delete forever">${ICONS.trash}</button>`);
      } else {
        acts.push(`<button type="button" class="icon-btn edit" data-detail="${id}" title="Details">${ICONS.eye}</button>`);
        acts.push(`<button type="button" class="icon-btn edit" data-edit="${id}" title="Edit">${ICONS.edit}</button>`);
        acts.push(`<button type="button" class="icon-btn edit" data-merge="${id}" title="Merge into another ${esc(cfg.singular.toLowerCase())}">${ICONS.merge}</button>`);
        acts.push(`<button type="button" class="icon-btn del" data-trash="${id}" title="Move to trash">${ICONS.trash}</button>`);
      }
      return `<div class="pc-row-actions">${acts.join("")}</div>`;
    }

    function renderTable() {
      const wrap = root.querySelector("#" + cfg.path + "Table");
      if (!wrap) return;
      if (!state.rows.length) {
        wrap.innerHTML = `<div class="pc-empty">
          <div>${state.search ? "এই search এ কিছু পাওয়া যায়নি।" : esc(cfg.empty)}</div>
          <div class="bk-hint" style="margin-top:8px;">${esc(cfg.hint)}</div>
        </div>`;
        return;
      }
      const c = cols();
      const pickCol = state.status !== "trashed";
      wrap.innerHTML = `<div class="pc-table-wrap bk-table-wrap"><table class="pc-table bk-table"><thead><tr>${c
        .map((col, i) => `<th${i === 0 && pickCol ? ' class="bk-check-col"' : ""}>${esc(headerFor(col))}</th>`)
        .join("")}</tr></thead><tbody>${state.rows
        .map(
          (row) =>
            `<tr data-row="${esc(String(row._id))}">${c
              .map((col) => `<td data-col="${col}" data-label="${esc(headerFor(col))}">${cellHtml(row, col)}</td>`)
              .join("")}</tr>`
        )
        .join("")}</tbody></table></div>`;

      if (state.status !== "trashed") {
        const head = wrap.querySelector("thead th:first-child");
        head.innerHTML = `<input type="checkbox" class="bk-row-check" id="${cfg.path}CheckAll" aria-label="Select all on this page" ${
          state.selected.size && state.selected.size === state.rows.length ? "checked" : ""
        } />`;
        head.querySelector("input").addEventListener("change", (e) => {
          state.selected = e.target.checked ? new Set(state.rows.map((r) => String(r._id))) : new Set();
          renderTable();
        });
      }

      const byName = (id) => state.rows.find((r) => String(r._id) === id);
      wrap.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openForm(byName(b.dataset.edit))));
      wrap.querySelectorAll("[data-detail]").forEach((b) => b.addEventListener("click", () => openDetail(b.dataset.detail)));
      wrap.querySelectorAll("[data-merge]").forEach((b) => b.addEventListener("click", () => openMerge(byName(b.dataset.merge))));
      wrap.querySelectorAll("[data-trash]").forEach((b) => b.addEventListener("click", () => bulkAction("trash", [b.dataset.trash])));
      wrap.querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", () => bulkAction("restore", [b.dataset.restore])));
      wrap.querySelectorAll("[data-permanent]").forEach((b) => b.addEventListener("click", () => bulkAction("permanent", [b.dataset.permanent])));
      wrap.querySelectorAll("[data-check]").forEach((box) =>
        box.addEventListener("change", () => {
          if (box.checked) state.selected.add(box.dataset.check);
          else state.selected.delete(box.dataset.check);
          renderBulkBar();
        })
      );
      wrap.querySelectorAll("tr[data-row]").forEach((tr) =>
        tr.addEventListener("click", (e) => {
          if (e.target.closest("button, a, input, select, textarea")) return;
          openDetail(tr.dataset.row);
        })
      );
      renderBulkBar();
    }

    function renderBulkBar() {
      const bar = root.querySelector("#" + cfg.path + "Bulk");
      if (!bar) return;
      bar.hidden = !state.selected.size;
      const count = root.querySelector("#" + cfg.path + "SelCount");
      if (count) count.textContent = String(state.selected.size);
    }

    function renderFoot() {
      const foot = root.querySelector("#" + cfg.path + "Foot");
      if (!foot) return;
      const meta = state.meta;
      const from = meta.total ? (meta.page - 1) * meta.limit + 1 : 0;
      const to = Math.min(meta.page * meta.limit, meta.total);
      foot.innerHTML = `
        <div class="ol-foot-info">
          <span>Showing ${from}–${to} of ${meta.total}</span>
          <label class="ol-page-size" for="${cfg.path}Size">Per page
            <select id="${cfg.path}Size" aria-label="Per page">${PAGE_SIZES.map(
              (n) => `<option value="${n}" ${meta.limit === n ? "selected" : ""}>${n}</option>`
            ).join("")}</select>
          </label>
        </div>
        <span class="spacer"></span>
        <div class="pc-pager" role="navigation" aria-label="${esc(cfg.title)} pagination"></div>`;

      foot.querySelector("#" + cfg.path + "Size").addEventListener("change", (e) => {
        const n = Number(e.target.value);
        if (!PAGE_SIZES.includes(n)) return;
        state.limit = n;
        state.page = 1;
        try {
          localStorage.setItem(sizeKey(cfg.path), String(n));
        } catch {
          /* private mode */
        }
        load();
      });

      const pager = foot.querySelector(".pc-pager");
      const go = (page) => {
        state.page = page;
        load();
      };
      const btn = (label, page, opts) => {
        const o = opts || {};
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.disabled = !!o.disabled;
        if (o.current) b.setAttribute("aria-current", "page");
        b.addEventListener("click", () => go(page));
        pager.appendChild(b);
      };
      const pages = Math.max(1, meta.pages);
      btn("‹", meta.page - 1, { disabled: !meta.hasPrev });
      const win = [];
      for (let i = Math.max(1, meta.page - 2); i <= Math.min(pages, meta.page + 2); i++) win.push(i);
      if (win[0] > 1) {
        btn("1", 1);
        if (win[0] > 2) pager.appendChild(document.createTextNode("…"));
      }
      win.forEach((i) => btn(String(i), i, { current: i === meta.page }));
      const last = win[win.length - 1];
      if (last < pages) {
        if (last < pages - 1) pager.appendChild(document.createTextNode("…"));
        btn(String(pages), pages);
      }
      btn("›", meta.page + 1, { disabled: !meta.hasNext });
    }

    async function bulkAction(action, ids) {
      if (!ids.length) return;
      const labels = {
        trash: ["Trash these records?", "তালিকা থেকে বাদ যাবে, বইয়ের সাথে সম্পর্ক থাকবে।"],
        restore: ["Restore these records?", "আগের status এ ফিরে যাবে।"],
        publish: ["Publish these records?", "Storefront-এ দেখা যাবে।"],
        draft: ["Unpublish these records?", "Storefront-এ লুকিয়ে যাবে।"],
        permanent: ["Delete forever?", "স্থায়ীভাবে মুছে যাবে — যেসব বইয়ে এই ${singular} আছে, সেখান থেকে নামটি সরে যাবে।"],
      };
      const def = labels[action] || ["Are you sure?", ""];
      const ok = await window.confirmDialog({
        title: def[0].replace("${singular}", cfg.singular.toLowerCase()),
        text: def[1].replace("${singular}", cfg.singular.toLowerCase()),
        okLabel: action === "permanent" ? "Delete forever" : action === "trash" ? "Trash" : "OK",
        okClass: action === "permanent" ? "btn-danger" : "btn-gold",
      });
      if (!ok) return;
      try {
        const data = await call("/api/books/" + cfg.path + "/bulk", {
          method: "PATCH",
          body: JSON.stringify({ action, ids }),
        });
        toast(`${data.affected || ids.length} record ${action} হলো`, "ok");
        state.selected.clear();
        await load();
      } catch (err) {
        toast(err.message, "err");
      }
    }

    function runBulk(action) {
      bulkAction(action, [...state.selected]);
    }

    /* ---------------- create / edit form ---------------- */
    function formHtml(row) {
      const r = row || {};
      const links = Array.isArray(r.links) ? r.links : [];
      const common = `
        <label class="bk-photo-row">
          <span class="bk-photo" id="${cfg.path}Photo">${
            r[cfg.picture] ? `<img src="${esc(r[cfg.picture])}" alt="">` : "<span>Add</span>"
          }</span>
          <div>
            <span>${esc(cfg.pictureLabel)}</span>
            <div class="bk-inline-row" style="margin-top:6px;">
              <button type="button" class="pf-btn-sm" id="${cfg.path}PickImg">Upload</button>
              <button type="button" class="pf-btn-sm" id="${cfg.path}RemoveImg">Remove</button>
            </div>
            <input type="file" accept="image/*" hidden id="${cfg.path}File" />
          </div>
        </label>
        <label><span>Name (English) *</span><input id="bkName" type="text" maxlength="160" value="${esc(r.name || "")}" /></label>
        <label><span>নাম (বাংলা)</span><input id="bkNameBn" type="text" maxlength="160" value="${esc(r.nameBn || "")}" /></label>
        <label><span>Slug</span><input id="bkSlug" type="text" maxlength="160" value="${esc(r.slug || "")}" placeholder="auto from name" /></label>
        <label><span>Status</span><select id="bkStatus">
          <option value="published" ${r.status === "published" || !r.status ? "selected" : ""}>Published</option>
          <option value="draft" ${r.status === "draft" ? "selected" : ""}>Draft</option>
        </select></label>`;

      if (cfg.record === "author") {
        return (
          common +
          `
          <label><span>Birth year</span><input id="bkBirth" type="number" min="-3000" max="2100" value="${esc(r.birthYear == null ? "" : r.birthYear)}" /></label>
          <label><span>Death year</span><input id="bkDeath" type="number" min="-3000" max="2100" value="${esc(r.deathYear == null ? "" : r.deathYear)}" /></label>
          <label><span>Country</span><input id="bkCountry" type="text" maxlength="60" value="${esc(r.country || "")}" /></label>
          <label class="full"><span>Bio (English)</span><textarea id="bkBio" maxlength="4000">${esc(r.bio || "")}</textarea></label>
          <label class="full"><span>জীবনী (বাংলা)</span><textarea id="bkBioBn" maxlength="4000">${esc(r.bioBn || "")}</textarea></label>
          <div class="bk-links">
            <span class="bk-hint">Social / profile links (http or https only)</span>
            <div id="${cfg.path}LinkRows"></div>
            <div><button type="button" class="pf-btn-sm" id="${cfg.path}AddLink">+ Add link</button></div>
          </div>`
        );
      }
      return (
        common +
        `
        <label><span>Phone</span><input id="bkPhone" type="text" maxlength="40" value="${esc(r.phone || "")}" /></label>
        <label><span>Email</span><input id="bkEmail" type="email" maxlength="160" value="${esc(r.email || "")}" /></label>
        <label class="full"><span>Website</span><input id="bkWebsite" type="url" maxlength="300" value="${esc(r.website || "")}" placeholder="https://…" /></label>
        <label class="full"><span>Address</span><input id="bkAddress" type="text" maxlength="300" value="${esc(r.address || "")}" /></label>
        <label class="full"><span>Description (English)</span><textarea id="bkDesc" maxlength="4000">${esc(r.description || "")}</textarea></label>
        <label class="full"><span>বিবরণ (বাংলা)</span><textarea id="bkDescBn" maxlength="4000">${esc(r.descriptionBn || "")}</textarea></label>`
      );
    }

    function addLinkRow(box, link) {
      const row = document.createElement("div");
      row.className = "bk-link-row";
      row.innerHTML = `<input class="bk-link-platform" type="text" maxlength="30" placeholder="website" value="${esc(
        (link || {}).platform || ""
      )}" aria-label="Platform" />
      <input class="bk-link-url" type="url" maxlength="300" placeholder="https://…" value="${esc((link || {}).url || "")}" aria-label="Link URL" />
      <button type="button" class="icon-btn del" title="Remove">${ICONS.trash}</button>`;
      row.querySelector("button").addEventListener("click", () => row.remove());
      box.appendChild(row);
    }

    function collectLinks(box) {
      return [...box.querySelectorAll(".bk-link-row")].map((row) => ({
        platform: row.querySelector(".bk-link-platform").value.trim(),
        url: row.querySelector(".bk-link-url").value.trim(),
      }));
    }

    function openForm(row) {
      const editing = !!row;
      const pop = openPop("", { locked: true });
      const box = pop._box;
      box.innerHTML = `
        <div class="bk-modal-head">
          <div>
            <h3>${editing ? "Edit " + cfg.singular.toLowerCase() : "New " + cfg.singular.toLowerCase()}</h3>
            <div class="bk-modal-sub">${editing ? esc(row.name || row.slug || "") : "শুধু নাম দিলেই হবে — বাকিগুলো পরে যোগ করুন"}</div>
          </div>
          <button type="button" class="bk-close" aria-label="Close">×</button>
        </div>
        <form class="bk-form" novalidate>
          ${formHtml(row)}
          <p class="bk-error full" id="${cfg.path}FormError"></p>
          <div class="pc-pop-actions full">
            <button type="button" class="btn-ghost" id="${cfg.path}Cancel">Cancel</button>
            <button type="submit" class="btn-gold" id="${cfg.path}Save">${editing ? "Save changes" : "Create"}</button>
          </div>
        </form>`;

      const fileInput = box.querySelector("#" + cfg.path + "File");
      const photo = box.querySelector("#" + cfg.path + "Photo");
      let file = null;
      let removeImage = false;
      box.querySelector("#" + cfg.path + "PickImg").addEventListener("click", () => fileInput.click());
      photo.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", () => {
        if (!fileInput.files[0]) return;
        file = fileInput.files[0];
        removeImage = false;
        photo.innerHTML = `<img src="${esc(URL.createObjectURL(file))}" alt="">`;
      });
      box.querySelector("#" + cfg.path + "RemoveImg").addEventListener("click", () => {
        file = null;
        removeImage = true;
        photo.innerHTML = "<span>Add</span>";
      });

      if (cfg.record === "author") {
        const rowsBox = box.querySelector("#" + cfg.path + "LinkRows");
        ((row && row.links) || []).forEach((l) => addLinkRow(rowsBox, l));
        box.querySelector("#" + cfg.path + "AddLink").addEventListener("click", () => addLinkRow(rowsBox, null));
      }

      box.querySelector(".bk-close").addEventListener("click", () => pop._close());
      box.querySelector("#" + cfg.path + "Cancel").addEventListener("click", () => pop._close());

      box.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const errEl = box.querySelector("#" + cfg.path + "FormError");
        errEl.textContent = "";
        const values = {
          name: box.querySelector("#bkName").value.trim(),
          nameBn: box.querySelector("#bkNameBn").value.trim(),
          slug: box.querySelector("#bkSlug").value.trim(),
          status: box.querySelector("#bkStatus").value,
        };
        if (!values.name && !values.nameBn) {
          errEl.textContent = "নাম দিতে হবে (English বা বাংলা)";
          return;
        }
        if (cfg.record === "author") {
          values.birthYear = box.querySelector("#bkBirth").value.trim();
          values.deathYear = box.querySelector("#bkDeath").value.trim();
          values.country = box.querySelector("#bkCountry").value.trim();
          values.bio = box.querySelector("#bkBio").value;
          values.bioBn = box.querySelector("#bkBioBn").value;
          values.links = collectLinks(box.querySelector("#" + cfg.path + "LinkRows"));
        } else {
          values.phone = box.querySelector("#bkPhone").value.trim();
          values.email = box.querySelector("#bkEmail").value.trim();
          values.website = box.querySelector("#bkWebsite").value.trim();
          values.address = box.querySelector("#bkAddress").value.trim();
          values.description = box.querySelector("#bkDesc").value;
          values.descriptionBn = box.querySelector("#bkDescBn").value;
        }
        if (removeImage && !file) values.removeImage = "true";
        // The picture rides the same multipart request the books API expects;
        // links stay JSON because FormData cannot carry an array of objects.
        let body;
        if (file) {
          const fd = new FormData();
          Object.entries(values).forEach(([key, value]) => {
            if (Array.isArray(value)) fd.set(key, JSON.stringify(value));
            else fd.set(key, value == null ? "" : String(value));
          });
          fd.set("image", file);
          body = fd;
        } else {
          body = JSON.stringify(values);
        }

        const save = box.querySelector("#" + cfg.path + "Save");
        save.disabled = true;
        save.textContent = "Saving…";
        try {
          const url = editing ? "/api/books/" + cfg.path + "/" + encodeURIComponent(row._id) : "/api/books/" + cfg.path;
          await call(url, { method: editing ? "PATCH" : "POST", body });
          toast((editing ? cfg.singular + " updated" : cfg.singular + " created"), "ok");
          window.bookModule.clearCache();
          pop._close();
          await load();
        } catch (err) {
          errEl.textContent = err.message;
          save.disabled = false;
          save.textContent = editing ? "Save changes" : "Create";
        }
      });
      const first = box.querySelector("#bkName");
      if (first && !editing) first.focus();
    }

    /* ---------------- detail + book list ---------------- */
    function openDetail(id, page) {
      const pop = openPop("wide", { locked: true });
      const box = pop._box;
      box.innerHTML = '<div class="pc-empty">Loading…</div>';
      (async () => {
        try {
          const params = new URLSearchParams({ page: String(page || 1), limit: "12" });
          const data = await call("/api/books/" + cfg.path + "/" + encodeURIComponent(id) + "?" + params.toString());
          renderDetail(pop, data, params);
        } catch (err) {
          box.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>
            <div class="pc-pop-actions"><button type="button" class="btn-ghost">Close</button></div>`;
          box.querySelector("button").addEventListener("click", () => pop._close());
        }
      })();
    }

    function renderDetail(pop, data, params) {
      const box = pop._box;
      const row = data.author || data.publisher || {};
      const books = data.books || [];
      const meta = data.meta || {};
      const isAuthor = cfg.record === "author";
      const fields = (isAuthor
        ? [
            ["Country", row.country],
            ["Born", row.birthYear],
            ["Died", row.deathYear],
            ["Slug", row.slug],
          ]
        : [
            ["Phone", row.phone],
            ["Email", row.email],
            ["Website", row.website],
            ["Slug", row.slug],
          ]
      )
        .map(([label, value]) => `<div class="bk-field"><span>${esc(label)}</span><b>${esc(value == null || value === "" ? "—" : value)}</b></div>`)
        .join("");

      box.innerHTML = `
        <div class="bk-modal-head">
          <span class="bk-avatar${isAuthor ? "" : " sq"}">${
            row[cfg.picture] ? `<img src="${esc(row[cfg.picture])}" alt="">` : esc(initials(row.name || row.nameBn))
          }</span>
          <div>
            <h3>${esc(row.name || row.nameBn || "—")}</h3>
            <div class="bk-modal-sub">${esc(row.nameBn || "")}${row.status ? " · " + esc(row.status) : ""}</div>
          </div>
          <button type="button" class="bk-close" aria-label="Close">×</button>
        </div>
        <div class="bk-stats">
          <div class="bk-stat"><span>Books</span><b>${Number(data.bookCount) || 0}</b></div>
          <div class="bk-stat"><span>Status</span><b>${esc(row.status || "—")}</b></div>
        </div>
        ${
          isAuthor
            ? `<div class="bk-section"><h4>${esc(cfg.singular)}</h4><div class="bk-grid">${fields}</div>
               <p style="font-size:13px;line-height:1.6;white-space:pre-wrap;">${esc(row.bioBn || row.bio || "—")}</p></div>`
            : `<div class="bk-section"><h4>Details</h4><div class="bk-grid">${fields}</div>
               <p style="font-size:13px;line-height:1.6;white-space:pre-wrap;margin-top:8px;">${esc(row.descriptionBn || row.description || "—")}</p></div>`
        }
        <div class="bk-section">
          <h4>Books <span>${meta.total || 0}</span></h4>
          <div class="bk-books">${
            books.length
              ? books
                  .map(
                    (b) => `<button type="button" class="bk-book-row" data-book="${esc(String(b._id))}">
                      ${b.image ? `<img src="${esc(b.image)}" alt="">` : '<span class="bk-book-thumb">no img</span>'}
                      <span class="bk-book-main"><b>${esc(b.title || "—")}</b>
                        <small>${esc(b.publicationYear || "")}${b.status ? " · " + esc(b.status) : ""}</small></span>
                      <span class="bk-formats">${(b.formats || [])
                        .map((f) => `<i class="bk-fmt ${esc(f)}">${esc(f)}</i>`)
                        .join("")}</span>
                    </button>`
                  )
                  .join("")
              : '<p class="bk-muted">এই ' + esc(cfg.singular.toLowerCase()) + " এখনো কোনো বইয়ে নেই।</p>"
          }</div>
          <div class="pc-foot" id="${cfg.path}DetailFoot"></div>
        </div>
        <div class="pc-pop-actions">
          <button type="button" class="btn-ghost" data-merge>Edit + merge</button>
          <button type="button" class="btn-gold" id="${cfg.path}DetailEdit">Edit</button>
        </div>`;

      box.querySelector(".bk-close").addEventListener("click", () => pop._close());
      box.querySelector("#" + cfg.path + "DetailEdit").addEventListener("click", () => {
        pop._close();
        openForm(row);
      });
      box.querySelector("[data-merge]").addEventListener("click", () => {
        pop._close();
        openMerge(row);
      });
      box.querySelectorAll("[data-book]").forEach((b) =>
        b.addEventListener("click", () => {
          pop._close();
          if (window.productForm) {
            window.switchView("add-product");
            window.productForm.open(b.dataset.book);
          }
        })
      );

      const foot = box.querySelector("#" + cfg.path + "DetailFoot");
      if (meta.pages > 1) {
        foot.innerHTML = '<div class="pc-pager" role="navigation"></div>';
        const pager = foot.querySelector(".pc-pager");
        const add = (label, page, disabled) => {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = label;
          b.disabled = !!disabled;
          b.addEventListener("click", () => {
            pop._close();
            openDetail(row._id, page);
          });
          pager.appendChild(b);
        };
        add("‹", Number(meta.page) - 1, !meta.hasPrev);
        for (let i = 1; i <= meta.pages; i++) add(String(i), i, false);
        add("›", Number(meta.page) + 1, !meta.hasNext);
      } else {
        foot.remove();
      }
    }

    /* ---------------- merge ---------------- */
    function openMerge(source) {
      if (!source) return;
      const pop = openPop("", { locked: true });
      const box = pop._box;
      let chosen = "";
      box.innerHTML = `
        <div class="bk-modal-head">
          <div>
            <h3>Merge ${esc(cfg.singular.toLowerCase())}</h3>
            <div class="bk-modal-sub">"${esc(source.name || source.nameBn || "")}" এর সব বই যে ${esc(
            cfg.singular.toLowerCase()
          )}-এ যাবে সেটি বেছে নিন।</div>
          </div>
          <button type="button" class="bk-close" aria-label="Close">×</button>
        </div>
        <div class="bk-picker">
          <div class="pc-search bk-search">${ICONS.search}
            <input type="search" id="${cfg.path}MergeSearch" placeholder="Search another ${esc(cfg.singular.toLowerCase())}…" aria-label="Search" />
          </div>
          <div class="bk-suggest" id="${cfg.path}MergeList"></div>
        </div>
        <p class="bk-error" id="${cfg.path}MergeError"></p>
        <div class="pc-pop-actions">
          <button type="button" class="btn-ghost" id="${cfg.path}MergeCancel">Cancel</button>
          <button type="button" class="btn-gold" id="${cfg.path}MergeGo" disabled>Merge</button>
        </div>`;

      const list = box.querySelector("#" + cfg.path + "MergeList");
      const go = box.querySelector("#" + cfg.path + "MergeGo");
      const errEl = box.querySelector("#" + cfg.path + "MergeError");
      box.querySelector(".bk-close").addEventListener("click", () => pop._close());
      box.querySelector("#" + cfg.path + "MergeCancel").addEventListener("click", () => pop._close());

      async function search(term) {
        try {
          const params = new URLSearchParams({ limit: String(MAX_OPTION_ROWS) });
          if (term) params.set("search", term);
          const data = await call("/api/books/" + cfg.path + "/options?" + params.toString());
          const rows = (data[cfg.optionKey] || data.authorOptions || data.publisherOptions || []).filter(
            (r) => String(r._id) !== String(source._id)
          );
          list.hidden = false;
          list.innerHTML = rows.length
            ? rows
                .map(
                  (r) => `<button type="button" class="bk-suggest-row" data-into="${esc(String(r._id))}">
                    <span>${esc(r.name || r.nameBn || "")}</span>
                    <small>${Number(r.bookCount) || 0} books</small>
                  </button>`
                )
                .join("")
            : '<div class="bk-suggest-empty">এই নামে আর কোনো record নেই।</div>';
          list.querySelectorAll("[data-into]").forEach((btn) =>
            btn.addEventListener("click", () => {
              chosen = btn.dataset.into;
              list.querySelectorAll(".bk-suggest-row").forEach((b) => b.classList.toggle("on", b === btn));
              go.disabled = false;
            })
          );
        } catch (err) {
          list.innerHTML = `<div class="bk-suggest-empty">${esc(err.message)}</div>`;
        }
      }
      let timer = null;
      const input = box.querySelector("#" + cfg.path + "MergeSearch");
      input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => search(input.value.trim()), 320);
      });
      search("");

      go.addEventListener("click", async () => {
        go.disabled = true;
        go.textContent = "Merging…";
        try {
          const data = await call("/api/books/" + cfg.path + "/" + encodeURIComponent(source._id) + "/merge", {
            method: "POST",
            body: JSON.stringify({ into: chosen }),
          });
          toast(`${data.moved || 0} বই move হয়েছে`, "ok");
          window.bookModule.clearCache();
          pop._close();
          await load();
        } catch (err) {
          errEl.textContent = err.message;
          go.disabled = false;
          go.textContent = "Merge";
        }
      });
    }

    function open() {
      if (!root) return;
      if (!root.dataset.ready) {
        root.dataset.ready = "1";
        shell();
      }
      // a book-less theme still allows the data screens — say so up front
      moduleState().then((st) => {
        if (st && st.reason === "theme") {
          const gate = root.querySelector("#" + cfg.path + "Gate");
          gate.innerHTML = gateBanner(st, cfg.title);
          bindGateBanner(gate);
        }
      });
      load();
    }

    return { open };
  }

  /* ==========================================================================
     Genres — a shortcut over the Category API (genres ARE categories)
     ========================================================================== */
  const genreState = {
    root: null,
    rows: [],
    meta: { page: 1, pages: 1, total: 0, limit: 20 },
    search: "",
    status: "",
    page: pageFromHash("genres"),
    limit: initialLimit("genres"),
    requestId: 0,
  };

  function genreShell() {
    const root = document.getElementById("genreRoot");
    if (!root) return null;
    root.innerHTML = `
      <div class="bk-wrap">
        <div id="genreGate"></div>
        <div class="bk-genre-path" id="genrePath"></div>
        <div class="bk-toolbar">
          <span class="bk-total"><b id="genreTotal">—</b> genres</span>
          <label class="bk-pick">Status
            <select class="bk-sort" id="genreStatus">
              <option value="">All (not trashed)</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="trashed">Trash</option>
            </select>
          </label>
          <div class="pc-search bk-search">${ICONS.search}
            <input type="search" id="genreSearch" placeholder="Search genre name or slug…" aria-label="Search genres" />
          </div>
          <div class="bk-actions">
            <button type="button" class="btn-ghost" id="genreStarterBtn">+ Starter genre pack</button>
            <button type="button" class="btn-ghost" id="genreMigrateBtn">Migration proposal</button>
            <button type="button" class="btn-add" id="genreAddBtn">+ Genre</button>
          </div>
        </div>
        <form id="genreForm" class="bk-inline" hidden novalidate>
          <div class="pf-grid-2">
            <div class="pf-field"><label for="genreName">Name (English) *</label><input id="genreName" type="text" maxlength="120" /></div>
            <div class="pf-field"><label for="genreNameBn">নাম (বাংলা)</label><input id="genreNameBn" type="text" maxlength="120" /></div>
            <div class="pf-field"><label for="genreFormStatus">Status</label><select id="genreFormStatus">
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select></div>
          </div>
          <div class="pf-row">
            <button type="button" class="pf-btn-sm" id="genreFormCancel">Cancel</button>
            <button type="submit" class="btn-gold" id="genreFormSave" style="padding:8px 14px;font-size:13px;">Add genre</button>
          </div>
        </form>
        <div id="genreTable"><div class="pc-empty">Loading…</div></div>
        <div class="pc-foot" id="genreFoot"></div>
      </div>`;
    return root;
  }

  let genreRootEl = null;

  async function genreLoad() {
    if (!genreRootEl) return;
    const wrap = genreRootEl.querySelector("#genreTable");
    const requestId = ++genreState.requestId;
    wrap.innerHTML = '<div class="pc-empty">Loading…</div>';
    const params = new URLSearchParams({ page: String(genreState.page), limit: String(genreState.limit) });
    if (genreState.search) params.set("search", genreState.search);
    if (genreState.status) params.set("status", genreState.status);
    try {
      const data = await call("/api/books/genres?" + params.toString());
      if (requestId !== genreState.requestId) return;
      genreState.root = data.root;
      genreState.rows = data.genres || [];
      genreState.meta = data.meta || genreState.meta;
      if (genreState.meta.outOfRange) {
        genreState.page = Math.max(1, genreState.meta.pages);
        return genreLoad();
      }
      writePageParam("genres", genreState.page);
      renderGenrePath();
      renderGenreTable();
      renderGenreFoot();
    } catch (err) {
      if (requestId !== genreState.requestId) return;
      if (err.code === "books_module_off" || err.code === "feature_locked") {
        const gate = genreRootEl.querySelector("#genreGate");
        gate.innerHTML = gateBanner({ reason: err.code === "feature_locked" ? "plan" : "toggle" }, "Genres");
        bindGateBanner(gate);
        wrap.innerHTML = "";
        return;
      }
      wrap.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>`;
    }
  }

  function renderGenrePath() {
    const box = genreRootEl.querySelector("#genrePath");
    const r = genreState.root;
    box.innerHTML = r
      ? `Root: <code>${esc(r.name)}${r.nameBn ? " / " + esc(r.nameBn) : ""}</code> <span class="bk-muted">— এই root মুছে বা সরানো যাবে না; genre গুলো সাধারণ category, শুধু এখানে shortcut হিসেবে দেখানো হচ্ছে।</span>`
      : '<span class="bk-muted">Books root এখনো তৈরি হয়নি।</span> <button type="button" class="pf-btn-sm" id="genreCreateRoot">+ Create Books root</button>';
    const btn = box.querySelector("#genreCreateRoot");
    if (btn)
      btn.addEventListener("click", async () => {
        try {
          await call("/api/books/genres/root", { method: "POST", body: "{}" });
          toast("Books root তৈরি হয়েছে", "ok");
          window.bookModule.clearCache();
          genreLoad();
        } catch (err) {
          toast(err.message, "err");
        }
      });
  }

  function renderGenreTable() {
    const wrap = genreRootEl.querySelector("#genreTable");
    if (!genreState.rows.length) {
      wrap.innerHTML = '<div class="pc-empty">এখনো কোনো genre নেই — "+ Starter genre pack" থেকে ১০টি বাংলা genre যোগ করতে পারেন।</div>';
      return;
    }
    wrap.innerHTML = `<div class="pc-table-wrap bk-table-wrap"><table class="pc-table bk-table"><thead><tr>
        <th>Genre</th><th>Slug</th><th>Level</th><th>Books</th><th>Status</th><th>Action</th>
      </tr></thead><tbody>${genreState.rows
        .map((g) => {
          const id = esc(String(g._id));
          return `<tr>
            <td data-col="name" data-label="Genre"><div class="bk-name"><span class="bk-tree-indent"></span><div>
              <b>${esc(g.name || "—")}${g.isDemo ? '<span class="bk-flag">demo</span>' : ""}</b>
              <small>${esc(g.nameBn || "")}</small></div></div></td>
            <td data-col="slug" data-label="Slug"><span class="bk-slug">/${esc(g.slug || "")}</span></td>
            <td data-col="level" data-label="Level">${Number(g.level) || 0}</td>
            <td data-col="books" data-label="Books"><span class="bk-count">${Number(g.books) || 0}</span></td>
            <td data-col="status" data-label="Status"><span class="bk-state ${esc(g.status)}">${esc(g.status)}</span></td>
            <td data-col="actions" data-label="Action"><div class="pc-row-actions">
              <button type="button" class="icon-btn edit" data-genre-edit="${id}" title="Rename / republish">${ICONS.edit}</button>
              ${
                g.status === "trashed"
                  ? `<button type="button" class="icon-btn edit" data-genre-restore="${id}" title="Restore">${ICONS.restore}</button>`
                  : `<button type="button" class="icon-btn del" data-genre-trash="${id}" title="Move to trash">${ICONS.trash}</button>`
              }
            </div></td></tr>`;
        })
        .join("")}</tbody></table></div>`;

    wrap.querySelectorAll("[data-genre-edit]").forEach((b) =>
      b.addEventListener("click", () => {
        const g = genreState.rows.find((row) => String(row._id) === b.dataset.genreEdit);
        openGenreForm(g);
      })
    );
    wrap.querySelectorAll("[data-genre-trash]").forEach((b) =>
      b.addEventListener("click", async () => {
        const ok = await window.confirmDialog({
          title: "Trash this genre?",
          text: "Genre একটি সাধারণ category —-trash করলে বইয়ে থাকা category reference অক্ষত থাকবে, শুধু storefront-এ দেখাবে না।",
          okLabel: "Trash",
        });
        if (!ok) return;
        try {
          await call("/api/categories/" + encodeURIComponent(b.dataset.genreTrash), { method: "DELETE" });
          toast("Genre trashed", "ok");
          genreLoad();
        } catch (err) {
          toast(err.message, "err");
        }
      })
    );
    wrap.querySelectorAll("[data-genre-restore]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await call("/api/categories/" + encodeURIComponent(b.dataset.genreRestore) + "/restore", { method: "PATCH" });
          toast("Genre restored", "ok");
          genreLoad();
        } catch (err) {
          toast(err.message, "err");
        }
      })
    );
  }

  function renderGenreFoot() {
    const foot = genreRootEl.querySelector("#genreFoot");
    const meta = genreState.meta;
    foot.innerHTML = `<div class="ol-foot-info"><span>Page ${meta.page} of ${Math.max(1, meta.pages)} · ${meta.total} genres</span></div>
      <span class="spacer"></span><div class="pc-pager" role="navigation" aria-label="Genre pagination"></div>`;
    const pager = foot.querySelector(".pc-pager");
    const add = (label, page, disabled, current) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.disabled = !!disabled;
      if (current) b.setAttribute("aria-current", "page");
      b.addEventListener("click", () => {
        genreState.page = page;
        genreLoad();
      });
      pager.appendChild(b);
    };
    const pages = Math.max(1, meta.pages);
    add("‹", meta.page - 1, !meta.hasPrev);
    for (let i = 1; i <= pages; i++) {
      if (pages > 7 && Math.abs(i - meta.page) > 2 && i !== 1 && i !== pages) {
        if (i === 2 || i === pages - 1) pager.appendChild(document.createTextNode("…"));
        continue;
      }
      add(String(i), i, false, i === meta.page);
    }
    add("›", meta.page + 1, !meta.hasNext);
  }

  function openGenreForm(genre) {
    const root = document.getElementById("genreRoot");
    const form = root.querySelector("#genreForm");
    form.hidden = false;
    root.querySelector("#genreName").value = genre ? genre.name : "";
    root.querySelector("#genreNameBn").value = genre ? genre.nameBn : "";
    root.querySelector("#genreFormStatus").value = genre && genre.status === "published" ? "published" : "draft";
    root.querySelector("#genreFormSave").textContent = genre ? "Save genre" : "Add genre";
    form.dataset.edit = genre ? String(genre._id) : "";
    root.querySelector("#genreName").focus();
  }

  async function saveGenre(e) {
    e.preventDefault();
    const root = genreRootEl;
    const form = root.querySelector("#genreForm");
    const id = form.dataset.edit;
    const name = root.querySelector("#genreName").value.trim();
    const nameBn = root.querySelector("#genreNameBn").value.trim();
    // a genre never publishes itself — the draft stays a draft until it is asked
    const status = root.querySelector("#genreFormStatus").value === "published" ? "published" : "draft";
    if (!name) {
      toast("Genre name lagbe", "err");
      return;
    }
    try {
      const body = JSON.stringify({
        name,
        nameBn,
        parent: genreState.root ? String(genreState.root._id) : "",
        status,
      });
      if (id) {
        await call("/api/categories/" + encodeURIComponent(id), { method: "PUT", body });
        toast("Genre updated", "ok");
      } else {
        await call("/api/categories", { method: "POST", body });
        toast(
          status === "published" ? "Genre added" : "Genre added (draft) — Categories page থেকে publish করুন",
          "ok"
        );
      }
      form.hidden = true;
      form.dataset.edit = "";
      window.bookModule.clearCache();
      genreLoad();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  function openMigration() {
    const pop = openPop("wide", { locked: true });
    const box = pop._box;
    box.innerHTML = '<div class="pc-empty">Checking existing categories…</div>';
    (async () => {
      let data;
      try {
        data = await call("/api/books/genres/migration");
      } catch (err) {
        box.innerHTML = `<div class="pc-empty">${esc(err.message)}</div>`;
        return;
      }
      const rows = data.candidates || [];
      box.innerHTML = `
        <div class="bk-modal-head">
          <div>
            <h3>Genre migration proposal</h3>
            <div class="bk-modal-sub">এই category গুলো genre-এর মতো দেখাচ্ছে। বেছে নিয়ে Apply করলেই "Books" root এর নিচে চলে যাবে — নিজে থেকে কিছু হয় না।</div>
          </div>
          <button type="button" class="bk-close" aria-label="Close">×</button>
        </div>
        ${
          rows.length
            ? `<div class="pc-table-wrap"><table class="pc-table bk-table"><thead><tr>
                <th></th><th>Category</th><th>Books</th><th>Children</th><th>Slug after move</th>
              </tr></thead><tbody>${rows
                .map(
                  (c) => `<tr>
                    <td data-col="pick" data-label=""><input type="checkbox" data-cand="${esc(String(c._id))}" /></td>
                    <td data-col="name" data-label="Category"><b>${esc(c.name || "")}</b><small class="bk-muted"> ${esc(c.nameBn || "")}</small></td>
                    <td data-col="books" data-label="Books">${Number(c.products) || 0}</td>
                    <td data-col="children" data-label="Children">${Number(c.children) || 0}</td>
                    <td data-col="slug" data-label="Slug"><span class="bk-slug">/${esc(c.newSlug || "")}</span>${
                      c.urlChanges ? "" : ' <span class="bk-flag">url stays</span>'
                    }</td>
                  </tr>`
                )
                .join("")}</tbody></table></div>`
            : '<p class="bk-muted" style="margin-top:14px;">কোনো candidate পাওয়া যায়নি।</p>'
        }
        <p class="bk-error" id="genreMigError"></p>
        <div class="pc-pop-actions">
          <button type="button" class="btn-ghost" id="genreMigCancel">Cancel</button>
          <button type="button" class="btn-gold" id="genreMigApply" ${rows.length ? "" : "disabled"}>Move selected</button>
        </div>`;
      box.querySelector(".bk-close").addEventListener("click", () => pop._close());
      box.querySelector("#genreMigCancel").addEventListener("click", () => pop._close());
      box.querySelector("#genreMigApply").addEventListener("click", async () => {
        const ids = [...box.querySelectorAll("[data-cand]:checked")].map((c) => c.dataset.cand);
        if (!ids.length) {
          box.querySelector("#genreMigError").textContent = "কমপক্ষে একটি category বেছে নিন";
          return;
        }
        const ok = await window.confirmDialog({
          title: "Move " + ids.length + " categories?",
          text: "Selecting these changes only the category tree (parent). Product links and URLs stay as they are.",
          okLabel: "Move",
        });
        if (!ok) return;
        try {
          const out = await call("/api/books/genres/migration/apply", { method: "POST", body: JSON.stringify({ ids }) });
          toast((out.moved || []).length + " category Books root এ move হয়েছে", "ok");
          window.bookModule.clearCache();
          pop._close();
          genreLoad();
        } catch (err) {
          box.querySelector("#genreMigError").textContent = err.message;
        }
      });
    })();
  }

  /* ==========================================================================
     Public surface
     ========================================================================== */
  function openPeople(kindKey) {
    if (!peoplePages[kindKey]) {
      peoplePages[kindKey] = buildPeoplePage(PEOPLE[kindKey]);
    }
    moduleState();
    peoplePages[kindKey].open();
  }

  function openGenres() {
    moduleState();
    if (!genreRootEl) {
      genreRootEl = genreShell();
      if (!genreRootEl) return;
      const input = genreRootEl.querySelector("#genreSearch");
      let timer = null;
      input.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          genreState.search = input.value.trim();
          genreState.page = 1;
          genreLoad();
        }, 320);
      });
      genreRootEl.querySelector("#genreStatus").addEventListener("change", (e) => {
        genreState.status = e.target.value;
        genreState.page = 1;
        genreLoad();
      });
      genreRootEl.querySelector("#genreAddBtn").addEventListener("click", () => openGenreForm(null));
      genreRootEl.querySelector("#genreFormCancel").addEventListener("click", () => {
        genreRootEl.querySelector("#genreForm").hidden = true;
      });
      genreRootEl.querySelector("#genreForm").addEventListener("submit", saveGenre);
      genreRootEl.querySelector("#genreMigrateBtn").addEventListener("click", openMigration);
      genreRootEl.querySelector("#genreStarterBtn").addEventListener("click", async () => {
        const ok = await window.confirmDialog({
          title: "Add the starter genre pack?",
          text: "১০টি সাধারণ genre (draft হিসেবে) যোগ হবে — পরে publish / trash করা যাবে।",
          okLabel: "Add genres",
          okClass: "btn-gold",
        });
        if (!ok) return;
        try {
          const data = await call("/api/books/genres/starter", { method: "POST", body: "{}" });
          toast((data.added || []).length + " টি genre যোগ হয়েছে", "ok");
          window.bookModule.clearCache();
          genreLoad();
        } catch (err) {
          toast(err.message, "err");
        }
      });
      bindGateBanner(genreRootEl);
    }
    genreLoad();
  }

  window.bookPeople = { open: openPeople };
  window.bookGenres = { open: openGenres };
  window.bookModule = {
    state: moduleState,
    clearCache() {
      stateCache = null;
    },
    banner: gateBanner,
    bindBanner: bindGateBanner,
  };
})();
