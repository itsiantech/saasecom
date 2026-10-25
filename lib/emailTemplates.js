/* ==========================================================================
   Email template helpers — default templates, token render, shared layout.
   Placeholders: {{store_name}}, {{order_number}}, {{customer_name}}, {{items}},
   {{subtotal}}, {{shipping}}, {{vat}}, {{total}}, {{payment_method}},
   {{shipping_address}}, {{status}}, {{year}}, {{code}}, {{minutes}}
   ========================================================================== */

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// {{key}} replace kore. Value raw thake (items table HTML pathanor jonno),
// tai caller scalar value gulo age esc() kore context banabe.
function renderTemplate(str, ctx) {
  return String(str || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key) => {
    const v = ctx && ctx[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

function itemsTableHtml(order) {
  const rows = (order.items || [])
    .map((it) => {
      const name = (it.product && it.product.name) || it.name || "Product";
      const qty = Number(it.quantity) || 0;
      const unit = Number(it.unitPrice) || 0;
      const line = Number(it.price) || unit * qty;
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;">${esc(name)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:center;">${qty}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;">${unit.toLocaleString("en-US")}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #eee;text-align:right;">${line.toLocaleString("en-US")}</td>
      </tr>`;
    })
    .join("");

  return `<table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead>
      <tr style="background:#faf7f0;color:#6b6455;">
        <th style="padding:8px 10px;text-align:left;font-weight:600;">Item</th>
        <th style="padding:8px 10px;text-align:center;font-weight:600;">Qty</th>
        <th style="padding:8px 10px;text-align:right;font-weight:600;">Price</th>
        <th style="padding:8px 10px;text-align:right;font-weight:600;">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

const DEFAULT_TEMPLATES = {
  order_new_customer: {
    subject: "Order {{order_number}} confirmed — {{store_name}}",
    body: `
      <h2 style="margin:0 0 6px;font-size:18px;">Dhonnobad, {{customer_name}}!</h2>
      <p style="margin:0 0 16px;color:#6b6455;">Apnar order ti amra peyechi. Order number: <strong>{{order_number}}</strong></p>
      {{items}}
      <p style="margin:14px 0 4px;">Subtotal: <strong>{{subtotal}}</strong></p>
      <p style="margin:0 0 4px;">Shipping: <strong>{{shipping}}</strong></p>
      <p style="margin:0 0 14px;font-size:16px;">Total: <strong>{{total}}</strong></p>
      <p style="margin:0 0 4px;color:#6b6455;">Payment: {{payment_method}}</p>
      <p style="margin:0;color:#6b6455;">Delivery: {{shipping_address}}</p>
    `,
  },
  order_new_admin: {
    subject: "New order {{order_number}} — {{store_name}}",
    body: `
      <h2 style="margin:0 0 6px;font-size:18px;">Notun order esheche</h2>
      <p style="margin:0 0 16px;color:#6b6455;">Order <strong>{{order_number}}</strong> — {{customer_name}}</p>
      {{items}}
      <p style="margin:14px 0 4px;">Shipping: <strong>{{shipping}}</strong></p>
      <p style="margin:0 0 14px;font-size:16px;">Total: <strong>{{total}}</strong></p>
      <p style="margin:0 0 4px;color:#6b6455;">Payment: {{payment_method}}</p>
      <p style="margin:0;color:#6b6455;">Delivery: {{shipping_address}}</p>
    `,
  },
  order_cancelled: {
    subject: "Order {{order_number}} cancelled — {{store_name}}",
    body: `
      <h2 style="margin:0 0 6px;font-size:18px;">Order cancel hoyeche</h2>
      <p style="margin:0 0 16px;color:#6b6455;">Apnar order <strong>{{order_number}}</strong> cancel kora hoyeche. Kono proshno thakle amader sathe jogajog korun.</p>
      {{items}}
      <p style="margin:14px 0 0;font-size:16px;">Total: <strong>{{total}}</strong></p>
    `,
  },
  order_status: {
    subject: "Order {{order_number}} update: {{status}} — {{store_name}}",
    body: `
      <h2 style="margin:0 0 6px;font-size:18px;">Order status update</h2>
      <p style="margin:0 0 16px;color:#6b6455;">Order <strong>{{order_number}}</strong> er notun status: <strong>{{status}}</strong></p>
      {{items}}
      <p style="margin:14px 0 0;font-size:16px;">Total: <strong>{{total}}</strong></p>
    `,
  },
  otp_login: {
    subject: "Your login OTP — {{store_name}}",
    body: `
      <h2 style="margin:0 0 6px;font-size:18px;">Login OTP</h2>
      <p style="margin:0 0 12px;color:#6b6455;">Apnar OTP code:</p>
      <p style="margin:0 0 12px;font-size:28px;letter-spacing:6px;font-weight:700;">{{code}}</p>
      <p style="margin:0;color:#6b6455;">{{minutes}} minute por expire hobe.</p>
    `,
  },
  installment_reminder: {
    subject: "Installment reminder — {{order_number}}",
    body: `
      <h2 style="margin:0 0 6px;font-size:18px;">Installment payment reminder</h2>
      <p style="margin:0 0 16px;color:#6b6455;">{{customer_name}}, order <strong>{{order_number}}</strong> er installment <strong>#{{installment_number}}</strong> er <strong>{{amount}}</strong> {{due_date}} e due.</p>
      <p style="margin:0 0 4px;">Baki: <strong>{{outstanding}}</strong></p>
      {{account_link}}
    `,
  },
  installment_overdue: {
    subject: "Installment overdue — {{order_number}}",
    body: `
      <h2 style="margin:0 0 6px;font-size:18px;">Installment overdue</h2>
      <p style="margin:0 0 16px;color:#6b6455;">{{customer_name}}, order <strong>{{order_number}}</strong> er installment <strong>#{{installment_number}}</strong> overdue hoye geche.</p>
      <p style="margin:0 0 4px;">Installment: <strong>{{amount}}</strong></p>
      <p style="margin:0 0 4px;">Late fee: <strong>{{late_fee}}</strong></p>
      <p style="margin:0 0 4px;">Baki: <strong>{{outstanding}}</strong></p>
      {{account_link}}
    `,
  },
};

const TEMPLATE_LABELS = {
  order_new_customer: "New order — customer",
  order_new_admin: "New order — admin",
  order_cancelled: "Cancel order",
  order_status: "Order status change",
  otp_login: "Login OTP",
  installment_reminder: "Installment reminder",
  installment_overdue: "Installment overdue",
};

// Shared responsive email wrapper.
function layout(setting, storeName, inner) {
  const accent = "#c9a961";
  const footer = setting && setting.footerNote ? setting.footerNote : "";
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#2a2620;">
  <div style="max-width:620px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e8e2d5;">
      <div style="background:#17140f;padding:18px 22px;">
        <span style="color:${accent};font-size:20px;font-weight:700;letter-spacing:0.5px;">${esc(storeName)}</span>
      </div>
      <div style="padding:22px;">${inner}</div>
    </div>
    <p style="text-align:center;color:#8a8375;font-size:12px;margin-top:14px;">
      ${footer ? esc(footer) : "© " + new Date().getFullYear() + " " + esc(storeName)}
    </p>
  </div>
</body></html>`;
}

module.exports = { DEFAULT_TEMPLATES, TEMPLATE_LABELS, renderTemplate, layout, itemsTableHtml, esc };
