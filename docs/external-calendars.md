# External booking calendars

Mooncrab supports **periodic, import-only iCalendar snapshots** for the existing KASAG room. This is not a live channel manager and does not send availability or rates back to Airbnb or Booking.com. Keep the channels in sync manually when a new direct booking is agreed, and review the source calendars before confirming a stay.

## Configuration

Set these private server-side Vercel environment variables for production, then redeploy:

- `AIRBNB_ICAL_URL`: KASAG's private Airbnb export URL, using `https://www.airbnb.com/calendar/ical/… .ics` (without the space).
- `BOOKING_COM_ICAL_URL`: KASAG's private Booking.com export URL from `ical.booking.com/v1/export/…` or `admin.booking.com/hotel/hoteladmin/ical.html`.
- `CRON_SECRET`: a long random value, if scheduling the protected synchronization endpoint.

The URLs are sensitive credentials. Never put them in the repository, chat, browser configuration, public environment variables, logs or screenshots. Configure only the exports for the single KASAG room. If a provider supplies a different export hostname, review and add that exact provider-owned host to the server allowlist; do not disable URL validation.

Airbnb's public listing URL and Booking.com's property listing URL are **not calendar feeds**. Private export links must be obtained from the owner's host/extranet account. No private feeds have been supplied in this session, so no live platform synchronization can be claimed.

## Operation

- Authenticated `GET /api/admin/calendar-sync` returns each source's configured flag, last attempt, last success, stale flag, event count and safe error code. No feed URL or guest notes are returned.
- Authenticated `POST /api/admin/calendar-sync` imports the configured sources and returns updated status.
- A scheduled server request can use `GET /api/admin/calendar-sync?action=sync` with `Authorization: Bearer <CRON_SECRET>`. Without that secret, GET only reads status for an authenticated administrator. Do not publish a public trigger URL containing the secret.
- The intended minimum schedule on a free Vercel Hobby plan is once daily; the administrator can refresh manually before agreeing a booking. A schedule is active only after it is actually added to deployment configuration. The stale indicator turns on after 26 hours without a successful source import.

Each successful **complete** snapshot reconciles source event IDs, updated dates and cancellations. Checkout dates are exclusive. The atomic Redis update changes only `mooncrab:imported-dates`; manually blocked and directly confirmed nights remain intact. The public calendar and confirmation conflict checks include the imported set.

Provider exports may contain host-blocked nights as well as reservations. They are shown as **external blocked dates**, not as proof of paid or confirmed guest bookings. Imported events retain source, a hashed stable event ID, room and stay dates, but do not retain guest names, descriptions, phone numbers or source reservation URLs.

## Failure behavior

The importer uses fixed provider-owned HTTPS allowlists, rejects credentials/custom ports/IP destinations, refuses redirects, times out requests and limits feed size. Unsupported recurrence rules, incomplete calendars, floating or unfamiliar timezones, malformed dates and inconsistent duplicate IDs fail closed. A failed import preserves that source's last good snapshot and blocks; removing an environment variable also preserves the last imported blocks. Restore and successfully refresh the correct feed before expecting canceled nights to reopen.

A Redis lock prevents simultaneous synchronization jobs. Source snapshots and the imported-only union are changed in an atomic Lua operation. A healthy refresh of one source cannot release the other source's stored dates. Monthly admin edits and direct reservations use independent Redis sets.

## Official guidance checked

- [Airbnb: Sync your home host calendar to other websites](https://www.airbnb.com/help/article/99). Airbnb describes booked and blocked nights, host export links, and periodic imports (not real-time updates).
- [Booking.com Partner Help](https://partner.booking.com/): obtain the property-specific iCalendar export from the extranet's calendar synchronization tools, where eligible.

The supplied Airbnb listing could not be retrieved through the public lookup tool. The supplied Booking.com listing displayed a JavaScript anti-bot page. Their URLs are preserved as owner-supplied booking links, but their reviews and listing details were not independently verified or copied.
