/* ==========================================================================
   Retail EMI back office — settings, month plans, application review,
   converted orders, schedule and manual payments. Loads on demand when the
   dashboard switches to #view-retail-emi.
   ========================================================================== */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const money = (paisa) =>
    "৳ " + ((Number(paisa) || 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const taka = (value) => (value === "" || value == null ? 0 : Math.round(Number(value) * 100));
  const fromPaisaInput = (paisa) => (paisa == null ? "" : String(Math.round(Number(paisa) || 0) / 100));
  const date = (value) => (value ? new Date(value).toLocaleDateString("en-GB") : "—");

  const state = {
    loaded: false,
    loading: false,
    tab: "applications",
    config: null,
    settings: null,
    rules: [],
    categories: [],
    offers: [],
    applications: [],
    counts: {},
    appDetail: null,
    appDetailId: "",
    orders: [],
    orderStats: {},
    orderDetail: null,
    orderDetailId: "",
    editingOfferId: "",
    statusFilter: "",
    search: "",
    report: null,
    reportPeriod: { preset: "this_month", from: "", to: "" },
  };

  async function api(path, opts = {}) {
    const res = await window.ApiSession.request(path, opts);
    if (!res) return null;
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const message = (data && data.message) || "Request fail";
      throw new Error(message);
    }
    return data;
  }

  function toast(message, type) {
    if (typeof window.toast === "function") return window.toast(message, type || "ok");
    const el = $("toast");
    if (!el) return;
    el.textContent = message;
    el.className = "toast show " + (type || "");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function armAction(btn, label, run) {
    if (btn.dataset.armed === "1") {
      clearTimeout(btn._armTimer);
      btn.dataset.armed = "";
      btn.classList.remove("armed");
      run();
      return;
    }
    btn.dataset.label = btn.dataset.label || btn.textContent;
    btn.dataset.armed = "1";
    btn.textContent = label;
    btn.classList.add("armed");
    clearTimeout(btn._armTimer);
    btn._armTimer = setTimeout(() => {
      btn.dataset.armed = "";
      btn.textContent = btn.dataset.label;
      btn.classList.remove("armed");
    }, 4000);
  }

  function badge(status) {
    const map = {
      pending_review: "low",
      info_requested: "low",
      approved: "in",
      rejected: "out",
      cancelled: "out",
      expired: "out",
      completed: "in",
      paid: "in",
      pending: "low",
      partially_paid: "low",
      overdue: "out",
      verified: "in",
      refunded: "low",
      confirmed: "in",
    };
    return `<span class="badge ${map[status] || ""}">${esc(String(status || "").replace(/_/g, " "))}</span>`;
  }

  function downloadBlob(blob, name) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  /* ---------------- tabs ---------------- */
  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll("[data-rei-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.reiTab === tab);
    });
    $("reiApplicationsPanel").hidden = tab !== "applications";
    $("reiOrdersPanel").hidden = tab !== "orders";
    $("reiSettingsPanel").hidden = tab !== "settings";
    $("reiPlansPanel").hidden = tab !== "plans";
    $("reiReportsPanel").hidden = tab !== "reports";
    if (tab === "orders" && !state.orders.length) loadOrders();
    if (tab === "reports" && !state.report) loadReport().catch((err) => toast(err.message, "err"));
  }

  /* ---------------- config + settings ---------------- */
  async function loadConfig() {
    const data = await api("/api/retail-installments/config");
    if (!data) return;
    state.config = data;
    state.settings = data.settings || {};
    state.categories = data.categories || [];
    state.offers = data.offers || [];
    renderSettings();
    renderOffers();
  }

  function renderSettings() {
    const s = state.settings || {};
    $("reiEnabled").checked = s.enabled === true;
    $("reiMethod").value = s.method || "flat_annual";
    $("reiRate").value = s.annualRatePct == null ? "" : s.annualRatePct;
    $("reiMarkup").value = s.markupPct == null ? "" : s.markupPct;
    $("reiMaxRate").value = s.maxAnnualRatePct == null ? "" : s.maxAnnualRatePct;
    $("reiServicePercent").value = s.serviceChargePercent == null ? "" : s.serviceChargePercent;
    $("reiServiceFlat").value = fromPaisaInput(s.serviceChargeFlatPaisa);
    $("reiMinDown").value = s.minDownPaymentPercent == null ? "" : s.minDownPaymentPercent;
    $("reiMaxMonths").value = s.maxMonths || 60;
    $("reiCashSale").checked = s.cashPriceIsSalePrice !== false;

    const a = s.applicant || {};
    $("reiReqNid").checked = a.requireNid !== false;
    $("reiReqAddress").checked = a.requireAddress !== false;
    $("reiReqGuarantor").checked = a.requireGuarantor === true;
    $("reiReqDocuments").checked = a.requireDocuments === true;
    $("reiDocTypes").value = Array.isArray(a.documentTypes) && a.documentTypes.length
      ? a.documentTypes.join(", ")
      : "nid_front, nid_back";
    $("reiApplicantNote").value = a.note || "";

    const docs = s.documents || {};
    $("reiDocRetention").value = docs.retentionDays == null ? 180 : docs.retentionDays;

    const r = s.review || {};
    $("reiApprovalRequired").checked = r.approvalRequired !== false;
    $("reiAutoReject").value = r.autoRejectDays == null ? 3 : r.autoRejectDays;

    const l = s.lateFee || {};
    $("reiLateType").value = l.type === "percent" ? "percent" : "flat";
    $("reiLateAmount").value = fromPaisaInput(l.amountPaisa);
    $("reiLatePercent").value = l.percent == null ? "" : l.percent;
    $("reiLateGrace").value = l.graceDays == null ? 3 : l.graceDays;

    $("reiReminderDays").value = Array.isArray(s.reminderDays) ? s.reminderDays.join(", ") : "3";

    const card = s.cardEmi || {};
    $("reiCardEnabled").checked = card.enabled === true;
    $("reiCardNote").value = card.note || "";

    $("reiTerms").value = s.terms || "";

    state.rules = (s.categoryRules || []).map((rule) => ({
      category: String(rule.category || ""),
      allowed: rule.allowed === null || rule.allowed === undefined ? "" : String(rule.allowed),
      method: rule.method || "",
      annualRatePct: rule.annualRatePct == null ? "" : String(rule.annualRatePct),
      markupPct: rule.markupPct == null ? "" : String(rule.markupPct),
      serviceChargePercent: rule.serviceChargePercent == null ? "" : String(rule.serviceChargePercent),
    }));
    renderRules();
  }

  function categoryOptions(selected) {
    const opts = ['<option value="">Select category</option>'];
    state.categories.forEach((cat) => {
      const pad = cat.level ? "— ".repeat(cat.level) : "";
      opts.push(
        `<option value="${esc(cat._id)}"${String(cat._id) === String(selected) ? " selected" : ""}>${pad}${esc(cat.name)}</option>`
      );
    });
    return opts.join("");
  }

  function renderRules() {
    const body = $("reiCategoryRules");
    if (!state.rules.length) {
      body.innerHTML = '<tr><td colspan="7"><div class="empty">No category rules — every category uses the store defaults.</div></td></tr>';
      return;
    }
    body.innerHTML = state.rules
      .map(
        (rule, index) => `<tr data-rule-index="${index}">
          <td><select data-rule-field="category">${categoryOptions(rule.category)}</select></td>
          <td>
            <select data-rule-field="allowed">
              <option value=""${rule.allowed === "" ? " selected" : ""}>Inherit</option>
              <option value="true"${rule.allowed === "true" ? " selected" : ""}>Allow</option>
              <option value="false"${rule.allowed === "false" ? " selected" : ""}>Block</option>
            </select>
          </td>
          <td>
            <select data-rule-field="method">
              <option value=""${rule.method === "" ? " selected" : ""}>Inherit</option>
              <option value="flat_annual"${rule.method === "flat_annual" ? " selected" : ""}>Flat</option>
              <option value="total_markup"${rule.method === "total_markup" ? " selected" : ""}>Markup</option>
              <option value="reducing"${rule.method === "reducing" ? " selected" : ""}>Reducing</option>
            </select>
          </td>
          <td><input data-rule-field="annualRatePct" type="number" min="0" step="0.01" value="${esc(rule.annualRatePct)}" placeholder="Inherit" /></td>
          <td><input data-rule-field="markupPct" type="number" min="0" step="0.01" value="${esc(rule.markupPct)}" placeholder="Inherit" /></td>
          <td><input data-rule-field="serviceChargePercent" type="number" min="0" step="0.01" value="${esc(rule.serviceChargePercent)}" placeholder="Inherit" /></td>
          <td><button type="button" class="inst-btn danger" data-rule-remove="${index}">Remove</button></td>
        </tr>`
      )
      .join("");
  }

  function collectSettings() {
    const reminderDays = String($("reiReminderDays").value || "")
      .split(/[,\s]+/)
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 90);
    const documentTypes = Array.from(
      new Set(
        String($("reiDocTypes").value || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      )
    ).slice(0, 10);
    return {
      enabled: $("reiEnabled").checked,
      method: $("reiMethod").value,
      annualRatePct: Number($("reiRate").value) || 0,
      markupPct: Number($("reiMarkup").value) || 0,
      maxAnnualRatePct: Number($("reiMaxRate").value) || 0,
      serviceChargePercent: Number($("reiServicePercent").value) || 0,
      serviceChargeFlatPaisa: taka($("reiServiceFlat").value),
      minDownPaymentPercent: Number($("reiMinDown").value) || 0,
      maxMonths: Number($("reiMaxMonths").value) || 60,
      cashPriceIsSalePrice: $("reiCashSale").checked,
      applicant: {
        requireNid: $("reiReqNid").checked,
        requireAddress: $("reiReqAddress").checked,
        requireGuarantor: $("reiReqGuarantor").checked,
        requireDocuments: $("reiReqDocuments").checked,
        documentTypes,
        note: $("reiApplicantNote").value.trim(),
      },
      documents: {
        retentionDays:
          $("reiDocRetention").value === "" ? 180 : Number($("reiDocRetention").value),
      },
      review: {
        approvalRequired: $("reiApprovalRequired").checked,
        autoRejectDays: Number($("reiAutoReject").value) || 0,
      },
      lateFee: {
        type: $("reiLateType").value === "percent" ? "percent" : "flat",
        amountPaisa: taka($("reiLateAmount").value),
        percent: Number($("reiLatePercent").value) || 0,
        graceDays: Number($("reiLateGrace").value) || 0,
      },
      reminderDays,
      categoryRules: state.rules
        .filter((rule) => rule.category)
        .map((rule) => ({
          category: rule.category,
          allowed: rule.allowed === "" ? null : rule.allowed === "true",
          method: rule.method || null,
          annualRatePct: rule.annualRatePct === "" ? null : Number(rule.annualRatePct),
          markupPct: rule.markupPct === "" ? null : Number(rule.markupPct),
          serviceChargePercent:
            rule.serviceChargePercent === "" ? null : Number(rule.serviceChargePercent),
        })),
      cardEmi: { enabled: $("reiCardEnabled").checked, note: $("reiCardNote").value.trim() },
      terms: $("reiTerms").value.trim(),
    };
  }

  async function saveSettings() {
    const btn = $("reiSaveSettings");
    btn.disabled = true;
    try {
      const data = await api("/api/retail-installments/settings", {
        method: "PUT",
        body: JSON.stringify({ settings: collectSettings() }),
      });
      if (data) {
        state.settings = data.settings;
        renderSettings();
        toast(data.settings.enabled ? "EMI settings saved — storefront e cholche" : "Settings saved — EMI bondho", "ok");
      }
    } catch (err) {
      toast(err.message, "err");
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- month plans ---------------- */
  function renderOffers() {
    $("reiOfferCount").textContent = state.offers.length + " plan" + (state.offers.length === 1 ? "" : "s");
    const body = $("reiOffersBody");
    if (!state.offers.length) {
      body.innerHTML = '<tr><td colspan="9"><div class="empty">No month plan yet — add 3 / 6 / 12 month plans.</div></td></tr>';
      return;
    }
    body.innerHTML = state.offers
      .map(
        (offer) => `<tr>
          <td class="p-name">${esc(offer.name || "—")}</td>
          <td>${offer.months}</td>
          <td>${Number(offer.downPaymentPercent) || 0}%</td>
          <td>${esc(offer.method || "inherit")}</td>
          <td>${offer.annualRatePct == null ? "inherit" : offer.annualRatePct + "%"}</td>
          <td>${offer.markupPct == null ? "inherit" : offer.markupPct + "%"}</td>
          <td>${offer.minProductPricePaisa ? money(offer.minProductPricePaisa) : "—"}</td>
          <td>${offer.isActive === false ? badge("expired") : badge("approved")}</td>
          <td>
            <div class="inst-actions">
              <button type="button" class="inst-btn" data-offer-edit="${esc(offer._id)}">Edit</button>
              <button type="button" class="inst-btn danger" data-offer-delete="${esc(offer._id)}">Delete</button>
            </div>
          </td>
        </tr>`
      )
      .join("");
  }

  function resetOfferForm() {
    state.editingOfferId = "";
    $("reiOfferFormTitle").textContent = "Add plan";
    $("reiOfferName").value = "";
    $("reiOfferMonths").value = "";
    $("reiOfferDown").value = "";
    $("reiOfferMethod").value = "";
    $("reiOfferRate").value = "";
    $("reiOfferMarkup").value = "";
    $("reiOfferMinPrice").value = "";
    $("reiOfferSort").value = "";
    $("reiOfferActive").checked = true;
    $("reiOfferCancelEdit").hidden = true;
  }

  function editOffer(id) {
    const offer = state.offers.find((row) => String(row._id) === String(id));
    if (!offer) return;
    state.editingOfferId = String(id);
    $("reiOfferFormTitle").textContent = "Edit plan — " + (offer.name || "");
    $("reiOfferName").value = offer.name || "";
    $("reiOfferMonths").value = offer.months || "";
    $("reiOfferDown").value = offer.downPaymentPercent == null ? "" : offer.downPaymentPercent;
    $("reiOfferMethod").value = offer.method || "";
    $("reiOfferRate").value = offer.annualRatePct == null ? "" : offer.annualRatePct;
    $("reiOfferMarkup").value = offer.markupPct == null ? "" : offer.markupPct;
    $("reiOfferMinPrice").value = fromPaisaInput(offer.minProductPricePaisa);
    $("reiOfferSort").value = offer.sortOrder == null ? "" : offer.sortOrder;
    $("reiOfferActive").checked = offer.isActive !== false;
    $("reiOfferCancelEdit").hidden = false;
    $("reiPlansPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveOffer() {
    const name = $("reiOfferName").value.trim();
    const months = Number($("reiOfferMonths").value);
    if (!name) return toast("Plan name lagbe", "err");
    if (!Number.isInteger(months) || months < 2 || months > 60) return toast("Months 2–60 hote hobe", "err");

    const payload = {
      name,
      months,
      downPaymentPercent: Number($("reiOfferDown").value) || 0,
      method: $("reiOfferMethod").value || null,
      annualRatePct: $("reiOfferRate").value === "" ? null : Number($("reiOfferRate").value),
      markupPct: $("reiOfferMarkup").value === "" ? null : Number($("reiOfferMarkup").value),
      minProductPricePaisa: taka($("reiOfferMinPrice").value),
      sortOrder: Number($("reiOfferSort").value) || 0,
      isActive: $("reiOfferActive").checked,
    };
    try {
      if (state.editingOfferId) {
        await api("/api/retail-installments/offers/" + state.editingOfferId, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        toast("Plan updated", "ok");
      } else {
        await api("/api/retail-installments/offers", { method: "POST", body: JSON.stringify(payload) });
        toast("Plan added", "ok");
      }
      resetOfferForm();
      await loadConfig();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  async function deleteOffer(id) {
    try {
      await api("/api/retail-installments/offers/" + id, { method: "DELETE" });
      if (state.editingOfferId === String(id)) resetOfferForm();
      toast("Plan deleted", "ok");
      await loadConfig();
    } catch (err) {
      toast(err.message, "err");
    }
  }

  /* ---------------- applications ---------------- */
  async function loadApplications() {
    const params = new URLSearchParams();
    if (state.statusFilter) params.set("status", state.statusFilter);
    if (state.search) params.set("search", state.search);
    const qs = params.toString();
    const data = await api("/api/retail-installments/applications" + (qs ? "?" + qs : ""));
    if (!data) return;
    state.applications = data.applications || [];
    state.counts = data.counts || {};
    renderApplications();
    if (state.appDetailId) {
      const still = state.applications.find((row) => String(row.id) === String(state.appDetailId));
      if (still) await openApplication(state.appDetailId, true);
    }
  }

  function renderApplications() {
    const c = state.counts || {};
    $("reiStatPending").textContent = c.pending_review || 0;
    $("reiStatInfo").textContent = c.info_requested || 0;
    $("reiStatApproved").textContent = c.approved || 0;
    $("reiStatClosed").textContent = (c.rejected || 0) + (c.expired || 0);
    $("reiTabApplications").textContent = Object.values(c).reduce((sum, n) => sum + n, 0);
    $("reiApplicationCount").textContent =
      state.applications.length + " application" + (state.applications.length === 1 ? "" : "s");

    const body = $("reiApplicationsBody");
    if (!state.applications.length) {
      body.innerHTML = '<tr><td colspan="7"><div class="empty">No application matches this filter.</div></td></tr>';
      return;
    }
    body.innerHTML = state.applications
      .map((app) => {
        const item = (app.items || [])[0] || {};
        return `<tr>
          <td>
            <div class="p-name">${esc(app.number || "—")}</div>
            <div class="p-desc">${date(app.createdAt)}</div>
          </td>
          <td>
            <div>${esc(app.applicant.name)}</div>
            <div class="p-desc">${esc(app.applicant.phone)}</div>
          </td>
          <td>
            <div>${esc(item.title || "—")}</div>
            <div class="p-desc">Qty ${item.quantity || 1}</div>
          </td>
          <td>
            <div>${app.months} months</div>
            <div class="p-desc">DP ${money(app.downPaymentPaisa)}</div>
          </td>
          <td class="p-price">${money(app.totalPayablePaisa)}</td>
          <td>${badge(app.status)}</td>
          <td><button type="button" class="inst-link-btn" data-app-view="${esc(app.id)}">View</button></td>
        </tr>`;
      })
      .join("");
  }

  function schedulePreview(schedule) {
    if (!Array.isArray(schedule) || !schedule.length) return '<div class="empty">Schedule nei.</div>';
    return `<div class="rei-schedule">${schedule
      .map(
        (row) =>
          `<span class="rei-chip">#${row.number} · ${money(row.amountPaisa)}</span>`
      )
      .join("")}</div>`;
  }

  async function openApplication(id, silent) {
    const data = await api("/api/retail-installments/applications/" + id);
    if (!data) return;
    state.appDetail = data.application;
    state.appDetailId = String(id);
    $("reiApplicationDetail").hidden = false;
    if (!silent) $("reiApplicationDetail").scrollIntoView({ behavior: "smooth", block: "start" });
    renderApplicationDetail();
  }

  function renderApplicationDetail() {
    const app = state.appDetail;
    if (!app) return;
    const a = app.applicant || {};
    const item = (app.items || [])[0] || {};
    const canReview = app.status === "pending_review" || app.status === "info_requested";
    const actions = [];
    if (canReview) {
      actions.push('<button type="button" class="inst-btn ok" id="reiApproveBtn">Approve &amp; create order</button>');
      actions.push('<button type="button" class="inst-btn" id="reiInfoBtn">Request info</button>');
      actions.push('<button type="button" class="inst-btn danger" id="reiRejectBtn">Reject</button>');
      actions.push('<button type="button" class="inst-btn danger" id="reiCancelBtn">Cancel</button>');
    }
    const orderLink = app.order ? '<p class="rei-note">Order created — see the Orders tab.</p>' : "";
    const docs = Array.isArray(app.documents) ? app.documents : [];
    const docsHtml = docs.length
      ? `<div class="rei-docs">${docs
          .map((doc) => {
            const label = String(doc.type || "document").replace(/_/g, " ");
            const canOpen = doc.status === "attached" && doc.id;
            const meta = doc.purgedAt
              ? "Purged on " + date(doc.purgedAt)
              : date(doc.uploadedAt) + (doc.sizeBytes ? " · " + Math.round(doc.sizeBytes / 1024) + " KB" : "");
            return `<div class="rei-doc-row">
              <div><strong>${esc(label)}</strong><span class="p-desc">${esc(meta)}</span></div>
              ${
                canOpen
                  ? `<button type="button" class="inst-btn ok" data-doc-download="${esc(doc.id)}" data-doc-type="${esc(doc.type || "document")}">Download</button>`
                  : `<span class="p-desc">${doc.purgedAt ? badge("expired") : "Not attached"}</span>`
              }
            </div>`;
          })
          .join("")}</div>`
      : '<div class="empty">No document uploaded.</div>';

    $("reiApplicationTitle").textContent = app.number || "Application";
    $("reiApplicationBody").innerHTML = `
      <div class="inst-detail-grid">
        <div>
          <span>Applicant</span>
          <strong>${esc(a.name)}</strong>
          <p>${esc(a.phone)}${a.email ? " · " + esc(a.email) : ""}</p>
          <p>${esc(a.address || "")}</p>
          ${a.nidPresent ? '<p class="rei-note">NID on file (encrypted)</p>' : ""}
          ${a.guarantorName ? `<p>Guarantor: ${esc(a.guarantorName)} (${esc(a.guarantorPhone || "")})</p>` : ""}
        </div>
        <div>
          <span>Product</span>
          <strong>${esc(item.title || "—")}</strong>
          <p>Qty ${item.quantity || 1} · ${esc(item.slug || "")}</p>
          <p>Stock ${app.stockReserved ? "reserved" : "not reserved"}</p>
        </div>
        <div>
          <span>Plan</span>
          <strong>${app.months} months</strong>
          <p>Cash ${money(app.cashPaisa)} · EMI base ${money(app.basePaisa)}</p>
          <p>Down ${money(app.downPaymentPaisa)} · Monthly ${money(app.monthlyPaisa)}</p>
        </div>
        <div>
          <span>Total payable</span>
          <strong>${money(app.totalPayablePaisa)}</strong>
          <p>Profit ${money(app.profitPaisa)} · Service ${money(app.serviceChargePaisa)}</p>
          <p>Effective ${Number(app.effectiveAnnualRatePct || 0)}% APR</p>
        </div>
      </div>
      <h3 class="inst-subhead">Monthly schedule (finance)</h3>
      ${schedulePreview(app.schedule)}
      <h3 class="inst-subhead">Documents</h3>
      ${docsHtml}
      ${app.review && app.review.infoRequest ? `<p class="rei-note">Info requested: ${esc(app.review.infoRequest)}</p>` : ""}
      ${app.review && app.review.note ? `<p class="rei-note">Review note: ${esc(app.review.note)}</p>` : ""}
      ${orderLink}
      ${actions.length ? `<div class="pf-field" style="margin-top:16px;"><label for="reiAppNote">Review note / info message</label><textarea id="reiAppNote" rows="2" placeholder="Reject reason or the information you need"></textarea></div>` : ""}
      <div class="inst-actions" style="margin-top:12px;">${actions.join("")}</div>
      <p class="empty" id="reiApplicationActionsEmpty" ${actions.length ? "hidden" : ""}>No action available for ${esc(app.status)} applications.</p>`;

    if (canReview) {
      $("reiApproveBtn").addEventListener("click", (e) =>
        armAction(e.currentTarget, "Confirm approve?", () => appAction("approve"))
      );
      $("reiInfoBtn").addEventListener("click", () => appAction("request-info"));
      $("reiRejectBtn").addEventListener("click", (e) =>
        armAction(e.currentTarget, "Confirm reject?", () => appAction("reject"))
      );
      $("reiCancelBtn").addEventListener("click", (e) =>
        armAction(e.currentTarget, "Confirm cancel?", () => appAction("cancel"))
      );
    }

    $("reiApplicationBody").querySelectorAll("[data-doc-download]").forEach((btn) => {
      btn.addEventListener("click", () =>
        downloadDocument(btn.dataset.docDownload, btn.dataset.docType).catch((err) =>
          toast(err.message, "err")
        )
      );
    });
  }

  // Files never have a public URL; the download rides the authenticated API.
  async function downloadDocument(docId, type) {
    const appId = state.appDetailId;
    if (!appId) return;
    const res = await window.ApiSession.request(
      "/api/retail-installments/applications/" + appId + "/documents/" + docId,
      { cache: "no-store" }
    );
    if (!res || !res.ok) {
      let message = "Document download hoyni";
      try {
        const data = await res.json();
        if (data && data.message) message = data.message;
      } catch {
        /* generic */
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") || "";
    const match = /filename="([^"]+)"/.exec(disposition);
    downloadBlob(blob, match ? match[1] : String(type || "document") + ".bin");
  }

  async function appAction(action) {
    const id = state.appDetailId;
    if (!id) return;
    const noteEl = $("reiAppNote");
    const note = noteEl ? noteEl.value.trim() : "";
    if (action === "request-info" && !note) return toast("Ki information lagbe likhe din", "err");
    const body =
      action === "request-info"
        ? { infoRequest: note }
        : { note: note || (action === "approve" ? "Approved" : "Admin " + action) };
    try {
      const data = await api("/api/retail-installments/applications/" + id + "/" + action, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!data) return;
      toast(
        action === "approve"
          ? "Approved — order " + (data.order ? data.order.orderNumber : "") + " created"
          : "Application " + action,
        "ok"
      );
      await loadApplications();
      await loadOrders();
      await openApplication(id, true);
    } catch (err) {
      toast(err.message, "err");
    }
  }

  /* ---------------- orders ---------------- */
  async function loadOrders() {
    const data = await api("/api/retail-installments/orders");
    if (!data) return;
    state.orders = data.orders || [];
    state.orderStats = data.stats || {};
    renderOrders();
    if (state.orderDetailId) {
      const still = state.orders.find((row) => String(row._id) === String(state.orderDetailId));
      if (still) await openOrder(state.orderDetailId, true);
    }
  }

  function renderOrders() {
    const s = state.orderStats || {};
    $("reiStatOrders").textContent = s.orders || state.orders.length;
    $("reiStatDue").textContent = money(s.duePaisa || 0);
    $("reiStatOverdue").textContent = s.overdue || 0;
    $("reiStatPayments").textContent = s.pendingPayments || 0;
    $("reiTabOrders").textContent = s.orders || state.orders.length;
    $("reiOrderCount").textContent = state.orders.length + " order" + (state.orders.length === 1 ? "" : "s");

    const body = $("reiOrdersBody");
    if (!state.orders.length) {
      body.innerHTML = '<tr><td colspan="7"><div class="empty">No converted EMI order yet — approve an application first.</div></td></tr>';
      return;
    }
    body.innerHTML = state.orders
      .map((order) => {
        const plan = order.plan || {};
        const next = order.nextDue;
        return `<tr>
          <td>
            <div class="p-name">${esc(order.orderNumber)}</div>
            <div class="p-desc">${date(order.createdAt)}</div>
          </td>
          <td>
            <div>${esc(order.customerName)}</div>
            <div class="p-desc">${esc(order.customerPhone || "—")}</div>
          </td>
          <td>
            <div>${esc(plan.name || "—")}</div>
            <div class="p-desc">${(order.installments || []).length} rows</div>
          </td>
          <td>
            <div class="p-price">${money(order.totalPaisa)}</div>
            <div class="p-desc">Paid ${money(order.paidPaisa)} · Due ${money(order.duePaisa)}</div>
          </td>
          <td>${badge(order.paymentStatus)}<div style="margin-top:6px;">${badge(order.status)}</div></td>
          <td>${next ? "#" + next.number + " · " + date(next.dueDate) : "—"}</td>
          <td><button type="button" class="inst-link-btn" data-order-view="${esc(order._id)}">View</button></td>
        </tr>`;
      })
      .join("");
  }

  async function openOrder(id, silent) {
    const data = await api("/api/retail-installments/orders/" + id);
    if (!data) return;
    state.orderDetail = data.order;
    state.orderDetailId = String(id);
    $("reiOrderDetail").hidden = false;
    renderOrderDetail();
    if (!silent) $("reiOrderDetail").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openRows(order) {
    return (order.installments || []).filter(
      (row) => row.status !== "paid" && row.status !== "cancelled" && row.outstandingPaisa > 0
    );
  }

  function renderOrderDetail() {
    const order = state.orderDetail;
    if (!order) return;
    const plan = order.plan || {};
    const open = openRows(order);
    const installments = (order.installments || [])
      .map(
        (row) => `<tr>
          <td>#${row.number}</td>
          <td>${date(row.dueDate)}</td>
          <td>${money(row.amountPaisa)}</td>
          <td>${money(row.paidPaisa)}</td>
          <td>${row.lateFeePaisa ? money(row.lateFeePaisa) : "—"}</td>
          <td>${badge(row.status)}</td>
          <td>${open.some((o) => String(o._id) === String(row._id)) ? `<button type="button" class="inst-btn ok" data-pay-row="${esc(row._id)}" data-due="${row.outstandingPaisa}">Pay</button>` : ""}</td>
        </tr>`
      )
      .join("");

    const payments = (order.payments || [])
      .map((p) => {
        const actions =
          p.status === "pending"
            ? `<div class="inst-actions">
                <button type="button" class="inst-btn ok" data-pay-verify="${esc(p._id)}">Verify</button>
                <button type="button" class="inst-btn danger" data-pay-reject="${esc(p._id)}">Reject</button>
              </div>`
            : "";
        return `<tr>
          <td>${date(p.createdAt)}</td>
          <td class="p-price">${money(p.amountPaisa)}</td>
          <td>${esc(p.methodLabel || p.method)}</td>
          <td>${esc(p.trxId || "—")}</td>
          <td>${badge(p.status)}</td>
          <td>${actions}</td>
        </tr>`;
      })
      .join("");

    const options = open
      .map(
        (row) =>
          `<option value="${esc(row._id)}" data-due="${row.outstandingPaisa}">#${row.number} · due ${date(row.dueDate)} · ${money(row.outstandingPaisa)}</option>`
      )
      .join("");

    $("reiOrderTitle").textContent = order.orderNumber;
    $("reiOrderBody").innerHTML = `
      <div class="inst-detail-grid">
        <div><span>Buyer</span><strong>${esc(order.customerName)}</strong><p>${esc(order.customerPhone || "")}</p><p>${esc(order.customerEmail || "")}</p></div>
        <div><span>Plan</span><strong>${esc(plan.name || "—")}</strong><p>${plan.months || 0} months · ${esc(plan.method || "")} ${plan.annualRatePct || 0}%</p><p>Down ${money(plan.downPaymentPaisa || 0)}</p></div>
        <div><span>Order total</span><strong>${money(order.totalPaisa)}</strong><p>Paid ${money(order.paidPaisa)} · Due ${money(order.duePaisa)}</p></div>
        <div><span>Status</span><strong>${badge(order.paymentStatus)}</strong><p>${badge(order.status)}</p></div>
      </div>

      <h3 class="inst-subhead">Installment schedule</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Due date</th><th>Amount</th><th>Paid</th><th>Late fee</th><th>Status</th><th></th></tr></thead>
          <tbody>${installments || '<tr><td colspan="7"><div class="empty">Schedule nei.</div></td></tr>'}</tbody>
        </table>
      </div>

      <h3 class="inst-subhead">Payments</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Transaction</th><th>Status</th><th></th></tr></thead>
          <tbody>${payments || '<tr><td colspan="6"><div class="empty">No payment yet.</div></td></tr>'}</tbody>
        </table>
      </div>

      ${open.length ? `<h3 class="inst-subhead">Record a payment</h3>
      <div class="rei-pay-form">
        <div class="pf-field">
          <label for="reiPayInstallment">Installment</label>
          <select id="reiPayInstallment">${options}</select>
        </div>
        <div class="pf-field">
          <label for="reiPayAmount">Amount (৳)</label>
          <input id="reiPayAmount" type="number" min="0.01" step="0.01" />
        </div>
        <div class="pf-field">
          <label for="reiPayMethod">Method</label>
          <select id="reiPayMethod">
            <option value="cash">Cash (in store)</option>
            <option value="mobile:bkash">bKash</option>
            <option value="mobile:nagad">Nagad</option>
            <option value="mobile:rocket">Rocket</option>
            <option value="bank:bank">Bank transfer</option>
          </select>
        </div>
        <div class="pf-field">
          <label for="reiPayTrx">Transaction ID</label>
          <input id="reiPayTrx" placeholder="Optional for cash" />
        </div>
        <div class="pf-field">
          <label for="reiPaySender">Sender number</label>
          <input id="reiPaySender" placeholder="Optional" />
        </div>
        <div class="pf-field">
          <label for="reiPayNote">Note</label>
          <input id="reiPayNote" placeholder="Optional" />
        </div>
        <div class="pf-actions" style="align-self:end;">
          <button class="btn-add" id="reiPayBtn" type="button">Record payment</button>
        </div>
      </div>` : '<p class="empty">Every installment is settled.</p>'}`;

    $("reiOrderBody").querySelectorAll("[data-pay-row]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const select = $("reiPayInstallment");
        if (!select) return;
        select.value = btn.dataset.payRow;
        $("reiPayAmount").value = (Number(btn.dataset.due) || 0) / 100;
      });
    });
    const select = $("reiPayInstallment");
    const amount = $("reiPayAmount");
    if (select && amount) {
      const setAmount = () => {
        const option = select.options[select.selectedIndex];
        amount.value = option ? (Number(option.dataset.due) || 0) / 100 : "";
      };
      setAmount();
      select.addEventListener("change", setAmount);
    }
    const payBtn = $("reiPayBtn");
    if (payBtn) payBtn.addEventListener("click", recordPayment);

    $("reiOrderBody").querySelectorAll("[data-pay-verify]").forEach((btn) => {
      btn.addEventListener("click", (e) =>
        armAction(e.currentTarget, "Confirm verify?", () => paymentAction(btn.dataset.payVerify, "verify"))
      );
    });
    $("reiOrderBody").querySelectorAll("[data-pay-reject]").forEach((btn) => {
      btn.addEventListener("click", (e) =>
        armAction(e.currentTarget, "Confirm reject?", () => paymentAction(btn.dataset.payReject, "reject"))
      );
    });
  }

  async function recordPayment() {
    const order = state.orderDetail;
    if (!order) return;
    const installmentId = $("reiPayInstallment").value;
    const amountPaisa = taka($("reiPayAmount").value);
    if (!installmentId) return toast("Installment select korun", "err");
    if (!Number.isInteger(amountPaisa) || amountPaisa <= 0) return toast("Amount valid na", "err");
    const btn = $("reiPayBtn");
    btn.disabled = true;
    try {
      const data = await api("/api/retail-installments/orders/" + order._id + "/payments", {
        method: "POST",
        body: JSON.stringify({
          installmentId,
          amountPaisa,
          method: $("reiPayMethod").value,
          trxId: $("reiPayTrx").value.trim(),
          senderNumber: $("reiPaySender").value.trim(),
          note: $("reiPayNote").value.trim(),
        }),
      });
      if (!data) return;
      toast("Payment recorded — order " + data.order.paymentStatus, "ok");
      await loadOrders();
      await openOrder(order._id, true);
    } catch (err) {
      toast(err.message, "err");
    } finally {
      btn.disabled = false;
    }
  }

  async function paymentAction(paymentId, action) {
    try {
      const res = await window.ApiSession.request("/api/installments/admin/payments/" + paymentId + "/" + action, {
        method: "PATCH",
        body: action === "reject" ? JSON.stringify({ note: "Admin rejected" }) : undefined,
      });
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Payment update hoyni");
      toast(action === "verify" ? "Payment verified" : "Payment rejected", "ok");
      await loadOrders();
      await openOrder(state.orderDetailId, true);
    } catch (err) {
      toast(err.message, "err");
    }
  }

  /* ---------------- reports ---------------- */
  function reportQuery() {
    const period = state.reportPeriod;
    if (period.preset === "custom") {
      return new URLSearchParams({ from: period.from, to: period.to }).toString();
    }
    return new URLSearchParams({ preset: period.preset }).toString();
  }

  function todayKey() {
    return new Date().toLocaleDateString("sv-SE");
  }

  function syncReportPeriodInputs() {
    const custom = $("reiReportPreset").value === "custom";
    $("reiReportFrom").hidden = !custom;
    $("reiReportTo").hidden = !custom;
    $("reiReportTo").max = todayKey();
    if (custom && !$("reiReportFrom").value) {
      $("reiReportFrom").value = todayKey();
      $("reiReportTo").value = todayKey();
    }
  }

  async function loadReport() {
    const data = await api("/api/retail-installments/reports/overview?" + reportQuery());
    if (!data) return;
    state.report = data;
    renderReport();
  }

  function emptyRow(colspan, text) {
    return `<tr><td colspan="${colspan}"><div class="empty">${esc(text)}</div></td></tr>`;
  }

  function renderReport() {
    const data = state.report;
    if (!data) return;
    const a = data.applications || {};
    const p = data.portfolio || {};
    const c = data.collections || {};
    const e = data.earnings || {};

    $("reiReportPeriodNote").textContent = data.period.from + " → " + data.period.to;
    $("reiReportGenerated").textContent =
      "Generated " + new Date(data.generatedAt).toLocaleString("en-GB") +
      " · applications are counted by submission date";
    $("reiRepAppTotal").textContent = a.total || 0;
    $("reiRepApprovalRate").textContent = (a.approvalRatePct || 0) + "%";
    $("reiRepAvgTicket").textContent = money(a.avgTotalPayablePaisa || 0);
    $("reiRepCollected").textContent = money(c.amountPaisa || 0);
    $("reiRepOrders").textContent = p.orders || 0;
    $("reiRepOutstanding").textContent = money(p.outstandingPaisa || 0);
    $("reiRepOverdue").textContent = p.overdueCount || 0;
    $("reiRepEarnings").textContent = money(e.totalPaisa || 0);

    $("reiReportAging").innerHTML = (data.aging || [])
      .map(
        (row) => `<tr>
          <td>${esc(row.label)}</td>
          <td>${row.count || 0}</td>
          <td class="p-price">${money(row.amountPaisa || 0)}</td>
        </tr>`
      )
      .join("");

    $("reiReportCollectionsCount").textContent =
      (c.count || 0) + " payment" + (c.count === 1 ? "" : "s");
    $("reiReportMonths").innerHTML = (c.byMonth || []).length
      ? c.byMonth
          .map(
            (row) => `<tr>
              <td>${esc(row.month)}</td>
              <td>${row.count || 0}</td>
              <td class="p-price">${money(row.amountPaisa || 0)}</td>
            </tr>`
          )
          .join("")
      : emptyRow(3, "No verified payment in this period.");
    $("reiReportMethods").innerHTML = (c.byMethod || []).length
      ? c.byMethod
          .map(
            (row) => `<tr>
              <td>${esc(row.label || row.method)}</td>
              <td>${row.count || 0}</td>
              <td class="p-price">${money(row.amountPaisa || 0)}</td>
            </tr>`
          )
          .join("")
      : emptyRow(3, "No verified payment in this period.");

    $("reiReportOverdue").innerHTML = (data.topOverdue || []).length
      ? data.topOverdue
          .map(
            (row) => `<tr>
              <td class="p-name">${esc(row.orderNumber || "—")}</td>
              <td>
                <div>${esc(row.customerName || "—")}</div>
                <div class="p-desc">${esc(row.customerPhone || "")}</div>
              </td>
              <td>#${row.installmentNumber}</td>
              <td>${date(row.dueDate)}</td>
              <td>${row.daysOverdue || 0} days</td>
              <td class="p-price">${money(row.outstandingPaisa || 0)}</td>
            </tr>`
          )
          .join("")
      : emptyRow(6, "Nothing overdue.");
  }

  async function exportReport(button) {
    if (button) button.disabled = true;
    try {
      const res = await window.ApiSession.request(
        "/api/retail-installments/reports/export.xlsx?" + reportQuery(),
        { cache: "no-store" }
      );
      if (!res || !res.ok) {
        let message = "Export fail hoyeche";
        try {
          const data = await res.json();
          if (data && data.message) message = data.message;
        } catch {
          /* generic */
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const match = /filename="([^"]+)"/.exec(disposition);
      downloadBlob(blob, match ? match[1] : "retail-emi-report.xlsx");
      toast("Excel report download hoyeche", "ok");
    } catch (err) {
      toast(err.message, "err");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function purgeDocuments() {
    const btn = $("reiPurgeDocs");
    btn.disabled = true;
    try {
      const data = await api("/api/retail-installments/documents/purge", { method: "POST" });
      if (!data) return;
      const s = data.summary || {};
      toast(
        `Purged ${(s.pending || 0) + (s.expired || 0)} document(s) · ${s.files || 0} file(s) deleted`,
        "ok"
      );
      await loadConfig();
    } catch (err) {
      toast(err.message, "err");
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- misc actions ---------------- */
  async function refresh() {
    if (state.loading) return;
    state.loading = true;
    $("reiRefreshBtn").disabled = true;
    try {
      await loadConfig();
      await Promise.all([loadApplications(), loadOrders()]);
      if (state.tab === "reports") await loadReport();
    } catch (err) {
      toast(err.message, "err");
    } finally {
      state.loading = false;
      $("reiRefreshBtn").disabled = false;
    }
  }

  async function runScheduler() {
    const btn = $("reiRunBtn");
    btn.disabled = true;
    try {
      const data = await api("/api/retail-installments/run-scheduler", { method: "POST" });
      if (!data) return;
      const s = data.summary || {};
      toast(
        `Reminders ${s.reminders || 0} · overdue ${s.overdueMarked || 0} · expired ${s.applicationsExpired || 0} · docs purged ${s.documentsPurged || 0}`,
        "ok"
      );
      await refresh();
    } catch (err) {
      toast(err.message, "err");
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------------- events ---------------- */
  document.querySelectorAll("[data-rei-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.reiTab));
  });
  $("reiRefreshBtn").addEventListener("click", refresh);
  $("reiRunBtn").addEventListener("click", runScheduler);
  $("reiSaveSettings").addEventListener("click", saveSettings);
  $("reiPurgeDocs").addEventListener("click", (e) =>
    armAction(e.currentTarget, "Confirm purge?", purgeDocuments)
  );

  $("reiReportPreset").addEventListener("change", syncReportPeriodInputs);
  $("reiReportTo").max = todayKey();
  $("reiReportApply").addEventListener("click", () => {
    const preset = $("reiReportPreset").value;
    if (preset === "custom") {
      const from = $("reiReportFrom").value;
      const to = $("reiReportTo").value;
      if (!from || !to) return toast("Start ar end date duitai din", "err");
      if (from > to) return toast("Start date end date er pore hote parbe na", "err");
      if (to > todayKey()) return toast("Future date er report neya jay na", "err");
      state.reportPeriod = { preset, from, to };
    } else {
      state.reportPeriod = { preset, from: "", to: "" };
    }
    loadReport().catch((err) => toast(err.message, "err"));
  });
  $("reiReportExport").addEventListener("click", (e) => exportReport(e.currentTarget));

  $("reiStatusFilter").addEventListener("change", () => {
    state.statusFilter = $("reiStatusFilter").value;
    loadApplications().catch((err) => toast(err.message, "err"));
  });
  let searchTimer = null;
  $("reiSearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = $("reiSearch").value.trim();
      loadApplications().catch((err) => toast(err.message, "err"));
    }, 300);
  });

  $("reiAddCategoryRule").addEventListener("click", () => {
    state.rules.push({
      category: "",
      allowed: "",
      method: "",
      annualRatePct: "",
      markupPct: "",
      serviceChargePercent: "",
    });
    renderRules();
  });
  $("reiCategoryRules").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-rule-remove]");
    if (!btn) return;
    state.rules.splice(Number(btn.dataset.ruleRemove), 1);
    renderRules();
  });
  $("reiCategoryRules").addEventListener("input", (e) => {
    const field = e.target.closest("[data-rule-field]");
    if (!field) return;
    const row = field.closest("[data-rule-index]");
    const index = Number(row.dataset.ruleIndex);
    if (!state.rules[index]) return;
    state.rules[index][field.dataset.ruleField] = field.value;
  });
  $("reiCategoryRules").addEventListener("change", (e) => {
    const field = e.target.closest("[data-rule-field]");
    if (!field) return;
    const row = field.closest("[data-rule-index]");
    const index = Number(row.dataset.ruleIndex);
    if (!state.rules[index]) return;
    state.rules[index][field.dataset.ruleField] = field.value;
  });

  $("reiApplicationsBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-app-view]");
    if (!btn) return;
    openApplication(btn.dataset.appView).catch((err) => toast(err.message, "err"));
  });
  $("reiApplicationClose").addEventListener("click", () => {
    $("reiApplicationDetail").hidden = true;
    state.appDetail = null;
    state.appDetailId = "";
  });

  $("reiOrdersBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-order-view]");
    if (!btn) return;
    openOrder(btn.dataset.orderView).catch((err) => toast(err.message, "err"));
  });
  $("reiOrderClose").addEventListener("click", () => {
    $("reiOrderDetail").hidden = true;
    state.orderDetail = null;
    state.orderDetailId = "";
  });

  $("reiOfferSave").addEventListener("click", saveOffer);
  $("reiOfferCancelEdit").addEventListener("click", resetOfferForm);
  $("reiOffersBody").addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-offer-edit]");
    if (editBtn) return editOffer(editBtn.dataset.offerEdit);
    const delBtn = e.target.closest("[data-offer-delete]");
    if (delBtn) {
      armAction(delBtn, "Confirm delete?", () => deleteOffer(delBtn.dataset.offerDelete));
    }
  });

  // detail panels stay hidden until a row is opened
  $("reiApplicationDetail").hidden = true;
  $("reiOrderDetail").hidden = true;

  window.retailEmiAdmin = {
    async open() {
      setTab(state.tab || "applications");
      if (!state.loaded) {
        try {
          await refresh();
          state.loaded = true;
        } catch (err) {
          toast(err.message, "err");
        }
        return;
      }
      refresh();
    },
  };
})();
