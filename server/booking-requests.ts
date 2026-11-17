import { createHash, randomUUID } from 'node:crypto';
import {
  authorized, BLOCKED_KEY, CONFIRMED_KEY, configured, createRedisCommand,
  INITIALIZED_KEY, isValidDate, monthRange, setHeaders, unavailable,
} from './availability.ts';
import type { ApiRequest, ApiResponse, HandlerOptions } from './availability.ts';

const REQUEST_PREFIX = 'mooncrab:request:';
const REQUEST_INDEX = 'mooncrab:requests';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface BookingRequest {
  id: string;
  checkIn: string;
  checkOut: string;
  name: string;
  email: string;
  message: string;
  status: 'pending' | 'confirmed' | 'declined' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

interface ValidRequest {
  checkIn: string; checkOut: string; name: string; email: string;
  message: string; idempotencyKey: string; nights: string[];
}

export function stayNights(checkIn: string, checkOut: string): string[] {
  const nights: string[] = [];
  for (let time = Date.parse(`${checkIn}T00:00:00Z`); time < Date.parse(`${checkOut}T00:00:00Z`) && nights.length <= 30; time += 86_400_000) {
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
  if (!nights.length || nights.length > 30) return null;
  if (typeof idempotencyKey !== 'string' || !UUID.test(idempotencyKey)) return null;
  if (typeof value.name !== 'string' || typeof value.email !== 'string') return null;
  const name = value.name.trim();
  const email = value.email.trim().toLowerCase();
  const message = value.message === undefined ? '' : value.message;
  if (name.length < 2 || name.length > 100 || /[\u0000-\u001f]/.test(name)) return null;
  if (email.length > 254 || !EMAIL.test(email)) return null;
  if (typeof message !== 'string' || message.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(message)) return null;
  return { checkIn, checkOut, name, email, message: message.trim(), idempotencyKey: idempotencyKey.toLowerCase(), nights };
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
  // Return only the intentional owner-facing fields, never internal digests.
  const { id, checkIn, checkOut, name, email, message, status, createdAt, updatedAt } = record;
  return { id, checkIn, checkOut, name, email, message, status, createdAt, updatedAt };
}

export const CREATE_REQUEST_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= '1' then return {'unavailable'} end
local previous = redis.call('GET', KEYS[4])
if previous then
  local prior = cjson.decode(previous)
  if prior.digest ~= ARGV[4] then return {'idempotency_conflict'} end
  return {'duplicate', prior.id}
end
local dates = cjson.decode(ARGV[2])
for _, date in ipairs(dates) do
  if redis.call('SISMEMBER', KEYS[2], date) == 1 or redis.call('SISMEMBER', KEYS[3], date) == 1 then return {'conflict'} end
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
return {'created', ARGV[5]}
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

export const ACTION_REQUEST_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'not_found'} end
local record = cjson.decode(raw)
if ARGV[1] == 'cancel' then
  if record.status ~= 'confirmed' then return {'already_actioned'} end
else
  if record.status ~= 'pending' then return {'already_actioned'} end
end
local dates = cjson.decode(ARGV[2])
if #dates == 0 then return {'invalid_record'} end
if ARGV[1] == 'confirm' then
  if redis.call('GET', KEYS[4]) ~= '1' then return {'unavailable'} end
  for _, date in ipairs(dates) do
    if redis.call('SISMEMBER', KEYS[2], date) == 1 or redis.call('SISMEMBER', KEYS[3], date) == 1 then return {'conflict'} end
  end
  for _, date in ipairs(dates) do redis.call('SADD', KEYS[3], date) end
  record.status = 'confirmed'
elseif ARGV[1] == 'cancel' then
  for _, date in ipairs(dates) do redis.call('SREM', KEYS[3], date) end
  record.status = 'cancelled'
else
  record.status = 'declined'
end
record.updatedAt = ARGV[3]
local updated = cjson.encode(record)
redis.call('SET', KEYS[1], updated)
redis.call('EXPIREAT', KEYS[1], ARGV[4])
return {'updated', updated}
`;

function resultArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('Invalid store response');
  return value;
}

export function createBookingRequestHandler(options: HandlerOptions = {}) {
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
    const currentTime = now();
    const input = parseRequest(req.body, currentTime);
    if (!input) {
      res.status(400).json({ error: 'Enter valid guest details and a stay of 1–30 nights within the next 24 months.' });
      return;
    }
    if (!configured(env)) { unavailable(res); return; }
    try {
      const id = randomUUID();
      const timestamp = currentTime.toISOString();
      const record: BookingRequest = {
        id, checkIn: input.checkIn, checkOut: input.checkOut,
        name: input.name, email: input.email, message: input.message,
        status: 'pending', createdAt: timestamp, updatedAt: timestamp,
      };
      const hash = (value: string) => createHash('sha256').update(value).digest('hex');
      const forwarded = req.headers['x-vercel-forwarded-for'];
      const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim().slice(0, 100) : '';
      const hour = Math.floor(currentTime.getTime() / 3_600_000);
      const digest = hash(JSON.stringify({ ...record, id: undefined, createdAt: undefined, updatedAt: undefined }));
      const result = resultArray(await command([
        'EVAL', CREATE_REQUEST_SCRIPT, 8,
        INITIALIZED_KEY, BLOCKED_KEY, CONFIRMED_KEY,
        `mooncrab:idempotency:${input.idempotencyKey}`, `${REQUEST_PREFIX}${id}`, REQUEST_INDEX,
        `mooncrab:rate:email:${hour}:${hash(input.email)}`,
        `mooncrab:rate:ip:${hour}:${hash(ip)}`,
        JSON.stringify(record), JSON.stringify(input.nights), currentTime.getTime(), digest, id, ip ? '1' : '0', requestExpiry(input.checkOut),
      ]));
      switch (result[0]) {
        case 'created':
        case 'duplicate':
          res.status(result[0] === 'created' ? 201 : 200).json({ id: result[1], status: 'pending' });
          return;
        case 'conflict':
          res.status(409).json({ error: 'Those dates are no longer available. Please choose another stay.' });
          return;
        case 'idempotency_conflict':
          res.status(409).json({ error: 'This request was already used for different details. Please refresh and try again.' });
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

export function createAdminBookingRequestsHandler(options: HandlerOptions = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const command = options.command ?? createRedisCommand(env);
  return async (req: ApiRequest, res: ApiResponse): Promise<void> => {
    setHeaders(res);
    if (req.method !== 'GET' && req.method !== 'PATCH') {
      res.setHeader('Allow', 'GET, PATCH');
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }
    if (!authorized(req, env)) { res.status(401).json({ error: 'Unauthorized.' }); return; }
    if (!configured(env)) { unavailable(res); return; }
    try {
      if (req.method === 'GET') {
        const rows = resultArray(await command(['EVAL', LIST_REQUESTS_SCRIPT, 1, REQUEST_INDEX, REQUEST_PREFIX]));
        res.status(200).json({ requests: rows.map(safeRecord) });
        return;
      }
      if (!jsonRequest(req)) { res.status(415).json({ error: 'Send an application/json request.' }); return; }
      const body = req.body as Record<string, unknown> | undefined;
      if (!body || typeof body !== 'object' || typeof body.id !== 'string' || !UUID.test(body.id) || typeof body.action !== 'string' || !['confirm', 'decline', 'cancel'].includes(body.action)) {
        res.status(400).json({ error: 'Provide a request ID and confirm, decline, or cancel action.' });
        return;
      }
      const key = `${REQUEST_PREFIX}${body.id}`;
      const raw = await command(['GET', key]);
      if (raw === null) { res.status(404).json({ error: 'Request not found.' }); return; }
      const record = safeRecord(raw);
      if (body.action === 'confirm' && record.checkIn < monthRange(now()).today) {
        res.status(409).json({ error: 'This stay has already started. Contact the guest to arrange new dates.' });
        return;
      }
      const nights = stayNights(record.checkIn, record.checkOut);
      if (!nights.length || nights.length > 30) { unavailable(res); return; }
      const result = resultArray(await command([
        'EVAL', ACTION_REQUEST_SCRIPT, 4, key, BLOCKED_KEY, CONFIRMED_KEY, INITIALIZED_KEY,
        body.action, JSON.stringify(nights), now().toISOString(), requestExpiry(record.checkOut),
      ]));
      switch (result[0]) {
        case 'updated': res.status(200).json({ request: safeRecord(result[1]) }); return;
        case 'not_found': res.status(404).json({ error: 'Request not found.' }); return;
        case 'conflict': res.status(409).json({ error: 'Those dates are already blocked. Contact the guest before choosing another stay.' }); return;
        case 'already_actioned': res.status(409).json({ error: 'This request has already been actioned. Refresh the list.' }); return;
        default: unavailable(res);
      }
    } catch { unavailable(res); }
  };
}
