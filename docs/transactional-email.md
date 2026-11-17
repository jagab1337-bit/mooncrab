# Mooncrab booking email

The booking creation transaction stores the pending request and two email jobs together in the existing Redis database. One job acknowledges the guest; the other notifies the configured owner notification address (initially `greetings@mooncrabsiargao.com`). No email is generated for a request that failed validation or persistence. The stored server-calculated quote is used in both messages.

The application sends through SMTP as **Moon Crab Siargao <bookings@mooncrabsiargao.com>**. It does not use a different sender when that alias is unavailable. The connected Spacemail tool can send from its current mailbox, but does not provide the sender/HTML/server-runtime configuration required for this automation or mailbox-signature management.

## Required production configuration

Set these variables privately in Vercel; do not put their values in source control, public variables, chat, or logs:

| Variable | Purpose |
| --- | --- |
| `SMTP_HOST` | Spacemail outgoing server; official documentation currently lists `mail.spacemail.com` |
| `SMTP_PORT` | `465` for Spacemail SSL/TLS; the code also supports `587` with required STARTTLS when the provider explicitly supports it |
| `SMTP_USER` | Full address of the actual mailbox that owns the sender alias; aliases cannot be used to log in |
| `SMTP_PASSWORD` | Password for that mailbox |
| `SMTP_FROM` | Exactly `bookings@mooncrabsiargao.com` |
| `SMTP_SENDER_VERIFIED` | Set to `true` only after verifying the alias exists and is authorized to send through that mailbox |
| `CRON_SECRET` | Optional strong secret for an authenticated scheduled drain |

TLS certificate validation remains enabled. The app uses the existing `KV_REST_API_URL` / `KV_REST_API_TOKEN` or direct Upstash equivalents for the durable outbox.

In Spacemail Manager, locate the mailbox, choose its three-dot menu, and use **Set aliases** to inspect or create `bookings`. Inspect **IMAP/POP3/SMTP** settings for that mailbox and ensure access is enabled. An alias can send/receive but has no separate login. Verify alias sending in Spacemail and then in the application with a deliberate test addressed to the owner before enabling guest traffic. Check actual recipient receipt and headers; SMTP acceptance alone is not delivery verification.

Sources checked November 18, 2026: [Spacemail client settings](https://www.spaceship.com/knowledgebase/connect-spacemail-to-email-client/) and [Spacemail aliases](https://www.spaceship.com/en-GB/knowledgebase/setup-email-aliases-spacemail/).

## Owner controls and reliability

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

The original reusable signature package remains under `public/email-signature/`. Application messages use a compact matching HTML contact component in `server/email-templates.ts`, with real text and a plain-text fallback. This does not change the mailbox's own signature.

To apply the provided signature to `greetings@mooncrabsiargao.com`:

1. Sign in to that mailbox at [Spacemail Webmail](https://www.spacemail.com/).
2. Open **Settings → Signature → Manage signatures**.
3. Choose **+ New signature**, give it a name, then press Enter.
4. Open the delivered rendered signature HTML, select/copy its rendered table, and paste it into the signature editor. Do not paste raw HTML source into a visual editor. If the client strips an image, insert the supplied logo/QR image through its image tool and retain the accompanying text links.
5. Use the tick below the editor to select it as the default. Wait for the saved notification.
6. Compose a test message to yourself and check image proportions, links, and QR codes on desktop and mobile. Separate email clients need their own signature configuration; signatures do not synchronize through IMAP.

These steps follow [Spaceship's signature guide](https://www.spaceship.com/en-GB/knowledgebase/create-email-signature-spacemail/). Mailbox signature editing and an actual live SMTP test remain unverified until the owner completes the external setup.
