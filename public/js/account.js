(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TOKEN_KEY = "luxe_customer_token";
  const STORE_KEY = "luxe_store_slug";

  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const money = (paisa) =>
    "৳" + ((Number(paisa) || 0) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

  let storeSlug = new URLSearchParams(location.search).get("store") || localStorage.getItem(STORE_KEY) || "";
  let token = localStorage.getItem(TOKEN_KEY) || "";
  let user = null;
  let config = null;
  let orders = [];
  let payTarget = null;

  const withStore = (path) =>
    path + (path.includes("?") ? "&" : "?") + "store=" + encodeURIComponent(storeSlug);

  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (token) headers.Authorization = "Bearer " + token;
    if (storeSlug) headers["x-store-slug"] = storeSlug;
    const res = await fetch(withStore(path), { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  function showGate(id) {
    $("acLoading").hidden = true;
    $("acOrdersWrap").hidden = true;
    $("acLoginGate").hidden = id !== "acLoginGate";
    $("acStoreGate").hidden = id !== "acStoreGate";
  }

  function showFatal(message) {
    $("acLoading").hidden = true;
    $("acOrdersWrap").hidden = true;
    $("acLoginGate").hidden = true;
    $("acStoreGate").hidden = true;
    const el = $("acFatal");
    el.textContent = message;
    el.hidden = false;
  }

  function applySite() {
    const site = (config && config.site) || {};
    const title = site.siteTitle || "Store";
    document.title = "My account — " + title;
    $("acFooter").textContent = "© " + new Date().getFullYear() + " " + title;

    const img = $("acLogo");
    if (site.logo) {
      img.src = site.logo;
      img.alt = title;
      img.hidden = false;
      $("acTitle").hidden = true;
    } else {
      img.hidden = true;
      $("acTitle").hidden = false;
    }

    const suffix = storeSlug ? "?store=" + encodeURIComponent(storeSlug) : "";
    $("acCheckout").href = "/checkout.html" + suffix;
    $("acShopLink").href = "/checkout.html" + suffix;
    $("acRegisterLink").href = "/checkout.html" + suffix;
  }

  function statusBadge(status) {
    const map = {
      paid: "ok",
      pending: "warn",
      overdue: "danger",
      cancelled: "muted",
      partially_paid: "warn",
      confirmed: "ok",
      delivered: "ok",
      verified: "ok",
      rejected: "danger",
      refunded: "muted",
    };
    return `<span class="ac-badge ${map[status] || "muted"}">${esc(String(status || "").replace(/_/g, " "))}</span>`;
  }

  function paymentMethodOptions() {
    const pay = (config && config.payments) || {};
    const opts = [];
    (pay.mobileManual || []).forEach((row) => {
      opts.push({ method: "mobile:" + row.name, label: "Mobile banking — " + row.name });
    });
    (pay.bankManual || []).forEach((row) => {
      opts.push({ method: "bank:" + row.name, label: "Bank transfer — " + row.name });
    });
    return opts;
  }

  function renderOrders() {
    const wrap = $("acOrders");
    $("acSubtitle").textContent = orders.length
      ? orders.length + " installment order" + (orders.length === 1 ? "" : "s")
      : "Kono installment order nei.";

    if (!orders.length) {
      wrap.innerHTML = `<div class="ac-card ac-empty">
        <p>Ekhono kono installment order nei.</p>
        <p class="ac-muted">Wholesale store theke installment plan select kore order korun.</p>
      </div>`;
      return;
    }

    wrap.innerHTML = orders
      .map((order) => {
        const plan = order.installmentPlan || {};
        const pendingByInstallment = new Set(
          (order.payments || [])
            .filter((p) => p.status === "pending" && p.installment)
            .map((p) => String(p.installment))
        );

        const rows = (order.installments || [])
          .map((inst) => {
            const canPay =
              inst.status !== "paid" &&
              inst.status !== "cancelled" &&
              order.status !== "cancelled" &&
              inst.outstandingPaisa > 0 &&
              !pendingByInstallment.has(String(inst._id));
            const due = new Date(inst.dueDate);
            return `<tr>
              <td>#${inst.number}</td>
              <td>${due.toLocaleDateString("en-GB")}</td>
              <td>${money(inst.amountPaisa)}</td>
              <td>${money(inst.paidPaisa)}</td>
              <td>${statusBadge(inst.status)}</td>
              <td>${
                canPay
                  ? `<button type="button" class="ac-btn small ac-pay-btn" data-order="${esc(order._id)}" data-installment="${esc(inst._id)}" data-amount="${inst.outstandingPaisa}">Pay now</button>`
                  : pendingByInstallment.has(String(inst._id))
                  ? '<span class="ac-muted">Verification pending</span>'
                  : ""
              }</td>
            </tr>`;
          })
          .join("");

        const payments = (order.payments || [])
          .map(
            (p) => `<li class="ac-payment-row">
              <div>
                <strong>${money(p.amountPaisa)}</strong>
                <span class="ac-muted">${esc(p.methodLabel || p.method)}</span>
                <span class="ac-muted">Trx: ${esc(p.trxId || "—")}</span>
              </div>
              <div class="ac-payment-right">
                ${statusBadge(p.status)}
                ${
                  p.status === "verified"
                    ? `<button type="button" class="ac-link ac-receipt-btn" data-payment="${esc(p._id)}">Receipt</button>`
                    : ""
                }
              </div>
            </li>`
          )
          .join("");

        return `<article class="ac-card ac-order">
          <div class="ac-order-head">
            <div>
              <h2>${esc(order.orderNumber)}</h2>
              <p class="ac-muted">${new Date(order.createdAt).toLocaleString("en-GB")} · ${esc(plan.name || "Installment")}</p>
            </div>
            <div class="ac-order-badges">
              ${statusBadge(order.status)}
              ${statusBadge(order.paymentStatus)}
            </div>
          </div>

          <div class="ac-order-stats">
            <div><span>Total</span><strong>${money((Number(order.totalAmount) || 0) * 100)}</strong></div>
            <div><span>Paid</span><strong>${money(order.paidAmount)}</strong></div>
            <div><span>Due</span><strong class="ac-due">${money(order.dueAmount)}</strong></div>
          </div>

          <div class="ac-table-wrap">
            <table class="ac-table">
              <thead><tr><th>#</th><th>Due date</th><th>Amount</th><th>Paid</th><th>Status</th><th></th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>

          ${
            payments
              ? `<h3 class="ac-subhead">Payment history</h3><ul class="ac-payments">${payments}</ul>`
              : ""
          }
        </article>`;
      })
      .join("");

    wrap.querySelectorAll(".ac-pay-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        payTarget = {
          orderId: btn.dataset.order,
          installmentId: btn.dataset.installment,
          amountPaisa: Number(btn.dataset.amount) || 0,
        };
        openPayModal();
      });
    });

    wrap.querySelectorAll(".ac-receipt-btn").forEach((btn) => {
      btn.addEventListener("click", () => openReceipt(btn.dataset.payment));
    });
  }

  function openPayModal() {
    const methods = paymentMethodOptions();
    const err = $("acPayError");
    err.hidden = true;
    $("acPayMeta").textContent = methods.length
      ? "Installment amount: " + money(payTarget.amountPaisa)
      : "Store e kono manual mobile/bank payment option nei.";

    $("acPayMethod").innerHTML = methods
      .map((opt) => `<option value="${esc(opt.method)}">${esc(opt.label)}</option>`)
      .join("");
    $("acPaySender").value = (user && user.phone) || "";
    $("acPayTrx").value = "";
    $("acPaySubmit").disabled = !methods.length;
    $("acPayModal").hidden = false;
    if (methods.length) $("acPayMethod").focus();
  }

  function closePayModal() {
    $("acPayModal").hidden = true;
    payTarget = null;
  }

  async function openReceipt(paymentId) {
    const win = window.open("about:blank", "_blank");
    try {
      const res = await fetch(withStore("/api/installments/payments/" + paymentId + "/receipt"), {
        headers: { Authorization: "Bearer " + token, "x-store-slug": storeSlug },
      });
      if (!res.ok) {
        if (win) win.close();
        const data = await res.json().catch(() => ({}));
        notice(data.message || "Receipt load hoyni", true);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      if (win) win.close();
      notice(err.message, true);
    }
  }

  function notice(message, isError) {
    const el = $("acNotice");
    el.textContent = message;
    el.className = "ac-notice" + (isError ? " error" : "");
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.hidden = true), 6000);
  }

  async function loadOrders() {
    const { res, data } = await api("/api/installments/my");
    if (res.status === 401) {
      token = "";
      localStorage.removeItem(TOKEN_KEY);
      showGate("acLoginGate");
      return;
    }
    if (!res.ok) {
      showFatal(data.message || "Installment orders load hoyni");
      return;
    }
    orders = data.orders || [];
    $("acLoading").hidden = true;
    $("acStoreGate").hidden = true;
    $("acLoginGate").hidden = true;
    $("acFatal").hidden = true;
    $("acOrdersWrap").hidden = false;
    renderOrders();
  }

  async function boot() {
    if (!storeSlug) {
      showGate("acStoreGate");
      return;
    }
    localStorage.setItem(STORE_KEY, storeSlug);
    $("acStoreGate").hidden = true;
    $("acLoginGate").hidden = true;
    $("acOrdersWrap").hidden = true;
    $("acFatal").hidden = true;
    $("acLoading").hidden = false;

    try {
      const cfg = await api("/api/settings/checkout");
      if (!cfg.res.ok) {
        showFatal(cfg.data.message || "Store load hoyni");
        return;
      }
      config = cfg.data;
      applySite();

      if (token) {
        const me = await api("/api/auth/me");
        if (me.res.ok) user = me.data;
        else {
          token = "";
          user = null;
          localStorage.removeItem(TOKEN_KEY);
        }
      }

      $("acLogout").hidden = !token;
      if (!token) {
        showGate("acLoginGate");
        return;
      }
      await loadOrders();
    } catch (err) {
      showFatal(err.message || "Kichhu ekta bhul hoyeche");
    }
  }

  $("acLoginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("acLoginError");
    err.hidden = true;
    const identifier = $("acLoginId").value.trim();
    const password = $("acLoginPassword").value;
    if (!identifier || !password) {
      err.textContent = "Email/phone ar password din";
      err.hidden = false;
      return;
    }
    const btn = $("acLoginBtn");
    btn.disabled = true;
    try {
      const { res, data } = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password }),
      });
      if (!res.ok) {
        err.textContent = data.message || "Login fail hoyeche";
        err.hidden = false;
        return;
      }
      token = data.token;
      user = data.user;
      localStorage.setItem(TOKEN_KEY, token);
      $("acLogout").hidden = false;
      await loadOrders();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  $("acLogout").addEventListener("click", () => {
    token = "";
    user = null;
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  });

  $("acStoreForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const value = $("acStoreSlug").value.trim();
    if (!value) return;
    storeSlug = value;
    localStorage.setItem(STORE_KEY, value);
    const url = new URL(location.href);
    url.searchParams.set("store", value);
    history.replaceState(null, "", url);
    boot();
  });

  $("acPayForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!payTarget) return;
    const err = $("acPayError");
    err.hidden = true;
    const method = $("acPayMethod").value;
    const senderNumber = $("acPaySender").value.trim();
    const transactionId = $("acPayTrx").value.trim();
    if (!method) {
      err.textContent = "Payment method select korun";
      err.hidden = false;
      return;
    }
    if (!/^01[3-9]\d{8}$/.test(senderNumber)) {
      err.textContent = "Sender number 01XXXXXXXXX format e din";
      err.hidden = false;
      return;
    }
    if (!transactionId) {
      err.textContent = "Transaction ID lagbe";
      err.hidden = false;
      return;
    }

    const btn = $("acPaySubmit");
    btn.disabled = true;
    try {
      const { res, data } = await api("/api/installments/orders/" + payTarget.orderId + "/pay", {
        method: "POST",
        body: JSON.stringify({
          installmentId: payTarget.installmentId,
          method,
          senderNumber,
          transactionId,
        }),
      });
      if (!res.ok) {
        err.textContent = data.message || "Payment joma hoyni";
        err.hidden = false;
        return;
      }
      closePayModal();
      notice(data.message || "Payment joma hoyeche");
      await loadOrders();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  $("acPayCancel").addEventListener("click", closePayModal);
  $("acPayModal").addEventListener("click", (e) => {
    if (e.target === $("acPayModal")) closePayModal();
  });

  boot();
})();
