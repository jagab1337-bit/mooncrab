# Mooncrab booking email

The booking creation transaction stores the pending request and two email jobs together in the existing Redis database. One job acknowledges the guest; the other notifies the configured owner notification address. No email is generated for a request that failed validation or persistence. The stored server-calculated quote is used in both messages.

Owner notifications use **Moon Crab Bookings <bookings@mooncrabsiargao.com>**. Guest acknowledgments and official confirmations use the same address with the Moon Crab Siargao display name. The outbox waits for the authorized alias. Spacemail Webmail manages its own compose signature.

## Confirm a stay or add a reservation

- In **Admin → Bookings**, review the guest and dates. Enter the agreed accommodation total and any payment actually received. Leave payment blank when you have no verified amount on record. Confirming a website request saves the reservation, blocks occupied nights, and queues the official guest email in the same Redis transaction.
- Use **Add manual reservation** and choose a booking source. Use **Confirm Booking & Send Email** for a current or upcoming direct stay with a guest email and recorded policy agreement. Use **Save Without Sending Email** to record an explicit status, including confirmed walk-ins and past reservations. Additional sources are available in **Rates & business settings**.
- For Airbnb and Booking.com, use the platform’s guest communication and policy. Matching the exact dates and source of a single imported stay allows an internal record without changing the imported event. A conflicting, differently sourced, or ambiguous import remains blocked. Cancelling an internal record leaves the original calendar import in place.
- Record subsequent payments under **Payment details**. The required 50% deposit and remaining balance are calculated from the agreed total and recorded payments. Approving a booking never records money. Confirmations and deliberate resends read the reservation's current payment record.
- The booking page requires guests to accept the current policy. The record stores the version and server timestamp. A manual agreement records when the host entered it. Existing reservations keep their original policy context. New direct bookings require a non-refundable 50% deposit and disallow same-day cancellation. The host handles any refunds under the reservation’s accepted terms.

## Activate booking notifications

On November 19, 2026, the production dashboard reported that SMTP was ready and owner notifications were enabled. The latest saved dashboard test was accepted by Spacemail. Use these steps if you need to reconfigure the connection or verify a new inbox.

1. In Spaceship, open **Launchpad → Spacemail Manager**. Find the mailbox that should send the notifications. Click the three dots next to it, then **Set aliases**. Verify that `bookings@mooncrabsiargao.com` is assigned to that mailbox. From its Spacemail webmail, send a message from that alias to an inbox you control and confirm the From address on receipt. [Spaceship alias guide](https://www.spaceship.com/en-GB/knowledgebase/setup-email-aliases-spacemail/)
2. On the mailbox’s three-dot menu, open **IMAP/POP3/SMTP**. Spaceship lists `mail.spacemail.com`, port `465`, with SSL/TLS for outgoing mail. SMTP authenticates using the full primary mailbox address and its mailbox password. Use the address assigned to the mailbox in Spacemail Manager, such as `greetings@mooncrabsiargao.com` if that is the one that owns the alias. [Spacemail client setup](https://www.spaceship.com/knowledgebase/connect-spacemail-to-email-client/)
3. In the Mooncrab Vercel project, open **Settings → Environment Variables**. Add `SMTP_USER` and `SMTP_PASSWORD` as **Production Secrets**. Add `SMTP_SENDER_VERIFIED=true` after verifying the sender in step 1. Confirm the Production values already in place for `SMTP_HOST=mail.spacemail.com`, `SMTP_PORT=465`, and `SMTP_FROM=bookings@mooncrabsiargao.com`. Enter credentials directly in Vercel. Redeploy the latest Production deployment from **Deployments** so the runtime loads the new variables. [Mooncrab environment variables](https://vercel.com/james-64e0/mooncrab/settings/environment-variables)
4. Sign in to **Notification Settings**. Review **Owner alert recipients** and enter the addresses that should receive booking alerts. Use **Save notification settings**, then **Send test notification**. Check the timestamped result and look for **Moon Crab booking notification test** in the recipient’s Inbox or Spam. SMTP acceptance records the provider response. Finding the message in the inbox verifies delivery. [Notification Settings](https://mooncrabsiargao.com/admin/settings/notifications)
5. After the test arrives, tick **Enable owner booking alerts** and click **Save notification settings**. To remove an address, delete it from the list and save. Disable alerts to save an empty list. The scheduled email job can process queued historical messages after activation. Use **Process queued emails** in **Calendar & email connections** to process eligible queued messages immediately.
6. For an end-to-end test, choose available dates on the booking page and give the request your own email and phone. Mark the name or notes **TEST — email verification**. Click **Request this stay** once. In **Admin → Bookings**, confirm that a pending request exists with the same reference. Check that the owner notification arrived from `bookings@mooncrabsiargao.com` and that **View booking in admin dashboard** opens the matching record after sign-in. Verify that each saved address received one owner message and that the guest received an acknowledgment. Use **Decline request** on the marked test record so it stays identifiable and does not reserve the room. [Booking page](https://mooncrabsiargao.com/booking) · [Admin](https://mooncrabsiargao.com/admin)

For a controlled delivery check, a signed-in owner or bearer-key client can use the notification test API with the chosen workflow and a `testRecipients` list. It sends the synthetic preview to those inboxes once and leaves saved owner alert recipients in place. The same one-minute rate limit applies.

If **Send test notification** stays disabled, check the saved addresses and the connection message. If Spacemail rejects authentication, check the primary mailbox username and its password and redeploy after editing the variables. If it rejects the sender, verify the alias is assigned to that same mailbox. If the provider accepted a message that is hard to find, check Spam, quarantine, and the recipient address. For a definite failure, use the failed job’s retry control after correcting the cause. For an unknown result, check the mailbox before retrying to avoid duplicates.

## Owner controls and reliability

Open **Email Automations → Owner booking alert** at `/admin/email-automations` or **Notification Settings** to see and edit the same recipient list. Enter up to 10 email addresses. The test button sends a separate message to each saved address and records the provider responses and timestamp. Owner jobs wait in the existing outbox until notifications are enabled and SMTP is configured. You can process saved jobs from the dashboard. Guest acknowledgments remain scheduled separately.

`GET /api/admin/email-outbox` requires an owner session or the existing private bearer key. It returns SMTP readiness, blocked reasons, the most recent 50 retained job summaries, and counts for those summaries. The authenticated per-booking lookup additionally returns the confirmation recipient and the latest sending and acceptance timestamps.

`POST /api/admin/email-outbox` accepts `{ "action": "drain" }` to process up to four queued jobs. A request handler also attempts both newly stored jobs immediately when SMTP is configured. An optional scheduled `GET /api/admin/email-outbox?drain=1` requires `Authorization: Bearer <CRON_SECRET>`. Without a configured schedule, the owner can drain the durable queue from the dashboard; this is not a continuously running worker.

Each job has a stable booking/kind ID, atomic Redis claim, and up to three attempts per submission. **Resend Confirmation** deliberately starts a new submission after a previous confirmation was accepted. Repeated clicks for the same submission are rejected. Each recipient keeps the same Message-ID across retries. Retrying a failed owner alert skips addresses where Spacemail already accepted the alert. The outbox shows each attempt and its submission state.

- `queued`: saved and awaiting a configured SMTP sender or a drain.
- `sending`: claimed by one execution.
- `accepted`: SMTP accepted the recipient/message; this does **not** prove inbox delivery.
- `failed`: a definite rejection occurred. A protected `{ "action": "retry", "id": "<booking-id>:guest" }` can retry it while below the attempt limit.
- `unknown`: the connection or execution ended with an ambiguous outcome. Expired sending claims also become unknown during the next drain. The app will not resend these automatically. Reconcile with the recipient/provider before any manual follow-up.
- `suppressed`: a queued message became obsolete when the reservation status changed.

SMTP and Redis cannot guarantee exactly-once inbox delivery. An execution may stop after SMTP accepts a message but before Redis records that fact. The app preserves that uncertain state. Email jobs and public requests expire 90 days after checkout. Manual reservation records remain available for historical tracking. Booking records and availability are preserved regardless of SMTP configuration or outcome.

## Business signature in Spacemail Webmail

Booking acknowledgments, confirmations, declines, cancellations, owner notifications, and the dashboard test append the standard HTML and plain-text signatures from `public/email-signature/`. The header and signature reference the same public HTTPS PNG. SMTP sends HTML and plain text without logo attachments. The Moon Crab name and contact links remain readable when remote images are blocked. The signature links to the booking and WhatsApp QR images. Edits made in Spacemail Webmail apply to messages composed there.

Cancelling a confirmed direct stay with a guest email queues a cancellation notice. Manage the workflow under **Email Automations → Booking cancellation**. For Airbnb or Booking.com stays, send any cancellation communication through that platform.

To apply the provided signature to `greetings@mooncrabsiargao.com`:

1. Sign in to that mailbox at [Spacemail Webmail](https://www.spacemail.com/).
2. Open **Settings → Signature → Manage signatures**.
3. Choose **+ New signature**, give it a name, then press Enter.
4. Open the [signature installer](https://mooncrabsiargao.com/email-signature/) and click **Copy signature**. Paste with the original formatting. If clipboard copying is unavailable, open the standalone preview and copy the visible signature. If the editor strips an image, use its image tool and retain the accompanying text links.
5. Use the tick below the editor to select it as the default. Wait for the saved notification.
6. Compose a test message to yourself and check image proportions, links, and QR codes on desktop and mobile. Separate email clients need their own signature configuration; signatures do not synchronize through IMAP.

These steps follow [Spaceship's signature guide](https://www.spaceship.com/en-GB/knowledgebase/create-email-signature-spacemail/). Mailbox signature editing and an actual live SMTP test remain unverified until the owner completes the external setup.
