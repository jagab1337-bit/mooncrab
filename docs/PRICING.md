# KASAG pricing policy

The published baseline is PHP 1,300 per night, PHP 8,000 per complete seven-night package, and PHP 30,000 per complete thirty-night package. The minimum stay is two nights. The request limit is ninety nights, within the existing twenty-four-month calendar horizon.

The calculator finds the lowest valid total made from complete eligible thirty-night packages, complete eligible seven-night packages, and individual nights. Packages never round a shorter stay up: twenty-nine nights do not qualify for a thirty-night monthly package. Checkout is excluded from the occupied nights. There are no invented taxes, cleaning charges, or additional discounts.

A third guest adds PHP 500 for every occupied night, including package nights. One or two guests use the same room rate. Maximum occupancy is three. The displayed fifty-percent deposit is an estimate of the deposit required after the host agrees the total; it is not a payment record or proof that money was received.

Examples for one or two guests:

| Nights | Applied packages | Accommodation estimate |
| --- | --- | ---: |
| 2 | 2 nightly | PHP 2,600 |
| 7 | 1 weekly | PHP 8,000 |
| 15 | 2 weekly + 1 nightly | PHP 17,300 |
| 29 | 4 weekly + 1 nightly | PHP 33,300 |
| 30 | 1 monthly | PHP 30,000 |
| 31 | 1 monthly + 1 nightly | PHP 31,300 |
| 44 | 1 monthly + 2 weekly | PHP 46,000 |

Owner settings can change the three rates, minimum and maximum stay, and whether weekly/monthly packages are eligible. The server validates the settings and stores them in the existing Redis database. Public configuration, quote responses, new booking requests, and email summaries use the same pure calculator in `shared/pricing.ts`.

Every new request stores its server-calculated rate snapshot and line items. A rate edit affects new requests only; retrying an existing request returns its stored snapshot. Browser-submitted totals are ignored. Legacy requests without a historical quote remain readable without fabricating a price for them.

Pending requests do not hold nights. Confirmation revalidates manually blocked, confirmed, and imported nights atomically. If an external feed has been configured but has not synchronized successfully recently, the owner must sync it before confirming. Cancelling a confirmed stay releases only its confirmed nights; manual and imported blocks remain protected.

Required booking contact is a valid normalized international phone number, a valid single email address, and an explicit WhatsApp preference. There is one verified room, KASAG; the API rejects invented room names.
