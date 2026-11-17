import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeAdmin, createAdminSessionHandler, hashPassword, sameOrigin, verifyPassword } from '../server/admin-auth.ts';
import type { ApiRequest, RedisCommand } from '../server/availability.ts';

const bootstrapPassword = 'initial-test-password';
const changedPassword = 'a-new-private-test-password';
function response() {
  return { code: 200, body: undefined as unknown, headers: {} as Record<string, string>, setHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; }, status(code: number) { this.code = code; return this; }, json(value: unknown) { this.body = value; } };
}
function request(method = 'GET', body?: unknown, cookie?: string): ApiRequest {
  return { method, headers: { host: 'admin.mooncrabsiargao.com', origin: 'https://admin.mooncrabsiargao.com', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body ? { body } : {}) };
}
function memoryStore() {
  const values = new Map<string, string>();
  const command: RedisCommand = async args => {
    const [operation, rawKey] = args; const key = String(rawKey);
    if (operation === 'GET') return values.get(key) ?? null;
    if (operation === 'SET') { if (args.includes('NX') && values.has(key)) return null; values.set(key, String(args[2])); return 'OK'; }
    if (operation === 'INCR') { const value = Number(values.get(key) ?? 0) + 1; values.set(key, String(value)); return value; }
    if (operation === 'EXPIRE') return 1;
    if (operation === 'DEL') return values.delete(key) ? 1 : 0;
    if (operation === 'EVAL') { const accountKey = String(args[3]); const raw = values.get(accountKey); if (!raw || JSON.parse(raw).version !== args[4]) return 0; values.set(accountKey, String(args[5])); return 1; }
    throw new Error('Unexpected memory command');
  };
  return { values, command };
}
async function setup() {
  const store = memoryStore();
  const env = { KV_REST_API_URL: 'https://storage.example.invalid', KV_REST_API_TOKEN: 'private-test-token', BOOKING_ADMIN_TOKEN: 'private-recovery-key', ADMIN_BOOTSTRAP_PASSWORD_HASH: await hashPassword(bootstrapPassword) };
  return { ...store, env, handler: createAdminSessionHandler({ env, command: store.command }) };
}
function cookie(res: ReturnType<typeof response>) { return res.headers['set-cookie'].split(';')[0]; }

test('password hashing uses a fresh salt and verifies without exposing the password', async () => {
  const one = await hashPassword(bootstrapPassword); const two = await hashPassword(bootstrapPassword);
  assert.notEqual(one, two); assert.equal(one.includes(bootstrapPassword), false);
  assert.equal(await verifyPassword(bootstrapPassword, one), true);
  assert.equal(await verifyPassword('incorrect', one), false);
  assert.equal(await verifyPassword(bootstrapPassword, 'invalid'), false);
});

test('bootstrap sign-in creates a secure session but protects admin actions until password change', async () => {
  const { handler, env, command, values } = await setup();
  const res = response(); await handler(request('POST', { username: 'admin', password: bootstrapPassword }), res);
  assert.equal(res.code, 200); assert.deepEqual(res.body, { authenticated: true, username: 'admin', mustChangePassword: true });
  assert.match(res.headers['set-cookie'], /HttpOnly; Secure; SameSite=Strict; Max-Age=28800/);
  assert.equal(await authorizeAdmin(request('GET', undefined, cookie(res)), env, command), false);
  const session = response(); await handler(request('GET', undefined, cookie(res)), session);
  assert.equal((session.body as { mustChangePassword: boolean }).mustChangePassword, true);
  const token = cookie(res).split('=')[1];
  assert.equal([...values.keys()].some(key => key.includes(token)), false);
  assert.equal(JSON.stringify([...values.values()]).includes(bootstrapPassword), false);
});

test('changing a bootstrap password unlocks access and invalidates the prior session', async () => {
  const { handler, env, command } = await setup();
  const login = response(); await handler(request('POST', { username: 'admin', password: bootstrapPassword }), login);
  const changed = response(); await handler(request('PATCH', { currentPassword: bootstrapPassword, newPassword: changedPassword }, cookie(login)), changed);
  assert.equal(changed.code, 200); assert.equal((changed.body as { mustChangePassword: boolean }).mustChangePassword, false);
  assert.equal(await authorizeAdmin(request('GET', undefined, cookie(login)), env, command), false);
  assert.equal(await authorizeAdmin(request('GET', undefined, cookie(changed)), env, command), true);
  const badOrigin = request('PATCH', {}, cookie(changed)); badOrigin.headers.origin = 'https://unrelated.invalid';
  assert.equal(await authorizeAdmin(badOrigin, env, command), false);
  const logout = response(); await handler(request('DELETE', undefined, cookie(changed)), logout);
  assert.match(logout.headers['set-cookie'], /Max-Age=0/);
  assert.equal(await authorizeAdmin(request('GET', undefined, cookie(changed)), env, command), false);
});

test('expired sessions cannot authorize a request', async () => {
  const { handler, env, command, values } = await setup();
  const login = response(); await handler(request('POST', { username: 'admin', password: bootstrapPassword }), login);
  const changed = response(); await handler(request('PATCH', { currentPassword: bootstrapPassword, newPassword: changedPassword }, cookie(login)), changed);
  for (const [key, raw] of values) if (key.startsWith('mooncrab:admin-session:')) values.set(key, JSON.stringify({ ...JSON.parse(raw), expiresAt: Date.now() - 1 }));
  assert.equal(await authorizeAdmin(request('GET', undefined, cookie(changed)), env, command), false);
});

test('sign-in is rate limited and cross-origin changes never reach credentials', async () => {
  const { handler, values } = await setup();
  const cross = request('POST', { username: 'admin', password: bootstrapPassword }); cross.headers.origin = 'https://attacker.invalid';
  const denied = response(); await handler(cross, denied); assert.equal(denied.code, 403); assert.equal(values.size, 0);
  for (let attempt = 0; attempt < 9; attempt++) { const res = response(); await handler(request('POST', { username: 'admin', password: 'wrong' }), res); assert.equal(res.code, attempt === 8 ? 429 : 401); }
});

test('legacy recovery bearer works while missing or malformed session cookies do not', async () => {
  const { env, command } = await setup();
  assert.equal(await authorizeAdmin({ method: 'GET', headers: { authorization: 'Bearer private-recovery-key' } }, env, command), true);
  assert.equal(await authorizeAdmin({ method: 'GET', headers: {} }, env, command), false);
  assert.equal(await authorizeAdmin(request('GET', undefined, 'mooncrab_admin=invalid'), env, command), false);
  assert.equal(sameOrigin({ method: 'POST', headers: { host: 'admin.mooncrabsiargao.com' } }), false);
  assert.equal(sameOrigin({ method: 'POST', headers: { host: 'attacker.invalid', origin: 'https://attacker.invalid', 'x-forwarded-host': 'admin.mooncrabsiargao.com' } }), false);
  assert.equal(sameOrigin({ method: 'POST', headers: { host: 'admin.mooncrabsiargao.com', origin: 'https://attacker.invalid', 'x-forwarded-host': 'attacker.invalid' } }), false);
});
