# Mooncrab deployment

Vercel project: `mooncrab` in team `james-64e0`, connected to `jagab1337-bit/mooncrab` on `main`. Production: https://mooncrab.vercel.app. Changes pushed to `main` deploy automatically. Framework: Vite; Node 24. Booking functions and the database are colocated in Singapore (`sin1`).

## Owner-provided calendar rules

Minimum stay: two nights. All dates from November 18 through December 16, 2026 are blocked. Check-in is available again on December 17, 2026. Dates use Asia/Manila. Requests require host confirmation; no payment is collected.

The `mooncrab` Upstash Redis store (`store_nkEE3VKFum46gINN`) is connected to production on the free plan. Automatic paid upgrades, eviction, and Prod Pack are disabled. The integration manages `KV_REST_API_URL` and `KV_REST_API_TOKEN`; direct `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` bindings are also supported. The private owner key is stored encrypted as `BOOKING_ADMIN_TOKEN` in Vercel. After these are set, redeploy and run `node scripts/initialize-calendar.mjs` with the owner token securely in the ignored `.env.local` or process environment. This script refuses to replace an already-published calendar. Later changes belong in `/manage`.

## Custom domain

These names are attached to the Vercel project: `mooncrabsiargao.com`, `www.mooncrabsiargao.com` (redirects to apex), and `booking.mooncrabsiargao.com`.

DNS is hosted by Spaceship. Vercel's recommended DNS values observed November 18, 2026:

| Type | Host | Value |
| --- | --- | --- |
| A | @ | 216.198.79.1 |
| A | @ | 64.29.17.1 |
| CNAME | www | cff3d388e8e2ced3.vercel-dns-017.com |
| CNAME | booking | cff3d388e8e2ced3.vercel-dns-017.com |

Replace website parking records only; preserve mail/TXT and unrelated records. Recheck current recommendations in the project's Domains settings before changing DNS. DNS and HTTPS were verified for the apex, www redirect, and booking subdomain on November 18, 2026. All three have valid Vercel configuration. Recheck DNS/TLS after future record changes.

## Owner access

Open `https://mooncrabsiargao.com/admin` or use **Admin login** in the website footer. This redirects to `/manage` on the primary domain. Sign in as `admin` using the supplied bootstrap password, then change it at first login. Only a scrypt hash is stored in the secret `ADMIN_BOOTSTRAP_PASSWORD_HASH`; the account/password changes persist in Redis. The existing `BOOKING_ADMIN_TOKEN` remains a private recovery key under the collapsed recovery option; never put it in a URL or share it with guests.

Owner access uses the main website; no separate admin hostname or DNS record is required. The unused hosting attachment has been retired. Keep website, booking, and email DNS records intact.

## Communications and imports

Two protected daily schedules are configured: external calendar imports around 03:00 and email outbox draining around 03:15 Asia/Manila. Vercel Hobby schedules may run within their hourly window. `CRON_SECRET` is stored as a Vercel Secret. New requests also attempt email processing immediately after persistence; owner controls can run imports/drains manually.

The owner-supplied Airbnb and Booking.com export feeds are configured as server-only production Secrets. Both exports have been retrieved and parsed successfully. Imported nights appear in the public booking calendar alongside manual and confirmed blocks; refresh status is available in the owner dashboard. See [external calendars](docs/external-calendars.md) for the import schedule and reconciliation behavior.

Spacemail SMTP credentials and sender verification remain pending. Actual email sending is not configured, and no actual test email has been sent yet. See [Spacemail](docs/transactional-email.md) for setup. SMTP acceptance is tracked separately from confirmed delivery.
