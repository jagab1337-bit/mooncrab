# Mooncrab deployment

Vercel project: `mooncrab` in team `james-64e0`, connected to `jagab1337-bit/mooncrab` on `main`. Production: https://mooncrab.vercel.app. Changes pushed to `main` deploy automatically. Framework: Vite; Node 24. Booking functions and the database are colocated in Singapore (`sin1`).

## Owner-provided calendar rules

Minimum stay: two nights. All dates from November 18 through December 16, 2026 are blocked. Check-in is available again on December 17, 2026. Dates use Asia/Manila. Requests require host confirmation; no payment is collected.

The `mooncrab` Upstash Redis store (`store_nkEE3VKFum46gINN`) is connected to production on the free plan. Automatic paid upgrades, eviction, and Prod Pack are disabled. The integration manages `KV_REST_API_URL` and `KV_REST_API_TOKEN`; direct `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` bindings are also supported. The private owner key is stored encrypted as `BOOKING_ADMIN_TOKEN` in Vercel. After these are set, redeploy and run `node scripts/initialize-calendar.mjs` with the owner token securely in the ignored `.env.local` or process environment. This script refuses to replace an already-published calendar. Later changes belong in `/manage`.

## Custom domain

These names are attached to the Vercel project: `mooncrabsiargao.com`, `www.mooncrabsiargao.com` (redirects to apex), and `booking.mooncrabsiargao.com` (permanently redirects legacy booking links to the main site’s `/booking` route). Keep the booking CNAME at Spaceship and the Vercel project alias to preserve the HTTPS redirect.

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

Each displayed date has an owner-only source and notes editor. Private overrides are stored in the `mooncrab:date-details` Redis hash; imported source labels are derived from the saved iCal snapshots and confirmed direct stays. Notes and source labels never appear in the public availability API. Saving annotations does not reserve or reopen a date; only explicit availability edits affect the manual blocked-date set. Metadata and manual edits submitted together use one atomic transaction, preserving imported and confirmed dates.

## Communications and imports

Two protected daily schedules are configured: external calendar imports around 03:00 and email outbox draining around 03:15 Asia/Manila. Vercel Hobby schedules may run within their hourly window. `CRON_SECRET` is stored as a Vercel Secret. New requests also attempt email processing immediately after persistence; owner controls can run imports/drains manually.

The owner-supplied Airbnb and Booking.com export feeds are configured as server-only production Secrets. Both exports have been retrieved and parsed successfully. Imported nights appear in the public booking calendar alongside manual and confirmed blocks; refresh status is available in the owner dashboard. See [external calendars](docs/external-calendars.md) for the import schedule and reconciliation behavior.

Production Spacemail SMTP reports ready, owner notifications are enabled, and the latest saved dashboard test was accepted by Spacemail. New bookings have a separate confirmation submission recorded after host approval. Each email attempt tracks provider acceptance separately from inbox delivery. [Spacemail setup and booking controls](docs/transactional-email.md)


## Private owner workspace

`/admin/finance`, `/admin/vault`, `/admin/projects`, and `/admin/settings/notifications` use the existing owner session. Finance, note, and project updates use Redis compare-and-set and record revisions to protect concurrent edits. The one-time November payable import is sent through the authorized API and stored in Redis. Do not commit the financial source data to Git.

The file library stores the original bytes encrypted with AES-256-GCM. Each file has an independent nonce and SHA-256 checksum. Files are served only through the authenticated API and have no public URL. Configure `ADMIN_WORKSPACE_ENCRYPTION_KEY` as a Vercel Production Secret containing a 32-byte base64url key. Back up the key in the business password manager. Existing files require the same key across deployments. Preserve the key during environment or project moves. Key rotation requires re-encrypting existing originals before changing the secret. Files are limited to 2 MiB each and 48 MiB total on the existing store.

The Logins section uses `ADMIN_LOGIN_VAULT_KEY`, a separate 32-byte base64url Production Secret. Keep a recovery copy in the business password manager. The key encrypts login fields and the authenticator seed using separate AES-256-GCM keys derived with HKDF. Preserve this key across deployments. Rotation requires a verified decrypt-and-re-encrypt migration.

Sign in with the administrator username and password. Use **Set Up Authenticator** once and keep a secure recovery copy of the displayed setup key. Unlocking thereafter requires the administrator password and a fresh six-digit code. A five-minute grant is bound to the active server session. Record lists exclude passwords. A dedicated authorized request retrieves one password for hover or copy and logs the action without the secret. The old Properties storage key continues to back the Notes collection for compatibility with saved records.
