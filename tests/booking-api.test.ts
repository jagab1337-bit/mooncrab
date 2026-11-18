import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdminAvailabilityHandler,
  createAvailabilityHandler,
  createRedisCommand,
  DATE_DETAILS_KEY,
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
  const confirmed = new Set<string>();
  const imported = new Set<string>();
  const details = new Map<string, string>();
  const snapshots = new Map<string, string>();
  const commands: Array<Array<string | number>> = [];
  const command: RedisCommand = async (args) => {
    commands.push(args);
    if (args[0] === 'GET') return args[1] === 'mooncrab:availability-initialized' ? initialized ? '1' : null : snapshots.get(String(args[1])) ?? null;
    if (args[0] === 'SUNION') return [...new Set([...blocked, ...confirmed, ...imported])];
    if (args[0] === 'SMEMBERS') return args[1] === 'mooncrab:blocked-dates' ? [...blocked] : args[1] === 'mooncrab:confirmed-dates' ? [...confirmed] : [...imported];
    if (args[0] === 'HGETALL') { assert.equal(args[1], DATE_DETAILS_KEY); return [...details.entries()].flat(); }
    if (args[0] === 'EVAL') {
      const offset = Number(args[2]) + 3;
      for (const date of JSON.parse(String(args[offset]))) blocked.add(date);
      for (const date of JSON.parse(String(args[offset + 1]))) blocked.delete(date);
      if (args[offset + 2] === '1') initialized = true;
      if (Number(args[2]) === 3) {
        assert.equal(args[5], DATE_DETAILS_KEY);
        const changes = JSON.parse(String(args[offset + 3]));
        for (const date of JSON.parse(String(args[offset + 4]))) details.delete(date);
        for (const [date, detail] of Object.entries(changes)) {
          assert.notEqual(detail, null, 'Lua must not depend on decoded JSON null entries');
          details.set(date, JSON.stringify(detail));
        }
      }
      return 1;
    }
    throw new Error('Unexpected command');
  };
  return { command, commands, blocked, confirmed, imported, details, snapshots };
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
  assert.deepEqual(res.body, { room: 'KASAG', initialized: false, blockedDates: ['2026-11-20', '2026-12-01'], manualDates: ['2026-11-20', '2026-12-01'], confirmedDates: [], importedDates: [], dateDetails:{}, dateSources:{} });
});

test('owner can reconcile dates and initialize a calendar in a single transaction', async () => {
  const store = memoryCalendar(false, ['2026-11-20']);
  const res = response();
  await createAdminAvailabilityHandler({ env, now, command: store.command })(adminRequest({
    method: 'PATCH', body: { add: ['2026-11-21', '2026-11-21'], remove: ['2026-11-20'], initialize: true },
  }), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { room: 'KASAG', initialized: true, blockedDates: ['2026-11-21'], manualDates: ['2026-11-21'], confirmedDates: [], importedDates: [], dateDetails:{}, dateSources:{} });
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

test('private date source and multiline notes persist without creating a booking or a block', async () => {
  const store = memoryCalendar();
  const handler = createAdminAvailabilityHandler({ env, now, command: store.command });
  const detail = { source:'airbnb', notes:'Arriving late\nPlease prepare two towels. <script>private</script>' };
  const saved = response();
  await handler(adminRequest({ method:'PATCH', body:{ dateDetails:{'2026-11-20':detail} } }), saved);
  assert.equal(saved.code,200);
  assert.deepEqual((saved.body as {dateDetails:unknown}).dateDetails,{'2026-11-20':detail});
  assert.deepEqual([...store.blocked],[]);
  assert.deepEqual([...store.confirmed],[]);
  const restored = response();
  await handler(adminRequest(),restored);
  assert.deepEqual((restored.body as {dateDetails:unknown}).dateDetails,{'2026-11-20':detail});
  const publicResponse = response();
  const beforeReads=store.commands.length;
  await createAvailabilityHandler({env,now,command:store.command})(request(),publicResponse);
  assert.deepEqual(publicResponse.body,{configured:true,room:'KASAG',month:'2026-11',blockedDates:[]});
  assert(!store.commands.slice(beforeReads).some(call=>call[0]==='HGETALL'));
  assert(!JSON.stringify(publicResponse.body).includes('private'));
});

test('owner saves blocking and annotations in one transaction, clears annotations separately, and preserves source blocks', async () => {
  const store = memoryCalendar(true,['2026-11-20']);
  store.confirmed.add('2026-11-21');
  store.imported.add('2026-11-22');
  const handler = createAdminAvailabilityHandler({env,now,command:store.command});
  const res=response();
  await handler(adminRequest({method:'PATCH',body:{
    add:['2026-11-23'],remove:['2026-11-20'],dateDetails:{
      '2026-11-21':{source:'direct',notes:'Confirmed elsewhere'},
      '2026-11-22':{source:'booking',notes:'Imported stay note'},
    },
  }}),res);
  assert.equal(res.code,200);
  const mutations=store.commands.filter(call=>call[0]==='EVAL');
  assert.equal(mutations.length,1);
  assert.equal(mutations[0][2],3);
  assert.deepEqual([...store.blocked],['2026-11-23']);
  assert.deepEqual([...store.confirmed],['2026-11-21']);
  assert.deepEqual([...store.imported],['2026-11-22']);
  assert.deepEqual((res.body as {dateSources:unknown}).dateSources,{'2026-11-21':['direct']});
  const cleared=response();
  await handler(adminRequest({method:'PATCH',body:{dateDetails:{'2026-11-22':null}}}),cleared);
  assert.equal(cleared.code,200);
  assert.equal(store.details.has('2026-11-22'),false);
  const clearCommand = store.commands.filter(call => call[0] === 'EVAL').at(-1)!;
  assert.deepEqual(JSON.parse(String(clearCommand[9])), {});
  assert.deepEqual(JSON.parse(String(clearCommand[10])), ['2026-11-22']);
  assert.deepEqual([...store.imported],['2026-11-22']);
  assert.deepEqual([...store.blocked],['2026-11-23']);
});

test('date details validate source, note bounds, object shape and displayed calendar dates before any write', async () => {
  const store=memoryCalendar();
  const handler=createAdminAvailabilityHandler({env,now,command:store.command});
  const valid={source:'direct',notes:'Private note'};
  for(const dateDetails of [
    null,[],{'2026-11-20':{source:'other',notes:''}}, {'2026-11-20':{source:'direct'}},
    {'2026-11-20':{...valid,guest:'Do not accept extra fields'}},
    {'2026-11-20':{source:'direct',notes:42}}, {'2026-11-20':{source:'direct',notes:'x'.repeat(2001)}},
    {'2026-11-20':{source:'direct',notes:'bad\u0000note'}},
    {'2026-10-31':valid},{'2028-11-01':valid},{'2027-02-29':valid},
    Object.fromEntries(Array.from({length:367},(_,i)=>[new Date(Date.UTC(2026,10,1+i)).toISOString().slice(0,10),valid])),
  ]) {
    const res=response();
    await handler(adminRequest({method:'PATCH',body:{add:['2026-11-20'],dateDetails}}),res);
    assert.equal(res.code,400);
  }
  assert.equal(store.commands.length,0);
  assert.equal(store.blocked.size,0);
  const allowed=response();
  await handler(adminRequest({method:'PATCH',body:{dateDetails:{
    '2026-11-01':{source:'',notes:'Past date in the displayed month'},
    '2028-10-31':{source:'booking',notes:'x'.repeat(2000)},
  }}}),allowed);
  assert.equal(allowed.code,200);
});

test('date detail mutations require owner authentication and corrupt notes never leak through an error', async () => {
  const store=memoryCalendar();
  const handler=createAdminAvailabilityHandler({env,now,command:store.command});
  const unauthorized=response();
  await handler(request({method:'PATCH',body:{dateDetails:{'2026-11-20':{source:'direct',notes:'Secret'}}}}),unauthorized);
  assert.equal(unauthorized.code,401);
  assert.equal(store.commands.length,0);
  store.details.set('2026-11-20','{"source":"invalid","notes":"SECRET guest note"}');
  const corrupt=response();
  await handler(adminRequest(),corrupt);
  assert.equal(corrupt.code,503);
  assert(!JSON.stringify(corrupt.body).includes('SECRET'));
  const publicResponse=response();
  await createAvailabilityHandler({env,now,command:store.command})(request(),publicResponse);
  assert.equal(publicResponse.code,200);
});

test('owner source labels retain overlaps, exclude checkout nights and omit private feed event fields', async () => {
  const store=memoryCalendar();
  const event=(source:string,checkIn:string,checkOut:string)=>({id:'private-event-id',source,room:'KASAG',checkIn,checkOut,notes:'Secret guest',url:'https://private.invalid/feed'});
  store.snapshots.set('mooncrab:ical:source:airbnb',JSON.stringify({events:[event('airbnb','2026-11-20','2026-11-22')]}));
  store.snapshots.set('mooncrab:ical:source:booking',JSON.stringify({events:[event('booking','2026-11-21','2026-11-23')]}));
  store.confirmed.add('2026-11-21');
  const res=response();
  await createAdminAvailabilityHandler({env,now,command:store.command})(adminRequest(),res);
  assert.equal(res.code,200);
  assert.deepEqual((res.body as {dateSources:unknown}).dateSources,{
    '2026-11-20':['airbnb'],'2026-11-21':['airbnb','booking','direct'],'2026-11-22':['booking'],
  });
  assert(!JSON.stringify(res.body).includes('private-event-id'));
  assert(!JSON.stringify(res.body).includes('Secret'));
  assert(!JSON.stringify(res.body).includes('private.invalid'));
  store.snapshots.set('mooncrab:ical:source:booking',JSON.stringify({events:[event('booking','2026-02-30','2026-03-01')]}));
  const invalid=response();
  await createAdminAvailabilityHandler({env,now,command:store.command})(adminRequest(),invalid);
  assert.equal(invalid.code,503);
});

test('Redis object-form date hashes are read safely and hidden outside the displayed horizon', async () => {
  const store=memoryCalendar();
  const note={source:'direct',notes:'Current owner note'};
  const command:RedisCommand=call=>call[0]==='HGETALL'?Promise.resolve({
    '2026-11-20':JSON.stringify(note),'2026-10-01':JSON.stringify({source:'',notes:'Historic note'}),
  }):store.command(call);
  const res=response();
  await createAdminAvailabilityHandler({env,now,command})(adminRequest(),res);
  assert.equal(res.code,200);
  assert.deepEqual((res.body as {dateDetails:unknown}).dateDetails,{'2026-11-20':note});
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
