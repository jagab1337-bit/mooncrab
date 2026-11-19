import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { DEFAULT_PRICING, validPricing, calculatePricing, nightsBetween } from '../shared/pricing.ts';
import type { PricingConfig } from '../shared/pricing.ts';
import { configured, createRedisCommand, isValidDate, monthRange, setHeaders, unavailable } from './availability.ts';
import type { ApiRequest, ApiResponse, HandlerOptions, RedisCommand } from './availability.ts';
import { authorizeAdmin } from './admin-auth.ts';
import { MANUAL_SOURCES } from '../shared/booking-terms.ts';
import { allowCouponQuote, quoteCoupons, requestCodes } from './coupons.ts';

export const SETTINGS_KEY = 'mooncrab:business-settings';
export interface BusinessContacts {
  phone: string; whatsappUrl: string; facebookUrl: string; instagramUrl: string;
  email: string; bookingEmail: string; notificationEmail: string;
}
export interface BusinessSettings { room: 'KASAG'; pricing: PricingConfig; contacts: BusinessContacts; bookingSources: string[] }
export const DEFAULT_SETTINGS: BusinessSettings = {
  room:'KASAG',pricing:{...DEFAULT_PRICING},bookingSources:[],contacts:{
    phone:'+639625284264',whatsappUrl:'https://wa.me/639625284264',
    facebookUrl:'https://www.facebook.com/share/1CsWCrqdR8/?mibextid=wwXIfr',instagramUrl:'https://www.instagram.com/mooncrabsiargao/',
    email:'greetings@mooncrabsiargao.com',bookingEmail:'bookings@mooncrabsiargao.com',notificationEmail:'greetings@mooncrabsiargao.com',
  },
};
function customSources(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const seen = new Set([...MANUAL_SOURCES, 'Website'].map(source => source.toLowerCase()));
  const sources = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string') return null;
    const source = candidate.trim();
    if (!source || source.length > 60 || /[\u0000-\u001f]/.test(source) || seen.has(source.toLowerCase())) return null;
    seen.add(source.toLowerCase());
    sources.push(source);
  }
  return sources;
}
const emailPattern = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i;
function validContacts(value: unknown): value is BusinessContacts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const c = value as BusinessContacts;
  if (typeof c.phone !== 'string' || c.phone.length > 25 || !parsePhoneNumberFromString(c.phone)?.isValid()) return false;
  if (!['email','bookingEmail','notificationEmail'].every(key => typeof c[key as keyof BusinessContacts] === 'string' && c[key as keyof BusinessContacts].length <= 254 && emailPattern.test(c[key as keyof BusinessContacts]))) return false;
  return [['whatsappUrl',['wa.me','api.whatsapp.com','www.whatsapp.com']],['facebookUrl',['facebook.com','www.facebook.com','m.me']],['instagramUrl',['instagram.com','www.instagram.com']]].every(([key, hosts]) => {
    try { const url = new URL(c[key as keyof BusinessContacts]); return url.protocol === 'https:' && (hosts as string[]).includes(url.hostname) && !url.username && !url.password && url.href.length <= 1000; } catch { return false; }
  });
}
export async function readBusinessSettings(command: RedisCommand): Promise<BusinessSettings> {
  const stored = await command(['GET',SETTINGS_KEY]);
  if (stored === null) return structuredClone(DEFAULT_SETTINGS);
  if (typeof stored !== 'string') throw new Error('Invalid business settings');
  const data = JSON.parse(stored) as BusinessSettings;
  const bookingSources = customSources(data.bookingSources ?? []);
  if (data.room !== 'KASAG' || !validPricing(data.pricing) || !validContacts(data.contacts) || !bookingSources) throw new Error('Invalid business settings');
  return {room:'KASAG',pricing:data.pricing,contacts:data.contacts,bookingSources};
}
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40 || !value.trim().startsWith('+')) return null;
  const phone = parsePhoneNumberFromString(value.trim());
  return phone?.isValid() ? phone.number : null;
}
export function createPublicConfigHandler(options: HandlerOptions = {}) {
  const env=options.env??process.env, command=options.command??createRedisCommand(env);
  return async (req:ApiRequest,res:ApiResponse) => {
    setHeaders(res);
    if(req.method!=='GET'){res.setHeader('Allow','GET');res.status(405).json({error:'Method not allowed.'});return;}
    if(!configured(env)){unavailable(res);return;}
    try {const { room, pricing, contacts } = await readBusinessSettings(command); res.status(200).json({room,pricing,contacts});} catch {unavailable(res);}
  };
}
export function createQuoteHandler(options: HandlerOptions = {}) {
  const env=options.env??process.env, command=options.command??createRedisCommand(env), now=options.now??(()=>new Date());
  return async(req:ApiRequest,res:ApiResponse)=>{
    setHeaders(res);
    if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('Allow','GET, POST');res.status(405).json({error:'Method not allowed.'});return;}
    const input = req.method==='POST' ? req.body as Record<string,unknown> | undefined : req.query;
    const {checkIn,checkOut,guests,room}=input??{};
    const at=now();
    const range=monthRange(at);
    if(!isValidDate(checkIn)||!isValidDate(checkOut)||checkIn<range.today||checkOut>range.lastDate||room!=='KASAG'||typeof guests!=='string'||! /^[1-3]$/.test(guests)){res.status(400).json({error:'Choose KASAG, valid stay dates, and 1–3 guests.'});return;}
    if(!configured(env)){unavailable(res);return;}
    try{
      const settings=await readBusinessSettings(command);
      let pricing;try{pricing=calculatePricing(nightsBetween(checkIn,checkOut),Number(guests),settings.pricing,at.toISOString());}catch{res.status(400).json({error:`Choose a stay of ${settings.pricing.minimumNights}–${settings.pricing.maxNights} nights.`});return;}
      if (req.method==='POST') {
        if (!await allowCouponQuote(command,req)) {res.status(429).json({error:'Too many promo checks. Try again later.'});return;}
        const email = typeof input?.email==='string' ? input.email.trim().slice(0,254) : '';
        try {pricing=(await quoteCoupons(command,pricing,requestCodes(input?.codes),checkIn,email,at)).pricing;}
        catch (error) {res.status(400).json({error:error instanceof Error ? error.message : 'This promo code is unavailable.'});return;}
      }
      res.status(200).json({pricing});
    }catch{unavailable(res);}
  };
}
export function createAdminSettingsHandler(options: HandlerOptions = {}) {
  const env=options.env??process.env, command=options.command??createRedisCommand(env);
  return async(req:ApiRequest,res:ApiResponse)=>{
    setHeaders(res);
    if(req.method!=='GET'&&req.method!=='PATCH'){res.setHeader('Allow','GET, PATCH');res.status(405).json({error:'Method not allowed.'});return;}
    if(!await authorizeAdmin(req,env,command)){res.status(401).json({error:'Unauthorized.'});return;}
    if(!configured(env)){unavailable(res);return;}
    try{
      const settings=await readBusinessSettings(command);
      if(req.method==='PATCH'){
        if(typeof req.headers['content-type']!=='string'||req.headers['content-type'].split(';')[0].trim().toLowerCase()!=='application/json'){res.status(415).json({error:'Send an application/json request.'});return;}
        const body=req.body as Record<string,unknown>;
        if(!body||typeof body!=='object'||Array.isArray(body)||!Object.keys(body).length||Object.keys(body).some(key=>!['pricing','contacts','bookingSources'].includes(key))){res.status(400).json({error:'Provide pricing, contact settings, or booking sources.'});return;}
        const pricing=body.pricing===undefined?settings.pricing:body.pricing&&typeof body.pricing==='object'&&!Array.isArray(body.pricing)?{...settings.pricing,...body.pricing}:null;
        const contacts=body.contacts===undefined?settings.contacts:body.contacts&&typeof body.contacts==='object'&&!Array.isArray(body.contacts)?{...settings.contacts,...body.contacts}:null;
        if(!validPricing(pricing)||!validContacts(contacts)||Object.keys(pricing).some(key=>!Object.hasOwn(DEFAULT_PRICING,key))||Object.keys(contacts).some(key=>!Object.hasOwn(DEFAULT_SETTINGS.contacts,key))){res.status(400).json({error:'Provide valid room rates, stay limits, phone, email, and official social links.'});return;}
        const bookingSources = body.bookingSources === undefined ? settings.bookingSources : customSources(body.bookingSources);
        if (!bookingSources) { res.status(400).json({error:'Enter up to 20 distinct additional sources, up to 60 characters each. Built-in sources are already included.'}); return; }
        const updated={room:'KASAG' as const,pricing,contacts,bookingSources};
        await command(['SET',SETTINGS_KEY,JSON.stringify(updated)]);
        res.status(200).json(updated);return;
      }
      res.status(200).json(settings);
    }catch{unavailable(res);}
  };
}
