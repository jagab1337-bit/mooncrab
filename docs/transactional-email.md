# Mooncrab booking email

The booking creation transaction stores the pending request and two email jobs together in the existing Redis database. One job acknowledges the guest; the other notifies the configured owner notification address. No email is generated for a request that failed validation or persistence. The stored server-calculated quote is used in both messages.

Owner notifications use **Moon Crab Bookings <bookings@mooncrabsiargao.com>**. Guest acknowledgments use the same address with the Moon Crab Siargao display name. It does not use a different sender when that alias is unavailable. The connected Spacemail tool can send from its current mailbox, but does not provide the sender/HTML/server-runtime configuration required for this automation or mailbox-signature management.

## Activate booking notifications

On November 19, 2026, Vercel Production had the host, port, and sender address. The admin page had a saved recipient with owner notifications disabled. The provider test had no recorded result. The authorized mailbox login and alias permission require access to the Spaceship account.

1. In Spaceship, open **Launchpad → Spacemail Manager**. Find the mailbox that should send the notifications. Click the three dots next to it, then **Set aliases**. Verify that `bookings@mooncrabsiargao.com` is assigned to that mailbox. From its Spacemail webmail, send a message from that alias to an inbox you control and confirm the From address on receipt. [Spaceship alias guide](https://www.spaceship.com/en-GB/knowledgebase/setup-email-aliases-spacemail/)
2. On the mailbox’s three-dot menu, open **IMAP/POP3/SMTP**. Spaceship lists `mail.spacemail.com`, port `465`, with SSL/TLS for outgoing mail. SMTP authenticates using the full primary mailbox address and its mailbox password. Use the address assigned to the mailbox in Spacemail Manager, such as `greetings@mooncrabsiargao.com` if that is the one that owns the alias. [Spacemail client setup](https://www.spaceship.com/knowledgebase/connect-spacemail-to-email-client/)
3. In the Mooncrab Vercel project, open **Settings → Environment Variables**. Add `SMTP_USER` and `SMTP_PASSWORD` as **Production Secrets**. Add `SMTP_SENDER_VERIFIED=true` after verifying the sender in step 1. Confirm the Production values already in place for `SMTP_HOST=mail.spacemail.com`, `SMTP_PORT=465`, and `SMTP_FROM=bookings@mooncrabsiargao.com`. Enter credentials directly in Vercel. Redeploy the latest Production deployment from **Deployments** so the runtime loads the new variables. [Mooncrab environment variables](https://vercel.com/james-64e0/mooncrab/settings/environment-variables)
4. Sign in to **Notification Settings**. Verify the saved **Recipient email** or replace it with the inbox that should receive owner notifications. Use **Save notification settings**, then **Send test notification**. Check the timestamped result and look for **Moon Crab booking notification test** in the recipient’s Inbox or Spam. SMTP acceptance records the provider response. Finding the message in the inbox verifies delivery. [Notification Settings](https://mooncrabsiargao.com/admin/settings/notifications)
5. After the test arrives, tick **Enable owner notifications** and click **Save notification settings**. To remove the recipient later, untick it, clear the email, and save. The scheduled email job can process queued historical messages after activation. Use **Process queued emails** in **Calendar & email connections** to process eligible queued messages immediately.
6. For an end-to-end test, choose available dates on the booking page and give the request your own email and phone. Mark the name or notes **TEST — email verification**. Click **Request this stay** once. In **Admin → Bookings**, confirm that a pending request exists with the same reference. Check that the owner notification arrived from `bookings@mooncrabsiargao.com` and that **View booking in admin dashboard** opens the matching record after sign-in. Verify that one owner message and a separate guest acknowledgment were received. Use **Decline request** on the marked test record so it stays identifiable and does not reserve the room. [Booking page](https://mooncrabsiargao.com/booking) · [Admin](https://mooncrabsiargao.com/admin)

If **Send test notification** stays disabled, check the saved recipient and the connection message. If Spacemail rejects authentication, check the primary mailbox username and its password and redeploy after editing the variables. If it rejects the sender, verify the alias is assigned to that same mailbox. If the provider accepted a message that is hard to find, check Spam, quarantine, and the recipient address. For a definite failure, use the failed job’s retry control after correcting the cause. For an unknown result, check the mailbox before retrying to avoid duplicates.

## Owner controls and reliability

Open **Notification Settings** at `/admin/settings/notifications`. Enter the address that should receive new booking inquiries and enable notifications. An empty recipient is valid while notifications are disabled. The test button sends only to the saved recipient and records the provider response and timestamp. Owner jobs wait in the existing outbox until notifications are enabled and SMTP is configured. You can process saved jobs from the dashboard. Guest acknowledgments remain scheduled separately.

`GET /api/admin/email-outbox` requires an owner session or the existing private bearer key. It returns SMTP readiness, blocked reasons, the most recent 50 retained job summaries, and counts for those summaries. It does not expose SMTP credentials, guest email bodies, or recipient addresses.

`POST /api/admin/email-outbox` accepts `{ "action": "drain" }` to process up to four queued jobs. A request handler also attempts both newly stored jobs immediately when SMTP is configured. An optional scheduled `GET /api/admin/email-outbox?drain=1` requires `Authorization: Bearer <CRON_SECRET>`. Without a configured schedule, the owner can drain the durable queue from the dashboard; this is not a continuously running worker.

Each job has a stable booking/kind ID, stable Message-ID, atomic Redis claim, and a maximum of three deliberate attempts. States:

- `queued`: saved and awaiting a configured SMTP sender or a drain.
- `sending`: claimed by one execution.
- `accepted`: SMTP accepted the recipient/message; this does **not** prove inbox delivery.
- `failed`: a definite rejection occurred. A protected `{ "action": "retry", "id": "<booking-id>:guest" }` can retry it while below the attempt limit.
- `unknown`: the connection or execution ended with an ambiguous outcome. Expired sending claims also become unknown during the next drain. The app will not resend these automatically. Reconcile with the recipient/provider before any manual follow-up.

SMTP and Redis cannot guarantee exactly-once inbox delivery. In particular, an execution may stop after SMTP accepts a message but before Redis records that fact. The app preserves the uncertain state rather than risk an automatic duplicate. Jobs expire with the booking record, 90 days after checkout. Booking records and availability are preserved regardless of SMTP configuration or outcome.

## Business signature in Spacemail Webmail

Booking acknowledgments, owner notifications, and the dashboard test append the standard HTML and plain-text signatures from `public/email-signature/`. The HTML includes the logo and the booking and WhatsApp QR codes. The website and the Spacemail copy tool use the same source files. Edits made in Spacemail Webmail apply to messages composed there.

To apply the provided signature to `greetings@mooncrabsiargao.com`:

1. Sign in to that mailbox at [Spacemail Webmail](https://www.spacemail.com/).
2. Open **Settings → Signature → Manage signatures**.
3. Choose **+ New signature**, give it a name, then press Enter.
4. Open the delivered rendered signature HTML, select/copy its rendered table, and paste it into the signature editor. Do not paste raw HTML source into a visual editor. If the client strips an image, insert the supplied logo/QR image through its image tool and retain the accompanying text links.
5. Use the tick below the editor to select it as the default. Wait for the saved notification.
6. Compose a test message to yourself and check image proportions, links, and QR codes on desktop and mobile. Separate email clients need their own signature configuration; signatures do not synchronize through IMAP.

These steps follow [Spaceship's signature guide](https://www.spaceship.com/en-GB/knowledgebase/create-email-signature-spacemail/). Mailbox signature editing and an actual live SMTP test remain unverified until the owner completes the external setup.
