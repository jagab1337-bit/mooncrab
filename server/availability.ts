import { createHash, timingSafeEqual } from 'node:crypto';
import { authorizeAdmin } from './admin-auth.ts';

export interface ApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  setHeader(name: string, value: string): void;
  status(code: number): ApiResponse;
  json(body: unknown): void;
}

export type Environment = Record<string, string | undefined>;
export type RedisCommand = (command: Array<string | number>) => Promise<unknown>;

export interface HandlerOptions {
  env?: Environment;
  now?: () => Date;
  command?: RedisCommand;
}

export const ROOM = 'KASAG';
export const BLOCKED_KEY = 'mooncrab:blocked-dates';
export const CONFIRMED_KEY = 'mooncrab:confirmed-dates';
export const IMPORTED_KEY = 'mooncrab:imported-dates';
export const INITIALIZED_KEY = 'mooncrab:availability-initialized';
export const DATE_DETAILS_KEY = 'mooncrab:date-details';
export type BookingSource = 'airbnb' | 'booking' | 'direct';
export interface DateDetail { source: BookingSource | ''; notes: string }
export type DateDetails = Record<string, DateDetail>;
export type DateSources = Record<string, BookingSource[]>;
const UNAVAILABLE = 'The booking calendar is temporarily unavailable. Please check back soon.';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const BOOKING_SOURCES = ['airbnb', 'booking', 'direct'] as const;
const INVALID_NOTE_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function manilaDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function monthRange(now: Date): { first: string; last: string; today: string; lastDate: string } {
  const today = manilaDate(now);
  const first = today.slice(0, 7);
  const [year, month] = first.split('-').map(Number);
  const end = new Date(Date.UTC(year, month - 1 + 24, 0));
  return { first, last: end.toISOString().slice(0, 7), today, lastDate: end.toISOString().slice(0, 10) };
}

function redisCredentials(env: Environment) {
  // The native Vercel integration supplies KV_* names. Direct Upstash accounts
  // supply UPSTASH_REDIS_* names. Always select a complete credential pair.
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    return { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN };
  }
  return { url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN };
}

export function configured(env: Environment): boolean {
  const credentials = redisCredentials(env);
  if (!credentials.token || !credentials.url) return false;
  try {
    const url = new URL(credentials.url);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function createRedisCommand(env: Environment): RedisCommand {
  return async (command) => {
    if (!configured(env)) throw new Error('Calendar storage is not configured');
    const credentials = redisCredentials(env);
    const response = await fetch(credentials.url!, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.token!}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Calendar storage request failed');
    const payload = await response.json() as { result?: unknown; error?: unknown };
    if (payload.error || !Object.hasOwn(payload, 'result')) throw new Error('Calendar storage response failed');
    return payload.result;
  };
}

export function setHeaders(res: ApiResponse): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export function unavailable(res: ApiResponse): void {
  res.setHeader('Retry-After', '60');
  res.status(503).json({ configured: false, error: UNAVAILABLE });
}

async function readCalendar(command: RedisCommand): Promise<{ initialized: boolean; blockedDates: string[] }> {
  const [initialized, dates] = await Promise.all([
    command(['GET', INITIALIZED_KEY]),
    command(['SUNION', BLOCKED_KEY, CONFIRMED_KEY, IMPORTED_KEY]),
  ]);
  if (!Array.isArray(dates) || dates.some((date) => !isValidDate(date))) {
    throw new Error('Invalid calendar storage data');
  }
  return { initialized: initialized === '1', blockedDates: [...new Set(dates)].sort() };
}

export function createAvailabilityHandler(options: HandlerOptions = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const command = options.command ?? createRedisCommand(env);

  return async (req: ApiRequest, res: ApiResponse): Promise<void> => {
    setHeaders(res);
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).json({ error: 'Method not allowed.' });
      return;
    }
    const month = req.query?.month;
    const range = monthRange(now());
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < range.first || month > range.last) {
      res.status(400).json({ error: 'Choose a month within the next 24 months.' });
      return;
    }
    if (!configured(env)) {
      unavailable(res);
      return;
    }
    try {
      const calendar = await readCalendar(command);
      if (!calendar.initialized) {
        unavailable(res);
        return;
      }
      res.status(200).json({
        configured: true,
        room: ROOM,
        month,
        blockedDates: calendar.blockedDates.filter((date) => date.startsWith(`${month}-`)),
      });
    } catch {
      unavailable(res);
    }
  };
}

export function authorized(req: ApiRequest, env: Environment): boolean {
  const token = env.BOOKING_ADMIN_TOKEN;
  const authorization = req.headers.authorization;
  if (!token || typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false;
  const supplied = authorization.slice(7);
  if (!supplied) return false;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(token), hash(supplied));
}

function isDateDetail(value: unknown): value is DateDetail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const detail = value as Record<string, unknown>;
  return Object.keys(detail).length === 2 && Object.keys(detail).every(key => ['source', 'notes'].includes(key))
    && typeof detail.source === 'string' && (detail.source === '' || BOOKING_SOURCES.includes(detail.source as BookingSource))
    && typeof detail.notes === 'string' && detail.notes.length <= 2000 && !INVALID_NOTE_CHARACTERS.test(detail.notes);
}

function readDateDetails(raw: unknown, range: ReturnType<typeof monthRange>): DateDetails {
  if (raw === null) return {};
  let entries: Array<[string, unknown]>;
  if (Array.isArray(raw)) {
    if (raw.length % 2 !== 0) throw new Error('Invalid date details');
    entries = [];
    for (let index = 0; index < raw.length; index += 2) {
      if (typeof raw[index] !== 'string') throw new Error('Invalid date details');
      entries.push([raw[index], raw[index + 1]]);
    }
  } else if (raw && typeof raw === 'object') entries = Object.entries(raw);
  else throw new Error('Invalid date details');
  const details: DateDetails = {};
  for (const [date, stored] of entries) {
    if (!isValidDate(date) || typeof stored !== 'string') throw new Error('Invalid date details');
    const detail: unknown = JSON.parse(stored);
    if (!isDateDetail(detail)) throw new Error('Invalid date details');
    if (date >= `${range.first}-01` && date <= range.lastDate) details[date] = detail;
  }
  return details;
}

/** Only source/date labels are derived; private event IDs and notes never leave snapshots. */
function deriveDateSources(rawSnapshots: unknown[], confirmedDates: string[], range: ReturnType<typeof monthRange>): DateSources {
  const sources: DateSources = {};
  const include = (date: string, source: BookingSource) => {
    if (date < `${range.first}-01` || date > range.lastDate) return;
    const values = sources[date] ??= [];
    if (!values.includes(source)) values.push(source);
  };
  for (const [index, source] of (['airbnb', 'booking'] as const).entries()) {
    const raw = rawSnapshots[index];
    if (raw === null) continue;
    if (typeof raw !== 'string') throw new Error('Invalid calendar sources');
    const snapshot = JSON.parse(raw) as { events?: unknown };
    if (!snapshot || !Array.isArray(snapshot.events) || snapshot.events.length > 2000) throw new Error('Invalid calendar sources');
    for (const candidate of snapshot.events) {
      if (!candidate || typeof candidate !== 'object') throw new Error('Invalid calendar sources');
      const event = candidate as Record<string, unknown>;
      if (event.room !== ROOM || event.source !== source || !isValidDate(event.checkIn) || !isValidDate(event.checkOut) || event.checkOut <= event.checkIn) throw new Error('Invalid calendar sources');
      const start = Date.parse(`${event.checkIn}T00:00:00Z`);
      const end = Date.parse(`${event.checkOut}T00:00:00Z`);
      if (end - start > 730 * 86_400_000) throw new Error('Invalid calendar sources');
      for (let at = start; at < end; at += 86_400_000) include(new Date(at).toISOString().slice(0, 10), source);
    }
  }
  confirmedDates.forEach(date => include(date, 'direct'));
  return sources;
}

interface CalendarUpdate { add: string[]; remove: string[]; initialize: boolean; dateDetails: Record<string, DateDetail | null> }

function parseUpdate(body: unknown, now: Date): CalendarUpdate | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['add', 'remove', 'initialize', 'dateDetails'].includes(key))) return null;
  const add = value.add ?? [];
  const remove = value.remove ?? [];
  const initialize = value.initialize ?? false;
  if (!Array.isArray(add) || !Array.isArray(remove) || typeof initialize !== 'boolean') return null;
  const dateDetails = value.dateDetails === undefined ? {} : value.dateDetails;
  if (!dateDetails || typeof dateDetails !== 'object' || Array.isArray(dateDetails)) return null;
  const detailChanges = Object.entries(dateDetails);
  if (add.length + remove.length > 366 || detailChanges.length > 366 || (!add.length && !remove.length && !initialize && !detailChanges.length)) return null;
  const range = monthRange(now);
  if (add.some((date) => !isValidDate(date) || date < range.today || date > range.lastDate)) return null;
  if (remove.some((date) => !isValidDate(date))) return null;
  if (add.some((date) => remove.includes(date))) return null;
  if (detailChanges.some(([date, detail]) => !isValidDate(date) || date < `${range.first}-01` || date > range.lastDate || (detail !== null && !isDateDetail(detail)))) return null;
  return { add: [...new Set(add)], remove: [...new Set(remove)], initialize, dateDetails: dateDetails as CalendarUpdate['dateDetails'] };
}

// One Redis transaction prevents readers seeing a partially applied date update.
const UPDATE_SCRIPT = `
local add = cjson.decode(ARGV[1])
local remove = cjson.decode(ARGV[2])
for _, date in ipairs(add) do redis.call('SADD', KEYS[1], date) end
for _, date in ipairs(remove) do redis.call('SREM', KEYS[1], date) end
if ARGV[3] == '1' then redis.call('SET', KEYS[2], '1') end
return 1
`;

// Metadata and availability are saved together; annotations never alter source calendars.
const UPDATE_WITH_DETAILS_SCRIPT = `
local add = cjson.decode(ARGV[1])
local remove = cjson.decode(ARGV[2])
local details = cjson.decode(ARGV[4])
local expected = { 'set', 'string', 'hash' }
for index, key in ipairs(KEYS) do
  local stored = redis.call('TYPE', key).ok
  if stored ~= 'none' and stored ~= expected[index] then return redis.error_reply('Invalid calendar storage type') end
end
for _, date in ipairs(add) do redis.call('SADD', KEYS[1], date) end
for _, date in ipairs(remove) do redis.call('SREM', KEYS[1], date) end
if ARGV[3] == '1' then redis.call('SET', KEYS[2], '1') end
for date, detail in pairs(details) do
  if detail == cjson.null then redis.call('HDEL', KEYS[3], date)
  else redis.call('HSET', KEYS[3], date, cjson.encode(detail)) end
end
return 1
`;

export function createAdminAvailabilityHandler(options: HandlerOptions = {}) {
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
    if (!await authorizeAdmin(req, env, command)) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }
    if (!configured(env)) {
      unavailable(res);
      return;
    }
    try {
      if (req.method === 'PATCH') {
        const contentType = req.headers['content-type'];
        if (typeof contentType !== 'string' || contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
          res.status(415).json({ error: 'Send an application/json request.' });
          return;
        }
        const update = parseUpdate(req.body, now());
        if (!update) {
          res.status(400).json({ error: 'Provide valid date changes, booking sources, and notes of up to 2,000 characters within the displayed calendar.' });
          return;
        }
        if (Object.keys(update.dateDetails).length) {
          await command(['EVAL', UPDATE_WITH_DETAILS_SCRIPT, 3, BLOCKED_KEY, INITIALIZED_KEY, DATE_DETAILS_KEY,
            JSON.stringify(update.add), JSON.stringify(update.remove), update.initialize ? '1' : '0', JSON.stringify(update.dateDetails)]);
        } else {
          await command(['EVAL', UPDATE_SCRIPT, 2, BLOCKED_KEY, INITIALIZED_KEY,
            JSON.stringify(update.add), JSON.stringify(update.remove), update.initialize ? '1' : '0']);
        }
      }
      const calendar = await readCalendar(command);
      const [categories, rawDetails, rawSnapshots] = await Promise.all([
        Promise.all([BLOCKED_KEY, CONFIRMED_KEY, IMPORTED_KEY].map(key => command(['SMEMBERS', key]))),
        command(['HGETALL', DATE_DETAILS_KEY]),
        Promise.all(['airbnb', 'booking'].map(source => command(['GET', `mooncrab:ical:source:${source}`]))),
      ]);
      if (categories.some(dates => !Array.isArray(dates) || dates.some(date => !isValidDate(date)))) throw new Error('Invalid calendar categories');
      const range = monthRange(now());
      const dateDetails = readDateDetails(rawDetails, range);
      const dateSources = deriveDateSources(rawSnapshots, categories[1] as string[], range);
      res.status(200).json({ room: ROOM, ...calendar, manualDates: (categories[0] as string[]).sort(), confirmedDates: (categories[1] as string[]).sort(), importedDates: (categories[2] as string[]).sort(), dateDetails, dateSources });
    } catch {
      unavailable(res);
    }
  };
}
