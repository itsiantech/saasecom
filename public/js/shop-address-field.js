/* ==========================================================================
   Live shop-address field, shared by setup.html and plan-checkout.html.

   - 500 ms debounce, local format check first, then GET /api/check-slug.
   - AbortController + value comparison: a stale response never overwrites a
     newer one.
   - States: idle / checking / available / invalid / reserved / taken / error.
   - Auto-suggests the label from the shop name (Bangla → Latin) until the
     user edits the address themselves.
   - Three alternatives when the name is unavailable.
   - Never resets or closes the surrounding form; the submit handler asks
     ensureAvailable() and keeps the typed values on failure.

   Requires public/js/shop-address.js (window.ShopAddress) on the page.
   ========================================================================== */
(function () {
  "use strict";

  const shared = window.ShopAddress;
  if (!shared) return;

  const LABELS = {
    bn: {
      full: "পুরো ঠিকানা",
      checking: "চেক করা হচ্ছে…",
      available: "এই ঠিকানাটি খালি আছে",
      taken: "এই ঠিকানা আগেই নেওয়া হয়েছে",
      error: "ঠিকানা চেক করা যাচ্ছে না — আবার চেষ্টা করুন",
      suggestions: "এই নামগুলো নিতে পারেন",
      noDomain: "প্ল্যাটফর্মের ডোমেইন এখনো সেট করা হয়নি — ঠিকানাটি এখন শুধু নাম হিসেবে সংরক্ষিত হবে।",
    },
    en: {
      full: "Full address",
      checking: "Checking…",
      available: "This address is available",
      taken: "This address is already taken",
      error: "Could not check the address — try again",
      suggestions: "Try one of these names",
      noDomain: "The platform domain is not configured yet — the name is saved on its own for now.",
    },
  };

  function langFromPage() {
    try {
      const fromQuery = new URLSearchParams(location.search).get("lang");
      const stored = localStorage.getItem("luxe_lang");
      const html = document.documentElement.getAttribute("lang");
      const value = String(fromQuery || stored || html || "bn").toLowerCase();
      return value.indexOf("en") === 0 ? "en" : "bn";
    } catch {
      return "bn";
    }
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function mount(options) {
    const opts = options || {};
    const input = opts.input;
    if (!input) throw new Error("ShopAddressField: input lagbe");

    const nameInput = opts.nameInput || null;
    const suffixEl = opts.suffixEl || null;
    const urlEl = opts.urlEl || null;
    const statusEl = opts.statusEl || null;
    const suggestionsEl = opts.suggestionsEl || null;
    const ruleEl = opts.ruleEl || null;
    const lang = opts.lang === "en" ? "en" : opts.lang === "bn" ? "bn" : langFromPage();
    const labels = LABELS[lang];
    const onState = typeof opts.onState === "function" ? opts.onState : function () {};

    let domain = String(opts.domain || "").trim().toLowerCase().replace(/^\.+/, "");
    let touched = Boolean(shared.normalize(input.value));
    let composing = false;
    let timer = null;
    let controller = null;
    let pendingRun = null;

    const state = {
      status: "idle",
      value: shared.normalize(input.value),
      reason: null,
      message: "",
      pending: false,
    };

    if (ruleEl) ruleEl.textContent = shared.RULE_TEXT[lang];

    /* ------------------------------------------------------------ render */
    function renderDomain() {
      if (suffixEl) {
        suffixEl.textContent = domain ? "." + domain : "";
        suffixEl.hidden = !domain;
      }
      renderUrl(state.value);
    }

    function renderUrl(value) {
      if (!urlEl) return;
      const full = shared.fullAddress(value, domain);
      if (full) {
        urlEl.hidden = false;
        urlEl.classList.remove("is-warn");
        urlEl.textContent = labels.full + ": " + full;
      } else if (!domain) {
        urlEl.hidden = false;
        urlEl.classList.add("is-warn");
        urlEl.textContent = labels.noDomain;
      } else {
        urlEl.hidden = true;
        urlEl.textContent = "";
      }
    }

    function renderStatus() {
      input.classList.remove("is-bad", "is-warn", "is-ok");
      input.removeAttribute("aria-busy");
      if (!statusEl) return;

      let text = "";
      let tone = "";
      if (state.status === "checking") {
        text = labels.checking;
        tone = "";
        input.setAttribute("aria-busy", "true");
      } else if (state.status === "available") {
        text = labels.available;
        tone = "is-ok";
      } else if (state.status === "invalid") {
        text = state.message || shared.RULE_TEXT[lang];
        tone = "is-bad";
      } else if (state.status === "reserved") {
        text = state.message || shared.MESSAGES.reserved[lang];
        tone = "is-bad";
      } else if (state.status === "taken") {
        text = state.message || labels.taken;
        tone = "is-bad";
      } else if (state.status === "error") {
        text = state.message || labels.error;
        tone = "is-warn";
      }

      statusEl.textContent = text;
      statusEl.className = "addr-status" + (tone ? " " + tone : "");
      statusEl.hidden = !text;
      if (tone === "is-bad" || tone === "is-warn") {
        input.classList.add(tone);
        input.setAttribute("aria-invalid", "true");
      } else {
        input.removeAttribute("aria-invalid");
      }
      if (tone === "is-ok") input.classList.add("is-ok");
    }

    function renderSuggestions() {
      if (!suggestionsEl) return;
      const offer = state.status === "taken" || state.status === "reserved";
      if (!offer) {
        suggestionsEl.hidden = true;
        suggestionsEl.innerHTML = "";
        return;
      }
      const base = state.value || shared.normalize(input.value) || (nameInput ? nameInput.value : "");
      const list = shared.alternatives(base, 3);
      if (!list.length) {
        suggestionsEl.hidden = true;
        suggestionsEl.innerHTML = "";
        return;
      }
      suggestionsEl.hidden = false;
      suggestionsEl.innerHTML =
        '<span class="addr-suggest-label">' + esc(labels.suggestions) + "</span>" +
        list
          .map(
            (name) =>
              '<button type="button" class="addr-suggest-btn" data-address="' +
              esc(name) +
              '">' +
              esc(name) +
              "</button>"
          )
          .join("");
    }

    function snapshot() {
      return {
        status: state.status,
        value: state.value,
        reason: state.reason,
        message: state.message,
        available: state.status === "available",
        busy: state.status === "checking",
      };
    }

    function render() {
      renderUrl(state.value);
      renderStatus();
      renderSuggestions();
      onState(snapshot());
    }

    /* ------------------------------------------------------------- check */
    function abortInFlight() {
      if (controller) {
        controller.abort();
        controller = null;
      }
    }

    function setStatus(status, value, reason, message) {
      state.status = status;
      state.value = value;
      state.reason = reason || null;
      state.message = message || "";
    }

    async function runCheck() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      abortInFlight();

      const local = shared.validate(input.value, { reserved: [], lang });
      state.pending = false;

      if (local.reason === "empty") {
        setStatus("idle", "", null, "");
        render();
        return;
      }
      if (!local.ok) {
        setStatus("invalid", local.value, "invalid", local.message);
        render();
        return;
      }

      const value = local.value;
      setStatus("checking", value, null, "");
      state.pending = true;
      render();

      const ctrl = new AbortController();
      controller = ctrl;

      const run = (async () => {
        try {
          const res = await fetch("/api/check-slug?slug=" + encodeURIComponent(value), {
            signal: ctrl.signal,
            headers: { Accept: "application/json" },
          });
          let data = null;
          try {
            data = await res.json();
          } catch {
            data = null;
          }
          if (ctrl.signal.aborted) return;
          if (shared.normalize(input.value) !== value) return; // a newer value won

          if (res.status === 429) {
            setStatus("error", value, "error", (data && data.message) || labels.error);
          } else if (!res.ok || !data) {
            setStatus("error", value, "error", labels.error);
          } else if (data.available) {
            setStatus("available", value, null, "");
          } else if (data.reason === "reserved") {
            setStatus("reserved", value, "reserved", shared.MESSAGES.reserved[lang]);
          } else if (data.reason === "taken") {
            setStatus("taken", value, "taken", shared.MESSAGES.taken[lang]);
          } else {
            const again = shared.validate(value, { reserved: [], lang });
            setStatus("invalid", value, "invalid", again.message || shared.RULE_TEXT[lang]);
          }
        } catch (err) {
          if (err && err.name === "AbortError") return;
          if (ctrl.signal.aborted) return;
          setStatus("error", value, "error", labels.error);
        } finally {
          if (controller === ctrl) controller = null;
          if (shared.normalize(input.value) === value) {
            state.pending = false;
            render();
          }
        }
      })();

      pendingRun = run;
      await run;
    }

    function schedule() {
      abortInFlight();
      if (timer) clearTimeout(timer);
      timer = setTimeout(runCheck, 500);
    }

    function applyValue(value, fromUser) {
      input.value = value;
      touched = Boolean(fromUser) && Boolean(shared.normalize(value));
      schedule();
    }

    /* ------------------------------------------------------------ events */
    function onSlugInput() {
      if (composing) return;
      touched = Boolean(shared.normalize(input.value));
      schedule();
    }

    function onCompositionStart() {
      composing = true;
    }

    function onCompositionEnd() {
      composing = false;
      onSlugInput();
    }

    function onNameInput() {
      if (touched) return;
      applyValue(shared.slugify(nameInput.value), false);
    }

    function onSuggestionClick(event) {
      const btn = event.target.closest("[data-address]");
      if (!btn) return;
      event.preventDefault();
      input.value = btn.dataset.address;
      touched = true;
      input.focus();
      runCheck();
    }

    input.addEventListener("input", onSlugInput);
    input.addEventListener("compositionstart", onCompositionStart);
    input.addEventListener("compositionend", onCompositionEnd);
    if (nameInput) nameInput.addEventListener("input", onNameInput);
    if (suggestionsEl) suggestionsEl.addEventListener("click", onSuggestionClick);

    /* -------------------------------------------------------------- init */
    renderDomain();
    if (!touched && nameInput && !shared.normalize(input.value) && nameInput.value) {
      input.value = shared.slugify(nameInput.value);
    }
    if (shared.normalize(input.value)) {
      touched = true;
      runCheck();
    } else {
      render();
    }

    return {
      value: function () {
        return shared.normalize(input.value);
      },
      message: function () {
        if (state.status === "checking") return labels.checking;
        if (state.status === "available") return "";
        return state.message || labels.error;
      },
      state: snapshot,
      setDomain: function (value) {
        domain = String(value || "").trim().toLowerCase().replace(/^\.+/, "");
        renderDomain();
      },
      recheck: runCheck,
      ensureAvailable: async function () {
        let value = shared.normalize(input.value);
        if (state.status === "available" && state.value === value && !state.pending) return true;

        if (state.pending && pendingRun) await pendingRun;
        value = shared.normalize(input.value);
        if (state.status === "available" && state.value === value && !state.pending) return true;

        await runCheck();
        return state.status === "available" && state.value === shared.normalize(input.value);
      },
      destroy: function () {
        abortInFlight();
        if (timer) clearTimeout(timer);
        input.removeEventListener("input", onSlugInput);
        input.removeEventListener("compositionstart", onCompositionStart);
        input.removeEventListener("compositionend", onCompositionEnd);
        if (nameInput) nameInput.removeEventListener("input", onNameInput);
        if (suggestionsEl) suggestionsEl.removeEventListener("click", onSuggestionClick);
      },
    };
  }

  window.ShopAddressField = { mount: mount, langFromPage: langFromPage };
})();
