import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { sameOrigin, vaultSession, verifyPassword } from './admin-auth.ts';
import { configured, createRedisCommand, setHeaders } from './availability.ts';
import type { ApiRequest, ApiResponse, HandlerOptions } from './availability.ts';
import { httpsUrl } from './workspace-fields.ts';
import { shortText, uuidPattern } from './workspace-records.ts';

const MFA_KEY = 'mooncrab:login-vault:mfa';
const RECORDS_KEY = 'mooncrab:login-vault:records';
const AUDIT_KEY = 'mooncrab:login-vault:audit';
const ATTEMPTS_KEY = 'mooncrab:login-vault:attempts';
const GRANT_SECONDS = 300;
const OTP_PERIOD = 30;
const RATE_LIMIT = `
local attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then redis.call('EXPIRE', KEYS[1], 300) end
return attempts
`;
const SAVE = `
local old = redis.call('GET', KEYS[1]) or ''
if old ~= ARGV[1] then return 0 end
redis.call('LPUSH', KEYS[2], ARGV[3])
redis.call('LTRIM', KEYS[2], 0, 499)
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;
const ENROLL = `
if redis.call('EXISTS', KEYS[1]) ~= 0 or redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('DEL', KEYS[2])
return 1
`;
const MARK_OTP = `
local previous = tonumber(redis.call('GET', KEYS[1]) or '-1')
if tonumber(ARGV[1]) <= previous then return 0 end
redis.call('SET', KEYS[1], ARGV[1])
return 1
`;
type LoginDetails = { name:string; username:string; url:string };
type EncryptedLogin = { id:string; revision:string; details:string; password:string };
type Unlock = { version:string; expiresAt:number };

function seal(value: string, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
function open(value: string, key: Buffer, context: string): string {
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}

function matchOtp(value: unknown, secret: string, now: number): number | null {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) return null;
  const totp = new TOTP({ issuer:'Mooncrab Siargao', label:'Owner login vault', period:OTP_PERIOD, secret:Secret.fromBase32(secret) });
  const offset = totp.validate({ token:value, window:1, timestamp:now });
  return offset === null ? null : Math.floor(now / (OTP_PERIOD * 1000)) + offset;
}

export function createLoginVaultHandler(options: HandlerOptions = {}) {
  const env = options.env ?? process.env;
  const command = options.command ?? createRedisCommand(env);
  const currentTime = () => (options.now?.() ?? new Date()).getTime();
  const master = Buffer.from(env.ADMIN_LOGIN_VAULT_KEY || '', 'base64url');
  const derive = (purpose: string) => Buffer.from(hkdfSync('sha256', master, 'mooncrab-login-vault-v1', purpose, 32));
  const keys = master.length === 32 ? { details:derive('details'), password:derive('password'), mfa:derive('mfa') } : null;

  return async (req: ApiRequest, res: ApiResponse): Promise<void> => {
    setHeaders(res);
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).json({ error:'Method not allowed.' });
      return;
    }
    if (req.method === 'POST' && !sameOrigin(req)) {
      res.status(403).json({ error:'Use the Mooncrab administrator portal.' });
      return;
    }
    if (!configured(env) || !keys) {
      res.status(503).json({ error:'The login vault encryption key or storage connection is unavailable.' });
      return;
    }
    try {
      const session = await vaultSession(req, env, command);
      if (!session) {
        res.status(403).json({ error:'Sign in with your administrator username and password to use Logins.' });
        return;
      }
      const grantKey = `mooncrab:login-vault:grant:${session.id}`;
      const pendingKey = `mooncrab:login-vault:setup:${session.id}`;
      const auditEvent = (action: string, id?: string) => JSON.stringify({
        action, ...(id ? { id } : {}), at:new Date(currentTime()).toISOString(), session:session.id.slice(0, 16),
      });
      async function audit(action: string, id?: string) {
        await command(['LPUSH', AUDIT_KEY, auditEvent(action, id)]);
        await command(['LTRIM', AUDIT_KEY, 0, 499]);
      }
      const encryptedMfa = await command(['GET', MFA_KEY]);
      const enrolled = typeof encryptedMfa === 'string';
      const rawGrant = await command(['GET', grantKey]);
      const previous: Unlock | null = typeof rawGrant === 'string' ? JSON.parse(rawGrant) : null;
      const unlockedUntil = enrolled && previous?.version === session.version && previous.expiresAt > currentTime() ? previous.expiresAt : null;
      async function readLogins(): Promise<{ raw:string; records:EncryptedLogin[] }> {
        const value = await command(['GET', RECORDS_KEY]);
        return { raw:typeof value === 'string' ? value : '', records:typeof value === 'string' ? JSON.parse(value) : [] };
      }
      const list = (records: EncryptedLogin[]) => records.map(record => ({
        id:record.id, revision:record.revision,
        ...JSON.parse(open(record.details, keys!.details, record.id + ':details')) as LoginDetails,
      }));
      if (req.method === 'GET') {
        const logins = unlockedUntil ? list((await readLogins()).records) : [];
        res.status(200).json({ enrolled, unlockedUntil, logins });
        return;
      }
      if (typeof req.headers['content-type'] !== 'string' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'])) {
        res.status(415).json({ error:'Send a JSON request.' });
        return;
      }
      const body = req.body as Record<string, unknown> | undefined;
      const action = body?.action;
      if (action === 'lock') {
        await command(['DEL', grantKey, pendingKey]);
        res.status(200).json({ enrolled, unlockedUntil:null, logins:[] });
        return;
      }

      if (action === 'setup' || action === 'enroll' || action === 'unlock') {
        const attempts = await command(['EVAL', RATE_LIMIT, 1, ATTEMPTS_KEY]);
        if (typeof attempts !== 'number' || attempts > 8) {
          res.setHeader('Retry-After', '300');
          res.status(429).json({ error:'Too many vault attempts. Try again in five minutes.' });
          return;
        }
        if (enrolled === (action !== 'unlock')) {
          res.status(409).json({ error:'Authenticator setup changed. Refresh Logins and try again.' });
          return;
        }
        if (action !== 'enroll') {
          const password = body?.adminPassword;
          if (typeof password !== 'string' || password.length > 128 || !await verifyPassword(password, session.passwordHash)) {
            await audit('password-rejected');
            res.status(403).json({ error:'The administrator password was not accepted.' });
            return;
          }
        }
        if (action === 'setup') {
          if ((await readLogins()).records.length) {
            res.status(409).json({ error:'The existing vault requires administrator recovery.' });
            return;
          }
          const secret = new Secret({ size:20 }).base32;
          await command(['SET', pendingKey, seal(secret, keys.mfa, session.id + ':setup'), 'EX', GRANT_SECONDS]);
          await audit('setup-started');
          res.status(200).json({ secret });
          return;
        }
        const mfa = action === 'enroll' ? await command(['GET', pendingKey]) : encryptedMfa;
        if (typeof mfa !== 'string') {
          res.status(409).json({ error:'Authenticator setup expired. Start setup again.' });
          return;
        }
        const opened = open(mfa, keys.mfa, action === 'enroll' ? session.id + ':setup' : 'authenticator');
        const authenticator = action === 'enroll' ? {secret:opened, step:-1} : JSON.parse(opened) as {secret:string; step:number};
        const step = matchOtp(body?.code, authenticator.secret, currentTime());
        if (step === null) {
          await audit('code-rejected');
          res.status(403).json({ error:'The authenticator code was not accepted.' });
          return;
        }
        if (action === 'enroll') {
          // Commit the seed and initial replay state together; enrollment can happen only once.
          const sealed = seal(JSON.stringify({secret:authenticator.secret, step}), keys.mfa, 'authenticator');
          if (await command(['EVAL', ENROLL, 2, MFA_KEY, pendingKey, mfa, sealed]) !== 1) {
            res.status(409).json({ error:'Authenticator setup changed. Refresh Logins and try again.' });
            return;
          }
        } else {
          if (step <= authenticator.step) {
            res.status(403).json({ error:'That code has already been used. Wait for the next code.' });
            return;
          }
          const marker = await command(['EVAL', MARK_OTP, 1, MFA_KEY + ':step', step]);
          if (marker !== 1) {
            res.status(403).json({ error:'That code has already been used. Wait for the next code.' });
            return;
          }
        }
        await audit(action === 'enroll' ? 'enrolled' : 'unlocked');
        const expiresAt = currentTime() + GRANT_SECONDS * 1000;
        await command(['SET', grantKey, JSON.stringify({version:session.version, expiresAt}), 'EX', GRANT_SECONDS]);
        await command(['DEL', ATTEMPTS_KEY]);
        res.status(200).json({ enrolled:true, unlockedUntil:expiresAt, logins:list((await readLogins()).records) });
        return;
      }

      if (!unlockedUntil) {
        res.status(423).json({ error:'Unlock Logins with your password and authenticator code.' });
        return;
      }
      if (!body || !['save','delete','reveal'].includes(String(action))) {
        res.status(400).json({ error:'Choose a supported login action.' });
        return;
      }
      const { raw, records } = await readLogins();
      const id = body.id;
      if (id !== undefined && (typeof id !== 'string' || !uuidPattern.test(id))) {
        res.status(400).json({ error:'Choose a saved login.' });
        return;
      }
      const index = records.findIndex(record => record.id === id);
      const current = records[index];
      if (action === 'reveal') {
        if (!current) { res.status(404).json({ error:'Login not found.' }); return; }
        if (!['hover','copy'].includes(String(body.reason))) {
          res.status(400).json({ error:'Choose a reveal action.' }); return;
        }
        await audit(body.reason === 'copy' ? 'copy-requested' : 'revealed', current.id);
        res.status(200).json({ password:open(current.password, keys.password, current.id + ':password') });
        return;
      }
      if (id !== undefined && (!current || current.revision !== body.revision)) {
        res.status(409).json({ error:'This login changed. Refresh Logins before editing.' });
        return;
      }
      const loginId = current?.id ?? randomUUID();
      if (action === 'delete') {
        if (!current) { res.status(404).json({ error:'Login not found.' }); return; }
        records.splice(index, 1);
      } else {
        const { name, username, url, password } = body;
        if (!shortText(name, 120) || !name.trim() || !shortText(username, 254) || !username.trim()
          || (url !== '' && !httpsUrl(url))
          || (password !== undefined && (typeof password !== 'string' || password.length < 1 || password.length > 1024))
          || (!current && password === undefined)) {
          res.status(400).json({ error:'Enter a name, username or email, password, and an optional HTTPS link.' });
          return;
        }
        if (!current && records.length >= 200) { res.status(409).json({ error:'The login vault is full.' }); return; }
        const entry = {
          id:loginId, revision:randomUUID(),
          details:seal(JSON.stringify({name:name.trim(), username:username.trim(), url}), keys.details, loginId + ':details'),
          password:typeof password === 'string' ? seal(password, keys.password, loginId + ':password') : current.password,
        };
        if (current) records[index] = entry;
        else records.push(entry);
      }
      const changed = await command(['EVAL', SAVE, 2, RECORDS_KEY, AUDIT_KEY, raw, JSON.stringify(records), auditEvent(String(action), loginId)]);
      if (changed !== 1) {
        res.status(409).json({ error:'Another edit just saved. Refresh Logins and try again.' });
        return;
      }
      res.status(200).json({ enrolled, unlockedUntil, logins:list(records) });
    } catch {
      res.status(503).json({ error:'The private login vault could not be reached or verified.' });
    }
  };
}
