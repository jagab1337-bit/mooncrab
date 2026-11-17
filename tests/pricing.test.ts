import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePricing, DEFAULT_PRICING, nightsBetween } from '../shared/pricing.ts';
import { createAdminSettingsHandler, createPublicConfigHandler, createQuoteHandler, DEFAULT_SETTINGS, normalizePhone, SETTINGS_KEY } from '../server/business-settings.ts';
import { createBookingRequestHandler, createAdminBookingRequestsHandler, CREATE_REQUEST_SCRIPT } from '../server/booking-requests.ts';
import type { ApiRequest, RedisCommand } from '../server/availability.ts';

const env={UPSTASH_REDIS_REST_URL:'https://store.example.invalid',UPSTASH_REDIS_REST_TOKEN:'test-token',BOOKING_ADMIN_TOKEN:'test-owner'};
const now=()=>new Date('2026-11-18T02:00:00.000Z');
function response(){return {code:200,body:undefined as unknown,headers:{} as Record<string,string>,setHeader(k:string,v:string){this.headers[k]=v;},status(code:number){this.code=code;return this;},json(value:unknown){this.body=value;}};}
function req(body:Record<string,unknown>):ApiRequest{return {method:'POST',headers:{'content-type':'application/json'},body};}
const guest={checkIn:'2026-12-17',checkOut:'2026-12-24',name:'Test Guest',email:'guest@example.invalid',phone:'+63 962 528 4264',whatsapp:true,room:'KASAG',guests:2,idempotencyKey:'371f802b-e248-4189-8b85-12b5a4664f33'};

test('published packages apply only to complete eligible blocks, including multi-week and monthly stays',()=>{
  for(const [nights,total] of [[2,2600],[3,3900],[6,7800],[7,8000],[8,9300],[14,16000],[15,17300],[28,32000],[29,33300],[30,30000],[31,31300],[36,37800],[44,46000],[60,60000],[90,90000]]){
    const price=calculatePricing(nights,2);
    assert.equal(price.totalPhp,total,`${nights} nights`);
    assert.equal(price.depositPhp,total/2);
    assert.equal(price.lineItems.reduce((sum,line)=>sum+line.amountPhp,0),total);
    assert.equal(price.monthlyPackages*30+price.weeklyPackages*7+price.additionalNights,nights);
  }
  assert.equal(calculatePricing(29,2).monthlyPackages,0);
  assert.equal(calculatePricing(30,2).monthlyPackages,1);
});
test('rates and package eligibility are configurable without inventing extra charges',()=>{
  assert.equal(calculatePricing(7,2,{...DEFAULT_PRICING,weeklyEnabled:false}).totalPhp,9100);
  assert.equal(calculatePricing(30,2,{...DEFAULT_PRICING,monthlyEnabled:false}).totalPhp,34600);
  assert.equal(calculatePricing(7,2,{...DEFAULT_PRICING,nightlyPhp:900}).totalPhp,6300);
  assert.throws(()=>calculatePricing(1,2));
  assert.throws(()=>calculatePricing(91,2));
  assert.throws(()=>calculatePricing(3,2,{...DEFAULT_PRICING,minimumNights:4}));
});
test('the third guest supplement is nightly even when the room uses a package',()=>{
  const weekly=calculatePricing(7,3);
  assert.equal(weekly.roomSubtotalPhp,8000);
  assert.equal(weekly.extraGuestFeePhp,3500);
  assert.equal(weekly.totalPhp,11500);
  assert.equal(weekly.depositPhp,5750);
  assert.equal(calculatePricing(30,3).totalPhp,45000);
});
test('date arithmetic excludes checkout and handles cross-year and leap-year boundaries',()=>{
  assert.equal(nightsBetween('2026-12-28','2027-01-04'),7);
  assert.equal(nightsBetween('2028-02-28','2028-03-01'),2);
  assert.ok(Number.isNaN(nightsBetween('2027-02-29','2027-03-03')));
});
test('phone validation normalizes valid international numbers and rejects incomplete/local-only input',()=>{
  assert.equal(normalizePhone('+63 962 528 4264'),'+639625284264');
  assert.equal(normalizePhone('+1 415 555 2671'),'+14155552671');
  for(const value of ['09625284264','+63 123','++639625284264','not a number','',null,123])assert.equal(normalizePhone(value),null,String(value));
});
test('public config and quote use the same persistent room rates',async()=>{
  const settings={...DEFAULT_SETTINGS,pricing:{...DEFAULT_PRICING,weeklyPhp:7500}};
  const command:RedisCommand=async()=>JSON.stringify(settings);
  const config=response();await createPublicConfigHandler({env,command})({method:'GET',headers:{}},config);
  assert.deepEqual(config.body,settings);
  const quote=response();await createQuoteHandler({env,command,now})({method:'GET',headers:{},query:{checkIn:'2026-12-17',checkOut:'2026-12-24',guests:'3',room:'KASAG'}},quote);
  assert.equal(quote.code,200);
  assert.equal((quote.body as {pricing:{totalPhp:number}}).pricing.totalPhp,11000);
});
test('owner settings require authorization and validate rate and official contact destinations',async()=>{
  let stored:string|null=null;
  const command:RedisCommand=async(args)=>{if(args[0]==='GET')return stored;if(args[0]==='SET'){stored=String(args[2]);return 'OK';}throw new Error('Unexpected command');};
  const handler=createAdminSettingsHandler({env,command});
  const forbidden=response();await handler({method:'PATCH',headers:{},body:{pricing:{nightlyPhp:1}}},forbidden);assert.equal(forbidden.code,401);
  const headers={'content-type':'application/json',authorization:'Bearer test-owner'};
  const bad=response();await handler({method:'PATCH',headers,body:{contacts:{whatsappUrl:'https://evil.example/collect'}}},bad);assert.equal(bad.code,400);assert.equal(stored,null);
  const good=response();await handler({method:'PATCH',headers,body:{pricing:{nightlyPhp:1400,minimumNights:3}}},good);assert.equal(good.code,200);
  assert.equal(JSON.parse(stored!).pricing.nightlyPhp,1400);
  assert.equal(JSON.parse(stored!).contacts.email,'greetings@mooncrabsiargao.com');
});
test('booking records keep their server price snapshot across retried submissions and later rate changes',async()=>{
  let settings=structuredClone(DEFAULT_SETTINGS);
  let saved:string|undefined;
  let jobs:unknown[]=[];
  const digests:string[]=[];
  const command:RedisCommand=async(args)=>{
    if(args[0]==='GET'&&args[1]===SETTINGS_KEY)return JSON.stringify(settings);
    if(args[0]==='EVAL'&&args[1]===CREATE_REQUEST_SCRIPT){
      digests.push(String(args[17]));
      if(saved)return ['duplicate',JSON.parse(saved).id,saved];
      const keyCount=Number(args[2]);saved=String(args[3+keyCount]);
      jobs=JSON.parse(String(args[3+keyCount+7]));
      return ['created',JSON.parse(saved).id,saved];
    }
    throw new Error('Unexpected command');
  };
  const handler=createBookingRequestHandler({env,now,command});
  const first=response();await handler(req({...guest,totalPhp:1,pricing:{totalPhp:1}}),first);assert.equal(first.code,201);
  const initial=(first.body as {pricing:{totalPhp:number}}).pricing;
  assert.equal(initial.totalPhp,8000);
  assert.equal(JSON.parse(saved!).phone,'+639625284264');
  assert.equal(jobs.length,2);
  settings={...settings,pricing:{...settings.pricing,weeklyPhp:9000}};
  const retry=response();await handler(req({...guest,totalPhp:2}),retry);assert.equal(retry.code,200);
  assert.deepEqual((retry.body as {pricing:unknown}).pricing,initial);
  assert.equal(digests[0],digests[1]);
  assert.equal(jobs.length,2);
});
test('booking POST requires valid phone, explicit contact preference, and the actual room',async()=>{
  let calls=0;
  const handler=createBookingRequestHandler({env,now,command:async()=>{calls++;return null;}});
  for(const change of [{phone:''},{phone:'09625284264'},{whatsapp:undefined},{whatsapp:'yes'},{room:'invented room'},{room:undefined},{email:'first,second@example.com'},{email:'first;second@example.com'},{email:'Guest <guest@example.com>'}]){
    const res=response();await handler(req({...guest,...change}),res);assert.equal(res.code,400);
  }
  assert.equal(calls,0);
});
test('configured external calendars must have a recent successful sync before owner confirmation',async()=>{
  let mutations=0;
  const id='371f802b-e248-4189-8b85-12b5a4664f33';
  const legacy={id,checkIn:'2026-12-17',checkOut:'2026-12-19',name:'Guest',email:'guest@example.invalid',message:'',status:'pending',createdAt:now().toISOString(),updatedAt:now().toISOString()};
  const command:RedisCommand=async(args)=>{if(args[0]==='GET')return String(args[1]).startsWith('mooncrab:request:')?JSON.stringify(legacy):null;mutations++;throw new Error('Must not confirm');};
  const handler=createAdminBookingRequestsHandler({env:{...env,AIRBNB_ICAL_URL:'https://www.airbnb.com/calendar/ical/private-test.ics'},now,command});
  const res=response();await handler({method:'PATCH',headers:{authorization:'Bearer test-owner','content-type':'application/json'},body:{id,action:'confirm'}},res);
  assert.equal(res.code,409);assert.equal(mutations,0);assert.match(String((res.body as {error:string}).error),/Sync/);
});
