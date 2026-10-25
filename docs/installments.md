# Partial / Installment payments — operations guide

Additive module on top of wholesale mode. Retail checkout and existing tables are
unchanged; installment data lives in new collections (`OrderInstallment`, `Payment`,
`InstallmentPlan`) plus new fields on `Order` (`paymentMode`, `paidAmount`,
`dueAmount`, `installmentPlan`).

## Settings (`WholesaleSettings`)

| Field | Meaning |
| --- | --- |
| `partialPaymentEnabled` | Master switch for installment checkout |
| `installmentBuyers` | `approved` = approved wholesale buyers only, `all` = any logged-in buyer |
| `goodsReleaseReached` (rule) | `after_advance`, `after_half`, `after_full` |
| `shippingInFirstInstallment` | Shipping is charged with installment #1 |
| `graceDays` | Days after the due date before a row becomes overdue |
| `lateFeeType` / `lateFeePaisa` | `flat` paisa or `percent` in basis points (200 = 2%) |
| `overdueAction` / `overdueDays` | After this many days past the due date: `hold` (flag order as overdue) or `cancel` |
| `maxOpenInstallmentOrders` | 0 = unlimited open installment orders per buyer |
| `refundType` / `refundPercent` | Full / percent / none refund rule when an order is cancelled |

## Money and schedule rules

- All amounts are integer **paisa**.
- `buildSchedule` splits the financed remainder equally; leftover paisa goes to
  the **last** installment. Example: 100000 paisa / 3 → `33333, 33333, 33334`.
- Advance is percent (basis points) or fixed paisa. Optional plan fee is added to
  the financed remainder.
- The schedule is snapshotted into `Order.installmentPlan`; later plan edits or
  deactivation never change an existing order.

## Customer flow

1. `GET /api/installments/plans` — eligible plans (or `{ enabled:false }`).
2. `POST /api/installments/preview` — schedule preview for the current cart.
3. Checkout creates the order + `OrderInstallment` rows + the first pending
   `Payment` row.
4. Account page (`/account.html`) shows the schedule, pays an installment
   (`POST /api/installments/orders/:id/pay`), and opens receipts.
5. Manual mobile/bank payments stay `pending` until an admin verifies them.

## Manual verification / webhook

- `PATCH /api/installments/admin/payments/:id/verify` — applies the payment to its
  installment, updates order totals/status, releases goods per rule, writes audit.
- `PATCH /api/installments/admin/payments/:id/reject` — no ledger change.
- `POST /api/installments/webhook/:provider?store=slug` — needs
  `INSTALLMENT_WEBHOOK_SECRET` and header `x-webhook-secret`; returns 501 when the
  env var is not set. Verifies by `paymentId` or `trxId` with an optional
  `amountPaisa` check.

Ledger rules: overpayment is refused, double payment of a settled row is refused,
partial payments keep the row open (and keep `overdue` status). Late fees are part
of the installment's outstanding amount, so customers pay `amount + lateFee - paid`.

## Daily scheduler

`services/installmentScheduler.js` runs automatically 30 seconds after MongoDB
connects and then every 24 hours (`server.js`). It can also be triggered manually
for the current store:

```
POST /api/installments/admin/run-scheduler
Authorization: Bearer <admin token>
x-store-slug: demo-store
```

Pass:

1. **3-day reminder** — pending row enters the `dueDate - 3 days` window;
   `remindersSent.before` prevents repeats.
2. **Due reminder** — row reaches the due date; `remindersSent.due` prevents repeats.
3. **Overdue + late fee** — after `graceDays`, status becomes `overdue` and
   `lateFeePaisa` is set to the absolute fee (never stacked). Second runs are
   idempotent.
4. **Overdue action** — once the due date is more than `overdueDays` old:
   - `hold`: order `paymentStatus` becomes `overdue` (audited once).
   - `cancel`: order is cancelled through the same refund path as manual cancel.

Reminder emails use the `installment_reminder` and `installment_overdue` templates
(editable under Settings > Email templates). Set `APP_URL` (e.g.
`https://shop.example.com`) to include a "Pay from your account" link in emails.

Scheduler errors are caught per store and logged; one failing store cannot stop
the rest.

## Cancel / refund

Cancelling an installment order from the existing admin order update
(`PUT /api/orders/:id` with `status: "cancelled"`) automatically:

- marks open (`pending` / `overdue`) installments `cancelled`;
- marks pending payment attempts `rejected` (`note: "Order cancelled"`);
- marks verified payments `refunded` and computes the refund using
  `refundType` / `refundPercent` (full, percent, or none);
- sets `status` and `paymentStatus` to `cancelled`, `dueAmount` to 0;
- stores `installmentPlan.cancellation = { at, reason, source, refundType,
  refundPercent, refundPaisa }`.

`paidAmount` is kept as history of money received before cancellation. Stock is
not restored automatically (same as the existing retail cancel behavior).

## Edge cases covered

- Plan deactivated: new previews/checkout rejected; existing schedules untouched.
- Double payment / overpayment: refused by the ledger (including late fees).
- Cancelled order: new payment attempts rejected.
- Payment without an installment link: applied to the oldest open row.
- Scheduler run twice: no duplicate reminders, fees, holds, or cancels.
- Percent late fee is computed on the installment amount, not the remaining due.

## Tests

```bash
npm test
```

Relevant suites: `tests/installments.test.js`, `tests/installmentLedger.test.js`,
`tests/installmentScheduler.test.js`.
