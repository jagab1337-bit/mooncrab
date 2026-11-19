import type { ApiRequest, ApiResponse, RedisCommand } from './availability.ts';
import { isValidDate, manilaDate } from './availability.ts';

export const BOOKING_ARCHIVES='mooncrab:booking-archives';
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INDEX='mooncrab:requests';
const PREFIX='mooncrab:request:';
const STATUS=['pending','confirmed','declined','cancelled'];

const PAGE=`
local filters=cjson.decode(ARGV[1])
local rows, ranges={}, {}
local pending, upcoming, matched=0,0,0
local ids=redis.call('ZREVRANGE',KEYS[1],0,-1)
for _,id in ipairs(ids) do
  local raw=redis.call('GET',ARGV[2]..id)
  if raw then
    local booking=cjson.decode(raw)
    local marker=redis.call('HGET',KEYS[2],id)
    local archive=marker and cjson.decode(marker) or nil
    local active=not archive or not archive.active
    if active and booking.status=='pending' then
      pending=pending+1
      if booking.checkOut>filters.today then table.insert(ranges,{booking.checkIn,booking.checkOut}) end
    end
    if booking.status=='confirmed' and booking.checkOut>filters.today then upcoming=upcoming+1 end
    local source=booking.source or 'Website'
    local search=string.lower(table.concat({booking.name,booking.email,id,booking.phone or '',booking.room or 'KASAG',source},' '))
    local date=archive and (archive.date or string.sub(archive.at,1,10)) or ''
    local filtered=(filters.view=='all' or (filters.view=='active' and active) or (filters.view=='archived' and not active))
      and (filters.status=='' or booking.status==filters.status) and (filters.source=='' or string.lower(source)==filters.source)
      and (filters.start=='' or booking.checkOut>filters.start) and (filters.endDate=='' or booking.checkIn<=filters.endDate)
      and (filters.archived=='' or (not active and date==filters.archived)) and string.find(search,filters.search,1,true)
    if (filters.id~='' and id==filters.id) or (filters.id=='' and filtered) then
      if matched>=filters.offset and #rows<filters.size then table.insert(rows,{raw,active and '' or archive.at}) end
      matched=matched+1
    end
  end
end
return {rows,matched,pending,upcoming,ranges}`;

const CHANGE=`
local ids=cjson.decode(ARGV[1])
for _,id in ipairs(ids) do
  if not redis.call('GET',ARGV[4]..id) then return 0 end
end
for _,id in ipairs(ids) do
  local raw=redis.call('HGET',KEYS[1],id)
  local archived=raw and cjson.decode(raw) or nil
  if ARGV[2]=='archive' and (not archived or not archived.active) then
    redis.call('HSET',KEYS[1],id,cjson.encode({active=true,at=ARGV[3],date=ARGV[5]}))
    redis.call('PERSIST',ARGV[4]..id)
    for _,kind in ipairs({'guest','owner','confirmation','decline'}) do redis.call('PERSIST','mooncrab:email-job:'..id..':'..kind) end
  elseif ARGV[2]=='restore' and archived and archived.active then
    archived.active=false; archived.restoredAt=ARGV[3]
    redis.call('HSET',KEYS[1],id,cjson.encode(archived))
  end
end
return #ids`;

export async function changeBookingArchive(body:Record<string,unknown>, command:RedisCommand, res:ApiResponse, at:Date) {
  if (!Array.isArray(body.ids)||!body.ids.length||body.ids.length>50||body.ids.some(id=>typeof id!=='string'||!ID.test(id))) {
    res.status(400).json({error:'Select up to 50 reservations.'});return;
  }
  const ids=[...new Set(body.ids.map(id=>id.toLowerCase()))];
  const changed=await command(['EVAL',CHANGE,1,BOOKING_ARCHIVES,JSON.stringify(ids),String(body.action),at.toISOString(),PREFIX,manilaDate(at)]);
  if(changed!==ids.length){res.status(404).json({error:'A reservation could not be found. Refresh the list.'});return;}
  res.status(200).json({changed:ids.length});
}

export async function bookingPage(req:ApiRequest, command:RedisCommand, res:ApiResponse, at:Date, readBooking:(raw:unknown)=>object) {
  const string=(key:string,max:number)=>typeof req.query?.[key]==='string'?String(req.query[key]).trim().slice(0,max):'';
  const view=string('view',16)||'active', status=string('status',16), id=string('id',36), source=string('source',60).toLowerCase();
  const start=string('start',10), endDate=string('end',10), archived=string('archived',10);
  const offset=Number(string('offset',8)||0), size=Number(string('size',2)||25);
  if(!['active','archived','all'].includes(view)||(status&&!STATUS.includes(status))||(id&&!ID.test(id))||![10,25,50].includes(size)||!Number.isSafeInteger(offset)||offset<0
    ||[start,endDate,archived].some(date=>date&&!isValidDate(date))||(start&&endDate&&start>endDate)) {res.status(400).json({error:'Check the booking filters.'});return;}
  const result=await command(['EVAL',PAGE,2,INDEX,BOOKING_ARCHIVES,JSON.stringify({view,status,id,source,start,endDate,archived,offset,size,search:string('search',180).toLowerCase(),today:manilaDate(at)}),PREFIX]);
  if(!Array.isArray(result)||!Array.isArray(result[0]))throw new Error('Invalid booking results');
  const requests=result[0].map(([raw,archivedAt])=>({...readBooking(raw),...(archivedAt?{archivedAt}:{})}));
  res.status(200).json({requests,total:Number(result[1]),pending:Number(result[2]),upcoming:Number(result[3]),pendingRanges:result[4]});
}
