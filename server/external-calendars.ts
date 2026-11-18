import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { authorizeAdmin } from './admin-auth.ts';
import {
  configured, createRedisCommand, isValidDate, manilaDate, monthRange, setHeaders, unavailable,
} from './availability.ts';
import type { ApiRequest, ApiResponse, Environment, HandlerOptions, RedisCommand } from './availability.ts';

export type CalendarSource = 'airbnb' | 'booking';
export const IMPORTED_DATES_KEY = 'mooncrab:imported-dates';
const SOURCES: CalendarSource[] = ['airbnb', 'booking'];
const SOURCE_PREFIX = 'mooncrab:ical:source:';
const SYNC_LOCK = 'mooncrab:ical:sync-lock';
const MAX_BYTES = 1_048_576;
const MAX_EVENTS = 2000;
const STALE_AFTER_MS = 26 * 3_600_000;

export interface ImportedEvent {
  id: string;
  source: CalendarSource;
  room: 'KASAG';
  checkIn: string;
  checkOut: string;
}

interface SourceSnapshot {
  events: ImportedEvent[];
  lastAttempt: string | null;
  lastSuccess: string | null;
  error: string | null;
}

export interface CalendarSyncStatus {
  source: CalendarSource;
  configured: boolean;
  lastAttempt: string | null;
  lastSuccess: string | null;
  stale: boolean;
  eventCount: number;
  error: string | null;
}

export interface CalendarOptions extends HandlerOptions {
  fetcher?: typeof fetch;
}

function sourceUrl(source: CalendarSource, env: Environment): string | undefined {
  return source === 'airbnb' ? env.AIRBNB_ICAL_URL : env.BOOKING_COM_ICAL_URL;
}

/** Only provider-owned HTTPS export endpoints may be requested; redirects are refused. */
export function validateCalendarUrl(source: CalendarSource, value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('invalid_feed_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash) {
    throw new Error('invalid_feed_url');
  }
  const allowed = source === 'airbnb'
    ? ['www.airbnb.com', 'airbnb.com']
    : ['ical.booking.com', 'admin.booking.com'];
  if (!allowed.includes(url.hostname.toLowerCase())) throw new Error('invalid_feed_url');
  if (source === 'airbnb' && !/^\/calendar\/ical\/[^/]+\.ics$/.test(url.pathname)) throw new Error('invalid_feed_url');
  if (source === 'booking' && url.hostname === 'ical.booking.com'
      && url.pathname !== '/v1/export' && !url.pathname.startsWith('/v1/export/')) throw new Error('invalid_feed_url');
  if (source === 'booking' && url.hostname === 'admin.booking.com' && url.pathname !== '/hotel/hoteladmin/ical.html') throw new Error('invalid_feed_url');
  return url;
}

function parseDate(property: string, value: string): string {
  const pieces = property.toUpperCase().split(';');
  const parameters = pieces.slice(1);
  if (parameters.some(parameter => !['VALUE=DATE', 'VALUE=DATE-TIME', 'TZID=ASIA/MANILA', 'TZID="ASIA/MANILA"'].includes(parameter))) {
    throw new Error('unsupported_date_format');
  }
  if (/^\d{8}$/.test(value)) {
    if (parameters.some(parameter => parameter !== 'VALUE=DATE')) throw new Error('invalid_date');
    const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    if (!isValidDate(date)) throw new Error('invalid_date');
    return date;
  }
  const utc = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (utc && !parameters.some(parameter => parameter.startsWith('TZID=') || parameter === 'VALUE=DATE')) {
    const iso = `${utc[1]}-${utc[2]}-${utc[3]}T${utc[4]}:${utc[5]}:${utc[6]}.000Z`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== iso) throw new Error('invalid_date');
    return manilaDate(date);
  }
  const local = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (local && parameters.some(parameter => parameter === 'TZID=ASIA/MANILA' || parameter === 'TZID="ASIA/MANILA"')) {
    const date = `${local[1]}-${local[2]}-${local[3]}`;
    if (!isValidDate(date) || +local[4] > 23 || +local[5] > 59 || +local[6] > 59) throw new Error('invalid_date');
    return date;
  }
  // Floating times and unfamiliar zones are not guessed; retain the prior good import.
  throw new Error('unsupported_date_format');
}

export function eventNights(event: Pick<ImportedEvent, 'checkIn' | 'checkOut'>): string[] {
  const result: string[] = [];
  for (let at = Date.parse(`${event.checkIn}T00:00:00Z`); at < Date.parse(`${event.checkOut}T00:00:00Z`); at += 86_400_000) {
    if (result.length >= 730) throw new Error('event_too_long');
    result.push(new Date(at).toISOString().slice(0, 10));
  }
  return result;
}

/** Import only complete, finite VEVENT snapshots. No guest names/notes are retained. */
export function parseICalendar(text: string, source: CalendarSource): ImportedEvent[] {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES || text.includes('\0')) throw new Error('invalid_calendar');
  const lines = text.replace(/^\uFEFF/, '').replace(/\r?\n[\t ]/g, '').split(/\r?\n/).map(line => line.trimEnd());
  const meaningful = lines.filter(line => line.trim());
  if (meaningful[0] !== 'BEGIN:VCALENDAR' || meaningful.at(-1) !== 'END:VCALENDAR'
      || meaningful.filter(line => line === 'BEGIN:VCALENDAR').length !== 1
      || meaningful.filter(line => line === 'END:VCALENDAR').length !== 1) throw new Error('invalid_calendar');
  const entries = new Map<string, { event: ImportedEvent | null; sequence: number; fingerprint: string }>();
  let fields: Map<string, { property: string; value: string }> | null = null;
  let eventCount = 0;
  for (const line of meaningful) {
    if (line === 'BEGIN:VEVENT') {
      if (fields || ++eventCount > MAX_EVENTS) throw new Error('invalid_calendar');
      fields = new Map();
      continue;
    }
    if (line === 'END:VEVENT') {
      if (!fields) throw new Error('invalid_calendar');
      const uid = fields.get('UID')?.value;
      if (!uid || uid.length > 1000) throw new Error('invalid_event');
      const id = createHash('sha256').update(`${source}:${uid}`).digest('hex');
      const sequenceText = fields.get('SEQUENCE')?.value ?? '0';
      if (!/^\d{1,9}$/.test(sequenceText)) throw new Error('invalid_event');
      const sequence = +sequenceText;
      const cancelled = fields.get('STATUS')?.value.toUpperCase() === 'CANCELLED';
      let event: ImportedEvent | null = null;
      if (!cancelled) {
        const begin = fields.get('DTSTART');
        const end = fields.get('DTEND');
        if (!begin || !end) throw new Error('missing_event_dates');
        const checkIn = parseDate(begin.property, begin.value);
        const checkOut = parseDate(end.property, end.value);
        if (checkOut <= checkIn) throw new Error('invalid_event_range');
        event = { id, source, room: 'KASAG', checkIn, checkOut };
        eventNights(event);
      }
      const fingerprint = JSON.stringify(event);
      const previous = entries.get(id);
      if (previous && previous.sequence === sequence && previous.fingerprint !== fingerprint) throw new Error('ambiguous_duplicate_event');
      if (!previous || previous.sequence <= sequence) entries.set(id, { event, sequence, fingerprint });
      fields = null;
      continue;
    }
    if (!fields) continue;
    if (line.startsWith('BEGIN:') || line.startsWith('END:')) throw new Error('unsupported_event_component');
    const separator = line.indexOf(':');
    if (separator < 1) throw new Error('invalid_event');
    const property = line.slice(0, separator);
    const name = property.split(';')[0].toUpperCase();
    const value = line.slice(separator + 1);
    if (['RRULE', 'RDATE', 'EXDATE', 'RECURRENCE-ID', 'DURATION'].includes(name)) throw new Error('unsupported_recurrence');
    if (['UID', 'DTSTART', 'DTEND', 'STATUS', 'SEQUENCE'].includes(name)) {
      if (fields.has(name)) throw new Error('duplicate_event_property');
      fields.set(name, { property, value });
    }
  }
  if (fields) throw new Error('incomplete_calendar');
  return [...entries.values()].flatMap(entry => entry.event ? [entry.event] : []);
}

function emptySnapshot(): SourceSnapshot {
  return { events: [], lastAttempt: null, lastSuccess: null, error: null };
}

function readSnapshot(raw: unknown, source: CalendarSource): SourceSnapshot {
  if (raw === null) return emptySnapshot();
  if (typeof raw !== 'string') throw new Error('invalid_sync_storage');
  const value = JSON.parse(raw) as SourceSnapshot;
  if (!value || !Array.isArray(value.events)
      || value.events.some(event => event.source !== source || event.room !== 'KASAG' || typeof event.id !== 'string'
        || !isValidDate(event.checkIn) || !isValidDate(event.checkOut) || event.checkOut <= event.checkIn)) {
    throw new Error('invalid_sync_storage');
  }
  for (const field of ['lastAttempt', 'lastSuccess'] as const) {
    if (value[field] !== null && (typeof value[field] !== 'string' || !Number.isFinite(Date.parse(value[field]!)))) throw new Error('invalid_sync_storage');
  }
  if (value.error !== null && typeof value.error !== 'string') throw new Error('invalid_sync_storage');
  return value;
}

function safeStatus(source: CalendarSource, snapshot: SourceSnapshot, env: Environment, now: Date): CalendarSyncStatus {
  return {
    source, configured: Boolean(sourceUrl(source, env)),
    lastAttempt: snapshot.lastAttempt, lastSuccess: snapshot.lastSuccess,
    stale: !snapshot.lastSuccess || now.getTime() - Date.parse(snapshot.lastSuccess) > STALE_AFTER_MS,
    eventCount: snapshot.events.length, error: snapshot.error,
  };
}

export async function calendarSyncStatus(command: RedisCommand, env: Environment, now = new Date()) {
  const sources = await Promise.all(SOURCES.map(async source => {
    const snapshot = readSnapshot(await command(['GET', `${SOURCE_PREFIX}${source}`]), source);
    return safeStatus(source, snapshot, env, now);
  }));
  return { room: 'KASAG', sources, mode: 'periodic-import', realtime: false };
}

/** One script replaces a source snapshot and rebuilds only the imported date set. */
export const COMMIT_IMPORT_SCRIPT = `
local first = cjson.decode(ARGV[2])
local second = cjson.decode(ARGV[3])
redis.call('SET', KEYS[1], ARGV[1])
redis.call('DEL', KEYS[2])
for _, date in ipairs(first) do redis.call('SADD', KEYS[2], date) end
for _, date in ipairs(second) do redis.call('SADD', KEYS[2], date) end
return 1
`;

const RELEASE_LOCK_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;

async function fetchCalendar(url: URL, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url, {
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000),
    headers: { Accept: 'text/calendar, application/octet-stream;q=0.9', 'User-Agent': 'MooncrabCalendar/1.0' },
  });
  if (!response.ok || !response.body) throw new Error('fetch_failed');
  const advertised = response.headers.get('content-length');
  if (advertised && Number(advertised) > MAX_BYTES) { await response.body.cancel(); throw new Error('feed_too_large'); }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('feed_too_large');
      chunks.push(next.value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  return Buffer.concat(chunks).toString('utf8');
}

function errorCode(error: unknown): string {
  const allowed = ['invalid_feed_url', 'invalid_calendar', 'invalid_event', 'missing_event_dates', 'invalid_event_range', 'invalid_date', 'unsupported_date_format', 'unsupported_recurrence', 'unsupported_event_component', 'duplicate_event_property', 'ambiguous_duplicate_event', 'incomplete_calendar', 'feed_too_large', 'event_too_long'];
  return error instanceof Error && allowed.includes(error.message) ? error.message : 'fetch_failed';
}

export async function syncExternalCalendars(options: CalendarOptions = {}) {
  const env = options.env ?? process.env;
  const command = options.command ?? createRedisCommand(env);
  const now = options.now ?? (() => new Date());
  const fetcher = options.fetcher ?? fetch;
  const lock = randomUUID();
  const acquired = await command(['SET', SYNC_LOCK, lock, 'NX', 'EX', 90]);
  if (acquired !== 'OK') return { ...(await calendarSyncStatus(command, env, now())), busy: true };
  try {
    const snapshots = new Map<CalendarSource, SourceSnapshot>();
    for (const source of SOURCES) snapshots.set(source, readSnapshot(await command(['GET', `${SOURCE_PREFIX}${source}`]), source));
    for (const source of SOURCES) {
      const feed = sourceUrl(source, env);
      if (!feed) continue; // Removing configuration never silently releases the last imported nights.
      const timestamp = now().toISOString();
      const previous = snapshots.get(source)!;
      let next: SourceSnapshot;
      try {
        const text = await fetchCalendar(validateCalendarUrl(source, feed), fetcher);
        const events = parseICalendar(text, source);
        next = { events, lastAttempt: timestamp, lastSuccess: timestamp, error: null };
      } catch (error) {
        next = { ...previous, lastAttempt: timestamp, error: errorCode(error) };
      }
      snapshots.set(source, next);
      const horizon = monthRange(now());
      const dates = SOURCES.map(current => [...new Set(snapshots.get(current)!.events.flatMap(eventNights))]
        .filter(date => date >= horizon.today && date <= horizon.lastDate));
      await command(['EVAL', COMMIT_IMPORT_SCRIPT, 2, `${SOURCE_PREFIX}${source}`, IMPORTED_DATES_KEY, JSON.stringify(next), JSON.stringify(dates[0]), JSON.stringify(dates[1])]);
    }
    return { ...(await calendarSyncStatus(command, env, now())), busy: false };
  } finally {
    await command(['EVAL', RELEASE_LOCK_SCRIPT, 1, SYNC_LOCK, lock]);
  }
}

function cronAuthorized(req: ApiRequest, env: Environment): boolean {
  const expected = env.CRON_SECRET;
  const supplied = req.headers.authorization;
  if (!expected || typeof supplied !== 'string') return false;
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(`Bearer ${expected}`), hash(supplied));
}

export function createCalendarSyncHandler(options: CalendarOptions = {}) {
  const env = options.env ?? process.env;
  const command = options.command ?? createRedisCommand(env);
  const now = options.now ?? (() => new Date());
  return async (req: ApiRequest, res: ApiResponse): Promise<void> => {
    setHeaders(res);
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST'); res.status(405).json({ error: 'Method not allowed.' }); return;
    }
    const cron = req.method === 'GET' && req.query?.action === 'sync' && cronAuthorized(req, env);
    if (!cron && !await authorizeAdmin(req, env, command)) { res.status(401).json({ error: 'Unauthorized.' }); return; }
    if (!configured(env)) { unavailable(res); return; }
    try {
      if (req.method === 'POST' || cron) res.status(200).json(await syncExternalCalendars({ ...options, env, command, now }));
      else res.status(200).json(await calendarSyncStatus(command, env, now()));
    } catch { res.status(503).json({ error: 'Calendar synchronization is temporarily unavailable. Existing blocks are retained.' }); }
  };
}
