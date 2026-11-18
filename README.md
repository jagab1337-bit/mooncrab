# Mooncrab Siargao

https://mooncrabsiargao.com · https://mooncrabsiargao.com/booking

Existing Vite/TypeScript website and Vercel Node 24 functions for **KASAG**, Mooncrab’s only room. Availability, guest requests, pricing, owner sessions, imported dates, and email jobs persist in the existing free Upstash Redis store in Singapore.

## Develop and verify

```sh
npm ci
npm run dev -- --port 3000
npm test
npm run test:e2e
npm run build
```

The Vite API plugin uses the same handlers as production. Copy `.env.example` to ignored `.env.local` for local server credentials. Never use `VITE_` for secrets. Browser tests use Chromium at `/usr/bin/chromium`, or `CHROMIUM_PATH`. Build output includes static content/metadata for all nine travel-guide routes; JavaScript enhances these into the interactive journal.

## Guest experience

- `/`: a six-photo KASAG carousel with full-resolution popups, rates, guest perks, exact Google Maps location, house rules, travel previews, an owner-supplied Airbnb testimonial, social gallery, and complete contacts.
- `/booking` (the former booking hostname redirects here): live calendar, immediate price breakdown, international phone validation, and a pending stay request followed by a WhatsApp-led next-step dialog.
- `/explore-siargao` and eight destination articles: original travel writing, verified road/boat directions from Mooncrab’s exact pin, authentic licensed photographs, credits, related guides, metadata, and structured data.
- `/email-signature/`: reusable HTML signature, QR codes, offline previews, installation instructions and downloadable package.
- Photographs open in an accessible viewer with full frames, original pixel dimensions, keyboard controls and direct full-image links. Display thumbnails are separate optimized assets.

## Booking and pricing

Two-night minimum, up to 90 nights; check-in 2 PM/check-out 11 AM in Asia/Manila. Two guests are included, maximum three; the third guest adds PHP 500 per occupied night. The owner supplied rates of PHP 1,300/night, PHP 8,000/seven nights, and PHP 30,000/30 nights. The calculator chooses the lowest total using eligible complete packages and remaining nightly rates; it never rounds a shorter stay up into a package. Admin rates and eligibility settings persist; each request retains its server-calculated pricing snapshot. See [pricing policy](docs/PRICING.md).

**A request does not hold or confirm the room.** Agree the final total, send the private personal-bank receiving QR/details, verify the 50% deposit actually credited, then confirm in the owner dashboard. No bank QR/details are published. No card checkout, automatic payment verification, refund processing or paid status is implemented.

Confirmation atomically rechecks manual, confirmed and imported blocked nights. Cancellation releases only that direct stay’s confirmed nights. Existing manual blocks remain. The calendar is initialized and remains blocked through December 16, 2026, reopening December 17. Do not rerun initialization or replace its saved state.

## Owner access

Use https://mooncrabsiargao.com/admin or the **Admin login** link in the website footer. `/admin` is the protected owner dashboard. Legacy `/manage` links redirect there. Username is `admin`; the supplied bootstrap password is stored only as a secure hash and must be changed after first login. Sessions use 8-hour, HttpOnly, Secure, SameSite cookies; login attempts are limited and mutations check Origin. The existing private bearer key remains available as a recovery/API option.

The dashboard supports date ranges, manual/confirmed/imported indicators, pending inquiries, stored guest/phone/price details, deposit verification before confirmation, pricing/contact controls, password changes, calendar connection status, and safe email retries. Select any displayed date to choose Airbnb, Booking.com, or direct booking and leave private notes, then use **Save changes**. Source labels and notes are independent of guest availability; use **Unavailable for guests** to manually block or reopen an eligible night. Imported and confirmed dates remain protected while their notes stay editable. Never share the owner key with guests.

Use **Finance Tracker** to view Money In and Money Out together. One month picker controls both ledgers and the summary. Search, filter, edit and export each ledger independently. Open **Manage People** to rename or archive a person, or choose **Add New Person** in a contributor field. Historical contributions retain their person IDs and original amounts. Transaction dates determine the month. Use **Credentials & Properties** to save property information and manage private original files, and use your MFA-protected password manager for actual credentials. **Project Management** includes project workspaces with tasks, checklists, milestones, notes, links, and shared attachments. **Notification Settings** controls the owner recipient and connection test.

## Integrations

[Deployment and DNS](DEPLOYMENT.md) · [Spacemail and durable email outbox](docs/transactional-email.md) · [External iCal imports](docs/external-calendars.md)

Successful creation atomically stores a pending request and two email jobs. SMTP sending is attempted only with a verified Spacemail alias and private SMTP configuration. Missing email configuration preserves queued jobs and the booking. Accepted by SMTP does not mean delivered. Two free daily cron jobs process pending email and configured calendar feeds; admin controls can run them manually.

Airbnb and Booking.com buttons use the owner’s exact listing URLs. Nikki's five-star Airbnb review is transcribed from the owner's screenshot; see [review provenance](content/REVIEWS.md). Public automatic review retrieval is unavailable; no aggregate rating is claimed. The owner's Airbnb and Booking.com calendar exports are configured as private production Secrets. Calendar synchronization is import-only and periodic, with a daily schedule and manual owner refresh; it is not a real-time channel manager. Keep external channels reconciled manually.

## API and data protection

Public: `GET /api/config`, `GET /api/quote`, `GET /api/availability`, `POST /api/booking-requests`.

Owner: `/api/admin/session`, `/api/admin/settings`, `/api/admin/availability`, `/api/admin/booking-requests`, `/api/admin/calendar-sync`, `/api/admin/email-outbox`, and `/api/admin/workspace`. Owner APIs enforce server authorization. Availability exposes no guest identity. Requests use UUID idempotency, validation and rate limiting; request records expire 90 days after checkout. Private feed URLs, SMTP secrets, passwords and database credentials stay server-side.

See [brand provenance](BRAND.md), [destination image credits](content/DESTINATION-PHOTO-CREDITS.md), and [travel research](content/EXPLORE-SIARGAO.md). No synthetic property or destination photos are used. The guest Wi-Fi PDF is not published.
