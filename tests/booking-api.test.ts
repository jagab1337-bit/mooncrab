import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdminAvailabilityHandler,
  createAvailabilityHandler,
  createRedisCommand,
  isValidDate,
  manilaDate,
  monthRange,
} from '../server/availability.ts';
import type { ApiRequest, ApiResponse, Environment, RedisCommand } from '../server/availability.ts';

const now = () => new Date('2026-11-17T18:00:00.000Z'); // November 18 in Siargao.
const env: Environment = {
  UPSTASH_REDIS_REST_URL: 'https://calendar.example.invalid',
  UPSTASH_REDIS_REST_TOKEN: 'test-redis-token',
  BOOKING_ADMIN_TOKEN: 'test-admin-token',
};

test('Siargao date rolls at UTC16:00 and month horizon includes exactly 24 displayed months', () => {
  assert.equal(manilaDate(new Date('2026-11-17T15:59:59Z')), '2026-11-17');
  assert.equal(manilaDate(new Date('2026-11-17T16:00:00Z')), '2026-11-18');
  assert.deepEqual(monthRange(new Date('2026-11-17T16:00:00Z')), {
    first: '2026-11', last: '2028-10', today: '2026-11-18', lastDate: '2028-10-31',
  });
});

function response() {
  return {
    code: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; },
    status(code: number) { this.code = code; return this; },
    json(body: unknown) { this.body = body; },
  };
}

function memoryCalendar(initialized = true, dates: string[] = []) {
  const blocked = new Set(dates);
  const commands: Array<Array<string | number>> = [];
  const command: RedisCommand = async (args) => {
    commands.push(args);
    if (args[0] === 'GET') return initialized ? '1' : null;
    if (args[0] === 'SUNION') return [...blocked];
    if (args[0] === 'EVAL') {
      for (const date of JSON.parse(String(args[5]))) blocked.add(date);
      for (const date of JSON.parse(String(args[6]))) blocked.delete(date);
      if (args[7] === '1') initialized = true;
      return 1;
    }
    throw new Error('Unexpected command');
  };
  return { command, commands, blocked };
}

function request(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return { method: 'GET', headers: {}, query: { month: '2026-11' }, ...overrides };
}

function adminRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return request({ headers: { authorization: 'Bearer test-admin-token', 'content-type': 'application/json' }, ...overrides });
}

test('calendar uses the Siargao date and includes exactly 24 calendar months', () => {
  assert.equal(manilaDate(now()), '2026-11-18');
  assert.deepEqual(monthRange(now()), {
    today: '2026-11-18', first: '2026-11', last: '2028-10', lastDate: '2028-10-31',
  });
});

test('validates real dates including leap years', () => {
  assert.equal(isValidDate('2028-02-29'), true);
  for (const value of ['2027-02-29', '2026-11-31', '2026-1-01', 'bad', 123]) {
    assert.equal(isValidDate(value), false);
  }
});

test('public response exposes only blocked dates for the requested month', async () => {
  const store = memoryCalendar(true, ['2026-11-20', '2026-12-01', '2026-11-19']);
  const handler = createAvailabilityHandler({ env, now, command: store.command });
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, {
    configured: true, room: 'KASAG', month: '2026-11', blockedDates: ['2026-11-19', '2026-11-20'],
  });
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('missing storage configuration does not imply an available room', async () => {
  let called = false;
  const handler = createAvailabilityHandler({ env: {}, now, command: async () => { called = true; } });
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 503);
  assert.equal((res.body as { configured: boolean }).configured, false);
  assert.equal(called, false);
  assert.equal(res.headers['retry-after'], '60');
});

test('an empty, uninitialized store fails closed until owner reconciliation', async () => {
  const store = memoryCalendar(false);
  const res = response();
  await createAvailabilityHandler({ env, now, command: store.command })(request(), res);
  assert.equal(res.code, 503);
  assert.equal((res.body as { configured: boolean }).configured, false);
});

test('an intentionally initialized empty calendar is available', async () => {
  const store = memoryCalendar(true);
  const res = response();
  await createAvailabilityHandler({ env, now, command: store.command })(request(), res);
  assert.equal(res.code, 200);
  assert.deepEqual((res.body as { blockedDates: string[] }).blockedDates, []);
});

test('invalid and out-of-horizon month input is rejected before storage is called', async () => {
  const store = memoryCalendar();
  const handler = createAvailabilityHandler({ env, now, command: store.command });
  for (const month of [undefined, '2026-13', '2026-1', '2026-10', '2028-11', ['2026-11']]) {
    const res = response();
    await handler(request({ query: { month } }), res);
    assert.equal(res.code, 400);
  }
  assert.equal(store.commands.length, 0);
});

test('storage failures and corrupt records return generic service errors', async () => {
  for (const command of [
    async () => { throw new Error('SECRET storage error'); },
    async (args: Array<string | number>) => args[0] === 'GET' ? '1' : ['not-a-date'],
  ]) {
    const res = response();
    await createAvailabilityHandler({ env, now, command })(request(), res);
    assert.equal(res.code, 503);
    assert.equal(JSON.stringify(res.body).includes('SECRET'), false);
  }
});

test('public endpoint does not accept mutations', async () => {
  const res = response();
  await createAvailabilityHandler({ env, now })(request({ method: 'POST' }), res);
  assert.equal(res.code, 405);
  assert.equal(res.headers.allow, 'GET');
});

test('HTTP method boundaries reject HEAD and OPTIONS rather than executing owner or public operations', async () => {
  let calls = 0;
  const command: RedisCommand = async () => { calls++; return []; };
  for (const method of [undefined, 'HEAD', 'OPTIONS', 'DELETE', 'PUT']) {
    const publicResponse = response();
    await createAvailabilityHandler({ env, now, command })(request({ method }), publicResponse);
    assert.equal(publicResponse.code, 405);
    const ownerResponse = response();
    await createAdminAvailabilityHandler({ env, now, command })(adminRequest({ method }), ownerResponse);
    assert.equal(ownerResponse.code, 405);
  }
  assert.equal(calls, 0);
});

test('owner endpoint rejects missing, invalid, and absent configured admin tokens', async () => {
  const store = memoryCalendar();
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: ['Bearer test-admin-token'] }]) {
    const res = response();
    await createAdminAvailabilityHandler({ env, now, command: store.command })(request({ headers }), res);
    assert.equal(res.code, 401);
  }
  const res = response();
  await createAdminAvailabilityHandler({ env: { ...env, BOOKING_ADMIN_TOKEN: undefined }, now, command: store.command })(adminRequest(), res);
  assert.equal(res.code, 401);
  assert.equal(store.commands.length, 0);
});

test('authenticated owner can read all calendar dates and initialization state', async () => {
  const store = memoryCalendar(false, ['2026-12-01', '2026-11-20']);
  const res = response();
  await createAdminAvailabilityHandler({ env, now, command: store.command })(adminRequest(), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { room: 'KASAG', initialized: false, blockedDates: ['2026-11-20', '2026-12-01'] });
});

test('owner can reconcile dates and initialize a calendar in a single transaction', async () => {
  const store = memoryCalendar(false, ['2026-11-20']);
  const res = response();
  await createAdminAvailabilityHandler({ env, now, command: store.command })(adminRequest({
    method: 'PATCH', body: { add: ['2026-11-21', '2026-11-21'], remove: ['2026-11-20'], initialize: true },
  }), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { room: 'KASAG', initialized: true, blockedDates: ['2026-11-21'] });
  assert.equal(store.commands.filter((command) => command[0] === 'EVAL').length, 1);
  const publicResponse = response();
  await createAvailabilityHandler({ env, now, command: store.command })(request(), publicResponse);
  assert.equal(publicResponse.code, 200);
});

test('owner may remove historic blocks but cannot add past or out-of-range blocks', async () => {
  const store = memoryCalendar(true, ['2026-01-01']);
  const handler = createAdminAvailabilityHandler({ env, now, command: store.command });
  for (const body of [
    { add: ['2026-11-17'] }, { add: ['2028-11-01'] }, { add: ['2027-02-29'] },
    { add: ['2026-11-20'], remove: ['2026-11-20'] }, { initialize: 'true' },
    { add: Array(367).fill('2026-11-20') }, { room: 'another-room' }, {},
  ]) {
    const res = response();
    await handler(adminRequest({ method: 'PATCH', body }), res);
    assert.equal(res.code, 400);
  }
  assert.equal(store.commands.length, 0);
  const res = response();
  await handler(adminRequest({ method: 'PATCH', body: { remove: ['2026-01-01'] } }), res);
  assert.equal(res.code, 200);
  assert.deepEqual((res.body as { blockedDates: string[] }).blockedDates, []);
});

test('owner mutations require JSON content type', async () => {
  const store = memoryCalendar();
  const res = response();
  await createAdminAvailabilityHandler({ env, now, command: store.command })(adminRequest({
    method: 'PATCH', headers: { authorization: 'Bearer test-admin-token', 'content-type': 'text/plain' },
    body: { initialize: true },
  }), res);
  assert.equal(res.code, 415);
  assert.equal(store.commands.length, 0);
});

test('owner update storage failure does not report success', async () => {
  const res = response();
  await createAdminAvailabilityHandler({ env, now, command: async () => { throw new Error('bad storage'); } })(adminRequest({
    method: 'PATCH', body: { initialize: true },
  }), res);
  assert.equal(res.code, 503);
});

for (const [binding, credentials] of Object.entries({ direct: env, vercel: { KV_REST_API_URL: env.UPSTASH_REDIS_REST_URL, KV_REST_API_TOKEN: env.UPSTASH_REDIS_REST_TOKEN } })) {
test(`${binding} Redis adapter retains HTTPS verification and sends credentials only as a header`, async () => {
  const originalFetch = globalThis.fetch;
  let requested = false;
  globalThis.fetch = async (input, init) => {
    requested = true;
    assert.equal(input, 'https://calendar.example.invalid');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-redis-token');
    assert.equal(String(init?.body).includes('test-redis-token'), false);
    assert.deepEqual(JSON.parse(String(init?.body)), ['GET', 'test-key']);
    return new Response(JSON.stringify({ result: '1' }), { status: 200 });
  };
  try {
    assert.equal(await createRedisCommand(credentials)(['GET', 'test-key']), '1');
    assert.equal(requested, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

}

test('insecure Redis URLs are rejected before sending credentials', async () => {
  const command = createRedisCommand({ ...env, UPSTASH_REDIS_REST_URL: 'http://calendar.example.invalid' });
  await assert.rejects(() => command(['GET', 'test-key']), /not configured/);
});

test('native Vercel Redis bindings configure the public calendar', async () => {
  const store = memoryCalendar(true, ['2026-11-20']);
  const res = response();
  await createAvailabilityHandler({ env: { KV_REST_API_URL: env.UPSTASH_REDIS_REST_URL, KV_REST_API_TOKEN: env.UPSTASH_REDIS_REST_TOKEN }, now, command: store.command })(request(), res);
  assert.equal(res.code, 200);
  assert.deepEqual((res.body as { blockedDates: string[] }).blockedDates, ['2026-11-20']);
});

test('insecure native Vercel Redis URL is rejected before sending credentials', async () => {
  const command = createRedisCommand({ KV_REST_API_URL: 'http://calendar.example.invalid', KV_REST_API_TOKEN: 'test-token' });
  await assert.rejects(() => command(['GET', 'test-key']), /not configured/);
});
