import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import { Secret, TOTP } from 'otpauth';
import { hashPassword } from '../server/admin-auth.ts';
import { createLoginVaultHandler } from '../server/login-vault.ts';
import { createNotesHandler } from '../server/notes.ts';
import type { ApiResponse, Environment, RedisCommand } from '../server/availability.ts';

const env: Environment = {
  KV_REST_API_URL:'https://example.invalid', KV_REST_API_TOKEN:'test', BOOKING_ADMIN_TOKEN:'test-owner-key',
  ADMIN_LOGIN_VAULT_KEY:randomBytes(32).toString('base64url'),
};

function output() {
  const result = { status:200, headers:{} as Record<string,string>, body:{} as Record<string,unknown> };
  const response: ApiResponse = {
    setHeader(key,value) { result.headers[key] = value; },
    status(code) { result.status = code; return response; },
    json(body) { result.body = body as Record<string,unknown>; },
  };
  return { response, result };
}

test('login vault requires a session, password and MFA, encrypts fields and reveals one password only while unlocked', async () => {
  const fakePassword = 'test-admin-password-only';
  const savedPassword = 'fictional <password> & spaces ';
  const token = randomBytes(32).toString('base64url');
  const fingerprint = createHash('sha256').update(token).digest('hex');
  let now = Date.now();
  const store = new Map<string,string>([
    ['mooncrab:admin-account', JSON.stringify({username:'admin', passwordHash:await hashPassword(fakePassword), mustChangePassword:false, version:'test-version'})],
    ['mooncrab:admin-session:' + fingerprint, JSON.stringify({version:'test-version', expiresAt:now + 3600000})],
  ]);
  const audit: string[] = [];
  const command: RedisCommand = async ([op, key, value, ...args]) => {
    if (op === 'GET') return store.get(String(key)) ?? null;
    if (op === 'SET') { store.set(String(key),String(value)); return 'OK'; }
    if (op === 'DEL') { [key,value,...args].forEach(name => store.delete(String(name))); return 1; }
    if (op === 'LPUSH') { audit.push(String(value)); return audit.length; }
    if (op === 'LTRIM') return 'OK';
    if (op !== 'EVAL') throw new Error('Unexpected command');
    const script = String(key);
    const [target, additional, expected, candidate, event] = args.map(String);
    if (script.includes('INCR')) {
      const count = Number(store.get(target) ?? '0') + 1;
      store.set(target,String(count));
      return count;
    }
    if (script.includes('EXISTS')) {
      if (store.has(target) || store.get(additional) !== expected) return 0;
      store.set(target,candidate); store.delete(additional); return 1;
    }
    if (script.includes('tonumber')) {
      if (Number(additional) <= Number(store.get(target) ?? '-1')) return 0;
      store.set(target,additional); return 1;
    }
    if ((store.get(target) ?? '') !== expected) return 0;
    audit.push(event); store.set(target,candidate); return 1;
  };
  const handler = createLoginVaultHandler({env,command,now:() => new Date(now)});
  const call = async (body?: Record<string,unknown>, options: {cookie?:boolean; origin?:string} = {}) => {
    const {response,result} = output();
    await handler({method:body ? 'POST' : 'GET',headers:{
      host:'mooncrabsiargao.com', origin:options.origin ?? 'https://mooncrabsiargao.com', 'content-type':'application/json',
      ...(options.cookie === false ? {authorization:'Bearer test-owner-key'} : {cookie:'__Host-mooncrab_admin=' + token}),
    },body},response);
    return result;
  };
  assert.equal((await call(undefined,{cookie:false})).status,403);
  assert.equal((await call({action:'setup',adminPassword:fakePassword},{origin:'https://unrelated.example'})).status,403);
  assert.equal((await call({action:'save'})).status,423);
  assert.equal((await call({action:'setup',adminPassword:'wrong'})).status,403);
  const setup = await call({action:'setup',adminPassword:fakePassword});
  assert.equal(setup.status,200);
  assert.equal(setup.headers['Cache-Control'],'no-store');
  const secret = String(setup.body.secret);
  const authenticator = new TOTP({secret:Secret.fromBase32(secret)});
  const code = () => authenticator.generate({timestamp:now});
  const enrolled = await call({action:'enroll',code:code()});
  assert.equal(enrolled.status,200);
  assert(!JSON.stringify(enrolled.body).includes(secret));
  assert.equal((await call({action:'setup',adminPassword:fakePassword})).status,409);
  const saved = await call({action:'save',name:'Example mail',username:'owner@example.test',url:'https://example.test/login',password:savedPassword});
  assert.equal(saved.status,200);
  const [login] = saved.body.logins as {id:string;revision:string}[];
  assert(!JSON.stringify(saved.body).includes(savedPassword));
  assert(!JSON.stringify([...store.values()]).includes(savedPassword));
  assert(!JSON.stringify([...store.values()]).includes('owner@example.test'));
  assert(!JSON.stringify([...store.values()]).includes(secret));
  assert.equal((await call({action:'save',name:'Bad link',username:'owner@example.test',url:'javascript:alert(1)',password:'test'})).status,400);
  assert.deepEqual((await call({action:'reveal',id:login.id,reason:'copy'})).body,{password:savedPassword});
  await call({action:'lock'});
  assert.deepEqual((await call()).body.logins,[]);
  assert.equal((await call({action:'reveal',id:login.id,reason:'copy'})).status,423);
  assert.equal((await call({action:'unlock',adminPassword:fakePassword,code:code()})).status,403);
  now += 30000;
  assert.equal((await call({action:'unlock',adminPassword:fakePassword,code:code()})).status,200);
  const edit = await call({action:'save',id:login.id,revision:login.revision,name:'Renamed',username:'owner@example.test',url:''});
  assert.equal(edit.status,200);
  assert.deepEqual((await call({action:'reveal',id:login.id,reason:'hover'})).body,{password:savedPassword});
  now += 300001;
  assert.equal((await call({action:'reveal',id:login.id,reason:'hover'})).status,423);
  assert.deepEqual((await call()).body.logins,[]);
  assert(!audit.some(entry => entry.includes(secret) || entry.includes(savedPassword) || entry.includes(fakePassword)));
  assert(audit.some(entry => entry.includes('copy-requested')));
});

test('old property contents, links and attachments are available as notes without rewriting saved records', async () => {
  const id = '242c4998-09a4-4876-bd8d-e3bdc5cd1195';
  const record = {id, revision:'original', createdAt:'2026-11-01T00:00:00Z', updatedAt:'2026-11-01T00:00:00Z',
    name:'House', description:'Original description', address:'Old address', contacts:'Old contact', notes:'Existing note',
    folder:'Archive', mapsUrl:'https://maps.example.test/', fileIds:[id], links:[{label:'Reference',url:'https://example.test/'}]};
  const raw = JSON.stringify({records:[record],imports:[]});
  const handler = createNotesHandler({env,command:async ([action,key]) => {
    assert.equal(action,'GET');
    assert.equal(key,'mooncrab:workspace:properties');
    return raw;
  }});
  const {response,result} = output();
  await handler({method:'GET',headers:{authorization:'Bearer test-owner-key'}}, response);
  assert.equal(result.status,200);
  const [note] = result.body.records as {id:string;title:string;body:string;fileIds:string[];links:{url:string}[]}[];
  assert.equal(note.id,id);
  assert.equal(note.title,'House');
  assert.match(note.body,/Original description[\s\S]+Existing note[\s\S]+Old address[\s\S]+Old contact/);
  assert.deepEqual(note.fileIds,[id]);
  assert.deepEqual(note.links.map(link => link.url),['https://example.test/','https://maps.example.test/']);
});
