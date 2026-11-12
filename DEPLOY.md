# Deploying shop addresses (`<slug>.<PLATFORM_DOMAIN>`)

Each store is reached at `<slug>.<PLATFORM_DOMAIN>` (prod: `<slug>.amarbazaar.bd`,
local: `<slug>.localtest.me`). The apex host serves the platform itself, so the
wildcard vhost only needs DNS + one wildcard certificate; shops never need a
deploy step of their own.

## 1. DNS

| Name | Type | Value |
| --- | --- | --- |
| `amarbazaar.bd`, `www` | A | server IP |
| `*.amarbazaar.bd` | A | server IP |
| `api.amarbazaar.bd` | A | server IP (backend/panel, optional alias) |

A custom domain added in the dashboard points at the same server (A record or
CNAME to a shop hostname). It must be added separately to TLS (next section).

## 2. TLS

One wildcard certificate covers the apex, `www` and every shop:

```bash
# DNS-01 is required for wildcards; point certbot at your DNS provider
certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d amarbazaar.bd -d '*.amarbazaar.bd' --cert-name amarbazaar.bd
```

The certs land in `/etc/letsencrypt/live/amarbazaar.bd/`; the wildcard vhost
references `amarbazaar.bd-0001` because a cert-name already owned that path.
Reload nginx from the renewal hook (`--deploy-hook "systemctl reload nginx"`).

Custom domains are not covered by the wildcard. When a store verifies its
domain, issue a per-domain cert and serve it with the same routing as a shop
subdomain (copy `amarbazaar-shops.conf`, replace `server_name` and the cert
paths):

```nginx
server {
    listen 443 ssl;
    server_name dokan.example.com;
    ssl_certificate     /etc/letsencrypt/live/dokan.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dokan.example.com/privkey.pem;
    # …same locations as amarbazaar-shops.conf
}
```

```bash
certbot certonly --nginx -d dokan.example.com   # then reload nginx
```

## 3. Nginx

Configs live in `deploy/nginx/`:

- `amarbazaar.conf` — apex + `www` (landing/setup/portal) and `api` host.
- `amarbazaar-shops.conf` — `*.amarbazaar.bd`: storefront (Next `:3000`) on `/`,
  store panel pages/assets and admin APIs on the Express backend (`:5000`).
  `X-Forwarded-Host` is set so the app sees the shop host.

```bash
sudo cp deploy/nginx/amarbazaar.conf deploy/nginx/amarbazaar-shops.conf /etc/nginx/sites-available/
sudo ln -sf /etc/nginx/sites-available/amarbazaar*.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Keep `/dashboard.html`, `/settings.html`, `/portal.html`, `/login.html`,
`/account.html`, `/css/`, `/js/`, `/uploads/` and `/api/` on the backend so the
Host header still resolves the shop for the panel. `/api/cart/*` and
`/api/public/*` stay on Next because it owns the httpOnly `cart_sid` cookie.

## 4. Environment

Backend (`.env`, Express):

```ini
APP_MODE=saas                 # enables per-host tenant resolution
PLATFORM_DOMAIN=amarbazaar.bd # also settable in the superadmin settings panel
STOREFRONT_URL=https://amarbazaar.bd  # origin used to build public shop URLs
PLATFORM_IP=                  # optional server IP for DNS instructions
```

Frontend (`.env.local`, Next):

```ini
BACKEND_URL=http://127.0.0.1:5000
PLATFORM_DOMAIN=amarbazaar.bd
PLATFORM_URL=                 # optional; defaults to https://<PLATFORM_DOMAIN>
DEFAULT_STORE=                # only for single-store/demo boots
```

Changing `PLATFORM_DOMAIN` changes the host suffix for every shop; existing
stores keep their `Store.slug` and resolve at the new suffix automatically.

## 5. How a host resolves to a shop

1. Nginx keeps the original Host; Next derives the first label
   (`tara-mart`) and sends it as `x-store-slug` (any other hostname is sent
   as `x-store-domain` for custom-domain verification).
2. The backend matches `Store.slug` first, then a legacy `Store.subdomain`
   alias, then a verified `customDomain`.
3. Suspended shops answer `403`, trashed/unknown addresses `404`. The Next
   shell renders a friendly "shop closed" or "no shop at this address" page;
   the not-found page links to the platform's `/setup.html`.
4. Store identity is fetched `no-store` on every render, so suspending or
   deleting a shop takes effect immediately.

### Changing a shop address

- Owners change the address from the portal (`/portal.html`). `Store.slug`
  becomes the new first label; the old label is kept in `SlugHistory` for 90
  days and the Next proxy answers a real `301` to the current site (path and
  query preserved) by asking `/api/public/address-redirect`.
- Owners can rename once per cooldown period, default **30 days**, configurable
  by the superadmin via platform settings (`slugChangeCooldownDays`, 0–365).
  Superadmin renames bypass the cooldown. Every rename writes an
  `AuditLog` row (`store.slug.change`).
- After the 90-day window the old label stops redirecting; it stays reserved
  only while its quarantine lasts, then becomes available like any other name.

## 6. Deploy checklist

```bash
pm2 restart rashacart-api rashacart-web
sudo nginx -t && sudo systemctl reload nginx
```

Smoke checks (replace the slug):

```bash
curl -I -k -H 'Host: tara-mart.amarbazaar.bd' https://127.0.0.1/  # 200 storefront
curl -s -k -H 'x-store-slug: tara-mart' https://127.0.0.1/api/public/store
curl -I -k -H 'Host: nope.amarbazaar.bd'    https://127.0.0.1/  # friendly 404 page
```

## 7. Local development

`*.localtest.me` already resolves to `127.0.0.1`, so no hosts file entries are
needed. Run the backend on `:3000` and the storefront on `:3001`:

```ini
# backend .env
APP_MODE=saas
PLATFORM_DOMAIN=localtest.me

# frontend .env.local
BACKEND_URL=http://localhost:3000
PLATFORM_DOMAIN=localtest.me
```

Then open `http://demo-store.localtest.me:3001`. On a bare `localhost` visit
the `?store=<slug>` query (or the `store_hint` cookie) selects the tenant; on a
shop subdomain links carry no query string. `allowedDevOrigins` in
`next.config.mjs` already whitelists `*.localtest.me` for dev hydration.
