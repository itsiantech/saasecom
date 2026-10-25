# Sales reports — operations guide

Read-only reporting module for the admin dashboard. It never edits orders,
products, coupons, customers or settings; all report data goes into five new
`report_daily*` collections plus two additive `Order` indexes.

- UI: `Reports` → Sales / Product wise / Category wise / Coupon wise / Top customers
- API: `/api/admin/reports/*`
- Source of truth for definitions: `lib/reportConstants.js`

## Definitions

| Metric | Rule |
| --- | --- |
| Valid order | `status` is exactly `processing` or `completed`; day bucket = order `createdAt` in report timezone |
| Sales | Sum of `totalAmount` (grand total including shipping, after coupon) |
| Average daily sales | Sales ÷ every calendar day in the selected period (including zero days) |
| Net sales this year | This year's sales − refunds − shipping − tax, independent of the selected period. Tax is 0 today because orders carry no tax field; the formula is ready for one |
| Orders placed | Count of valid orders |
| Items purchased | Sum of item quantities |
| Refunded orders | Orders with `installmentPlan.cancellation.at` in the period and `refundPaisa > 0`; bucketed by refund date, not order date |
| Charged for shipping | Sum of `shippingAmount` on valid orders |
| Worth of coupons used | Sum of `couponDiscountPaisa`, falling back to `couponDiscount` |
| Product / category sales | Order merchandise (`totalAmount − shippingAmount`), split across item lines by gross value with largest-remainder rounding, so lines always add up to the order merchandise exactly |
| Category attribution | Earliest `ProductCategory` link (`createdAt`, then `_id`); no link → `Uncategorized`. Attribution is evaluated when the day is rebuilt, not at order time |
| Top customers | Registered orders group by `customer`; guests by normalised phone, then email, then order id. Total spent includes shipping, same as Sales |

Refunds are tracked only through the installment cancellation snapshot
(`Order.installmentPlan.cancellation`). Retail refunds are not tracked and are
therefore not subtracted.

## Periods and timezone

All preset and custom ranges resolve on the server (`lib/reportPeriods.js`); the
client only sends `preset` or `from`/`to`.

| Input | Range |
| --- | --- |
| `yearly` | 1 Jan of the current year → today |
| `last_month` | First → last day of the previous calendar month |
| `this_month` | First day of this month → today |
| `last_7_days` | Today − 6 days → today |
| `from` + `to` | Inclusive; max 366 days, no future end date |
| Top customers `monthly` | First day of this month → today |
| Top customers `half_yearly` | First day of the month 5 months ago → today (6 calendar months) |
| Top customers `yearly` | 1 Jan of this year → today |

Timezone default is `Asia/Dhaka`; set `REPORT_TIMEZONE` (IANA name) to override.
An invalid value logs a warning and falls back to `Asia/Dhaka`. Day boundaries,
midnight bucketing and reconciliation all use this timezone.

Chart buckets are zero-filled: daily up to 14 days, weekly for 15–91 days,
monthly above 91 days (and monthly for the yearly preset).

## Rollups, live today, cache

- Completed past days are read from `report_daily*`.
- Today is always aggregated live from orders, so a refresh never shows stale data.
- A past day with no rollup is computed from raw orders on the fly and is **not**
  written; run the backfill to persist it.
- Order changes and installment refunds schedule a best-effort rebuild of the
  affected day(s) after a 2 second debounce. Hook failures never fail the
  order/refund flow.
- In-memory cache: 45 seconds per store/range/dimension; rebuilding a day clears
  that store's cache.
- Nightly reconciliation runs at 02:30 report time and rebuilds the last 3
  completed days for every store (`services/reportScheduler.js`).

## Collections and indexes

New collections created by `scripts/reports-migrate-up.js`:

- `report_daily`
- `report_daily_products`
- `report_daily_categories`
- `report_daily_coupons`
- `report_daily_customers`

Each has a unique `{ store, date, ... }` key and tenant `store` field. Additive
indexes on the existing `orders` collection:

- `report_valid_orders` — `{ store: 1, status: 1, createdAt: 1 }`
- `report_refund_dates` — `{ store: 1, "installmentPlan.cancellation.at": 1 }`

The migration never modifies existing documents, schemas or roles. It has not
been executed by this implementation — run it in the target environment.

```bash
node scripts/reports-migrate-up.js --dry-run
node scripts/reports-migrate-up.js

# Rollback: dry-run by default; only drops report collections/indexes
node scripts/reports-migrate-down.js
node scripts/reports-migrate-down.js --yes-drop-report-data
```

## Backfill

Rebuild any range from raw orders without touching source data. Run off-peak and
keep a delay for long ranges.

```bash
node scripts/reports-backfill.js --dry-run --from=2026-01-01 --to=2026-10-24
node scripts/reports-backfill.js --from=2026-01-01 --to=2026-10-24 --delay=250
node scripts/reports-backfill.js --from=2026-10-01 --to=2026-10-24 --store=<storeId>
```

When exactly one store exists, `--store` can be omitted. Rebuilds are idempotent:
a day is replaced, not appended.

Superadmins can also rebuild through the API (max 31 days per call):

```http
POST /api/admin/reports/rebuild
{ "from": "2026-10-01", "to": "2026-10-24" }
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/admin/reports/access` | Fail-closed sidebar probe for any signed-in user |
| GET | `/api/admin/reports/sales/summary` | 8 summary metrics + chart buckets |
| GET | `/api/admin/reports/sales/products` | Product-wise rows (`sort`, `page`, `limit`) |
| GET | `/api/admin/reports/sales/categories` | Category-wise rows (`sort`, `page`, `limit`) |
| GET | `/api/admin/reports/sales/coupons` | Coupon-wise rows (`page`, `limit`) |
| GET | `/api/admin/reports/customers/top` | Top customers (`range`, `limit` ≤ 100) |
| GET | `/api/admin/reports/export` | `report`, `format=csv\|pdf`, same filters |
| POST | `/api/admin/reports/rebuild` | Superadmin-only day rebuild |

Reads and exports require `auth` + `requireAdmin` (admin, superadmin or store
owner). Rebuild requires `requireSuperAdmin`. No granular permission migration is
needed; the existing role mapping is used. The access probe deliberately returns
booleans instead of 403 so a denied user is not logged out by the sidebar.

Rate limits are per user + store:

| Kind | Limit |
| --- | --- |
| Read | 60 / minute |
| Export | 10 / minute |
| Rebuild | 2 / minute |

Every response carries `X-Request-Id`. A valid `X-Request-Id` or
`X-Correlation-Id` header (8–80 chars `A-Za-z0-9._:-`) is reused; otherwise a UUID
is generated. Error responses include `requestId`; 5xx responses never expose a
stack trace or customer data.

Unknown query keys, repeated query params, invalid presets/dates, `from > to`, a
future end date, ranges over 366 days, invalid `sort`/`range`/`report`/`format`,
and malformed rebuild bodies return a clear 400.

## Exports

- **CSV** — UTF-8 BOM, CRLF, quoted cells, formula-injection guard for cells that
  start with `= + - @`, at most 5,000 rows. Metadata rows include report name,
  resolved period, timezone, generation time and admin name.
- **PDF** — the server returns a print-ready HTML page (period, generated-at and
  admin name included). The UI opens it in a new tab synchronously and the admin
  uses the browser's Save as PDF. Blocked popups show an inline message.

## UI behavior

- The sidebar group is hidden until `/access` confirms `canView`; a failed probe
  fails closed. Direct navigation shows an "admin-only" state.
- Presets, custom dates (validated client-side too), sort and customer limit all
  reload with an AbortController so stale responses cannot overwrite newer ones.
- Sales shows exactly 8 cards, a zero-filled inline SVG chart, and an accessible
  "Chart data" table. Tables show totals and Prev/Next paging.
- Loading skeletons, empty states, inline errors with the request id and Retry
  are implemented. The page never calls the dashboard `api()` helper, so a report
  403 does not log the admin out.
- Dark/light theme uses existing tokens; 44px targets and `:focus-visible`; layout
  fits 390px mobile (tables and chart scroll inside their own containers).

## Tests

```bash
node --test tests/reports*.test.js   # unit + API/aggregation integration
node --test tests/*.test.js          # full regression
```

The integration suite uses `mongodb-memory-server` + supertest and covers metrics,
refund-date bucketing, YTD filter independence, Dhaka midnight isolation, chart
zero-fill, rollup idempotency/fallback/drift repair, permissions, validation,
rate/correlation headers, exports and the status-change hook.

## Known limitations

- Only `processing` and `completed` orders count. Legacy `delivered` orders are
  excluded by design; migrate those statuses if they should be reported.
- Product/category names reflect current catalogue names when a day is rebuilt.
- Category attribution uses the earliest current mapping, not the historical
  mapping at order time.
- Retail refunds are invisible; only installment cancellations carry a refund
  snapshot.
- The report cache is in-process. Multiple app instances may serve up to 45
  seconds of stale past-day data; today is always live.
