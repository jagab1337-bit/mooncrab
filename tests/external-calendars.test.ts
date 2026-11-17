import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COMMIT_IMPORT_SCRIPT, IMPORTED_DATES_KEY, calendarSyncStatus, createCalendarSyncHandler,
  eventNights, parseICalendar, syncExternalCalendars, validateCalendarUrl,
} from '../server/external-calendars.ts';
import type { ApiResponse, RedisCommand } from '../server/availability.ts';

const calendar = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events}\r\nEND:VCALENDAR\r\n`;
const event = (uid: string, start: string, end: string, extra = '') => `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;VALUE=DATE:${start}\r\nDTEND;VALUE=DATE:${end}\r\n${extra}END:VEVENT`;
const FEED = 'https://www.airbnb.com/calendar/ical/example.ics?s=private';
const ENV = { UPSTASH_REDIS_REST_URL: 'https://example.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'test', AIRBNB_ICAL_URL: FEED, BOOKING_ADMIN_TOKEN: 'owner-test' };
const NOW = new Date('2026-11-18T02:00:00Z');

function fakeRedis() {
  const values = new Map<string, string>();
  const sets = new Map<string, Set<string>>([
    ['mooncrab:blocked-dates', new Set(['2026-12-01'])],
    ['mooncrab:confirmed-dates', new Set(['2026-12-05'])],
  ]);
  const calls: Array<Array<string | number>> = [];
  const command: RedisCommand = async call => {
    calls.push(call);
    const [verb, ...args] = call;
    if (verb === 'GET') return values.get(String(args[0])) ?? null;
    if (verb === 'SET') {
      const [key, value] = args.map(String);
      if (args.includes('NX') && values.has(key)) return null;
      values.set(key, value); return 'OK';
    }
    if (verb === 'EVAL') {
      if (args[0] === COMMIT_IMPORT_SCRIPT) {
        const key = String(args[2]);
        const aggregate = String(args[3]);
        values.set(key, String(args[4]));
        sets.set(aggregate, new Set([...JSON.parse(String(args[5])), ...JSON.parse(String(args[6]))]));
        return 1;
      }
      const lockKey = String(args[2]);
      if (values.get(lockKey) === args[3]) { values.delete(lockKey); return 1; }
      return 0;
    }
    throw new Error(`Unexpected fake command: ${verb}`);
  };
  return { values, sets, command, calls };
}

test('iCal all-day checkout is exclusive and stable IDs deduplicate repeated records', () => {
  const raw = calendar(`${event('same-id', '20261217', '20261220')}\r\n${event('same-id', '20261217', '20261220')}`);
  const events = parseICalendar(raw, 'airbnb');
  assert.equal(events.length, 1);
  assert.deepEqual(eventNights(events[0]), ['2026-12-17', '2026-12-18', '2026-12-19']);
  assert.equal(events[0].room, 'KASAG');
  assert.match(events[0].id, /^[a-f0-9]{64}$/);
  assert.equal(events[0].id.includes('same-id'), false);
});

test('iCal UTC and explicit Philippine timestamps become Manila calendar dates', () => {
  const utc = calendar('BEGIN:VEVENT\r\nUID:utc\r\nDTSTART:20261217T180000Z\r\nDTEND:20261219T180000Z\r\nEND:VEVENT');
  assert.deepEqual(eventNights(parseICalendar(utc, 'booking')[0]), ['2026-12-18', '2026-12-19']);
  const local = calendar('BEGIN:VEVENT\r\nUID:local\r\nDTSTART;TZID=Asia/Manila:20261217T140000\r\nDTEND;TZID=Asia/Manila:20261219T110000\r\nEND:VEVENT');
  assert.deepEqual(eventNights(parseICalendar(local, 'booking')[0]), ['2026-12-17', '2026-12-18']);
});

test('canceled events and higher-sequence updates are reconciled without retaining private summaries', () => {
  const raw = calendar(`${event('one', '20261217', '20261219', 'SEQUENCE:1\r\nSUMMARY:Private Guest Name\r\n')}\r\n${event('one', '20261217', '20261219', 'SEQUENCE:2\r\nSTATUS:CANCELLED\r\n')}`);
  assert.deepEqual(parseICalendar(raw, 'airbnb'), []);
  const data = parseICalendar(calendar(event('guest', '20261217', '20261219', 'SUMMARY:Private Guest Name\r\nDESCRIPTION:Private details\r\n')), 'airbnb');
  assert.equal(JSON.stringify(data).includes('Private'), false);
});

test('recurrence, ambiguous duplicates, broken calendars, floating times and invalid dates fail closed', () => {
  const bad = [
    calendar(event('repeat', '20261217', '20261219', 'RRULE:FREQ=DAILY\r\n')),
    calendar(`${event('duplicate', '20261217', '20261219')}\r\n${event('duplicate', '20261220', '20261222')}`),
    calendar(event('invalid', '20260230', '20260301')),
    'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:broken\r\nEND:VCALENDAR',
    calendar('BEGIN:VEVENT\r\nUID:floating\r\nDTSTART:20261217T140000\r\nDTEND:20261219T110000\r\nEND:VEVENT'),
    calendar('BEGIN:VEVENT\r\nUID:zone\r\nDTSTART;TZID=America/New_York:20261217T140000\r\nDTEND;TZID=America/New_York:20261219T110000\r\nEND:VEVENT'),
  ];
  for (const raw of bad) assert.throws(() => parseICalendar(raw, 'airbnb'));
});

test('feed allowlist rejects SSRF, credentials, provider lookalikes, ports and unrelated provider paths', () => {
  assert.equal(validateCalendarUrl('airbnb', FEED).hostname, 'www.airbnb.com');
  assert.equal(validateCalendarUrl('booking', 'https://ical.booking.com/v1/export/token.ics').hostname, 'ical.booking.com');
  for (const url of ['http://www.airbnb.com/calendar/ical/a.ics', 'https://127.0.0.1/a.ics', 'https://www.airbnb.com.evil.test/calendar/ical/a.ics', 'https://user:pass@www.airbnb.com/calendar/ical/a.ics', 'https://www.airbnb.com:8443/calendar/ical/a.ics', 'https://www.airbnb.com/rooms/1']) {
    assert.throws(() => validateCalendarUrl('airbnb', url));
  }
  assert.throws(() => validateCalendarUrl('booking', 'https://www.booking.com/hotel/ph/moon-crab.html'));
});

test('successful snapshot import atomically blocks nights while preserving manual and confirmed dates', async () => {
  const redis = fakeRedis();
  let requests = 0;
  const fetcher: typeof fetch = async (_url, options) => {
    requests++;
    assert.equal(options?.redirect, 'error');
    return new Response(calendar(event('a', '20261217', '20261219')), { headers: { 'Content-Type': 'text/calendar' } });
  };
  const result = await syncExternalCalendars({ env: ENV, command: redis.command, fetcher, now: () => NOW });
  assert.equal(requests, 1);
  assert.equal(result.sources[0].eventCount, 1);
  assert.equal(result.sources[0].lastSuccess, NOW.toISOString());
  assert.equal(result.sources[0].stale, false);
  assert.deepEqual([...redis.sets.get(IMPORTED_DATES_KEY)!], ['2026-12-17', '2026-12-18']);
  assert.deepEqual([...redis.sets.get('mooncrab:blocked-dates')!], ['2026-12-01']);
  assert.deepEqual([...redis.sets.get('mooncrab:confirmed-dates')!], ['2026-12-05']);
  const safe = JSON.stringify(result);
  assert.equal(safe.includes('private'), false);
  assert.equal(safe.includes('example.ics'), false);
});

test('failed fetch/parse retains last good dates and a later valid cancellation releases imported-only dates', async () => {
  const redis = fakeRedis();
  const run = (raw: string) => syncExternalCalendars({ env: ENV, command: redis.command, now: () => NOW, fetcher: async () => new Response(raw) });
  await run(calendar(event('a', '20261217', '20261219')));
  const failed = await run('<html>Sign in</html>');
  assert.equal(failed.sources[0].error, 'invalid_calendar');
  assert.deepEqual([...redis.sets.get(IMPORTED_DATES_KEY)!], ['2026-12-17', '2026-12-18']);
  await run(calendar(event('a', '20261217', '20261219', 'STATUS:CANCELLED\r\n')));
  assert.equal(redis.sets.get(IMPORTED_DATES_KEY)!.size, 0);
  assert.equal(redis.sets.get('mooncrab:blocked-dates')!.size, 1);
  assert.equal(redis.sets.get('mooncrab:confirmed-dates')!.size, 1);
});

test('reconciling one source preserves the other source and limits blocked nights to the booking horizon', async () => {
  const redis = fakeRedis();
  const env = { ...ENV, BOOKING_COM_ICAL_URL: 'https://ical.booking.com/v1/export/example.ics' };
  let cancelAirbnb = false;
  const fetcher: typeof fetch = async url => new Response(calendar(String(url).includes('airbnb.com')
    ? event('airbnb-stay', '20261217', '20261219', cancelAirbnb ? 'STATUS:CANCELLED\r\n' : '')
    : `${event('booking-stay', '20261220', '20261222')}\r\n${event('old', '20240101', '20240103')}\r\n${event('distant', '20400101', '20400103')}`));
  await syncExternalCalendars({ env, command: redis.command, fetcher, now: () => NOW });
  assert.deepEqual([...redis.sets.get(IMPORTED_DATES_KEY)!], ['2026-12-17', '2026-12-18', '2026-12-20', '2026-12-21']);
  cancelAirbnb = true;
  await syncExternalCalendars({ env, command: redis.command, fetcher, now: () => NOW });
  assert.deepEqual([...redis.sets.get(IMPORTED_DATES_KEY)!], ['2026-12-20', '2026-12-21']);
});

test('missing feed configuration reports unconfigured and does not invent a successful sync', async () => {
  const redis = fakeRedis();
  const result = await syncExternalCalendars({ env: {}, command: redis.command, now: () => NOW, fetcher: async () => { throw new Error('Must not fetch'); } });
  assert.equal(result.sources.every(source => !source.configured && source.lastSuccess === null && source.stale), true);
  assert.equal(redis.calls.some(call => call.includes(COMMIT_IMPORT_SCRIPT)), false);
});

test('an in-progress synchronization lock prevents competing fetches', async () => {
  const redis = fakeRedis();
  redis.values.set('mooncrab:ical:sync-lock', 'other-job');
  const result = await syncExternalCalendars({ env: ENV, command: redis.command, now: () => NOW, fetcher: async () => { throw new Error('Must not fetch'); } });
  assert.equal(result.busy, true);
  assert.equal(redis.values.get('mooncrab:ical:sync-lock'), 'other-job');
});

test('staleness is based on the last successful import rather than the last attempt', async () => {
  const redis = fakeRedis();
  await syncExternalCalendars({ env: ENV, command: redis.command, now: () => NOW, fetcher: async () => new Response(calendar('')) });
  const result = await calendarSyncStatus(redis.command, ENV, new Date('2026-11-19T05:00:00Z'));
  assert.equal(result.sources[0].stale, true);
});

test('calendar sync endpoint denies an unauthenticated request before returning private source state', async () => {
  const redis = fakeRedis();
  let code = 0;
  let body: unknown;
  const res: ApiResponse = { setHeader() {}, status(value) { code = value; return this; }, json(value) { body = value; } };
  await createCalendarSyncHandler({ env: ENV, command: redis.command })({ method: 'GET', headers: {} }, res);
  assert.equal(code, 401);
  assert.deepEqual(body, { error: 'Unauthorized.' });
});
