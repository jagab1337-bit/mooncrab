import { createHash, randomUUID } from 'node:crypto';
import {
  BLOCKED_KEY, CONFIRMED_KEY, CONFIRMED_SOURCES_KEY, IMPORTED_KEY, configured, createRedisCommand,
  INITIALIZED_KEY, isValidDate, monthRange, setHeaders, unavailable,
} from './availability.ts';
import type { ApiRequest, ApiResponse, HandlerOptions } from './availability.ts';
import { authorizeAdmin } from './admin-auth.ts';
import { normalizePhone, readBusinessSettings } from './business-settings.ts';
import { calculatePricing } from '../shared/pricing.ts';
import type { PricingSnapshot } from '../shared/pricing.ts';
import { DIRECT_POLICY, externalSource, hasRecordedDirectPolicy, MANUAL_SOURCES, readStoredPayment, validPayment } from '../shared/booking-terms.ts';
import type { BookingAgreement, BookingPayment } from '../shared/booking-terms.ts';
import {
  BOOKING_RECORD_PREFIX, CLAIM_MILLISECONDS, EMAIL_JOB_PREFIX, EMAIL_OUTBOX_INDEX, EMAIL_PENDING_KEY, ENQUEUE_EMAIL_JOB_LUA,
  prepareBookingEmailJobs, prepareEmailJob, processBookingEmails, processConfirmationEmail, processReservationEmail,
} from './email-outbox.ts';
import type { EmailOptions } from './email-outbox.ts';
import { calendarSyncStatus } from './external-calendars.ts';
import { COUPON_GUESTS, COUPON_REDEMPTIONS, COUPON_RULES, COUPON_USAGE, quoteCoupons, requestCodes } from './coupons.ts';
import { applyAdjustments, COUPON_CODE } from '../shared/coupons.ts';
import type { Redemption } from './coupons.ts';
import { analyticsDay } from './analytics.ts';
import { bookingPage, changeBookingArchive } from './booking-archive.ts';
import { isLocale } from '../shared/locale-data.ts';

const REQUEST_PREFIX = BOOKING_RECORD_PREFIX;
const REQUEST_INDEX = 'mooncrab:requests';
const IMPORT_SNAPSHOTS = ['mooncrab:ical:source:airbnb', 'mooncrab:ical:source:booking'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i;

export interface BookingRequest {
  id: string;
  checkIn: string;
  checkOut: string;
  name: string;
  email: string;
  phone?: string;
  whatsapp?: boolean;
  room?: 'KASAG';
  pricing?: PricingSnapshot;
  agreement?: BookingAgreement;
  payment?: BookingPayment;
  source?: string;
  manual?: true;
  declineReason?: string;
  locale?:string;
  priceAudit?: Array<{at:string;reason:string;previous:PricingSnapshot;adjusted:PricingSnapshot}>;
  message: string;
  guests: number;
  extraGuestFeePhp: number;
  status: 'pending' | 'confirmed' | 'declined' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

interface ValidRequest {
  checkIn: string; checkOut: string; name: string; email: string;
  phone: string; whatsapp: boolean; room: 'KASAG';
  message: string; guests: number; extraGuestFeePhp: number; idempotencyKey: string; nights: string[];
}

export function stayNights(checkIn: string, checkOut: string): string[] {
  const nights: string[] = [];
  for (let time = Date.parse(`${checkIn}T00:00:00Z`); time < Date.parse(`${checkOut}T00:00:00Z`) && nights.length <= 90; time += 86_400_000) {
    nights.push(new Date(time).toISOString().slice(0, 10));
  }
  return nights;
}

function parseRequest(body: unknown, now: Date): ValidRequest | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  const { checkIn, checkOut, idempotencyKey } = value;
  if (!isValidDate(checkIn) || !isValidDate(checkOut) || checkOut <= checkIn) return null;
  const range = monthRange(now);
  if (checkIn < range.today || checkOut > range.lastDate) return null;
  const nights = stayNights(checkIn, checkOut);
  if (nights.length < 2 || nights.length > 90 || value.room !== 'KASAG') return null;
  const guests = value.guests === undefined ? 2 : value.guests;
  if (typeof guests !== 'number' || !Number.isInteger(guests) || guests < 1 || guests > 3) return null;
  const extraGuestFeePhp = guests === 3 ? nights.length * 500 : 0;
  if (typeof idempotencyKey !== 'string' || !UUID.test(idempotencyKey)) return null;
  if (typeof value.name !== 'string' || typeof value.email !== 'string') return null;
  const name = value.name.trim();
  const email = value.email.trim().toLowerCase();
  const phone = normalizePhone(value.phone);
  if (!phone || typeof value.whatsapp !== 'boolean') return null;
  const message = value.message === undefined ? '' : value.message;
  if (name.length < 2 || name.length > 100 || /[\u0000-\u001f]/.test(name)) return null;
  if (email.length > 254 || !EMAIL.test(email)) return null;
  if (typeof message !== 'string' || message.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(message)) return null;
  return { checkIn, checkOut, name, email, phone, whatsapp:value.whatsapp, room:'KASAG', message: message.trim(), guests, extraGuestFeePhp, idempotencyKey: idempotencyKey.toLowerCase(), nights };
}

export function requestExpiry(checkOut: string): number {
  return Math.floor(Date.parse(`${checkOut}T00:00:00+08:00`) / 1000) + 90 * 86_400;
}

function jsonRequest(req: ApiRequest): boolean {
  const contentType = req.headers['content-type'];
  return typeof contentType === 'string' && contentType.split(';')[0].trim().toLowerCase() === 'application/json';
}

function safeRecord(value: unknown): BookingRequest {
  if (typeof value !== 'string') throw new Error('Invalid request record');
  const record = JSON.parse(value) as BookingRequest;
  if (!record || typeof record.id !== 'string' || !UUID.test(record.id) || !isValidDate(record.checkIn) || !isValidDate(record.checkOut)
      || !['pending', 'confirmed', 'declined', 'cancelled'].includes(record.status) || typeof record.name !== 'string' || typeof record.email !== 'string'
      || typeof record.message !== 'string' || typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string') {
    throw new Error('Invalid request record');
  }
  const guests = record.guests === undefined ? 2 : record.guests;
  if (typeof guests !== 'number' || !Number.isInteger(guests) || guests < 1 || guests > 3) throw new Error('Invalid guest count');
  // Old records predate occupancy fields. Derive the supplement from validated dates and guest count.
  const extraGuestFeePhp = guests === 3 ? stayNights(record.checkIn, record.checkOut).length * 500 : 0;
  // Return only the intentional owner-facing fields, never internal digests.
  const { id, checkIn, checkOut, name, email, message, status, createdAt, updatedAt } = record;
  const optional: Partial<BookingRequest> = {};
  if (record.phone !== undefined) {
    if (!normalizePhone(record.phone) || typeof record.whatsapp !== 'boolean' || record.room !== 'KASAG') throw new Error('Invalid contact record');
    optional.phone = record.phone; optional.whatsapp = record.whatsapp;
  }
  if (record.room === 'KASAG') optional.room = record.room;
  if (record.manual === true) {
    if (typeof record.source !== 'string' || !record.source || record.source.length > 60) throw new Error('Invalid booking source');
    optional.manual = true; optional.source = record.source;
  }
  if (record.agreement !== undefined) {
    const { version, acceptedAt, recordedBy } = record.agreement;
    if (typeof version !== 'string' || typeof acceptedAt !== 'string' || !Number.isFinite(Date.parse(acceptedAt))
      || !['guest', 'host'].includes(recordedBy)) throw new Error('Invalid booking agreement');
    optional.agreement = { version, acceptedAt, recordedBy };
  }
  if (record.payment !== undefined) {
    const payment = readStoredPayment(record.payment);
    if (!payment) throw new Error('Invalid booking payment');
    optional.payment = payment;
  }
  if (typeof record.declineReason === 'string') optional.declineReason = record.declineReason;
  if (isLocale(record.locale)) optional.locale=record.locale;
  if (record.pricing !== undefined) {
    const p=record.pricing;
    const base=calculatePricing(stayNights(checkIn,checkOut).length,guests,p.rates,p.calculatedAt);
    if (p.coupons !== undefined && (!Array.isArray(p.coupons) || p.coupons.length>3 || p.coupons.some(c=>!COUPON_CODE.test(c.code) || typeof c.name!=='string' || typeof c.revision!=='string' || !Number.isSafeInteger(c.discountCents) || c.discountCents<=0))) throw new Error('Invalid stored coupon snapshot');
    const recomputed=applyAdjustments(base,p.coupons??[],p.manualDiscountCents??0);
    const numericFields=['nights','guests','monthlyPackages','weeklyPackages','additionalNights','roomSubtotalPhp','extraGuestFeePhp','totalPhp','depositPhp'] as const;
    if (p.currency!=='PHP'||p.room!=='KASAG'||typeof p.calculatedAt!=='string'||Number.isNaN(Date.parse(p.calculatedAt))
      ||numericFields.some(key=>p[key]!==recomputed[key])||!Array.isArray(p.lineItems)||p.lineItems.length!==recomputed.lineItems.length
      ||p.lineItems.some((line,index)=>Object.keys(recomputed.lineItems[index]).some(key=>line[key as keyof typeof line]!==recomputed.lineItems[index][key as keyof typeof line]))) throw new Error('Invalid stored pricing');
    optional.pricing=recomputed;
  }
  if (Array.isArray(record.priceAudit)) optional.priceAudit=record.priceAudit;
  return { id, checkIn, checkOut, name, email, message, guests, extraGuestFeePhp, status, createdAt, updatedAt, ...optional };
}

export const CREATE_REQUEST_SCRIPT = `${ENQUEUE_EMAIL_JOB_LUA}
if redis.call('GET', KEYS[1]) ~= '1' then return {'unavailable'} end
local previous = redis.call('GET', KEYS[4])
if previous then
  local prior = cjson.decode(previous)
  if prior.digest ~= ARGV[4] then return {'idempotency_conflict'} end
  return {'duplicate', prior.id, redis.call('GET', 'mooncrab:request:' .. prior.id) or ''}
end
if ARGV[10] ~= '' then return {'invalid_coupon'} end
local dates = cjson.decode(ARGV[2])
for _, date in ipairs(dates) do
  if redis.call('SISMEMBER', KEYS[2], date) == 1 or redis.call('SISMEMBER', KEYS[3], date) == 1 or redis.call('SISMEMBER', KEYS[9], date) == 1 then return {'conflict'} end
end
if tonumber(redis.call('GET', KEYS[7]) or '0') >= 5 then return {'rate_limited'} end
if ARGV[6] == '1' and tonumber(redis.call('GET', KEYS[8]) or '0') >= 20 then return {'rate_limited'} end
redis.call('INCR', KEYS[7])
redis.call('EXPIRE', KEYS[7], 3600)
if ARGV[6] == '1' then redis.call('INCR', KEYS[8]); redis.call('EXPIRE', KEYS[8], 3600) end
redis.call('SET', KEYS[5], ARGV[1])
redis.call('EXPIREAT', KEYS[5], ARGV[7])
redis.call('ZADD', KEYS[6], ARGV[3], ARGV[5])
redis.call('SET', KEYS[4], cjson.encode({id=ARGV[5], digest=ARGV[4]}))
redis.call('EXPIREAT', KEYS[4], ARGV[7])
local jobs = cjson.decode(ARGV[8])
for _, job in ipairs(jobs) do
  enqueueEmail(job, 'mooncrab:email-job:', KEYS[10], KEYS[11], ARGV[3])
end
redis.call('HINCRBY', ARGV[9], 'request', 1)
redis.call('EXPIRE', ARGV[9], 34560000)
return {'created', ARGV[5], ARGV[1]}
`;

export const LIST_REQUESTS_SCRIPT = `
local ids = redis.call('ZREVRANGE', KEYS[1], 0, 199)
local records = {}
for _, id in ipairs(ids) do
  local record = redis.call('GET', ARGV[1] .. id)
  if record then
    if #records < 100 then table.insert(records, record) end
  else
    redis.call('ZREM', KEYS[1], id)
  end
end
return records
`;

const CHECK_BOOKING_DATES_LUA = `
local function datesConflict(record, dates, blocked, confirmed, imported, airbnb, bookingCom, provider)
  local hasImported = false
  for _, date in ipairs(dates) do
    if redis.call('SISMEMBER', blocked, date) == 1 or redis.call('SISMEMBER', confirmed, date) == 1 then return true end
    if redis.call('SISMEMBER', imported, date) == 1 then hasImported = true end
  end
  if not hasImported then return false end
  if provider == '' then return true end
  -- A manual platform record may mirror one unambiguous imported stay.
  local matches = 0
  for _, feed in ipairs({airbnb, bookingCom}) do
    local raw = redis.call('GET', feed)
    if raw then
      for _, event in ipairs(cjson.decode(raw).events) do
        if event.checkIn < record.checkOut and event.checkOut > record.checkIn then
          if event.source ~= provider or event.checkIn ~= record.checkIn or event.checkOut ~= record.checkOut then return true end
          matches = matches + 1
        end
      end
    end
  end
  return matches ~= 1
end
local function blockConfirmed(dates, confirmed, sources, provider)
  for _, date in ipairs(dates) do
    redis.call('SADD', confirmed, date)
    if provider ~= '' then redis.call('HSET', sources, date, provider) end
  end
end`;

export const ACTION_REQUEST_SCRIPT = `${ENQUEUE_EMAIL_JOB_LUA}\n${CHECK_BOOKING_DATES_LUA}
local raw = redis.call('GET', KEYS[1])
if not raw then return {'not_found'} end
local record = cjson.decode(raw)
if ARGV[1] == 'payment' then
  if record.status ~= 'confirmed' or record.updatedAt ~= ARGV[10] then return {'already_actioned'} end
  record.payment = cjson.decode(ARGV[5])
elseif ARGV[1] == 'adjust-price' then
  if record.status ~= 'pending' or record.updatedAt ~= ARGV[10] then return {'already_actioned'} end
  local change = cjson.decode(ARGV[13])
  record.priceAudit = record.priceAudit or {}
  table.insert(record.priceAudit, change)
  record.pricing = change.adjusted
elseif ARGV[1] == 'cancel' then
  if record.status ~= 'confirmed' then return {'already_actioned'} end
  local jobRaw = redis.call('GET', KEYS[11])
  if jobRaw then
    local job = cjson.decode(jobRaw)
    if job.status == 'sending' and tonumber(job.attemptStartedAt or 0) + tonumber(ARGV[9]) >= tonumber(ARGV[7]) then return {'email_sending'} end
    if job.status == 'queued' then
      job.status = 'suppressed'; job.updatedAt = ARGV[3]; job.lastError = 'The reservation was cancelled before sending.'
      redis.call('SET', KEYS[11], cjson.encode(job)); if redis.call('HEXISTS', 'mooncrab:booking-archives', job.bookingId) == 0 then redis.call('EXPIREAT', KEYS[11], job.expiresAtUnix) end
      redis.call('ZREM', KEYS[7], job.id)
    end
  end
else
  if record.status ~= 'pending' then return {'already_actioned'} end
end
local dates = cjson.decode(ARGV[2])
if #dates == 0 then return {'invalid_record'} end
if ARGV[1] == 'confirm' then
  if redis.call('GET', KEYS[4]) ~= '1' then return {'unavailable'} end
  if datesConflict(record, dates, KEYS[2], KEYS[3], KEYS[5], KEYS[8], KEYS[9], ARGV[8]) then return {'conflict'} end
  if record.updatedAt ~= ARGV[10] then return {'already_actioned'} end
  local redemptions = cjson.decode(ARGV[12])
  for _, item in ipairs(redemptions) do
    local ruleRaw = redis.call('HGET', KEYS[12], item.code)
    if not ruleRaw or cjson.decode(ruleRaw).revision ~= item.revision then return {'coupon_changed'} end
    if item.limit > 0 and tonumber(redis.call('HGET', KEYS[13], item.code) or '0') >= item.limit then return {'coupon_changed'} end
    if item.perGuest > 0 and tonumber(redis.call('HGET', KEYS[14], item.guest) or '0') >= item.perGuest then return {'coupon_changed'} end
  end
  for _, item in ipairs(redemptions) do
    redis.call('HINCRBY', KEYS[13], item.code, 1)
    redis.call('HINCRBY', KEYS[13], item.code..':discount', item.discountCents)
    redis.call('HINCRBY', KEYS[14], item.guest, 1)
    redis.call('ZADD', KEYS[15], ARGV[7], cjson.encode({code=item.code,bookingId=record.id,room=record.room or 'KASAG',at=ARGV[3],discountCents=item.discountCents}))
  end
  blockConfirmed(dates, KEYS[3], KEYS[10], ARGV[8])
  record.status = 'confirmed'
  if not record.manual then
    redis.call('HINCRBY', ARGV[14], 'approval', 1)
    redis.call('EXPIRE', ARGV[14], 34560000)
  end
  record.payment = cjson.decode(ARGV[5])
  if ARGV[6] ~= '' then enqueueEmail(cjson.decode(ARGV[6]), 'mooncrab:email-job:', KEYS[6], KEYS[7], ARGV[7]) end
elseif ARGV[1] == 'cancel' then
  for _, date in ipairs(dates) do
    if not record.blockedFrom or date >= record.blockedFrom then
      redis.call('SREM', KEYS[3], date); redis.call('HDEL', KEYS[10], date)
    end
  end
  record.status = 'cancelled'
  if ARGV[6] ~= '' then enqueueEmail(cjson.decode(ARGV[6]), 'mooncrab:email-job:', KEYS[6], KEYS[7], ARGV[7]) end
elseif ARGV[1] == 'decline' then
  record.status = 'declined'
  if ARGV[11] ~= '' then record.declineReason = ARGV[11] end
  if ARGV[6] ~= '' then enqueueEmail(cjson.decode(ARGV[6]), 'mooncrab:email-job:', KEYS[6], KEYS[7], ARGV[7]) end
end
record.updatedAt = ARGV[3]
local updated = cjson.encode(record)
redis.call('SET', KEYS[1], updated)
if not record.manual and redis.call('HEXISTS','mooncrab:booking-archives',record.id)==0 then redis.call('EXPIREAT', KEYS[1], ARGV[4]) end
return {'updated', updated}
`;

export const CREATE_MANUAL_BOOKING_SCRIPT = `${ENQUEUE_EMAIL_JOB_LUA}\n${CHECK_BOOKING_DATES_LUA}
local previous = redis.call('GET', KEYS[1])
if previous then
  if cjson.decode(previous).manualDigest == ARGV[2] then return {'duplicate', previous} end
  return {'idempotency_conflict'}
end
local record = cjson.decode(ARGV[1])
local dates = cjson.decode(ARGV[3])
if record.status == 'confirmed' and #dates > 0 then
  if redis.call('GET', KEYS[4]) ~= '1' then return {'unavailable'} end
  if datesConflict(record, dates, KEYS[2], KEYS[3], KEYS[5], KEYS[9], KEYS[10], ARGV[6]) then return {'conflict'} end
  blockConfirmed(dates, KEYS[3], KEYS[11], ARGV[6])
end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('ZADD', KEYS[6], ARGV[5], record.id)
if ARGV[4] ~= '' then enqueueEmail(cjson.decode(ARGV[4]), 'mooncrab:email-job:', KEYS[7], KEYS[8], ARGV[5]) end
return {'created', ARGV[1]}
`;

function resultArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('Invalid store response');
  return value;
}

export function createBookingRequestHandler(options: EmailOptions = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const command = options.command ?? createRedisCommand(env);
  return async (req: ApiRequest, res: ApiResponse): Promise<void> => {
    setHeaders(res);
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }
    if (!jsonRequest(req)) {
      res.status(415).json({ error: 'Send an application/json request.' });
      return;
    }
    const policy = req.body as Record<string, unknown> | undefined;
    if (policy?.policyAccepted !== true || policy.policyVersion !== DIRECT_POLICY.version) {
      res.status(400).json({ error: 'Review and agree to the current booking and cancellation policy before submitting. Refresh the page if the policy changed.' });
      return;
    }
    const currentTime = now();
    const input = parseRequest(req.body, currentTime);
    if (!input) {
      res.status(400).json({ error: 'Enter your full name, valid email and international phone, KASAG, 1–3 guests, and a stay of 2–90 nights within the next 24 months.' });
      return;
    }
    if (!configured(env)) { unavailable(res); return; }
    try {
      const settings = await readBusinessSettings(command);
      if(input.nights.length<settings.pricing.minimumNights||input.nights.length>settings.pricing.maxNights){res.status(400).json({error:`Choose a stay of ${settings.pricing.minimumNights}–${settings.pricing.maxNights} nights.`});return;}
      const base=calculatePricing(input.nights.length,input.guests,settings.pricing,currentTime.toISOString());
      let codes: string[];
      let pricing=base;
      let couponError='';
      try {
        codes=requestCodes(policy.couponCodes);
      } catch (error) {res.status(400).json({error:error instanceof Error?error.message:'This promo code is unavailable.'});return;}
      try {pricing=(await quoteCoupons(command,base,codes,input.checkIn,input.email,currentTime)).pricing;}
      catch (error) {couponError=error instanceof Error?error.message:'This promo code is unavailable.';}
      const id = randomUUID();
      const timestamp = currentTime.toISOString();
      const record: BookingRequest = {
        id, checkIn: input.checkIn, checkOut: input.checkOut,
        name: input.name, email: input.email, message: input.message,
        phone:input.phone, whatsapp:input.whatsapp,room:'KASAG',pricing,
        agreement: { version: DIRECT_POLICY.version, acceptedAt: timestamp, recordedBy: 'guest' },
        ...(isLocale(policy.locale)&&policy.locale!=='en'?{locale:policy.locale}:{}),
        guests: input.guests, extraGuestFeePhp: input.extraGuestFeePhp,
        status: 'pending', createdAt: timestamp, updatedAt: timestamp,
      };
      const hash = (value: string) => createHash('sha256').update(value).digest('hex');
      const forwarded = req.headers['x-vercel-forwarded-for'];
      const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim().slice(0, 100) : '';
      const hour = Math.floor(currentTime.getTime() / 3_600_000);
      // Rates may change between retries; idempotency identifies guest intent, not the new quote.
      const digest = hash(JSON.stringify({ ...record, id: undefined, createdAt: undefined, updatedAt: undefined, pricing:undefined, locale:undefined, agreement: DIRECT_POLICY.version, ...(codes.length?{codes}:{}) }));
      const result = resultArray(await command([
        'EVAL', CREATE_REQUEST_SCRIPT, 11,
        INITIALIZED_KEY, BLOCKED_KEY, CONFIRMED_KEY,
        `mooncrab:idempotency:${input.idempotencyKey}`, `${REQUEST_PREFIX}${id}`, REQUEST_INDEX,
        `mooncrab:rate:email:${hour}:${hash(input.email)}`,
        `mooncrab:rate:ip:${hour}:${hash(ip)}`,
        IMPORTED_KEY,
        EMAIL_OUTBOX_INDEX,EMAIL_PENDING_KEY,
        JSON.stringify(record), JSON.stringify(input.nights), currentTime.getTime(), digest, id, ip ? '1' : '0', requestExpiry(input.checkOut),
        JSON.stringify(prepareBookingEmailJobs(record,currentTime)),analyticsDay(currentTime),couponError,
      ]));
      switch (result[0]) {
        case 'created':
        case 'duplicate': {
          const saved = safeRecord(result[2]);
          if(result[0]==='created') {
            // Queue persistence is atomic with the booking. SMTP failures never roll it back.
            try {await processBookingEmails(saved.id,{...options,env,command,now});} catch { /* Retry through the durable outbox. */ }
          }
          res.status(result[0] === 'created' ? 201 : 200).json({ id: result[1], status: saved.status, room:saved.room??'KASAG', checkIn:saved.checkIn,checkOut:saved.checkOut,guests:saved.guests,nights:stayNights(saved.checkIn,saved.checkOut).length,pricing:saved.pricing });
          return;
        }
        case 'conflict':
          res.status(409).json({ error: 'Those dates are no longer available. Please choose another stay.' });
          return;
        case 'idempotency_conflict':
          res.status(409).json({ error: 'This request was already used for different details. Please refresh and try again.' });
          return;
        case 'invalid_coupon':
          res.status(400).json({error:couponError || 'This promo code is unavailable.'});
          return;
        case 'rate_limited':
          res.setHeader('Retry-After', '3600');
          res.status(429).json({ error: 'Too many requests. Please try again later.' });
          return;
        default: unavailable(res);
      }
    } catch { unavailable(res); }
  };
}

function confirmationJob(record: BookingRequest, now: Date) {
  return JSON.stringify(prepareEmailJob({ ...record, status: 'confirmed' }, 'confirmation', now));
}

async function calendarsReady(options: Required<Pick<HandlerOptions, 'env' | 'command'>>, at: Date): Promise<boolean> {
  const { env, command } = options;
  if (!env.AIRBNB_ICAL_URL && !env.BOOKING_COM_ICAL_URL) return true;
  const sync = await calendarSyncStatus(command, env, at);
  return !sync.sources.some(source => source.configured && (source.stale || source.error));
}

async function saveManualBooking(body: Record<string, unknown>, res: ApiResponse, options: EmailOptions & Required<Pick<HandlerOptions, 'env' | 'command'>>, at: Date) {
  const { command } = options;
  const { checkIn, checkOut, room, guests, status, payment, idempotencyKey, sendEmail } = body;
  const range = monthRange(at);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = body.phone ? normalizePhone(body.phone) : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const nights = isValidDate(checkIn) && isValidDate(checkOut) ? stayNights(checkIn, checkOut) : [];
  if (!isValidDate(checkIn) || !isValidDate(checkOut) || checkIn < '1900-01-01' || checkOut > range.lastDate || !nights.length || nights.length > 90
    || room !== 'KASAG' || typeof guests !== 'number' || !Number.isInteger(guests) || guests < 1 || guests > 3
    || name.length < 2 || name.length > 100 || /[\u0000-\u001f]/.test(name) || email.length > 254 || (email && !EMAIL.test(email))
    || phone === null || message.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(message)
    || !validPayment(payment) || typeof idempotencyKey !== 'string' || !UUID.test(idempotencyKey)
    || (status !== 'confirmed' && status !== 'pending' && status !== 'cancelled' && status !== 'declined') || typeof sendEmail !== 'boolean') {
    res.status(400).json({ error: 'Enter valid guest details, dates, room, booking status, and accommodation and payment amounts. Include a country code for phone numbers.' }); return;
  }
  const settings = await readBusinessSettings(command);
  const source = [...MANUAL_SOURCES, ...settings.bookingSources].find(candidate => candidate === body.source);
  if (!source) { res.status(400).json({ error: 'Choose a configured booking source.' }); return; }
  const provider = externalSource(source);
  const accepted = !provider && body.policyAccepted === true && body.policyVersion === DIRECT_POLICY.version;
  if (sendEmail && (status !== 'confirmed' || !email || !accepted || checkIn < range.today)) {
    res.status(400).json({ error: 'To send a confirmation, choose a current or upcoming direct stay, provide the guest email, and record their policy agreement.' }); return;
  }
  const activeNights = nights.filter(night => night >= range.today);
  if (status === 'confirmed' && activeNights.length && !await calendarsReady(options, at)) {
    res.status(409).json({ error: 'Sync the configured external calendars successfully before confirming this stay. Existing blocks remain protected.' }); return;
  }
  const timestamp = at.toISOString();
  const record: BookingRequest = {
    id: idempotencyKey.toLowerCase(), checkIn, checkOut, name, email, room, guests, extraGuestFeePhp: guests === 3 ? nights.length * 500 : 0,
    status, message, manual: true, source, payment: { totalCents: payment.totalCents, receivedCents: payment.receivedCents }, createdAt: timestamp, updatedAt: timestamp,
    ...(phone ? { phone, whatsapp: body.whatsapp === true } : {}),
    ...(accepted ? { agreement: { version: DIRECT_POLICY.version, acceptedAt: timestamp, recordedBy: 'host' } } : {}),
  };
  const manualDigest = createHash('sha256').update(JSON.stringify({ ...record, createdAt: undefined, updatedAt: undefined, agreement: record.agreement?.version, sendEmail })).digest('hex');
  const result = resultArray(await command([
    'EVAL', CREATE_MANUAL_BOOKING_SCRIPT, 11, REQUEST_PREFIX + record.id, BLOCKED_KEY, CONFIRMED_KEY, INITIALIZED_KEY, IMPORTED_KEY,
    REQUEST_INDEX, EMAIL_OUTBOX_INDEX, EMAIL_PENDING_KEY, ...IMPORT_SNAPSHOTS, CONFIRMED_SOURCES_KEY,
    JSON.stringify({ ...record, manualDigest, blockedFrom: range.today }), manualDigest, JSON.stringify(activeNights), sendEmail ? confirmationJob(record, at) : '', at.getTime(), provider ?? '',
  ]));
  if (result[0] === 'conflict') { res.status(409).json({ error: 'This stay overlaps blocked or confirmed dates. For a platform booking, the imported stay must match its dates and source exactly.' }); return; }
  if (result[0] === 'idempotency_conflict') { res.status(409).json({ error: 'This entry has already been used. Refresh bookings before adding another reservation.' }); return; }
  if (result[0] !== 'created' && result[0] !== 'duplicate') { unavailable(res); return; }
  const saved = safeRecord(result[1]);
  const confirmationEmail = sendEmail && result[0] === 'created' ? await processConfirmationEmail(saved.id, options) : undefined;
  res.status(result[0] === 'created' ? 201 : 200).json({ request: saved, confirmationEmail });
}

export function createAdminBookingRequestsHandler(options: EmailOptions = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const command = options.command ?? createRedisCommand(env);
  return async (req: ApiRequest, res: ApiResponse): Promise<void> => {
    setHeaders(res);
    if (req.method !== 'GET' && req.method !== 'PATCH' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, PATCH, POST');
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }
    if (!await authorizeAdmin(req, env, command)) { res.status(401).json({ error: 'Unauthorized.' }); return; }
    if (!configured(env)) { unavailable(res); return; }
    try {
      if (req.method === 'GET') {
        if (req.query?.view !== undefined || req.query?.id !== undefined) {await bookingPage(req,command,res,now(),safeRecord);return;}
        const rows = resultArray(await command(['EVAL', LIST_REQUESTS_SCRIPT, 1, REQUEST_INDEX, REQUEST_PREFIX]));
        res.status(200).json({ requests: rows.map(safeRecord) });
        return;
      }
      if (!jsonRequest(req)) { res.status(415).json({ error: 'Send an application/json request.' }); return; }
      const body = req.body as Record<string, unknown> | undefined;
      const at = now();
      const emailOptions = { ...options, env, command, now };
      if (req.method === 'POST') {
        if (!body || typeof body !== 'object' || Array.isArray(body)) { res.status(400).json({ error: 'Provide manual booking details.' }); return; }
        if (body.action === 'archive' || body.action === 'restore') {await changeBookingArchive(body,command,res,at);return;}
        await saveManualBooking(body, res, emailOptions, at);
        return;
      }
      if (!body || typeof body !== 'object' || typeof body.id !== 'string' || !UUID.test(body.id) || typeof body.action !== 'string' || !['confirm', 'decline', 'cancel', 'payment','adjust-price'].includes(body.action)) {
        res.status(400).json({ error: 'Provide a request ID and a valid booking action.' });
        return;
      }
      const key = `${REQUEST_PREFIX}${body.id}`;
      const raw = await command(['GET', key]);
      if (raw === null) { res.status(404).json({ error: 'Request not found.' }); return; }
      const record = safeRecord(raw);
      if (body.action === 'confirm' && record.checkIn < monthRange(at).today) {
        res.status(409).json({ error: 'This stay has already started. Contact the guest to arrange new dates.' });
        return;
      }
      const payment = validPayment(body.payment) ? { totalCents: body.payment.totalCents, receivedCents: body.payment.receivedCents } : undefined;
      if ((body.action === 'confirm' || body.action === 'payment') && (!payment || (body.action === 'payment' && typeof body.expectedUpdatedAt !== 'string'))) {
        res.status(400).json({ error: 'Enter the agreed accommodation total and any payment actually received.' }); return;
      }
      const provider = externalSource(record.source);
      let redemptions: Redemption[] = [];
      let priceChange: NonNullable<BookingRequest['priceAudit']>[number] | undefined;
      if (body.action === 'adjust-price' || (body.action === 'confirm' && record.pricing?.discountPhp)) {
        const previous = record.pricing;
        if (!previous || record.manual || record.status !== 'pending') {res.status(409).json({error:'Only pending website quotes can be adjusted.'});return;}
        const base=calculatePricing(previous.nights,previous.guests,previous.rates,previous.calculatedAt);
        try {
          if (body.action === 'adjust-price') {
            const reason = typeof body.reason==='string'?body.reason.trim():'';
            const manual = body.manualDiscountCents;
            if (reason.length<3 || reason.length>400 || typeof manual!=='number' || !Number.isSafeInteger(manual) || manual<0 || body.expectedUpdatedAt!==record.updatedAt) throw new Error('Provide a reason, valid discount, and current request revision.');
            const { pricing: adjusted } = await quoteCoupons(command,base,requestCodes(body.couponCodes),record.checkIn,record.email,at);
            priceChange = {at:at.toISOString(),reason,previous,adjusted:applyAdjustments(base,adjusted.coupons??[],manual)};
          } else {
            const quoted = await quoteCoupons(command,base,(previous.coupons??[]).map(c=>c.code),record.checkIn,record.email,at);
            if ((previous.coupons??[]).some((coupon,index)=>{
              const current=quoted.pricing.coupons?.[index];
              return current?.revision!==coupon.revision || current.discountCents!==coupon.discountCents;
            }) || payment?.totalCents!==Math.round(previous.totalPhp*100)) throw new Error('Review the promotion and agree any revised total with the guest before approving.');
            redemptions=quoted.redemptions;
          }
        } catch (error) {res.status(409).json({error:error instanceof Error?error.message:'Review or remove the coupon before approving.'});return;}
      }
      const sendEmail = body.action === 'confirm' && !provider && (!record.manual || body.sendEmail === true);
      const declineEmail = body.action === 'decline' && !record.manual && EMAIL.test(record.email);
      const cancellationEmail = body.action === 'cancel' && record.status === 'confirmed' && !provider && EMAIL.test(record.email);
      const declineReason = body.action === 'decline' && typeof body.reason === 'string' ? body.reason.trim() : '';
      if (declineReason.length > 600 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(declineReason)) {
        res.status(400).json({error:'Enter a decline reason of up to 600 characters.'}); return;
      }
      if (sendEmail && (!EMAIL.test(record.email) || (record.manual && !hasRecordedDirectPolicy(record.agreement?.version)))) {
        res.status(400).json({ error: 'A valid guest email and, for manual entries, a recorded direct-booking policy agreement are required.' }); return;
      }
      if (body.action === 'confirm' && !await calendarsReady(emailOptions, at)) {
        res.status(409).json({ error: 'Sync the configured external calendars successfully before confirming this stay. Existing blocks remain protected.' }); return;
      }
      const nights = stayNights(record.checkIn, record.checkOut);
      if (!nights.length || nights.length > 90) { unavailable(res); return; }
      const emailJob = sendEmail ? confirmationJob({ ...record, payment }, at) : declineEmail
        ? JSON.stringify(prepareEmailJob({...record,status:'declined',declineReason},'decline',at))
        : cancellationEmail ? JSON.stringify(prepareEmailJob({ ...record, status: 'cancelled' }, 'cancellation', at)) : '';
      const result = resultArray(await command([
        'EVAL', ACTION_REQUEST_SCRIPT, 15, key, BLOCKED_KEY, CONFIRMED_KEY, INITIALIZED_KEY, IMPORTED_KEY, EMAIL_OUTBOX_INDEX, EMAIL_PENDING_KEY,
        ...IMPORT_SNAPSHOTS, CONFIRMED_SOURCES_KEY, `${EMAIL_JOB_PREFIX}${record.id}:confirmation`,
        COUPON_RULES,COUPON_USAGE,COUPON_GUESTS,COUPON_REDEMPTIONS,
        body.action, JSON.stringify(nights), at.toISOString(), requestExpiry(record.checkOut), JSON.stringify(payment ?? null),
        emailJob, at.getTime(), provider ?? '', CLAIM_MILLISECONDS, body.action==='confirm'?record.updatedAt:String(body.expectedUpdatedAt ?? ''), declineReason,
        JSON.stringify(redemptions),JSON.stringify(priceChange??null),analyticsDay(at),
      ]));
      switch (result[0]) {
        case 'updated': {
          const saved = safeRecord(result[1]);
          const confirmationEmail = sendEmail ? await processConfirmationEmail(saved.id, emailOptions) : undefined;
          const declineSubmission = declineEmail ? await processReservationEmail(saved.id,'decline',emailOptions) : undefined;
          const cancellationSubmission = cancellationEmail ? await processReservationEmail(saved.id, 'cancellation', emailOptions) : undefined;
          res.status(200).json({ request: saved, ...(sendEmail ? { confirmationEmail } : {}), ...(declineEmail ? { declineEmail:declineSubmission } : {}),
            ...(cancellationEmail ? { cancellationEmail: cancellationSubmission } : {}) }); return;
        }
        case 'not_found': res.status(404).json({ error: 'Request not found.' }); return;
        case 'conflict': res.status(409).json({ error: 'Those dates are already blocked. Contact the guest before choosing another stay.' }); return;
        case 'coupon_changed': res.status(409).json({error:'Coupon availability changed while approving. Review the quote and agree any changes with the guest.'}); return;
        case 'already_actioned': res.status(409).json({ error: 'This request has already been actioned. Refresh the list.' }); return;
        case 'email_sending': res.status(409).json({ error: 'The confirmation email is currently being submitted. Refresh after the attempt finishes before cancelling.' }); return;
        default: unavailable(res);
      }
    } catch {
      if (req.method === 'GET') {
        res.setHeader('Retry-After', '60');
        res.status(503).json({ error: 'Stay requests could not load. Use Refresh requests to try again.' });
      } else unavailable(res);
    }
  };
}
