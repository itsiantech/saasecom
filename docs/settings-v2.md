# Settings v2 — Payment, Login/Registration, Checkout Fields

## What was added

- Payment > Manual: COD switch + instruction, mobile banking rows, bank transfer rows.
- Payment > API: bKash/Nagad/Upay and SSLCommerz/aamarPay cards with per-card on/off.
- Login/Registration: master switch, email/phone methods (at least one on), live previews.
- Checkout fields: show/required/label per field, Simple/Full presets, live preview.
- Public checkout page: `public/checkout.html` (loads everything from settings).

## Migration

Run once after deploying the code:

```bash
node scripts/migrate-settings-v2.js
```

It is idempotent and does the following:

- Drops the old non-sparse `users.email_1` index and recreates `email` + `phone` as sparse unique indexes.
- Inserts missing setting keys (payment/login defaults) without overwriting existing values.
- Seeds each store with default shipping rows, mobile payment rows, API gateways and checkout fields if those collections are empty.

## New collections

| Model | Purpose |
| --- | --- |
| `PaymentMobileManual` | Manual mobile banking rows (name, account type, number, instruction) |
| `PaymentBankManual` | Manual bank rows (bank, account, number, branch, instruction) |
| `PaymentGateway` | API gateway config; credentials are AES-256-GCM encrypted in `credentials` |
| `CheckoutField` | Per-store show/required/label config for the 9 checkout fields |

Existing `User` now allows email **or** phone, and stores the last used delivery address in `shipping`.
Existing `Order` stores customer id/phone/address, payment method/label/details and shipping label.

## Settings keys

```
cod_enabled, cod_instruction
mobile_banking_enabled, mobile_banking_ask_sender
banking_enabled
api_mobile_enabled, api_banking_enabled
login_registration_enabled, login_email_enabled, login_phone_enabled
```

## API

Admin (JWT required):

- `GET /api/settings` — includes `payments` and `checkoutFields`
- `PUT /api/settings` — accepts `settings`, `payments`, `checkoutFields`
- `POST /api/settings/shipping-quote` — used by checkout for district/area pricing

Public:

- `GET /api/settings/checkout?store=<slug>` — fields, payment methods, shipping rules, login config, optional prefill
- `POST /api/auth/register?store=<slug>` — `{ name, email?, phone?, password }`
- `POST /api/auth/login?store=<slug>` — `{ identifier, password }`
- `POST /api/cart/checkout?store=<slug>` — validates fields/payment/login server-side

## Secrets

Gateway credentials are encrypted with `lib/secretBox.js`. The key comes from
`SETTINGS_SECRET` when set, otherwise it falls back to `JWT_SECRET`.
Admin responses mask secrets as `••••<last4>`; sending the masked value back keeps
the existing secret, so a blank/masked field never wipes credentials.

## Checkout page

Open:

```
/checkout.html?store=demo-store
```

- Store slug is remembered in `localStorage` (`luxe_store_slug`).
- Guest cart uses `x-session-id`; logged-in customers use a bearer token.
- If Login/Registration is enabled, guests must log in/register first; their guest cart is merged.
- Logged-in customers get name/phone/address prefilled from their saved details.
- District input triggers an area shipping quote; a matching area is selected automatically.
- Payment methods and sender/transaction fields follow the saved settings.
