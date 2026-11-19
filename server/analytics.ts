import { createHash } from 'node:crypto';
import { authorizeAdmin, sameOrigin } from './admin-auth.ts';
import { configured, createRedisCommand, isValidDate, manilaDate, setHeaders, unavailable } from './availability.ts';
import type { ApiRequest, ApiResponse, HandlerOptions } from './availability.ts';

const PREFIX='mooncrab:analytics:';
export const analyticsDay=(at:Date)=>PREFIX+manilaDate(at);
const DAY=86400000;
const TTL=400*86400;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_PATH=/^\/(?:booking|explore-siargao(?:\/[a-z0-9-]{1,80})?)?$/;

const TRACK = `
local hits = redis.call('INCR', KEYS[4]); if hits == 1 then redis.call('EXPIRE', KEYS[4], 3600) end
if hits > 150 then return 0 end
local event = ARGV[1]
redis.call('HINCRBY', KEYS[1], event, 1)
if event == 'view' then
  redis.call('HINCRBY', KEYS[1], 'page:'..ARGV[4], 1)
  redis.call('HINCRBY', KEYS[1], 'source:'..ARGV[5], 1)
  redis.call('HINCRBY', KEYS[1], 'device:'..ARGV[6], 1)
  redis.call('HINCRBY', KEYS[1], 'country:'..ARGV[7], 1)
  redis.call('PFADD', KEYS[2], ARGV[2]); redis.call('PFADD', KEYS[3], ARGV[3])
  redis.call('EXPIRE', KEYS[2], ARGV[9]); redis.call('EXPIRE', KEYS[3], ARGV[9])
elseif event == 'engagement' then
  redis.call('HINCRBY', KEYS[1], 'engagementSeconds', ARGV[8])
end
redis.call('EXPIRE', KEYS[1], ARGV[9])
return 1`;

const READ = `
local days, visitors, sessions = {}, {}, {}
for _, key in ipairs(KEYS) do
  table.insert(days,redis.call('HGETALL',key))
  table.insert(visitors,key..':visitors')
  table.insert(sessions,key..':sessions')
end
return {days,redis.call('PFCOUNT',unpack(visitors)),redis.call('PFCOUNT',unpack(sessions))}`;

function traffic(value: unknown) {
  if (typeof value!=='string' || !value || value.length>200) return 'Direct / unknown';
  try {
    const host=new URL(value).hostname.replace(/^www\./,'');
    if (host.endsWith('mooncrabsiargao.com')) return 'Internal navigation';
    if (/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com)$/.test(host)) return 'Search';
    if (/(^|\.)(facebook\.com|instagram\.com|whatsapp\.com|messenger\.com|tiktok\.com)$/.test(host)) return 'Social';
    return 'Other referral';
  } catch{return 'Direct / unknown';}
}

export function createAnalyticsEventHandler(options:HandlerOptions={}) {
  const env=options.env??process.env, command=options.command??createRedisCommand(env), now=options.now??(()=>new Date());
  return async(req:ApiRequest,res:ApiResponse)=>{
    setHeaders(res);
    if(req.method!=='POST'){res.status(405).json({error:'Method not allowed.'});return;}
    if(!sameOrigin(req)){res.status(403).json({error:'Use the Moon Crab website.'});return;}
    const body=req.body as Record<string,unknown>|undefined;
    if(!body||typeof body.event!=='string'||!['view','interaction','dates','engagement'].includes(body.event)||typeof body.visitor!=='string'||!UUID.test(body.visitor)||typeof body.session!=='string'||!UUID.test(body.session)||typeof body.path!=='string'||!PUBLIC_PATH.test(body.path)){res.status(400).json({error:'Invalid analytics event.'});return;}
    if(/bot|crawl|spider|headless|lighthouse/i.test(String(req.headers['user-agent']??''))){res.status(200).json({recorded:false});return;}
    if(!configured(env)){unavailable(res);return;}
    const ip=String(req.headers['x-vercel-forwarded-for']??'').split(',')[0].slice(0,100);
    const key=analyticsDay(now());
    const limiter=createHash('sha256').update(key+':'+(ip||body.session)).digest('hex');
    const country=String(req.headers['x-vercel-ip-country']??'');
    const device=body.device==='Mobile'||body.device==='Tablet'?body.device:'Desktop / other';
    const seconds=body.event==='engagement'&&typeof body.seconds==='number'?Math.min(1800,Math.max(0,Math.round(body.seconds))):0;
    try{
      const result=await command(['EVAL',TRACK,4,key,key+':visitors',key+':sessions',PREFIX+'rate:'+limiter,
        body.event,body.visitor,body.session,body.path,traffic(body.referrer),device,/^[A-Z]{2}$/.test(country)?country:'Unknown',seconds,TTL]);
      res.status(200).json({recorded:result===1});
    }catch{unavailable(res);}
  };
}

export function createAnalyticsDashboardHandler(options:HandlerOptions={}) {
  const env=options.env??process.env, command=options.command??createRedisCommand(env), now=options.now??(()=>new Date());
  return async(req:ApiRequest,res:ApiResponse)=>{
    setHeaders(res);
    if(req.method!=='GET'){res.status(405).json({error:'Method not allowed.'});return;}
    if(!await authorizeAdmin(req,env,command)){res.status(401).json({error:'Unauthorized.'});return;}
    if(!configured(env)){unavailable(res);return;}
    const today=manilaDate(now()), end=req.query?.end??today;
    const start=req.query?.start??new Date(Date.parse(today)-29*DAY).toISOString().slice(0,10);
    if(!isValidDate(start)||!isValidDate(end)||start>end||end>today||Date.parse(end)-Date.parse(start)>365*DAY){res.status(400).json({error:'Choose up to 366 days ending today or earlier.'});return;}
    const dates=[];
    for(let date=Date.parse(start);date<=Date.parse(end);date+=DAY)dates.push(new Date(date).toISOString().slice(0,10));
    try{
      const result=await command(['EVAL',READ,dates.length,...dates.map(date=>PREFIX+date)]);
      if(!Array.isArray(result)||!Array.isArray(result[0])||result[0].length!==dates.length)throw Error('Invalid analytics response');
      const series=dates.map((date,index)=>{
        const pairs=result[0][index];
        const counts=Object.fromEntries(Array.isArray(pairs)?pairs.flatMap((entry,i)=>i%2===0?[[String(entry),Number(pairs[i+1])]]:[]):[]);
        return {date,counts};
      });
      let discounts=0, redemptions=0;
      const promo=await command(['ZRANGEBYSCORE','mooncrab:coupon-redemptions',Date.parse(start+'T00:00:00+08:00'),Date.parse(end+'T00:00:00+08:00')+DAY-1]);
      if(Array.isArray(promo)) for(const raw of promo){const row=JSON.parse(String(raw)) as {discountCents:number};discounts+=row.discountCents;redemptions++;}
      res.status(200).json({series,visitors:Number(result[1]),sessions:Number(result[2]),redemptions,discounts});
    }catch{unavailable(res);}
  };
}
