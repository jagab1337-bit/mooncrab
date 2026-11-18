import { randomUUID, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { authorizeAdmin, sameOrigin } from './admin-auth.ts';
import { configured, createRedisCommand, setHeaders, unavailable } from './availability.ts';
import type { ApiRequest, ApiResponse, Environment, HandlerOptions, RedisCommand } from './availability.ts';
import { bookingEmail, EMAIL_CONTACTS } from './email-templates.ts';
import type { EmailBooking } from './email-templates.ts';
import { readBusinessSettings } from './business-settings.ts';

export const EMAIL_JOB_PREFIX = 'mooncrab:email-job:';
export const EMAIL_OUTBOX_INDEX = 'mooncrab:email-outbox';
export const EMAIL_PENDING_KEY = 'mooncrab:email-pending';
export const NOTIFICATION_SETTINGS_KEY = 'mooncrab:notification-settings';
const NOTIFICATION_TEST_KEY = 'mooncrab:notification-test';
type NotificationSettings = { enabled: boolean; recipient: string };

function validNotificationSettings(value: unknown): value is NotificationSettings {
  if (!value || typeof value !== 'object') return false;
  const { enabled, recipient } = value as NotificationSettings;
  return typeof enabled === 'boolean' && typeof recipient === 'string' && recipient.length <= 254
    && (recipient === '' ? !enabled : /^[^\s@<>(),;:"\\]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(recipient));
}

async function readNotificationSettings(command: RedisCommand): Promise<NotificationSettings> {
  const raw = await command(['GET', NOTIFICATION_SETTINGS_KEY]);
  if (raw === null) return { enabled: false, recipient: '' };
  const data: unknown = typeof raw === 'string' ? JSON.parse(raw) : null;
  if (!validNotificationSettings(data)) throw new Error('Invalid notification settings');
  return data;
}

const MAX_ATTEMPTS = 3;
const CLAIM_MILLISECONDS = 90_000;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:(guest|owner)$/i;

export type EmailState = 'queued' | 'sending' | 'accepted' | 'failed' | 'unknown';
export interface EmailJob {
  id: string; bookingId: string; kind: 'guest' | 'owner'; booking: EmailBooking;
  status: EmailState; attempts: number; createdAt: string; updatedAt: string;
  expiresAtUnix: number; claimToken?: string; attemptStartedAt?: number;
  acceptedAt?: string; messageId?: string; lastError?: string;
}
export interface EmailOptions extends HandlerOptions { send?: EmailSender }
export type EmailSender = (message: { from: string; to: string; subject: string; html: string; text: string; messageId: string }) => Promise<{ accepted: unknown[]; rejected?: unknown[]; messageId?: string }>;

export function prepareBookingEmailJobs(booking: EmailBooking, now = new Date()): EmailJob[] {
  const timestamp = now.toISOString();
  const expiresAtUnix = Math.floor(Date.parse(`${booking.checkOut}T00:00:00+08:00`) / 1000) + 90 * 86_400;
  return (['guest', 'owner'] as const).map(kind => ({
    id: `${booking.id}:${kind}`, bookingId: booking.id, kind, booking,
    status: 'queued', attempts: 0, createdAt: timestamp, updatedAt: timestamp, expiresAtUnix,
  }));
}

/** The same job payloads can be included in the booking creation Lua transaction. */
export const ENQUEUE_EMAILS_SCRIPT = `
local jobs = cjson.decode(ARGV[1])
for i, job in ipairs(jobs) do
  local key = ARGV[2] .. job.id
  if redis.call('SET', key, cjson.encode(job), 'NX') then
    redis.call('EXPIREAT', key, job.expiresAtUnix)
    redis.call('ZADD', KEYS[1], ARGV[3], job.id)
    redis.call('ZADD', KEYS[2], ARGV[3], job.id)
  end
end
return #jobs
`;

export const CLAIM_EMAIL_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then redis.call('ZREM', KEYS[2], ARGV[1]); return nil end
local job = cjson.decode(raw)
if job.status == 'sending' then
  if tonumber(job.attemptStartedAt or 0) + tonumber(ARGV[4]) < tonumber(ARGV[2]) then
    job.status = 'unknown'; job.lastError = 'A previous send attempt ended without a recorded outcome. Check the mailbox before taking further action.'
    job.updatedAt = ARGV[3]; job.claimToken = nil
    redis.call('SET', KEYS[1], cjson.encode(job)); redis.call('EXPIREAT', KEYS[1], job.expiresAtUnix)
    redis.call('ZREM', KEYS[2], ARGV[1])
  end
  return nil
end
if job.status ~= 'queued' or tonumber(job.attempts) >= tonumber(ARGV[6]) then return nil end
job.status = 'sending'; job.attempts = job.attempts + 1; job.claimToken = ARGV[5]
job.attemptStartedAt = tonumber(ARGV[2]); job.updatedAt = ARGV[3]
redis.call('SET', KEYS[1], cjson.encode(job)); redis.call('EXPIREAT', KEYS[1], job.expiresAtUnix)
return cjson.encode(job)
`;

export const FINISH_EMAIL_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
if current.status ~= 'sending' or current.claimToken ~= ARGV[1] then return 0 end
local job = cjson.decode(ARGV[2]); job.claimToken = nil
redis.call('SET', KEYS[1], cjson.encode(job)); redis.call('EXPIREAT', KEYS[1], job.expiresAtUnix)
redis.call('ZREM', KEYS[2], job.id)
return 1
`;

export const RETRY_EMAIL_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'not_found' end
local job = cjson.decode(raw)
if job.status ~= 'failed' then return 'unsafe' end
if tonumber(job.attempts) >= tonumber(ARGV[3]) then return 'limit' end
job.status = 'queued'; job.updatedAt = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(job)); redis.call('EXPIREAT', KEYS[1], job.expiresAtUnix)
redis.call('ZADD', KEYS[2], ARGV[1], job.id)
return 'queued'
`;

export function smtpReadiness(env: Environment): { configured: boolean; reason: string | null } {
  const missing = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'].filter(key => !env[key]?.trim());
  if (missing.length) return { configured: false, reason: `Add these Vercel Production variables and redeploy: ${missing.join(', ')}.` };
  if (!['465', '587'].includes(env.SMTP_PORT ?? '')) return { configured: false, reason: 'SMTP_PORT must use TLS port 465 or STARTTLS port 587.' };
  if (env.SMTP_FROM?.toLowerCase() !== EMAIL_CONTACTS.bookings) {
    return { configured: false, reason: 'Set SMTP_FROM to bookings@mooncrabsiargao.com in Vercel Production and redeploy.' };
  }
  if (env.SMTP_SENDER_VERIFIED !== 'true') {
    return { configured: false, reason: 'Verify that the authenticated Spacemail mailbox can send as bookings@mooncrabsiargao.com, then set SMTP_SENDER_VERIFIED=true in Vercel Production and redeploy.' };
  }
  return { configured: true, reason: null };
}

function smtpSender(env: Environment): EmailSender {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT), secure: env.SMTP_PORT === '465',
    requireTLS: true, auth: { user: env.SMTP_USER!, pass: env.SMTP_PASSWORD! },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
  });
  return async message => {
    const info = await transport.sendMail(message);
    return { accepted: info.accepted || [], rejected: info.rejected || [], messageId: info.messageId };
  };
}

function safeJob(value: unknown): EmailJob {
  if (typeof value !== 'string') throw new Error('Invalid outbox record');
  const job = JSON.parse(value) as EmailJob;
  if (!job || !JOB_ID.test(job.id) || job.id !== `${job.bookingId}:${job.kind}` || !['guest', 'owner'].includes(job.kind) || !['queued', 'sending', 'accepted', 'failed', 'unknown'].includes(job.status)
    || typeof job.attempts !== 'number' || !job.booking || job.booking.id !== job.bookingId || typeof job.booking.email !== 'string'
    || typeof job.expiresAtUnix !== 'number') throw new Error('Invalid outbox record');
  return job;
}

function definiteFailure(error: unknown): boolean {
  // Errors after DATA, an interrupted connection, or a timeout can have ambiguous outcomes.
  // Only a rejected SMTP response / pre-DATA failure is safe for a controlled retry.
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: string; command?: string; responseCode?: number };
  if (typeof value.responseCode === 'number' && value.responseCode >= 400 && value.responseCode <= 599) return true;
  return ['CONN', 'EHLO', 'HELO', 'STARTTLS', 'AUTH', 'MAIL FROM', 'RCPT TO'].includes(value.command || '') && value.code !== 'ETIMEDOUT';
}

async function processJob(id: string, options: EmailOptions): Promise<EmailState | 'skipped'> {
  const env = options.env ?? process.env;
  if (!smtpReadiness(env).configured) return 'skipped';
  const command = options.command ?? createRedisCommand(env);
  const now = options.now ?? (() => new Date());
  const isOwner = id.endsWith(':owner');
  const notification = isOwner ? await readNotificationSettings(command) : null;
  if (notification && !notification.enabled) return 'skipped';
  const settings = await readBusinessSettings(command);
  const started = now();
  const token = randomUUID();
  const raw = await command(['EVAL', CLAIM_EMAIL_SCRIPT, 2, `${EMAIL_JOB_PREFIX}${id}`, EMAIL_PENDING_KEY, id, started.getTime(), started.toISOString(), CLAIM_MILLISECONDS, token, MAX_ATTEMPTS]);
  if (raw === null) return 'skipped';
  const job = safeJob(raw);
  const recipient = notification?.recipient ?? job.booking.email;
  const message = bookingEmail(job.booking, job.kind, {
    ...EMAIL_CONTACTS, phone: settings.contacts.phone, whatsapp: settings.contacts.whatsappUrl,
    facebook: settings.contacts.facebookUrl, instagram: settings.contacts.instagramUrl,
    greetings: settings.contacts.email,
  });
  try {
    const result = await (options.send ?? smtpSender(env))({
      from: `${isOwner ? 'Moon Crab Bookings' : 'Moon Crab Siargao'} <${EMAIL_CONTACTS.bookings}>`, to: recipient,
      ...message, messageId: `<${job.id.replace(':', '.')}@mooncrabsiargao.com>`,
    });
    if (!result.accepted.length || result.rejected?.length) {
      job.status = 'failed'; job.lastError = 'The SMTP server did not accept this recipient. Review the recipient and retry deliberately.';
    } else {
      job.status = 'accepted'; job.acceptedAt = now().toISOString(); job.messageId = result.messageId;
      delete job.lastError;
    }
  } catch (error) {
    job.status = definiteFailure(error) ? 'failed' : 'unknown';
    job.lastError = job.status === 'failed' ? 'SMTP rejected the attempt before acceptance. Check configuration or recipient before retrying.' : 'The send outcome is uncertain. Check the mailbox before sending another message; this job will not retry automatically.';
  }
  job.updatedAt = now().toISOString();
  await command(['EVAL', FINISH_EMAIL_SCRIPT, 2, `${EMAIL_JOB_PREFIX}${id}`, EMAIL_PENDING_KEY, token, JSON.stringify(job)]);
  return job.status;
}

export async function enqueueBookingEmails(booking: EmailBooking, options: EmailOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const command = options.command ?? createRedisCommand(env);
  const now = (options.now ?? (() => new Date()))();
  const jobs = prepareBookingEmailJobs(booking, now);
  await command(['EVAL', ENQUEUE_EMAILS_SCRIPT, 2, EMAIL_OUTBOX_INDEX, EMAIL_PENDING_KEY, JSON.stringify(jobs), EMAIL_JOB_PREFIX, now.getTime()]);
}

/** Called after atomic booking/outbox persistence; each attempt has a durable claim. */
export async function processBookingEmails(bookingId: string, options: EmailOptions = {}): Promise<{ guest: string; owner: string }> {
  const guest = await processJob(`${bookingId}:guest`, options);
  const owner = await processJob(`${bookingId}:owner`, options);
  return { guest, owner };
}

export async function drainEmailOutbox(options: EmailOptions = {}, limit = 4): Promise<{ attempted: number; states: string[]; blockedReason: string | null }> {
  const env = options.env ?? process.env;
  const readiness = smtpReadiness(env);
  if (!readiness.configured) return { attempted: 0, states: [], blockedReason: readiness.reason };
  const command = options.command ?? createRedisCommand(env);
  const ids = await command(['ZRANGE', EMAIL_PENDING_KEY, 0, Math.min(Math.max(limit, 1), 10) - 1]);
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !JOB_ID.test(id))) throw new Error('Invalid outbox index');
  const states = [];
  for (const id of ids) states.push(await processJob(id, options));
  return { attempted: states.filter(state => state !== 'skipped').length, states, blockedReason: null };
}

function cronAuthorized(req: ApiRequest, env: Environment): boolean {
  const header = req.headers.authorization;
  if (!env.CRON_SECRET || typeof header !== 'string') return false;
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function createEmailOutboxHandler(options: EmailOptions = {}) {
  const env = options.env ?? process.env;
  const command = options.command ?? createRedisCommand(env);
  return async (req: ApiRequest, res: ApiResponse): Promise<void> => {
    setHeaders(res);
    if (!['GET', 'POST'].includes(req.method || '')) { res.setHeader('Allow', 'GET, POST'); res.status(405).json({ error: 'Method not allowed.' }); return; }
    const cron = req.method === 'GET' && req.query?.drain === '1' && cronAuthorized(req, env);
    if (!cron && !await authorizeAdmin(req, env, command)) { res.status(401).json({ error: 'Unauthorized.' }); return; }
    if (!configured(env)) { unavailable(res); return; }
    try {
      if (cron) { res.status(200).json(await drainEmailOutbox({ ...options, env, command })); return; }
      if (req.query?.settings === '1') {
        const smtp = smtpReadiness(env);
        let settings = await readNotificationSettings(command);
        if (req.method === 'POST') {
          if (!sameOrigin(req)) { res.status(403).json({ error: 'Use the administrator portal for notification settings.' }); return; }
          const contentType = req.headers['content-type'];
          if (typeof contentType !== 'string' || contentType.split(';')[0] !== 'application/json') {
            res.status(415).json({ error: 'Send an application/json request.' }); return;
          }
          const body = req.body as { action?: unknown; settings?: unknown } | undefined;
          if (body?.action === 'save') {
            if (!validNotificationSettings(body.settings)) { res.status(400).json({ error: 'Enter a valid recipient email or disable notifications and clear the address.' }); return; }
            settings = { enabled: body.settings.enabled, recipient: body.settings.recipient };
            await command(['SET', NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings)]);
          } else if (body?.action === 'test') {
            if (!settings.recipient || !smtp.configured) { res.status(409).json({ error: smtp.reason || 'Save a recipient address first.' }); return; }
            const claim = await command(['SET', 'mooncrab:notification-test-lock', '1', 'NX', 'EX', 60]);
            if (claim !== 'OK') { res.status(429).json({ error: 'Wait one minute before sending another test.' }); return; }
            const id = randomUUID();
            let status = 'unknown';
            try {
              const result = await (options.send ?? smtpSender(env))({
                from: `Moon Crab Bookings <${EMAIL_CONTACTS.bookings}>`, to: settings.recipient,
                subject: 'Moon Crab booking notification test',
                text: 'This test was sent from your Moon Crab notification settings.',
                html: '<p>This test was sent from your Moon Crab notification settings.</p>',
                messageId: `<test.${id}@mooncrabsiargao.com>`,
              });
              status = result.accepted.length && !result.rejected?.length ? 'accepted' : 'failed';
            } catch (error) {
              if (definiteFailure(error)) status = 'failed';
            }
            await command(['SET', NOTIFICATION_TEST_KEY, JSON.stringify({ status, at: (options.now ?? (() => new Date()))().toISOString() })]);
          } else { res.status(400).json({ error: 'Choose save or test.' }); return; }
        }
        const lastTest = await command(['GET', NOTIFICATION_TEST_KEY]);
        res.status(200).json({ ...settings, smtp, lastTest: typeof lastTest === 'string' ? JSON.parse(lastTest) : null }); return;
      }
      if (req.method === 'GET') {
        const lookup = req.query?.bookings;
        let rows: unknown[];
        if (lookup !== undefined) {
          const ids = typeof lookup === 'string' ? [...new Set(lookup.split(',').map(id => id + ':owner'))] : [];
          if (!ids.length || ids.length > 50 || ids.some(id => !JOB_ID.test(id))) {
            res.status(400).json({ error: 'Provide up to 50 booking identifiers.' }); return;
          }
          const found = await command(['MGET', ...ids.map(id => EMAIL_JOB_PREFIX + id)]);
          if (!Array.isArray(found)) throw new Error('Invalid outbox lookup');
          rows = found;
        } else {
          const ids = await command(['ZREVRANGE', EMAIL_OUTBOX_INDEX, 0, 49]);
          if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !JOB_ID.test(id))) throw new Error('Invalid outbox index');
          rows = await Promise.all(ids.map(id => command(['GET', EMAIL_JOB_PREFIX + id])));
        }
        const jobs = rows.filter(value => value !== null).map(value => {
          const { id, bookingId, kind, status, attempts, createdAt, updatedAt, acceptedAt, lastError, attemptStartedAt } = safeJob(value);
          return { id, bookingId, kind, status, attempts, createdAt, updatedAt, acceptedAt, lastError, lastAttempt: attemptStartedAt ? new Date(attemptStartedAt).toISOString() : undefined, safeToRetry: status === 'failed' && attempts < MAX_ATTEMPTS };
        });
        const smtp = smtpReadiness(env);
        const counts = { queued: 0, sending: 0, accepted: 0, failed: 0, unknown: 0 };
        for (const job of jobs) counts[job.status]++;
        res.status(200).json({ smtp, config: { configured: smtp.configured, blockedReasons: smtp.reason ? [smtp.reason] : [] }, counts, jobs, note: 'Accepted means accepted by SMTP, not delivered to the recipient inbox. Counts cover the most recent 50 retained jobs. Unknown attempts need manual mailbox reconciliation.' }); return;
      }
      const contentType = req.headers['content-type'];
      if (typeof contentType !== 'string' || contentType.split(';')[0] !== 'application/json') { res.status(415).json({ error: 'Send an application/json request.' }); return; }
      const body = req.body as { action?: unknown; id?: unknown } | undefined;
      if (body?.action === 'retry' && typeof body.id === 'string' && JOB_ID.test(body.id)) {
        const now = (options.now ?? (() => new Date()))();
        const result = await command(['EVAL', RETRY_EMAIL_SCRIPT, 2, `${EMAIL_JOB_PREFIX}${body.id}`, EMAIL_PENDING_KEY, now.getTime(), now.toISOString(), MAX_ATTEMPTS]);
        if (result !== 'queued') { res.status(result === 'not_found' ? 404 : 409).json({ error: 'Only definite failed attempts below the retry limit can be retried. Unknown or accepted messages cannot be resent here.' }); return; }
        res.status(200).json({ state: await processJob(body.id, { ...options, env, command }) }); return;
      }
      if (body?.action !== 'drain') { res.status(400).json({ error: 'Choose drain or retry with a valid job ID.' }); return; }
      res.status(200).json(await drainEmailOutbox({ ...options, env, command }));
    } catch { res.status(503).json({ error: 'Email processing is temporarily unavailable. Stored booking requests are preserved.' }); }
  };
}
