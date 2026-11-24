# Retail cash + EMI — operations guide

Retail EMI is a **store-scoped, plan-gated module**. It is separate from the
wholesale installment flow in [`docs/installments.md`](installments.md): retail
applications are reviewed by the store, then converted into a normal order
tagged `paymentMode: "installment"` with `installmentPlan.source: "retail"`.

The module stays off until both conditions are true:

1. the store's plan grants the `installments` feature (or the store has a
   `featureOverrides.granted` entry — see `lib/features.js`);
2. `InstallmentSettings.enabled` is on.

Storefront UI ships in **theme3 only**; theme1 and theme2 are unchanged.

## Settings (`InstallmentSettings`)

| Group | Field | Meaning |
| --- | --- | --- |
| Calculation | `method` | `flat_annual`, `total_markup` or `reducing` |
| | `annualRatePct`, `markupPct`, `serviceChargePercent`, `serviceChargeFlatPaisa` | Pricing inputs (all money in integer paisa) |
| | `minDownPaymentPercent`, `maxMonths` | Guard rails shown on the product page |
| | `cashPriceIsSalePrice` | Use the sale price as the cash price (regular price becomes the EMI base) |
| Applicant | `requireNid`, `requireAddress`, `requireGuarantor` | Field validation in `lib/installmentApplicant.js` |
| | `requireDocuments` | Submission is refused until every configured document type is attached |
| | `documentTypes` | Comma-separated types collected by the upload UI (default `nid_front, nid_back`) |
| Review | `approvalRequired`, `autoRejectDays` | Manual review queue; stale applications expire and restore stock |
| Late fee | `type` / `amountPaisa` / `percent`, `graceDays` | Applied once per installment by the scheduler |
| Reminders | `reminderDays` | Days before the due date to email |
| Documents | `documents.retentionDays` | Keep scans this long after an application closes (`0` = forever, max 3650) |
| Category rules | `categoryRules` | Per-category allow/block or rate override; product-level policy wins |

Offers (`InstallmentOffer`) are the month plans shown on the product page. They
can inherit the store rate or override it, set a minimum down payment and a
minimum product price.

## Application flow

1. `GET /api/public/installments/config` — settings the form needs.
2. `POST /api/public/installments/quote` — server-computed quote for the chosen
   plan (the storefront never sends prices).
3. `POST /api/public/installments/documents` — one file per call, base64 JSON
   (`type`, `filename`, `data`). Returns a short-lived `token` (24 hours).
4. `POST /api/public/installments/apply` — applicant + `documents: [{ token }]`
   + consent + idempotency key. Stock is reserved **before** the row is written,
   and documents are claimed/attached before the response.
5. Review queue: approve converts to an order with a frozen schedule; reject,
   request-info, cancel and expire restore reserved stock exactly once.

All money values in requests that look like totals are ignored; the backend
recomputes the quote with the same engine the shopper saw.

## Document vault (encrypted at rest)

- Files live under `storage/private/installment-documents/<storeId>/` — outside
  `public/`, git-ignored, never served by a static route.
- Bytes are AES-256-GCM encrypted (`lib/secretBox.encryptBuffer`, format
  `EMI1 | iv | tag | ciphertext`). The key derives from
  `SETTINGS_SECRET` → `JWT_SECRET` → dev fallback; **set `SETTINGS_SECRET` in
  production and keep it stable**, otherwise stored scans cannot be decrypted.
- Accepted types: JPG, PNG, WebP; max 20 MB; max 4 documents per application.
  The MIME type is sniffed from the bytes, not the filename.
- A pending upload expires after 24 hours and is deleted by the scheduler.
- Admin download is authenticated:
  `GET /api/retail-installments/applications/:id/documents/:docId` returns the
  decrypted bytes with `Cache-Control: no-store`, `nosniff`, and writes an
  `installment_document.view` audit entry.
- URL parameters are always validated by `ObjectId` before touching the DB, and
  the storage path is resolved against the root to block traversal.

### Retention

The daily retail scheduler calls `purgeStoreDocuments` for **every store that
has settings**, even if EMI was switched off later:

- stale `pending` uploads (past `expiresAt`) are deleted;
- when `documents.retentionDays > 0`, scans attached to **closed** applications
  (`rejected`, `cancelled`, `expired`, `completed`) whose `updatedAt` is older
  than the window are deleted;
- the document row becomes `status: "purged"` with `path: ""`, and the embedded
  application copy keeps a marker (`purgedAt`, empty mime/size) for the audit
  trail.

Manual run:

```
POST /api/retail-installments/documents/purge
Authorization: Bearer <admin token>
x-store-slug: <store>
```

## Reports

`GET /api/retail-installments/reports/overview?preset=this_month` (also
`last_month`, `last_7_days`, `yearly`, or `from`/`to` as `YYYY-MM-DD`).

Live aggregation over applications, retail orders, open installments and
verified payments — no rollup tables, so the numbers always match the review
screens:

- **applications** — counts by status in the period (by submission date),
  approval rate, average ticket;
- **portfolio** — retail EMI orders, financed, collected, outstanding, open
  installments, overdue count/amount;
- **aging** — open installments bucketed `current`, `1–30`, `31–60`, `61–90`,
  `91+` days past due (outstanding = amount + late fee − paid);
- **collections** — verified payments in the period by month and method;
- **earnings** — profit + service charge snapshotted on the orders;
- **topOverdue** — eight most overdue installments.

`GET /api/retail-installments/reports/export.xlsx?...` streams the same data as
a five-sheet workbook (Summary, Aging, Collections, Methods, Overdue) using the
dependency-free writer in `lib/xlsx.js`.

## Daily scheduler

`services/retailInstallmentScheduler.js` sends reminders, marks overdue rows and
charges the late fee once, expires stale applications, and purges documents.
It runs for all stores; `POST /api/retail-installments/run-scheduler` runs it for
the current store from the admin UI. The response summary includes
`documentsPurged` and `documentFilesDeleted`.

## Admin UI

Dashboard → **Retail EMI** (`public/dashboard.html`, `public/js/retail-installments-admin.js`):

- Applications: review queue, detail panel with the schedule and **document
  download** (blob download through the authenticated API — a plain link has no
  bearer token);
- Orders: schedule, manual payments, verify/reject;
- Settings: rates, applicant requirements, document types, retention window,
  "Purge old documents now";
- Month plans;
- Reports: period picker, aging/collections/overdue tables, Export Excel.

## Tests

```bash
npm test
```

Relevant suites: `tests/installmentApply.test.js`,
`tests/retailInstallmentAdmin.test.js`, `tests/retailInstallmentDocsReports.test.js`
(upload/attach, required types, expired tokens, download + audit, retention
purge, scheduler purge, report numbers, XLSX export).
