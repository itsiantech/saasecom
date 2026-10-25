(function () {
  "use strict";

  const TOKEN_KEY = "luxe_token";
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
  const bdt = (amount) =>
    "৳ " + (Number(amount) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const date = (value) => (value ? new Date(value).toLocaleDateString("en-GB") : "—");

  let orders = [];
  let pendingPayments = [];
  let stats = {};
  let detail = null;
  let detailId = "";
  let loading = false;

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + localStorage.getItem(TOKEN_KEY),
        ...(opts.headers || {}),
      },
    });
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem(TOKEN_KEY);
      location.href = "/login.html";
      return null;
    }
    return res;
  }

  function badge(status) {
    const map = {
      paid: "in",
      pending: "low",
      partially_paid: "low",
      overdue: "out",
      cancelled: "out",
      confirmed: "in",
      delivered: "in",
      shipped: "in",
      verified: "in",
      rejected: "out",
      refunded: "low",
    };
    return `<span class="badge ${map[status] || ""}">${esc(
      String(status || "").replace(/_/g, " ")
    )}</span>`;
  }

  function toast(message, type) {
    if (typeof window.toast === "function") return window.toast(message, type);
    const el = $("toast");
    if (!el) return;
    el.textContent = message;
    el.className = "toast show " + (type || "");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 3200);
  }

  function setTab(tab) {
    document.querySelectorAll("[data-inst-tab]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.instTab === tab);
    });
    $("instOrdersPanel").hidden = tab !== "orders";
    $("instPaymentsPanel").hidden = tab !== "payments";
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

  function renderStats() {
    $("instStatOrders").textContent = (stats.orders || orders.length).toLocaleString("en-IN");
    $("instStatDue").textContent = money(stats.dueAmountPaisa || 0);
    $("instStatPending").textContent = (stats.pendingPayments || pendingPayments.length).toLocaleString("en-IN");
    $("instStatOverdue").textContent = (stats.overdue || 0).toLocaleString("en-IN");
    $("instOrderCount").textContent = orders.length + " order" + (orders.length === 1 ? "" : "s");
    $("instPaymentCount").textContent =
      pendingPayments.length + " pending payment" + (pendingPayments.length === 1 ? "" : "s");
  }

  function renderOrders() {
    const body = $("instOrdersBody");
    if (!orders.length) {
      body.innerHTML = '<tr><td colspan="7"><div class="empty">Kono installment order nei.</div></td></tr>';
      return;
    }
    body.innerHTML = orders
      .map((order) => {
        const plan = order.installmentPlan || {};
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
            <div class="p-desc">${plan.installmentsCount || 0} installments</div>
          </td>
          <td>
            <div class="p-price">${bdt(order.totalAmount)}</div>
            <div class="p-desc">Paid ${money(order.paidAmount)} · Due ${money(order.dueAmount)}</div>
          </td>
          <td>${badge(order.paymentStatus)}<div style="margin-top:6px;">${badge(order.status)}</div></td>
          <td>${next ? "#" + next.number + " · " + date(next.dueDate) : "—"}</td>
          <td>
            <button type="button" class="inst-link-btn inst-view-btn" data-id="${esc(order._id)}">View</button>
          </td>
        </tr>`;
      })
      .join("");

    body.querySelectorAll(".inst-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => loadDetail(btn.dataset.id));
    });
  }

  function renderPayments() {
    const body = $("instPaymentsBody");
    if (!pendingPayments.length) {
      body.innerHTML = '<tr><td colspan="7"><div class="empty">Kono pending manual payment nei.</div></td></tr>';
      return;
    }
    body.innerHTML = pendingPayments
      .map((p) => {
        const order = p.order || {};
        const inst = p.installmentInfo || {};
        return `<tr>
          <td>
            <div class="p-name">${esc(order.orderNumber || "—")}</div>
            <div class="p-desc">${date(p.createdAt)}</div>
          </td>
          <td>
            <div>${esc(order.customerName || "—")}</div>
            <div class="p-desc">${esc(order.customerPhone || "—")}</div>
          </td>
          <td>${inst.number ? "#" + inst.number : "—"}</td>
          <td class="p-price">${money(p.amountPaisa)}</td>
          <td>${esc(p.methodLabel || p.method)}</td>
          <td>
            <div>${esc(p.trxId || "—")}</div>
            <div class="p-desc">${esc(p.senderNumber || "")}</div>
          </td>
          <td>
            <div class="inst-actions">
              <button type="button" class="inst-btn ok inst-verify-btn" data-id="${esc(p._id)}">Verify</button>
              <button type="button" class="inst-btn danger inst-reject-btn" data-id="${esc(p._id)}">Reject</button>
            </div>
          </td>
        </tr>`;
      })
      .join("");

    body.querySelectorAll(".inst-verify-btn").forEach((btn) => {
      btn.addEventListener("click", () =>
        armAction(btn, "Confirm verify?", () => verifyPayment(btn.dataset.id))
      );
    });
    body.querySelectorAll(".inst-reject-btn").forEach((btn) => {
      btn.addEventListener("click", () =>
        armAction(btn, "Confirm reject?", () => rejectPayment(btn.dataset.id))
      );
    });
  }

  async function loadDetail(id) {
    const res = await api("/api/installments/admin/orders/" + id);
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.message || "Order load hoyni", "err");
      return;
    }
    detail = data.order;
    detailId = id;
    renderDetail();
    $("instDetailPanel").hidden = false;
    $("instDetailPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderDetail() {
    const order = detail;
    if (!order) return;
    const plan = order.installmentPlan || {};
    const installments = (order.installments || [])
      .map(
        (inst) => `<tr>
          <td>#${inst.number}</td>
          <td>${date(inst.dueDate)}</td>
          <td>${money(inst.amountPaisa)}</td>
          <td>${money(inst.paidPaisa)}</td>
          <td>${inst.lateFeePaisa ? money(inst.lateFeePaisa) : "—"}</td>
          <td>${badge(inst.status)}</td>
        </tr>`
      )
      .join("");

    const payments = (order.payments || [])
      .map((p) => {
        const actions =
          p.status === "pending"
            ? `<div class="inst-actions">
                <button type="button" class="inst-btn ok inst-verify-btn" data-id="${esc(p._id)}">Verify</button>
                <button type="button" class="inst-btn danger inst-reject-btn" data-id="${esc(p._id)}">Reject</button>
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

    $("instDetailTitle").textContent = order.orderNumber;
    $("instDetailBody").innerHTML = `
      <div class="inst-detail-grid">
        <div><span>Buyer</span><strong>${esc(order.customerName)}</strong><p>${esc(order.customerPhone || "")}</p></div>
        <div><span>Plan</span><strong>${esc(plan.name || "—")}</strong><p>${plan.installmentsCount || 0} installments · ${esc(plan.advanceType || "")} ${plan.advanceValue != null ? plan.advanceValue : ""}</p></div>
        <div><span>Order total</span><strong>${bdt(order.totalAmount)}</strong><p>Paid ${money(order.paidAmount)} · Due ${money(order.dueAmount)}</p></div>
        <div><span>Status</span><strong>${badge(order.paymentStatus)}</strong><p>${badge(order.status)}</p></div>
      </div>

      <h3 class="inst-subhead">Schedule snapshot</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Due date</th><th>Amount</th><th>Paid</th><th>Late fee</th><th>Status</th></tr></thead>
          <tbody>${installments || '<tr><td colspan="6"><div class="empty">Schedule nei.</div></td></tr>'}</tbody>
        </table>
      </div>

      <h3 class="inst-subhead">Payments</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Transaction</th><th>Status</th><th></th></tr></thead>
          <tbody>${payments || '<tr><td colspan="6"><div class="empty">Kono payment nei.</div></td></tr>'}</tbody>
        </table>
      </div>`;

    $("instDetailBody").querySelectorAll(".inst-verify-btn").forEach((btn) => {
      btn.addEventListener("click", () =>
        armAction(btn, "Confirm verify?", () => verifyPayment(btn.dataset.id))
      );
    });
    $("instDetailBody").querySelectorAll(".inst-reject-btn").forEach((btn) => {
      btn.addEventListener("click", () =>
        armAction(btn, "Confirm reject?", () => rejectPayment(btn.dataset.id))
      );
    });
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    $("instRefreshBtn").disabled = true;
    $("instRefreshBtn").textContent = "Loading…";
    try {
      const [orderRes, paymentRes] = await Promise.all([
        api("/api/installments/admin/orders"),
        api("/api/installments/admin/payments?status=pending"),
      ]);
      if (!orderRes || !paymentRes) return;
      const orderData = await orderRes.json().catch(() => ({}));
      const paymentData = await paymentRes.json().catch(() => ({}));
      if (!orderRes.ok) throw new Error(orderData.message || "Installment orders load hoyni");
      if (!paymentRes.ok) throw new Error(paymentData.message || "Payments load hoyni");
      orders = orderData.orders || [];
      stats = orderData.stats || {};
      pendingPayments = paymentData.payments || [];
      renderStats();
      renderOrders();
      renderPayments();
      if (detailId) {
        const still = orders.find((order) => String(order._id) === String(detailId));
        if (still) await loadDetail(detailId);
        else {
          $("instDetailPanel").hidden = true;
          detailId = "";
          detail = null;
        }
      }
    } catch (err) {
      toast(err.message, "err");
    } finally {
      loading = false;
      $("instRefreshBtn").disabled = false;
      $("instRefreshBtn").textContent = "Refresh";
    }
  }

  async function verifyPayment(id) {
    if (!id) return;
    const res = await api("/api/installments/admin/payments/" + id + "/verify", { method: "PATCH" });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.message || "Verify hoyni", "err");
      return;
    }
    toast("Payment verified — order " + data.order.paymentStatus, "ok");
    await refresh();
  }

  async function rejectPayment(id) {
    if (!id) return;
    const res = await api("/api/installments/admin/payments/" + id + "/reject", {
      method: "PATCH",
      body: JSON.stringify({ note: "Admin rejected" }),
    });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(data.message || "Reject hoyni", "err");
      return;
    }
    toast("Payment rejected", "ok");
    await refresh();
  }

  document.querySelectorAll("[data-inst-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.instTab));
  });
  $("instRefreshBtn").addEventListener("click", refresh);
  $("instDetailClose").addEventListener("click", () => {
    $("instDetailPanel").hidden = true;
    detailId = "";
    detail = null;
  });

  window.installmentAdmin = {
    open() {
      setTab("orders");
      refresh();
    },
  };
})();
