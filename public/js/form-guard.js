/* ==========================================================================
   FormGuard — keeps admin forms from losing typed data.

   - No Esc / outside-click close. Only X / Cancel, and those ask first.
   - Local autosave after 800 ms, server draft autosave after ~2.2 s.
   - Restore prompt when this browser still holds an unsaved draft.
   - beforeunload / pagehide flush the local copy (and a keepalive draft save).
   - Focus trap for modals, inline error banner, "draft saved" status text.
   ========================================================================== */
(function () {
  "use strict";

  const LOCAL_PREFIX = "draft:";
  const LOCAL_DEBOUNCE = 800;
  const SERVER_DEBOUNCE = 2200;

  function scopeKey() {
    let store = "";
    let user = "";
    try {
      store = localStorage.getItem("luxe_store_id") || localStorage.getItem("luxe_store_slug") || "store";
      user = localStorage.getItem("luxe_user_id") || "user";
    } catch {
      /* private mode */
    }
    return store + ":" + user;
  }

  function keyFor(type, recordId) {
    return LOCAL_PREFIX + scopeKey() + ":" + type + ":" + (recordId ? String(recordId) : "new");
  }

  function readLocal(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object" || !data.values) return null;
      return data;
    } catch {
      return null;
    }
  }

  function writeLocal(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  function removeLocal(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* private mode */
    }
  }

  function clearAllLocal() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.indexOf(LOCAL_PREFIX) === 0) keys.push(key);
      }
      keys.forEach(function (key) {
        localStorage.removeItem(key);
      });
    } catch {
      /* private mode */
    }
  }

  function clock(value) {
    const d = value ? new Date(value) : new Date();
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function newDraftKey() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return "fg-" + window.crypto.randomUUID();
      }
    } catch {
      /* fallback below */
    }
    return "fg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 12);
  }

  function focusable(root) {
    if (!root) return [];
    return Array.prototype.slice
      .call(
        root.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
      .filter(function (el) {
        return el.offsetParent !== null || el === document.activeElement;
      });
  }

  function trapTab(root, e) {
    const nodes = focusable(root);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Small blocking prompt above any modal. Resolves with the chosen key,
  // null on Esc (caller treats null as "stay as is").
  function showPrompt(config) {
    return new Promise(function (resolve) {
      const overlay = document.createElement("div");
      overlay.className = "fg-prompt";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", config.title || "Unsaved changes");
      const actions = (config.buttons || [])
        .map(function (btn) {
          return (
            '<button type="button" class="' +
            esc(btn.class || "btn-ghost") +
            '" data-choice="' +
            esc(btn.key) +
            '">' +
            esc(btn.label) +
            "</button>"
          );
        })
        .join("");
      overlay.innerHTML =
        '<div class="fg-prompt-box">' +
        "<h4>" +
        esc(config.title || "") +
        "</h4>" +
        (config.text ? "<p>" + esc(config.text) + "</p>" : "") +
        '<div class="fg-prompt-actions">' +
        actions +
        "</div></div>";
      document.body.appendChild(overlay);

      const box = overlay.querySelector(".fg-prompt-box");
      const finish = function (choice) {
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        resolve(choice == null ? null : choice);
      };
      const onKey = function (e) {
        if (e.key === "Escape") {
          e.stopPropagation();
          finish(config.escape == null ? null : config.escape);
          return;
        }
        if (e.key === "Tab") trapTab(box, e);
      };
      overlay.querySelectorAll("[data-choice]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          finish(btn.dataset.choice);
        });
      });
      document.addEventListener("keydown", onKey, true);
      const primary = overlay.querySelector(".btn-gold") || overlay.querySelector("button");
      if (primary) primary.focus();
    });
  }

  function collectElements(els) {
    const out = {};
    for (let i = 0; i < els.length; i += 1) {
      const el = els[i];
      if (!el) continue;
      const tag = String(el.tagName || "").toUpperCase();
      if (tag === "BUTTON" || el.type === "submit" || el.type === "button" || el.type === "file" || el.type === "reset") {
        continue;
      }
      const name = el.name || el.id;
      if (!name) continue;
      if (el.type === "checkbox") out[name] = !!el.checked;
      else if (el.type === "radio") {
        if (el.checked) out[name] = el.value;
        else if (!Object.prototype.hasOwnProperty.call(out, name)) out[name] = "";
      } else out[name] = el.value;
    }
    return out;
  }

  function collectValues(form) {
    return form ? collectElements(form.elements) : {};
  }

  function collectFrom(root) {
    if (!root) return {};
    if (String(root.tagName || "").toUpperCase() === "FORM") return collectElements(root.elements);
    return collectElements(root.querySelectorAll("input, select, textarea"));
  }

  function applyElements(els, values) {
    for (let i = 0; i < els.length; i += 1) {
      const el = els[i];
      if (!el) continue;
      const name = el.name || el.id;
      if (!name || !Object.prototype.hasOwnProperty.call(values, name)) continue;
      if (el.type === "checkbox") el.checked = values[name] === true;
      else if (el.type === "radio") el.checked = el.value === values[name];
      else if (el.type !== "file") el.value = values[name] == null ? "" : values[name];
    }
  }

  function applyValues(form, values) {
    if (!form || !values) return;
    applyElements(form.elements, values);
  }

  function applyTo(root, values) {
    if (!root || !values) return;
    if (String(root.tagName || "").toUpperCase() === "FORM") applyElements(root.elements, values);
    else applyElements(root.querySelectorAll("input, select, textarea"), values);
  }

  // Inline forms live inside hidden dashboard views. The restore prompt must
  // wait until the user actually opens the view, otherwise it blocks the page.
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.hidden) return false;
    let node = el;
    while (node && node.nodeType === 1) {
      if (node.hidden) return false;
      if (node.style && node.style.display === "none") return false;
      node = node.parentElement;
    }
    return true;
  }

  function whenVisible(el, cb) {
    if (isVisible(el)) {
      cb();
      return function () {};
    }
    let stopped = false;
    const observer = new MutationObserver(function () {
      if (stopped || !isVisible(el)) return;
      stopped = true;
      observer.disconnect();
      cb();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["hidden", "class", "style"],
      subtree: true,
    });
    return function () {
      stopped = true;
      observer.disconnect();
    };
  }

  function attach(options) {
    const opts = options || {};
    const form = opts.form || null;
    const root = form || opts.root;
    if (!root) throw new Error("FormGuard: form ba root element lagbe");

    const type = opts.type || "form";
    const recordId = opts.recordId ? String(opts.recordId) : null;
    const draftOf = opts.draftOf ? String(opts.draftOf) : null;
    let key =
      typeof opts.key === "function"
        ? String(opts.key())
        : typeof opts.key === "string"
        ? opts.key
        : keyFor(type, recordId);

    function resolveKey() {
      if (typeof opts.key === "function") key = String(opts.key());
      return key;
    }

    let draftKey = opts.draftKey || newDraftKey();
    let serverDraftId = opts.serverDraftId ? String(opts.serverDraftId) : null;
    let dirty = false;
    let detached = false;
    let saving = false;
    let pendingSave = false;
    let localTimer = null;
    let serverTimer = null;
    let lastServerJSON = "";
    let lastServerAt = null;

    let statusEl = opts.statusEl || null;
    if (!statusEl) {
      statusEl = document.createElement("div");
      statusEl.className = "fg-status";
      statusEl.setAttribute("role", "status");
      statusEl.setAttribute("aria-live", "polite");
      root.insertBefore(statusEl, root.firstChild);
    }

    let errorEl = opts.errorEl || null;
    if (!errorEl) {
      errorEl = document.createElement("div");
      errorEl.className = "fg-banner";
      errorEl.setAttribute("role", "alert");
      errorEl.hidden = true;
      root.insertBefore(errorEl, root.firstChild);
    }

    let stopRestoreWait = null;

    // Secret fields (SMTP password, SMS API key) never reach localStorage.
    const excluded = new Set((opts.exclude || []).map(String));

    function collectAll() {
      const values = collectFrom(root);
      if (typeof opts.extra === "function") {
        const extra = opts.extra();
        if (extra && typeof extra === "object") Object.assign(values, extra);
      }
      excluded.forEach(function (name) {
        delete values[name];
      });
      return values;
    }

    function setStatus(text, cls) {
      if (!statusEl) return;
      statusEl.textContent = text || "";
      statusEl.className = "fg-status" + (cls ? " " + cls : "");
      statusEl.hidden = !text;
    }

    function showError(text) {
      if (!errorEl) return;
      errorEl.textContent = text || "";
      errorEl.hidden = !text;
    }

    function clearTimers() {
      clearTimeout(localTimer);
      clearTimeout(serverTimer);
      localTimer = null;
      serverTimer = null;
    }

    function saveLocal() {
      if (detached) return false;
      const ok = writeLocal(key, {
        type: type,
        recordId: recordId,
        draftOf: draftOf,
        draftKey: draftKey,
        serverId: serverDraftId,
        values: collectAll(),
        savedAt: new Date().toISOString(),
      });
      if (!ok) {
        setStatus("Draft save hoyni — browser storage purno", "is-error");
        return false;
      }
      if (!opts.serverSave || navigator.onLine === false) {
        setStatus(navigator.onLine === false ? "Offline, saved on this device" : "Saved on this device", "is-local");
      }
      return true;
    }

    function schedule() {
      clearTimers();
      localTimer = setTimeout(saveLocal, LOCAL_DEBOUNCE);
      if (opts.serverSave) serverTimer = setTimeout(saveServer, SERVER_DEBOUNCE);
    }

    async function saveServer() {
      if (detached || !opts.serverSave) return false;
      if (saving) {
        pendingSave = true;
        return false;
      }
      const values = collectAll();
      const serialized = JSON.stringify(values);
      if (serialized === lastServerJSON) {
        if (navigator.onLine === false) setStatus("Offline, saved on this device", "is-local");
        else if (lastServerAt) setStatus("Draft saved " + clock(lastServerAt), "is-saved");
        return true;
      }
      saving = true;
      setStatus("Saving...", "is-saving");
      try {
        const payload = Object.assign(
          { draftKey: draftKey, draftOf: draftOf || null, id: serverDraftId || undefined },
          values
        );
        const saved = await opts.serverSave(payload);
        const id = saved && (saved.id || saved._id);
        if (!id) throw new Error("Draft save hoyni");
        serverDraftId = String(id);
        lastServerJSON = serialized;
        lastServerAt = new Date();
        saveLocal();
        setStatus("Draft saved " + clock(lastServerAt), "is-saved");
        return true;
      } catch (err) {
        saveLocal();
        setStatus("Offline, saved on this device", "is-local");
        return false;
      } finally {
        saving = false;
        if (pendingSave && !detached) {
          pendingSave = false;
          serverTimer = setTimeout(saveServer, 200);
        }
      }
    }

    function flushKeepalive() {
      if (!opts.serverUrl || !opts.serverSave) return;
      const values = collectAll();
      if (JSON.stringify(values) === lastServerJSON) return;
      const token = (function () {
        try {
          return localStorage.getItem("luxe_token") || "";
        } catch {
          return "";
        }
      })();
      if (!token) return;
      const headers = { "Content-Type": "application/json", Authorization: "Bearer " + token };
      try {
        const slug = localStorage.getItem("luxe_store_slug");
        if (slug) headers["x-store-slug"] = slug;
      } catch {
        /* private mode */
      }
      const payload = Object.assign(
        { draftKey: draftKey, draftOf: draftOf || null, id: serverDraftId || undefined },
        values
      );
      try {
        fetch(opts.serverUrl, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(payload),
          keepalive: true,
        });
      } catch {
        /* local copy already holds the values */
      }
    }

    async function discardChanges() {
      clearTimers();
      if (serverDraftId && opts.serverDiscard) {
        try {
          await opts.serverDiscard(serverDraftId);
        } catch {
          /* best effort */
        }
      }
      serverDraftId = null;
      removeLocal(key);
      dirty = false;
    }

    async function saveAsDraft() {
      clearTimers();
      const localOk = saveLocal();
      if (opts.serverSave && navigator.onLine !== false) return saveServer();
      return localOk;
    }

    async function publish() {
      clearTimers();
      const values = collectAll();
      const problem = opts.validate ? opts.validate(values) : "";
      if (problem) {
        showError(problem);
        setStatus("", "");
        return false;
      }
      showError("");
      const btn = opts.publishButton;
      let label = "";
      if (btn) {
        label = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Saving...";
      }
      setStatus("Saving...", "is-saving");
      try {
        const saved = await opts.publish(values);
        dirty = false;
        if (serverDraftId && opts.serverDiscard) {
          try {
            await opts.serverDiscard(serverDraftId);
          } catch {
            /* draft row already removed by publish */
          }
        }
        serverDraftId = null;
        removeLocal(key);
        clearTimers();
        if (typeof opts.onPublish === "function") await opts.onPublish(saved, values);
        return true;
      } catch (err) {
        showError((err && err.message) || "Save hoyni — abar chesta korun");
        setStatus("", "");
        return false;
      } finally {
        if (btn) {
          btn.disabled = false;
          if (label) btn.textContent = label;
        }
      }
    }

    async function close(closeOptions) {
      const force = !!(closeOptions && closeOptions.force);
      if (!force && dirty) {
        const choice = await showPrompt({
          title: "Save this form as draft?",
          text: "Apnar type kora data ekhono final save hoyni. Draft hisebe rakben, naki discard korben?",
          escape: "keep",
          buttons: [
            { key: "keep", label: "Keep editing", class: "btn-ghost" },
            { key: "discard", label: "Discard", class: "btn-ghost fg-danger" },
            { key: "draft", label: "Save as draft", class: "btn-gold" },
          ],
        });
        if (choice === "draft") {
          await saveAsDraft();
        } else if (choice === "discard") {
          await discardChanges();
        } else {
          return false;
        }
      }
      detach();
      if (typeof opts.onClose === "function") opts.onClose();
      return true;
    }

    function onInput() {
      if (detached) return;
      dirty = true;
      showError("");
      setStatus("Saving...", "is-saving");
      schedule();
    }

    function onBeforeUnload(e) {
      if (detached || !dirty) return undefined;
      saveLocal();
      flushKeepalive();
      e.preventDefault();
      e.returnValue = "";
      return "";
    }

    function onPageHide() {
      if (detached || !dirty) return;
      saveLocal();
      flushKeepalive();
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") onPageHide();
    }

    function onWindowError(event) {
      if (detached || !isVisible(root)) return;
      if (opts.container && opts.container.isConnected === false) return;
      const detail = (event && event.message) || "Form e kichu bhul hoyeche";
      showError(detail + " — apnar data form e ache, abar chesta korun.");
    }

    function onWindowRejection(event) {
      if (detached || !isVisible(root)) return;
      const reason = event && event.reason;
      const detail = (reason && (reason.message || String(reason))) || "Kichu ekta fail hoyeche";
      if (/session|login/i.test(detail)) return; // re-login modal already explains this
      showError(detail + " — apnar data form e ache, abar chesta korun.");
    }

    function onTrapKey(e) {
      if (e.key !== "Tab" || !opts.container) return;
      trapTab(opts.container, e);
    }

    function detach() {
      if (detached) return;
      detached = true;
      clearTimers();
      if (stopRestoreWait) stopRestoreWait();
      root.removeEventListener("input", onInput);
      root.removeEventListener("change", onInput);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onWindowRejection);
      if (opts.container) opts.container.removeEventListener("keydown", onTrapKey);
    }

    root.addEventListener("input", onInput);
    root.addEventListener("change", onInput);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onWindowRejection);
    if (opts.container) {
      opts.container.setAttribute("aria-modal", "true");
      opts.container.addEventListener("keydown", onTrapKey);
    }

    lastServerJSON = JSON.stringify(collectAll());

    function showRestorePrompt(restored) {
      const savedAt = restored.savedAt;
      if (stopRestoreWait) stopRestoreWait();
      stopRestoreWait = whenVisible(root, function () {
        if (detached) return;
        showPrompt({
          title: "Unsaved form found",
          text:
            "Ei form er ekta unsaved draft ache" +
            (savedAt ? " (" + clock(savedAt) + ")" : "") +
            ". Continue korben naki notun form shuru korben?",
          escape: "new",
          buttons: [
            { key: "new", label: "Start new", class: "btn-ghost" },
            { key: "continue", label: "Continue draft", class: "btn-gold" },
          ],
        }).then(function (choice) {
          if (detached || choice !== "continue") {
            if (choice === "new") removeLocal(key);
            return;
          }
          const restoredValues = Object.assign({}, restored.values);
          excluded.forEach(function (name) {
            delete restoredValues[name];
          });
          applyTo(root, restoredValues);
          if (typeof opts.extraApply === "function") opts.extraApply(restoredValues);
          draftKey = restored.draftKey || draftKey;
          serverDraftId = restored.serverId ? String(restored.serverId) : serverDraftId;
          lastServerJSON = JSON.stringify(collectAll());
          dirty = true;
          setStatus("Draft restored — " + (savedAt ? clock(savedAt) : "just now"), "is-saved");
          if (typeof opts.onRestore === "function") opts.onRestore(restoredValues);
        });
      });
    }

    // Edit/new switch korle form er draft key-o bodlai — tar por local draft check.
    function rebase(checkForDraft) {
      clearTimers();
      if (stopRestoreWait) stopRestoreWait();
      resolveKey();
      lastServerJSON = JSON.stringify(collectAll());
      if (checkForDraft === false) return;
      const restored = readLocal(key);
      if (restored && restored.values) showRestorePrompt(restored);
    }

    // Restore prompt is deferred until the form is actually on screen (and one
    // tick later) so modals and hidden dashboard views both behave.
    const restored = opts.restore === false ? null : readLocal(key);
    if (restored && restored.values) {
      setTimeout(function () {
        if (detached) return;
        showRestorePrompt(restored);
      }, 0);
    }

    function markClean() {
      clearTimers();
      removeLocal(key);
      serverDraftId = null;
      dirty = false;
      showError("");
      setStatus("", "");
    }

    return {
      root: root,
      draftKey: function () {
        return draftKey;
      },
      serverDraftId: function () {
        return serverDraftId;
      },
      values: function () {
        return collectAll();
      },
      isDirty: function () {
        return dirty;
      },
      publish: publish,
      close: close,
      saveAsDraft: saveAsDraft,
      discard: discardChanges,
      markClean: markClean,
      rebase: rebase,
      showError: showError,
      setStatus: setStatus,
      detach: detach,
      key: function () {
        return key;
      },
    };
  }

  window.FormGuard = {
    attach: attach,
    clearAllLocal: clearAllLocal,
    keyFor: keyFor,
    newDraftKey: newDraftKey,
    collectValues: collectValues,
  };
})();