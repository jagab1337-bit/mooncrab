import { createHash, timingSafeEqual } from 'node:crypto';

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
export const INITIALIZED_KEY = 'mooncrab:availability-initialized';
const UNAVAILABLE = 'The booking calendar is temporarily unavailable. Please check back soon.';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

export function configured(env: Environment): boolean {
  if (!env.UPSTASH_REDIS_REST_TOKEN || !env.UPSTASH_REDIS_REST_URL) return false;
  try {
    const url = new URL(env.UPSTASH_REDIS_REST_URL);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function createRedisCommand(env: Environment): RedisCommand {
  return async (command) => {
    if (!configured(env)) throw new Error('Calendar storage is not configured');
    const response = await fetch(env.UPSTASH_REDIS_REST_URL!, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN!}`,
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
    command(['SUNION', BLOCKED_KEY, CONFIRMED_KEY]),
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

interface CalendarUpdate { add: string[]; remove: string[]; initialize: boolean }

function parseUpdate(body: unknown, now: Date): CalendarUpdate | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['add', 'remove', 'initialize'].includes(key))) return null;
  const add = value.add ?? [];
  const remove = value.remove ?? [];
  const initialize = value.initialize ?? false;
  if (!Array.isArray(add) || !Array.isArray(remove) || typeof initialize !== 'boolean') return null;
  if (add.length + remove.length > 366 || (!add.length && !remove.length && !initialize)) return null;
  const range = monthRange(now);
  if (add.some((date) => !isValidDate(date) || date < range.today || date > range.lastDate)) return null;
  if (remove.some((date) => !isValidDate(date))) return null;
  if (add.some((date) => remove.includes(date))) return null;
  return { add: [...new Set(add)], remove: [...new Set(remove)], initialize };
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
    if (!authorized(req, env)) {
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
          res.status(400).json({ error: 'Provide up to 366 valid date changes within the next 24 months.' });
          return;
        }
        await command([
          'EVAL', UPDATE_SCRIPT, 2, BLOCKED_KEY, INITIALIZED_KEY,
          JSON.stringify(update.add), JSON.stringify(update.remove), update.initialize ? '1' : '0',
        ]);
      }
      const calendar = await readCalendar(command);
      res.status(200).json({ room: ROOM, ...calendar });
    } catch {
      unavailable(res);
    }
  };
}
