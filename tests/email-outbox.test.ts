import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAIM_EMAIL_SCRIPT, EMAIL_JOB_PREFIX, EMAIL_OUTBOX_INDEX, EMAIL_PENDING_KEY,
  ENQUEUE_EMAILS_SCRIPT, FINISH_EMAIL_SCRIPT, RETRY_EMAIL_SCRIPT, NOTIFICATION_SETTINGS_KEY,
  createEmailOutboxHandler, drainEmailOutbox, enqueueBookingEmails, processBookingEmails,
  smtpReadiness,
} from '../server/email-outbox.ts';
import type { EmailJob, EmailSender } from '../server/email-outbox.ts';
import { bookingEmail, firstName } from '../server/email-templates.ts';
import type { EmailBooking } from '../server/email-templates.ts';
import type { Environment, RedisCommand } from '../server/availability.ts';

const id = '242c4998-09a4-4876-bd8d-e3bdc5cd1195';
const fixedNow = new Date('2026-11-18T00:00:00Z');
const record: EmailBooking = {
  id, name: 'Ana <script>alert(1)</script>', email: 'ana@example.com', phone: '+639625284264', whatsapp: true,
  room: 'KASAG', checkIn: '2026-12-17', checkOut: '2026-12-24', guests: 2, message: '<img src=x onerror=bad()>',
  status: 'pending', createdAt: fixedNow.toISOString(),
  pricing: { nights: 7, totalPhp: 8000, depositPhp: 4000, roomSubtotalPhp: 8000, extraGuestFeePhp: 0 },
};
const env: Environment = {
  KV_REST_API_URL: 'https://example.invalid', KV_REST_API_TOKEN: 'test', BOOKING_ADMIN_TOKEN: 'test-owner-key',
  SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '465', SMTP_USER: 'owner@example.com', SMTP_PASSWORD: 'test-only',
  SMTP_FROM: 'bookings@mooncrabsiargao.com', SMTP_SENDER_VERIFIED: 'true',
};

/** Redis EVAL operations are atomic in the production store; emulate their state transitions here. */
function store() {
  const values = new Map<string, string>();
  const indexes = new Map<string, Map<string, number>>();
  const index = (key: string) => { if (!indexes.has(key)) indexes.set(key, new Map()); return indexes.get(key)!; };
  let failFinish = false;
  const command: RedisCommand = async args => {
    if (args[0] === 'GET') {
      if (args[1] === NOTIFICATION_SETTINGS_KEY) return JSON.stringify({enabled:true,recipient:'greetings@mooncrabsiargao.com'});
      return values.get(String(args[1])) ?? null;
    }
    if (args[0] === 'ZRANGE' || args[0] === 'ZREVRANGE') {
      const rows = [...index(String(args[1]))].sort((a, b) => a[1] - b[1]);
      if (args[0] === 'ZREVRANGE') rows.reverse();
      return rows.slice(Number(args[2]), Number(args[3]) + 1).map(([key]) => key);
    }
    assert.equal(args[0], 'EVAL');
    const script = args[1];
    const key = String(args[3]);
    const second = String(args[4]);
    if (script === ENQUEUE_EMAILS_SCRIPT) {
      const jobs = JSON.parse(String(args[5])) as EmailJob[];
      for (const job of jobs) if (!values.has(`${EMAIL_JOB_PREFIX}${job.id}`)) {
        values.set(`${EMAIL_JOB_PREFIX}${job.id}`, JSON.stringify(job)); index(key).set(job.id, Number(args[7])); index(second).set(job.id, Number(args[7]));
      }
      return jobs.length;
    }
    const raw = values.get(key);
    if (!raw) return null;
    const job = JSON.parse(raw) as EmailJob;
    if (script === CLAIM_EMAIL_SCRIPT) {
      if (job.status === 'sending') {
        if (Number(job.attemptStartedAt) + Number(args[8]) < Number(args[6])) {
          job.status = 'unknown'; delete job.claimToken; values.set(key, JSON.stringify(job)); index(second).delete(job.id);
        }
        return null;
      }
      if (job.status !== 'queued' || job.attempts >= Number(args[10])) return null;
      job.status = 'sending'; job.attempts++; job.claimToken = String(args[9]); job.attemptStartedAt = Number(args[6]);
      values.set(key, JSON.stringify(job)); return JSON.stringify(job);
    }
    if (script === FINISH_EMAIL_SCRIPT) {
      if (failFinish) throw new Error('Simulated storage interruption after SMTP');
      if (job.status !== 'sending' || job.claimToken !== args[5]) return 0;
      const updated = JSON.parse(String(args[6])) as EmailJob;
      delete updated.claimToken; values.set(key, JSON.stringify(updated)); index(second).delete(job.id); return 1;
    }
    if (script === RETRY_EMAIL_SCRIPT) {
      if (job.status !== 'failed') return 'unsafe';
      if (job.attempts >= Number(args[7])) return 'limit';
      job.status = 'queued'; values.set(key, JSON.stringify(job)); index(second).set(job.id, Number(args[5])); return 'queued';
    }
    throw new Error('Unexpected Lua script');
  };
  return { command, values, indexes, setFailFinish: (value: boolean) => { failFinish = value; } };
}

function response() {
  return { code: 200, body: undefined as unknown, headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; } };
}

test('guest and owner templates preserve actual quote, escape guest HTML, and distinguish pending from confirmed', () => {
  const guest = bookingEmail(record, 'guest');
  const owner = bookingEmail(record, 'owner');
  assert.equal(firstName('  Ana María Smith '), 'Ana');
  assert.match(guest.html, /Hi Ana,/);
  assert.match(owner.html, /&lt;script&gt;/);
  assert.doesNotMatch(owner.html, /<script>|<img src=x/);
  assert.match(owner.html, /&lt;img src=x onerror=bad\(\)&gt;/);
  assert.match(guest.text, /8,000/);
  assert.match(guest.text, /4,000/);
  assert.match(guest.html, /reservation is not yet confirmed/);
  assert.match(guest.html, /https:\/\/wa\.me\/639625284264\?text=/);
  assert.match(guest.html, /Facebook · open our page/);
  assert.match(guest.text, /Please do not reply/);
  assert.match(owner.html, /href="https:\/\/mooncrabsiargao\.com\/admin#request-/);
  assert.match(owner.text, /Dashboard: https:\/\/mooncrabsiargao\.com\/admin/);
  assert.doesNotMatch(owner.html + owner.text, /admin\.mooncrabsiargao\.com/);
});

test('SMTP remains blocked until an authorized bookings@ sender is explicitly verified', () => {
  assert.equal(smtpReadiness({}).configured, false);
  assert.equal(smtpReadiness({ ...env, SMTP_SENDER_VERIFIED: undefined }).configured, false);
  assert.equal(smtpReadiness({ ...env, SMTP_FROM: 'other@example.com' }).configured, false);
  assert.equal(smtpReadiness({ ...env, SMTP_PORT: '25' }).configured, false);
  assert.equal(smtpReadiness(env).configured, true);
});

test('idempotent enqueue creates exactly two jobs, and missing SMTP never touches the store while processing', async () => {
  const memory = store();
  await enqueueBookingEmails(record, { env, command: memory.command, now: () => fixedNow });
  await enqueueBookingEmails(record, { env, command: memory.command, now: () => fixedNow });
  assert.equal(memory.values.size, 2);
  assert.equal(memory.indexes.get(EMAIL_OUTBOX_INDEX)?.size, 2);
  assert.equal(memory.indexes.get(EMAIL_PENDING_KEY)?.size, 2);
  let reads = 0;
  const state = await processBookingEmails(id, { env: {}, command: async () => { reads++; throw new Error('Must not read'); } });
  assert.deepEqual(state, { guest: 'skipped', owner: 'skipped' });
  assert.equal(reads, 0);
});

test('concurrent drains send each stable job once and report SMTP acceptance, not inbox delivery', async () => {
  const memory = store();
  await enqueueBookingEmails(record, { env, command: memory.command, now: () => fixedNow });
  const sent: Array<Parameters<EmailSender>[0]> = [];
  const send: EmailSender = async message => { sent.push(message); await Promise.resolve(); return { accepted: [message.to], messageId: message.messageId }; };
  await Promise.all([processBookingEmails(id, { env, command: memory.command, send, now: () => fixedNow }), processBookingEmails(id, { env, command: memory.command, send, now: () => fixedNow })]);
  assert.equal(sent.length, 2);
  assert.deepEqual(new Set(sent.map(message => message.to)), new Set(['ana@example.com', 'greetings@mooncrabsiargao.com']));
  assert.ok(sent.every(message => message.from.endsWith('<bookings@mooncrabsiargao.com>')));
  for (const raw of memory.values.values()) assert.equal((JSON.parse(raw) as EmailJob).status, 'accepted');
  await processBookingEmails(id, { env, command: memory.command, send, now: () => fixedNow });
  assert.equal(sent.length, 2);
});

test('ambiguous SMTP outcome becomes unknown and is protected from resend', async () => {
  const memory = store();
  await enqueueBookingEmails(record, { env, command: memory.command, now: () => fixedNow });
  let attempts = 0;
  const send: EmailSender = async () => { attempts++; throw Object.assign(new Error('Lost connection'), { code: 'ETIMEDOUT', command: 'DATA' }); };
  await processBookingEmails(id, { env, command: memory.command, send, now: () => fixedNow });
  await processBookingEmails(id, { env, command: memory.command, send, now: () => fixedNow });
  assert.equal(attempts, 2);
  for (const raw of memory.values.values()) assert.equal((JSON.parse(raw) as EmailJob).status, 'unknown');
  const handler = createEmailOutboxHandler({ env, command: memory.command, send, now: () => fixedNow });
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer test-owner-key', 'content-type': 'application/json' }, body: { action: 'retry', id: `${id}:guest` } }, res);
  assert.equal(res.code, 409);
  assert.equal(attempts, 2);
});

test('interruption after SMTP acceptance expires to unknown instead of sending twice', async () => {
  const memory = store();
  await enqueueBookingEmails(record, { env, command: memory.command, now: () => fixedNow });
  let attempts = 0;
  const send: EmailSender = async message => { attempts++; return { accepted: [message.to] }; };
  memory.setFailFinish(true);
  await assert.rejects(processBookingEmails(id, { env, command: memory.command, send, now: () => fixedNow }));
  memory.setFailFinish(false);
  const later = new Date(fixedNow.getTime() + 100_000);
  await drainEmailOutbox({ env, command: memory.command, send, now: () => later });
  assert.equal(attempts, 2); // first guest attempt + independently queued owner attempt
  const guest = JSON.parse(memory.values.get(`${EMAIL_JOB_PREFIX}${id}:guest`)!) as EmailJob;
  assert.equal(guest.status, 'unknown');
});

test('only definite failed messages can be retried by an authenticated owner', async () => {
  const memory = store();
  await enqueueBookingEmails(record, { env, command: memory.command, now: () => fixedNow });
  const failed: EmailSender = async () => { throw Object.assign(new Error('Rejected'), { responseCode: 550, command: 'RCPT TO' }); };
  await processBookingEmails(id, { env, command: memory.command, send: failed, now: () => fixedNow });
  let sent = 0;
  const handler = createEmailOutboxHandler({ env, command: memory.command, now: () => fixedNow, send: async message => { sent++; return { accepted: [message.to] }; } });
  const unauthorized = response();
  await handler({ method: 'GET', headers: {} }, unauthorized);
  assert.equal(unauthorized.code, 401);
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer test-owner-key', 'content-type': 'application/json' }, body: { action: 'retry', id: `${id}:guest` } }, res);
  assert.equal(res.code, 200);
  assert.equal(sent, 1);
  assert.equal((JSON.parse(memory.values.get(`${EMAIL_JOB_PREFIX}${id}:guest`)!) as EmailJob).attempts, 2);
  const status = response();
  await handler({ method: 'GET', headers: { authorization: 'Bearer test-owner-key' } }, status);
  assert.equal(status.code, 200);
  const body = status.body as { jobs: Array<Record<string, unknown>>; note: string };
  assert.ok(body.jobs.every(job => !('booking' in job) && !('email' in job) && !('claimToken' in job)));
  assert.match(body.note, /not delivered/);
});

test('notification settings start empty and a test sends only to the saved recipient', async () => {
  const values = new Map<string, string>();
  const messages: Array<Parameters<EmailSender>[0]> = [];
  const command: RedisCommand = async ([operation, key, value]) => {
    if (operation === 'GET') return values.get(String(key)) ?? null;
    if (operation === 'SET') { values.set(String(key), String(value)); return 'OK'; }
    throw new Error('Unexpected command');
  };
  const handler = createEmailOutboxHandler({
    env, command, now: () => fixedNow,
    send: async message => { messages.push(message); return { accepted: [message.to] }; },
  });
  const headers = { authorization: 'Bearer test-owner-key', host: 'mooncrabsiargao.com', origin: 'https://mooncrabsiargao.com', 'content-type': 'application/json' };
  const query = { settings: '1' };
  const empty = response();
  await handler({ method: 'GET', headers, query }, empty);
  assert.equal((empty.body as { recipient: string }).recipient, '');
  const noRecipient = response();
  await handler({ method: 'POST', headers, query, body: { action: 'test' } }, noRecipient);
  assert.equal(noRecipient.code, 409);
  const saved = response();
  await handler({ method: 'POST', headers, query, body: { action: 'save', settings: { recipient: 'owner@example.com', enabled: true } } }, saved);
  assert.equal(saved.code, 200);
  assert.equal(messages.length, 0);
  const tested = response();
  await handler({ method: 'POST', headers, query, body: { action: 'test', to: 'other@example.com' } }, tested);
  assert.equal(tested.code, 200);
  assert.equal((tested.body as { lastTest: { status: string } }).lastTest.status, 'accepted');
  assert.deepEqual(messages.map(message => message.to), ['owner@example.com']);
  assert.equal(messages[0].from, 'Moon Crab Bookings <bookings@mooncrabsiargao.com>');
});
