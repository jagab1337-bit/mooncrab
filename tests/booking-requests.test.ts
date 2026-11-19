import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminBookingRequestsHandler, createBookingRequestHandler as realCreateBookingRequestHandler, CREATE_REQUEST_SCRIPT, requestExpiry, stayNights } from '../server/booking-requests.ts';
import type { ApiRequest, Environment, RedisCommand, HandlerOptions } from '../server/availability.ts';
import { DIRECT_POLICY } from '../shared/booking-terms.ts';

const env: Environment = {
  UPSTASH_REDIS_REST_URL: 'https://calendar.example.invalid',
  UPSTASH_REDIS_REST_TOKEN: 'test-redis-token',
  BOOKING_ADMIN_TOKEN: 'test-admin-token',
};
// Older request mocks focus on booking commands; configuration and atomic record replies are explicit here.
function createBookingRequestHandler(options: HandlerOptions = {}) {
  const original=options.command;
  return realCreateBookingRequestHandler({...options,...(original?{command:async(args)=>{
    if(args[0]==='GET'&&args[1]==='mooncrab:business-settings')return null;
    const result=await original(args);
    if(args[0]==='EVAL'&&args[1]===CREATE_REQUEST_SCRIPT&&Array.isArray(result)&&result[0]==='created'&&result.length===2)return [...result,String(args[14])];
    if(args[0]==='EVAL'&&args[1]===CREATE_REQUEST_SCRIPT&&Array.isArray(result)&&result[0]==='duplicate'&&result.length===2)return [...result,JSON.stringify(record)];
    return result;
  }}:{})});
}
const now = () => new Date('2026-11-17T18:00:00.000Z');
const id = '371f802b-e248-4189-8b85-12b5a4664f33';
const payment = { totalCents: 800_000, receivedCents: null };
const record = {
  id, checkIn: '2026-11-20', checkOut: '2026-11-22', name: 'Test Guest',
  email: 'guest@example.com', message: '', status: 'pending',
  guests: 2, extraGuestFeePhp: 0,
  createdAt: now().toISOString(), updatedAt: now().toISOString(),
};

function response() {
  return {
    code: 200, body: undefined as unknown, headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; },
    status(code: number) { this.code = code; return this; },
    json(body: unknown) { this.body = body; },
  };
}

function request(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: {
      checkIn: '2026-11-20', checkOut: '2026-11-22', name: ' Test Guest ',
      email: 'Guest@Example.com', phone:'+63 962 528 4264', whatsapp:true, room:'KASAG', idempotencyKey: id,
      policyAccepted: true, policyVersion: DIRECT_POLICY.version,
    },
    ...overrides,
  };
}

function adminRequest(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return request({ method: 'GET', headers: { 'content-type': 'application/json', authorization: 'Bearer test-admin-token' }, ...overrides });
}

test('night ranges include arrival and exclude departure', () => {
  assert.deepEqual(stayNights('2028-02-28', '2028-03-02'), ['2028-02-28', '2028-02-29', '2028-03-01']);
});

test('request PII expiry is 90 days after Siargao checkout, including leap-year boundaries', () => {
  assert.equal(new Date(requestExpiry('2026-11-23') * 1000).toISOString(), '2027-02-20T16:00:00.000Z');
  assert.equal(new Date(requestExpiry('2028-02-29') * 1000).toISOString(), '2028-05-28T16:00:00.000Z');
});

test('idempotency keys normalize UUID casing and share the request record retention', async () => {
  const commands: Array<Array<string | number>> = [];
  const handler = createBookingRequestHandler({ env, now, command: async (args) => { commands.push(args); return ['created', id]; } });
  const base = request().body as Record<string, unknown>;
  const key = 'f5ec7e5f-6f54-44be-a10f-40d5cc3c2e75';
  await handler(request({ body: { ...base, idempotencyKey: key } }), response());
  await handler(request({ body: { ...base, idempotencyKey: key.toUpperCase() } }), response());
  assert.equal(commands[0][6], commands[1][6]);
  assert.equal(commands[0][20], requestExpiry('2026-11-22'));
});

test('valid guest request is normalized and accepted without exposing guest fields', async () => {
  let captured: Array<string | number> = [];
  const command: RedisCommand = async (args) => { captured = args; return ['created', id]; };
  const res = response();
  await createBookingRequestHandler({ env, now, command })(request(), res);
  assert.equal(res.code, 201);
  assert.equal((res.body as {id:string}).id,id);
  assert.equal((res.body as {status:string}).status,'pending');
  const stored = JSON.parse(String(captured[14]));
  assert.equal(stored.name, 'Test Guest');
  assert.equal(stored.email, 'guest@example.com');
  assert.equal(stored.status, 'pending');
  assert.equal(stored.guests, 2);
  assert.equal(stored.extraGuestFeePhp, 0);
  assert.deepEqual(stored.agreement, { version: DIRECT_POLICY.version, acceptedAt: now().toISOString(), recordedBy: 'guest' });
  assert.deepEqual(JSON.parse(String(captured[21])).map((job: {kind:string}) => job.kind), ['guest', 'owner']);
  assert.deepEqual(JSON.parse(String(captured[15])), ['2026-11-20', '2026-11-21']);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('the direct request requires current policy assent before any storage', async () => {
  const base = request().body as Record<string, unknown>;
  const handler = createBookingRequestHandler({ env, now, command: async () => { assert.fail('Must validate before storage'); } });
  for (const fields of [{ policyAccepted:false }, { policyAccepted: undefined }, { policyVersion:'outdated' }]) {
    const res = response();
    await handler(request({ body: { ...base, ...fields } }), res);
    assert.equal(res.code, 400);
    assert.match(String((res.body as {error:string}).error), /agree to the current/);
  }
});

test('guest counts must be integers from one to three before storage is called', async () => {
  let calls = 0;
  const handler = createBookingRequestHandler({ env, now, command: async () => { calls++; return ['created', id]; } });
  const base = request().body as Record<string, unknown>;
  for (const guests of [0, 4, -1, 1.5, '3', null, true, [], {}]) {
    const res = response();
    await handler(request({ body: { ...base, guests } }), res);
    assert.equal(res.code, 400, JSON.stringify(guests));
  }
  assert.equal(calls, 0);
});

test('third-guest supplement is computed per occupied night and ignores client fee overrides', async () => {
  const records: Array<Record<string, unknown>> = [];
  const handler = createBookingRequestHandler({ env, now, command: async (args) => { records.push(JSON.parse(String(args[14]))); return ['created', id]; } });
  const base = request().body as Record<string, unknown>;
  for (const [guests, checkOut, expectedFee] of [[1, '2026-11-22', 0], [2, '2026-11-22', 0], [3, '2026-11-22', 1000], [3, '2026-11-25', 2500]] as const) {
    const res = response();
    await handler(request({ body: { ...base, guests, checkOut, extraGuestFeePhp: -50000 } }), res);
    assert.equal(res.code, 201);
    assert.equal(records.at(-1)?.guests, guests);
    assert.equal(records.at(-1)?.extraGuestFeePhp, expectedFee);
    assert.equal((res.body as {id:string}).id,id);
  assert.equal((res.body as {status:string}).status,'pending');
  }
});

test('retry digests distinguish occupancy changes while defaulting old clients to two guests', async () => {
  const digests: string[] = [];
  const handler = createBookingRequestHandler({ env, now, command: async (args) => { digests.push(String(args[17])); return ['created', id]; } });
  const base = request().body as Record<string, unknown>;
  await handler(request(), response());
  await handler(request({ body: { ...base, guests: 2 } }), response());
  await handler(request({ body: { ...base, guests: 3 } }), response());
  assert.equal(digests[0], digests[1]);
  assert.notEqual(digests[1], digests[2]);
});

test('request rate-limit keys hash the guest email and trusted forwarded IP', async () => {
  let captured: Array<string | number> = [];
  const command: RedisCommand = async (args) => { captured = args; return ['created', id]; };
  const res = response();
  await createBookingRequestHandler({ env, now, command })(request({
    headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': '203.0.113.12' },
  }), res);
  assert.equal(res.code, 201);
  assert.equal(String(captured[9]).includes('guest@example.com'), false);
  assert.equal(String(captured[10]).includes('203.0.113.12'), false);
  assert.match(String(captured[9]), /^mooncrab:rate:email:\d+:[a-f0-9]{64}$/);
  assert.match(String(captured[10]), /^mooncrab:rate:ip:\d+:[a-f0-9]{64}$/);
});

test('guest request rejects invalid dates, range, identity, and oversized fields without storage writes', async () => {
  const changes = [
    { checkIn: '2026-11-17' }, { checkOut: '2026-11-20' },
    { checkIn: '2026-02-30' }, { checkOut: '2027-02-20' }, { checkOut: '2028-11-01' },
    { name: 'A' }, { email: 'bad-email' }, { idempotencyKey: 'not-a-uuid' },
    { message: 'x'.repeat(2001) }, { name: 'x'.repeat(101) }, { message: '\u0000' },
  ];
  let calls = 0;
  const command: RedisCommand = async () => { calls++; return ['created', id]; };
  const handler = createBookingRequestHandler({ env, now, command });
  const base = request().body as Record<string, unknown>;
  for (const change of changes) {
    const res = response();
    await handler(request({ body: { ...base, ...change } }), res);
    assert.equal(res.code, 400, JSON.stringify(change));
  }
  assert.equal(calls, 0);
});

test('guest date boundaries accept a two-night stay today and 90 nights but reject 91 nights and checkout beyond the horizon', async () => {
  const handler = createBookingRequestHandler({ env, now, command: async () => ['created', id] });
  const base = request().body as Record<string, unknown>;
  for (const [checkIn, checkOut, code] of [
    ['2026-11-18', '2026-11-20', 201],
    ['2026-11-18', '2026-12-18', 201],
    ['2026-11-18', '2027-02-16', 201],
    ['2026-11-18', '2027-02-17', 400],
    ['2028-10-29', '2028-10-31', 201],
    ['2028-10-31', '2028-11-01', 400],
  ] as const) {
    const res = response();
    await handler(request({ body: { ...base, checkIn, checkOut } }), res);
    assert.equal(res.code, code, `${checkIn} / ${checkOut}`);
  }
});

test('one-night requests are rejected before storage while two-night requests are accepted', async () => {
  let calls = 0;
  const handler = createBookingRequestHandler({ env, now, command: async () => { calls++; return ['created', id]; } });
  const base = request().body as Record<string, unknown>;
  const tooShort = response();
  await handler(request({ body: { ...base, checkOut: '2026-11-21' } }), tooShort);
  assert.equal(tooShort.code, 400);
  assert.match(String((tooShort.body as { error: string }).error), /2–90 nights/);
  assert.equal(calls, 0);
  const accepted = response();
  await handler(request(), accepted);
  assert.equal(accepted.code, 201);
  assert.equal(calls, 1);
});

test('guest request handles duplicate, conflict, rate limit, and initialization results honestly', async () => {
  for (const [result, status] of [
    [['duplicate', id], 200], [['conflict'], 409], [['idempotency_conflict'], 409],
    [['rate_limited'], 429], [['unavailable'], 503],
  ] as const) {
    const res = response();
    await createBookingRequestHandler({ env, now, command: async () => [...result] })(request(), res);
    assert.equal(res.code, status);
    if (status === 429) assert.equal(res.headers['retry-after'], '3600');
  }
});

test('guest requests fail closed without storage credentials or on storage errors', async () => {
  for (const options of [
    { env: {}, command: async () => { throw new Error('must not call'); } },
    { env, command: async () => { throw new Error('SECRET storage detail'); } },
  ]) {
    const res = response();
    await createBookingRequestHandler({ ...options, now })(request(), res);
    assert.equal(res.code, 503);
    assert.equal(JSON.stringify(res.body).includes('SECRET'), false);
  }
});

test('guest request endpoint rejects non-JSON bodies and non-POST methods', async () => {
  const handler = createBookingRequestHandler({ env, now });
  const wrongMethod = response();
  await handler(request({ method: 'GET' }), wrongMethod);
  assert.equal(wrongMethod.code, 405);
  const wrongType = response();
  await handler(request({ headers: { 'content-type': 'text/plain' } }), wrongType);
  assert.equal(wrongType.code, 415);
});

test('owner request list requires authentication and hides internal data', async () => {
  const unauthenticated = response();
  await createAdminBookingRequestsHandler({ env, now })(request({ method: 'GET' }), unauthenticated);
  assert.equal(unauthenticated.code, 401);
  const authenticated = response();
  await createAdminBookingRequestsHandler({ env, now, command: async () => [JSON.stringify({ ...record, digest: 'internal' })] })(adminRequest(), authenticated);
  assert.equal(authenticated.code, 200);
  assert.deepEqual(authenticated.body, { requests: [record] });
});

test('legacy stored requests remain readable for two guests with no supplement, including cancelled stays', async () => {
  const { guests: _guests, extraGuestFeePhp: _fee, ...legacy } = record;
  const cancelled = { ...legacy, status: 'cancelled' };
  const res = response();
  await createAdminBookingRequestsHandler({ env, now, command: async () => [JSON.stringify(legacy), JSON.stringify(cancelled)] })(adminRequest(), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { requests: [record, { ...record, status: 'cancelled' }] });
});

test('owner records show validated occupancy and the computed extra guest supplement', async () => {
  const res = response();
  await createAdminBookingRequestsHandler({ env, now, command: async () => [JSON.stringify({ ...record, guests: 3, extraGuestFeePhp: 0, internal: 'hidden' })] })(adminRequest(), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { requests: [{ ...record, guests: 3, extraGuestFeePhp: 1000 }] });
});

test('owner confirmation submits an atomic action for the correct occupied nights', async () => {
  const commands: Array<Array<string | number>> = [];
  const confirmed = { ...record, status: 'confirmed', payment };
  const command: RedisCommand = async (args) => {
    commands.push(args);
    return args[0] === 'GET' ? JSON.stringify(record) : ['updated', JSON.stringify(confirmed)];
  };
  const res = response();
  await createAdminBookingRequestsHandler({ env, now, command })(adminRequest({ method: 'PATCH', body: { id, action: 'confirm', payment } }), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { request: confirmed, confirmationEmail: 'queued' });
  assert.equal(commands[1][0], 'EVAL');
  assert.equal(commands[1][18], 'confirm');
  assert.deepEqual(JSON.parse(String(commands[1][19])), ['2026-11-20', '2026-11-21']);
  const job = JSON.parse(String(commands[1][23]));
  assert.equal(job.id, `${id}:confirmation`);
  assert.deepEqual(job.booking.payment, payment);
});

test('owner receives conflict when another confirmed stay won the dates', async () => {
  const res = response();
  await createAdminBookingRequestsHandler({ env, now, command: async (args) => args[0] === 'GET' ? JSON.stringify(record) : ['conflict'] })(adminRequest({ method: 'PATCH', body: { id, action: 'confirm', payment } }), res);
  assert.equal(res.code, 409);
});

test('owner cannot confirm a stay that has already started', async () => {
  let calls = 0;
  const res = response();
  await createAdminBookingRequestsHandler({ env, now, command: async () => { calls++; return JSON.stringify({ ...record, checkIn: '2026-11-17' }); } })(adminRequest({ method: 'PATCH', body: { id, action: 'confirm' } }), res);
  assert.equal(res.code, 409);
  assert.equal(calls, 1);
});

test('owner invalid actions and absent records cannot mutate calendar', async () => {
  const handler = createAdminBookingRequestsHandler({ env, now, command: async () => null });
  const invalid = response();
  await handler(adminRequest({ method: 'PATCH', body: { id, action: 'delete' } }), invalid);
  assert.equal(invalid.code, 400);
  const absent = response();
  await handler(adminRequest({ method: 'PATCH', body: { id, action: 'decline' } }), absent);
  assert.equal(absent.code, 404);
});

test('owner action requires a primitive string and cannot bypass past-date guard by array coercion', async () => {
  let calls = 0;
  const handler = createAdminBookingRequestsHandler({ env, now, command: async () => { calls++; return JSON.stringify(record); } });
  const res = response();
  await handler(adminRequest({ method: 'PATCH', body: { id, action: ['confirm'] } }), res);
  assert.equal(res.code, 400);
  assert.equal(calls, 0);
});

test('owner can atomically cancel a confirmed stay without changing request expiry', async () => {
  const commands: Array<Array<string | number>> = [];
  const confirmed = { ...record, status: 'confirmed' };
  const cancelled = { ...record, status: 'cancelled' };
  const handler = createAdminBookingRequestsHandler({ env, now, command: async (args) => {
    commands.push(args);
    return args[0] === 'GET' ? JSON.stringify(confirmed) : ['updated', JSON.stringify(cancelled)];
  } });
  const res = response();
  await handler(adminRequest({ method: 'PATCH', body: { id, action: 'cancel' } }), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { request: cancelled });
  assert.equal(commands[1][18], 'cancel');
  assert.equal(commands[1][21], requestExpiry(record.checkOut));
});
