import { createHash, randomUUID } from 'node:crypto';
import { authorizeAdmin } from './admin-auth.ts';
import { configured, createRedisCommand, isValidDate, manilaDate, setHeaders, unavailable } from './availability.ts';
import type { ApiRequest, ApiResponse, HandlerOptions, RedisCommand } from './availability.ts';
import { COUPON_CODE, PACKAGES, normalizeCodes, priceWithCoupons } from '../shared/coupons.ts';
import type { Coupon, CouponRule } from '../shared/coupons.ts';
import type { PricingSnapshot } from '../shared/pricing.ts';

export const COUPON_RULES = 'mooncrab:coupon-rules';
export const COUPON_USAGE = 'mooncrab:coupon-usage';
export const COUPON_GUESTS = 'mooncrab:coupon-guest-usage';
export const COUPON_REDEMPTIONS = 'mooncrab:coupon-redemptions';
const COUPON_AUDIT = 'mooncrab:coupon-audit';
const COUPON_QUOTE_RATE = `local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], 3600) end; return n`;

const int = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const optionalInt = (value: unknown, min: number, max: number) => value === null || int(value,min,max);
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function validate(value: unknown): CouponRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rule = value as CouponRule;
  const code = typeof rule.code === 'string' ? rule.code.trim().toUpperCase() : '';
  if (!COUPON_CODE.test(code) || !text(rule.name,100) || !rule.name.trim() || !text(rule.description,400) || !text(rule.notes,800)
    || !['percent','fixed','free-night'].includes(rule.kind) || !int(rule.value,1,rule.kind==='percent'?10_000:rule.kind==='free-night'?90:9_999_999_999)
    || !Array.isArray(rule.rooms) || rule.rooms.length !== 1 || rule.rooms[0] !== 'KASAG'
    || !Array.isArray(rule.packages) || !rule.packages.length || new Set(rule.packages).size!==rule.packages.length || rule.packages.some(value=>!PACKAGES.includes(value))
    || !int(rule.minCents,0,9_999_999_999) || !int(rule.minNights,1,90) || !optionalInt(rule.maxNights,rule.minNights,90)
    || !(rule.startsAt === null || timestamp(rule.startsAt)) || !(rule.endsAt === null || timestamp(rule.endsAt))
    || (rule.startsAt && rule.endsAt && rule.startsAt >= rule.endsAt)
    || !(rule.checkInFrom === null || isValidDate(rule.checkInFrom)) || !(rule.checkInThrough === null || isValidDate(rule.checkInThrough))
    || (rule.checkInFrom && rule.checkInThrough && rule.checkInFrom > rule.checkInThrough)
    || !optionalInt(rule.minLead,0,730) || !optionalInt(rule.maxLead,rule.minLead ?? 0,730)
    || !optionalInt(rule.limit,1,100_000) || !optionalInt(rule.perGuest,1,100_000) || !optionalInt(rule.maxDiscountCents,1,9_999_999_999)
    || !int(rule.paidNights,1,89) || !int(rule.maxFree,1,90) || (rule.kind==='free-night' && (rule.paidNights+rule.value>90 || rule.maxFree<rule.value))
    || typeof rule.combinable !== 'boolean' || !['active','inactive','archived'].includes(rule.status)) return null;
  const {name,description,notes,kind,value:amount,rooms,packages,minCents,minNights,maxNights,startsAt,endsAt,checkInFrom,checkInThrough,minLead,maxLead,limit,perGuest,maxDiscountCents,paidNights,maxFree,combinable,status} = rule;
  return { code,name:name.trim(),description:description.trim(),notes:notes.trim(),kind,value:amount,rooms,packages,minCents,minNights,maxNights,startsAt,endsAt,checkInFrom,checkInThrough,minLead,maxLead,limit,perGuest,maxDiscountCents,paidNights,maxFree,combinable,status };
}

function readCoupon(raw: unknown): Coupon | null {
  if (raw === null) return null;
  if (typeof raw !== 'string') throw new Error('Invalid stored coupon.');
  const value = JSON.parse(raw) as Coupon;
  const rule = validate(value);
  if (!rule || typeof value.revision !== 'string' || !timestamp(value.createdAt) || !timestamp(value.updatedAt)) throw new Error('Invalid stored coupon.');
  return {...rule, revision:value.revision,createdAt:value.createdAt,updatedAt:value.updatedAt};
}

export interface Redemption { code: string; revision: string; guest: string; discountCents: number; limit: number; perGuest: number }

export async function quoteCoupons(command: RedisCommand, base: PricingSnapshot, codes: string[], checkIn: string, email: string, at: Date): Promise<{pricing:PricingSnapshot; redemptions:Redemption[]}> {
  if (!codes.length) return {pricing:base,redemptions:[]};
  const coupons = await Promise.all(codes.map(code=>command(['HGET',COUPON_RULES,code]).then(readCoupon)));
  if (coupons.some(value=>!value)) throw new Error('This promo code is unavailable.');
  const rules = coupons as Coupon[];
  const pricing = priceWithCoupons(base,rules,checkIn,manilaDate(at),at.toISOString());
  const redemptions = await Promise.all(rules.map(async (rule,index)=>{
    if (rule.perGuest !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter your booking email to check this promo code.');
    const guest = rule.code+':'+digest(email.trim().toLowerCase());
    const uses = await command(['HGET',COUPON_USAGE,rule.code]);
    const guestUses = rule.perGuest === null ? 0 : await command(['HGET',COUPON_GUESTS,guest]);
    if ((rule.limit !== null && Number(uses ?? 0) >= rule.limit) || (rule.perGuest !== null && Number(guestUses ?? 0) >= rule.perGuest)) throw new Error('This code is unavailable for these booking details.');
    return { code:rule.code, revision:rule.revision, guest, discountCents:pricing.coupons![index].discountCents, limit:rule.limit ?? 0, perGuest:rule.perGuest ?? 0 };
  }));
  return {pricing,redemptions};
}

export async function allowCouponQuote(command: RedisCommand, req: ApiRequest) {
  const ip = req.headers['x-vercel-forwarded-for'];
  if (typeof ip !== 'string' || !ip) return true;
  return Number(await command(['EVAL',COUPON_QUOTE_RATE,1,'mooncrab:coupon-rate:'+digest(ip.split(',')[0].trim().slice(0,100))])) <= 40;
}

const SAVE_COUPON_SCRIPT = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if raw and cjson.decode(raw).revision ~= ARGV[2] then return 0 end
if not raw and ARGV[2] ~= '' then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[3])
return 1`;

function hash(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw)) return Object.fromEntries(raw.filter((_,index)=>index%2===0).map((key,index)=>[String(key),raw[index*2+1]]));
  return raw && typeof raw==='object' ? raw as Record<string,unknown> : {};
}

export function createCouponsHandler(options: HandlerOptions = {}) {
  const env = options.env ?? process.env;
  const command = options.command ?? createRedisCommand(env);
  const now = options.now ?? (() => new Date());
  return async (req: ApiRequest, res: ApiResponse) => {
    setHeaders(res);
    if (req.method !== 'GET' && req.method !== 'PATCH') {res.status(405).json({error:'Method not allowed.'});return;}
    if (!await authorizeAdmin(req,env,command)) {res.status(401).json({error:'Unauthorized.'});return;}
    if (!configured(env)) {unavailable(res);return;}
    try {
      if (req.method === 'PATCH') {
        if (typeof req.headers['content-type'] !== 'string' || req.headers['content-type'].split(';')[0].trim() !== 'application/json') {res.status(415).json({error:'Send a JSON coupon.'});return;}
        const body = req.body as { previous?:unknown; rule?:unknown } | undefined;
        const rule = validate(body?.rule);
        if (!rule || typeof body?.previous !== 'string') {res.status(400).json({error:'Check the code, discount, dates, and limits.'});return;}
        const at = now();
        const previous = readCoupon(await command(['HGET',COUPON_RULES,rule.code]));
        if ((previous?.revision ?? '') !== body.previous) {res.status(409).json({error:'This code already exists or changed. Refresh the list.'});return;}
        const coupon = { ...rule,revision:randomUUID(),createdAt:previous?.createdAt ?? at.toISOString(),updatedAt:at.toISOString() };
        if (await command(['EVAL', SAVE_COUPON_SCRIPT, 2, COUPON_RULES, COUPON_AUDIT, rule.code, body.previous, JSON.stringify(coupon), at.getTime()]) !== 1) {
          res.status(409).json({error:'The coupon changed. Refresh the list.'});return;
        }
        res.status(200).json({coupon});return;
      }
      const [rules,usage,latest,count] = await Promise.all([command(['HGETALL',COUPON_RULES]),command(['HGETALL',COUPON_USAGE]),
        command(['ZREVRANGE',COUPON_REDEMPTIONS,0,99]),command(['ZCARD',COUPON_REDEMPTIONS])]);
      const coupons = Object.values(hash(rules)).map(raw=>readCoupon(raw));
      const redemptions = Array.isArray(latest) ? latest.map(raw=>JSON.parse(String(raw))) : [];
      res.status(200).json({coupons,usage:hash(usage),redemptions,redemptionCount:Number(count),at:now().toISOString()});
    } catch {unavailable(res);}
  };
}

export function requestCodes(value: unknown) {
  const codes = normalizeCodes(value);
  if (!codes) throw new Error('Enter up to three distinct promo codes using letters, numbers, hyphens, or underscores.');
  return codes;
}
