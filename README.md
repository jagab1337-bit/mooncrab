# Mooncrab Siargao

Production website: https://mooncrab.vercel.app. See [DEPLOYMENT.md](DEPLOYMENT.md) for domain DNS and owner-provided calendar rules.

Responsive Vite/TypeScript website for KASAG, Mooncrab’s single room, with a guest booking calendar and an authenticated owner dashboard. Self-hosted typography; no third-party frontend scripts. Vercel Node functions persist availability and stay requests in Upstash Redis.

## Run locally

Use Node 24 and the existing checkout; each cloud task is isolated, so no worktree is needed.

```sh
cd /workspace/mooncrab
npm ci --cache /workspace/.cache/npm
npm run dev -- --port 3000 --strictPort
```

The Vite development plugin serves the same `/api` handlers used on Vercel. Optional local credentials go in ignored `.env.local` (see `.env.example`), never in source. Restart the dev server after updating them. Without storage credentials the calendar honestly returns HTTP 503 and disables requests; it does not manufacture available dates.

```sh
npm test                 # Backend validation/auth/date-boundary tests
npm run test:e2e         # Chromium frontend tests; fixture API responses
npm run build            # TypeScript + production asset build
```

Browser tests use `/usr/bin/chromium`, or override `CHROMIUM_PATH`. The production API is tested separately from browser fixtures. Passing local tests does not establish a live database connection, DNS configuration, or successful deployment.

## Pages

- `/` — property website.
- `/booking` — KASAG’s public calendar and stay request form.
- `/manage` — owner access; the access key stays in page memory and is erased on lock/navigation. This path is not linked in public navigation. Authentication is enforced server-side.
- The root of `booking.mooncrabsiargao.com` automatically renders the booking page. Links from `mooncrabsiargao.com` go to that booking subdomain; local and preview deployments use `/booking`.

## Deploy to Vercel

1. Import the `jagab1337-bit/mooncrab` GitHub repository into your Vercel account (Vite framework, Node 24). `vercel.json` supplies build/output settings, routing, and security headers. Alternatively use an authenticated Vercel CLI from this directory.
2. Create or connect an **Upstash Redis** store in Vercel’s storage integrations. The native integration supplies server-side `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Direct Upstash names `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are also supported. Set `BOOKING_ADMIN_TOKEN` to a unique strong randomly generated owner key in Vercel’s environment settings. Never use `VITE_` for any secret. Use separate databases and owner keys for production and previews.
3. Deploy. Add `mooncrabsiargao.com`, `www.mooncrabsiargao.com`, and `booking.mooncrabsiargao.com` to this same Vercel project. At your domain provider, use the **exact DNS values Vercel displays** for each name; preserve existing email/other records. Verify domain ownership and TLS in Vercel. No DNS changes have been made by this source code.
4. Open `/manage`, unlock with your owner key, and block all existing reservations for the coming 24 calendar months. Dates are in **Asia/Manila**. Only after reconciling existing bookings, check the explicit publication checkbox and save. Even a connected empty database stays closed to guests until this step is completed.
5. Verify live availability, submit a clearly identified test request, view it in the owner dashboard, and decline it. Confirm that the main domain and booking subdomain both load over HTTPS. Do not accept live reservations until these checks succeed.

Cloud outbound network access and Vercel authentication are separate. The draft has requested `api.vercel.com`, `vercel.com`, `auth.vercel.com`, and photo-source destinations; saving a draft alone does not apply network policy. Vercel runtime access to Upstash is configured independently from the development machine.

## Booking operations

KASAG is the only inventory item. Public users see only blocked dates; guest identity is never exposed by availability APIs. Check-in is occupied, check-out is not. Stay requests cover 2–30 nights within the published calendar horizon.

**A request is not a reservation or date hold.** The host reviews incoming requests in `/manage`, contacts the guest by email, agrees the rate and other stay details, then confirms. No payment or automatic email delivery is implemented. Check the dashboard regularly; it is the source of incoming requests. The host must manually notify guests of approval, decline, or cancellation.

Confirmation atomically rechecks and blocks every occupied night. Two overlapping requests cannot both be confirmed. Manual blocked dates and confirmed nights are stored separately: reopening a manually blocked date cannot accidentally reopen a confirmed stay. Reservations from other channels must be blocked here manually; there is no external calendar synchronization.

The public request endpoint validates guest input and rate-limits submissions using hashes of email and Vercel’s trusted forwarded IP when present. Guest request records and retry markers expire 90 days after check-out. Owner API calls require the private bearer key. Do not share it with guests. Refresh availability before relying on the current calendar.

For a confirmed-stay cancellation, agree the cancellation with the guest and notify them directly, then use the guarded cancellation action on the owner dashboard. Only the cancelled stay’s confirmed nights are released; manual blocks remain. No refund or cancellation email is sent by this site.

## API

- `GET /api/availability?month=YYYY-MM` → `{configured:true,room:'KASAG',blockedDates:[...]}` or HTTP 503 until connected and initialized.
- `POST /api/booking-requests` → `{id,status:'pending'}` after validating `{checkIn,checkOut,name,email,message,idempotencyKey}`. The client uses a UUID for retry safety.
- `GET /api/admin/availability` and `PATCH` with `{add:[],remove:[],initialize?:true}` manage manual blocks.
- `GET /api/admin/booking-requests` lists recent requests; `PATCH` with `{id,action:'confirm'|'decline'|'cancel'}` handles them.

All owner endpoints require `Authorization: Bearer <owner key>`. Responses are not cached. No server credentials are included in the frontend bundle.

## Photos and brand assets

The supplied Dropbox photographs, Moon Crab logo, and five-color palette are applied across the landing and booking pages. See [BRAND.md](BRAND.md) for asset provenance and font availability. Public photos are optimized WebPs in `public/images/`; full-resolution source photos remain outside the repository.

No nightly rate, guest capacity, precise property address, Wi-Fi, or other unverified amenities are claimed.
