import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { authorized, configured, createRedisCommand, setHeaders, unavailable } from './availability.ts';
import type { ApiRequest, ApiResponse, Environment, HandlerOptions, RedisCommand } from './availability.ts';

const scryptAsync = promisify(scrypt);
const ACCOUNT_KEY = 'mooncrab:admin-account';
const COOKIE = '__Host-mooncrab_admin';
const SESSION_SECONDS = 8 * 60 * 60;
const SESSION_PREFIX = 'mooncrab:admin-session:';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type Account = { username: 'admin'; passwordHash: string; mustChangePassword: boolean; version: string };
type Session = { version: string; expiresAt: number };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scryptAsync(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt' || !/^[A-Za-z0-9_-]{22}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{86}$/.test(parts[2])) return false;
  const derived = await scryptAsync(password, parts[1], 64) as Buffer;
  const expected = Buffer.from(parts[2], 'base64url');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function cookieToken(req: ApiRequest): string | null {
  const cookies = req.headers.cookie;
  if (typeof cookies !== 'string') return null;
  const token = cookies.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

/** Session mutations must originate from the same site; bearer API clients do not use browser cookies. */
export function sameOrigin(req: ApiRequest): boolean {
  const origin = req.headers.origin;
  const rawHost = req.headers.host;
  if (typeof origin !== 'string' || typeof rawHost !== 'string' || rawHost.includes(',')) return false;
  const host = rawHost.toLowerCase();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const production = ['mooncrabsiargao.com', 'www.mooncrabsiargao.com', 'booking.mooncrabsiargao.com'].includes(host);
  const deployment = /^mooncrab(?:-[a-z0-9-]+)?\.vercel\.app$/.test(host);
  if (!local && !production && !deployment) return false;
  return origin === `${local ? 'http' : 'https'}://${host}` && req.headers['sec-fetch-site'] !== 'cross-site';
}

async function account(command: RedisCommand, env: Environment): Promise<Account | null> {
  let raw = await command(['GET', ACCOUNT_KEY]);
  if (raw === null && env.ADMIN_BOOTSTRAP_PASSWORD_HASH && /^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/.test(env.ADMIN_BOOTSTRAP_PASSWORD_HASH)) {
    const initial: Account = { username: 'admin', passwordHash: env.ADMIN_BOOTSTRAP_PASSWORD_HASH, mustChangePassword: true, version: randomBytes(16).toString('hex') };
    await command(['SET', ACCOUNT_KEY, JSON.stringify(initial), 'NX']);
    raw = await command(['GET', ACCOUNT_KEY]);
  }
  if (typeof raw !== 'string') return null;
  const value = JSON.parse(raw) as Account;
  if (value?.username !== 'admin' || typeof value.passwordHash !== 'string' || typeof value.version !== 'string' || typeof value.mustChangePassword !== 'boolean') throw new Error('Invalid administrator account');
  return value;
}

async function sessionAccount(req: ApiRequest, env: Environment, command: RedisCommand): Promise<Account | null> {
  const token = cookieToken(req);
  if (!token) return null;
  const raw = await command(['GET', `${SESSION_PREFIX}${hash(token)}`]);
  if (typeof raw !== 'string') return null;
  const session = JSON.parse(raw) as Session;
  if (!session || typeof session.expiresAt !== 'number' || session.expiresAt <= Date.now()) return null;
  const current = await account(command, env);
  return current && current.version === session.version ? current : null;
}

export async function vaultSession(req: ApiRequest, env: Environment, command: RedisCommand) {
  const token = cookieToken(req);
  if (!token) return null;
  const current = await sessionAccount(req, env, command);
  if (!current || current.mustChangePassword) return null;
  return { id: hash(token), version: current.version, passwordHash: current.passwordHash };
}

export async function authorizeAdmin(req: ApiRequest, env: Environment, command: RedisCommand): Promise<boolean> {
  if (authorized(req, env)) return true; // Existing private access-key API clients remain supported.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || '') && !sameOrigin(req)) return false;
  try {
    const current = await sessionAccount(req, env, command);
    return !!current && !current.mustChangePassword;
  } catch { return false; }
}

function setCookie(res: ApiResponse, token: string, seconds = SESSION_SECONDS): void {
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`);
}

async function establishSession(current: Account, command: RedisCommand, res: ApiResponse): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  await command(['SET', `${SESSION_PREFIX}${hash(token)}`, JSON.stringify({ version: current.version, expiresAt: Date.now() + SESSION_SECONDS * 1000 }), 'EX', SESSION_SECONDS]);
  setCookie(res, token);
}

const CHANGE_PASSWORD_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
if current.version ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;

export function createAdminSessionHandler(options: HandlerOptions = {}) {
  const env = options.env ?? process.env;
  const command = options.command ?? createRedisCommand(env);
  return async (req: ApiRequest, res: ApiResponse): Promise<void> => {
    setHeaders(res);
    if (!['GET', 'POST', 'DELETE', 'PATCH'].includes(req.method || '')) { res.setHeader('Allow', 'GET, POST, DELETE, PATCH'); res.status(405).json({ error: 'Method not allowed.' }); return; }
    if (!configured(env)) { unavailable(res); return; }
    if (req.method !== 'GET' && !sameOrigin(req)) { res.status(403).json({ error: 'Use the administrator portal to make this request.' }); return; }
    if (req.method === 'POST' || req.method === 'PATCH') {
      if (typeof req.headers['content-type'] !== 'string' || req.headers['content-type'].split(';')[0] !== 'application/json') { res.status(415).json({ error: 'Send an application/json request.' }); return; }
    }
    try {
      if (req.method === 'GET') {
        const current = await sessionAccount(req, env, command);
        res.status(200).json(current ? { authenticated: true, username: current.username, mustChangePassword: current.mustChangePassword } : { authenticated: false });
        return;
      }
      if (req.method === 'DELETE') {
        const token = cookieToken(req);
        if (token) await command(['DEL', `${SESSION_PREFIX}${hash(token)}`]);
        setCookie(res, '', 0);
        res.status(200).json({ authenticated: false }); return;
      }
      const body = req.body as Record<string, unknown> | undefined;
      if (!body || typeof body !== 'object' || Array.isArray(body)) { res.status(400).json({ error: 'Provide valid sign-in details.' }); return; }
      if (req.method === 'POST') {
        const ipHeader = req.headers['x-vercel-forwarded-for'] ?? req.headers['x-forwarded-for'];
        const ip = typeof ipHeader === 'string' ? ipHeader.split(',')[0].trim().slice(0, 100) : 'unknown';
        const bucket = `mooncrab:admin-login:${hash(ip)}`;
        const attempts = await command(['INCR', bucket]);
        if (attempts === 1) await command(['EXPIRE', bucket, 900]);
        if (typeof attempts !== 'number' || attempts > 8) { res.setHeader('Retry-After', '900'); res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' }); return; }
        const current = await account(command, env);
        if (!current) { res.status(503).json({ error: 'Administrator sign-in needs its secure bootstrap configuration.' }); return; }
        const password = typeof body.password === 'string' && body.password.length <= 128 ? body.password : '';
        const validPassword = await verifyPassword(password, current.passwordHash);
        if (body.username !== current.username || !validPassword) { res.status(401).json({ error: 'The username or password was not accepted.' }); return; }
        await command(['DEL', bucket]);
        await establishSession(current, command, res);
        res.status(200).json({ authenticated: true, username: current.username, mustChangePassword: current.mustChangePassword }); return;
      }
      const current = await sessionAccount(req, env, command);
      if (!current) { res.status(401).json({ error: 'Sign in to change your password.' }); return; }
      const oldPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
      const nextPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      if (oldPassword.length > 128 || !await verifyPassword(oldPassword, current.passwordHash)) { res.status(401).json({ error: 'The current password was not accepted.' }); return; }
      if (nextPassword.length < 12 || nextPassword.length > 128 || nextPassword === oldPassword) { res.status(400).json({ error: 'Choose a different password with 12–128 characters.' }); return; }
      const updated: Account = { ...current, passwordHash: await hashPassword(nextPassword), mustChangePassword: false, version: randomBytes(16).toString('hex') };
      const changed = await command(['EVAL', CHANGE_PASSWORD_SCRIPT, 1, ACCOUNT_KEY, current.version, JSON.stringify(updated)]);
      if (changed !== 1) { res.status(409).json({ error: 'The account changed. Sign in again before retrying.' }); return; }
      const token = cookieToken(req);
      if (token) await command(['DEL', `${SESSION_PREFIX}${hash(token)}`]);
      await establishSession(updated, command, res);
      res.status(200).json({ authenticated: true, username: updated.username, mustChangePassword: false });
    } catch { res.status(503).json({ error: 'Administrator sign-in could not be reached. Try again shortly.' }); }
  };
}
