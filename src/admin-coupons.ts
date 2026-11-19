import { couponStatus, PACKAGES } from '../shared/coupons.ts';
import type { Coupon, CouponRule } from '../shared/coupons.ts';
import { escape, money, protectDraft, showError, workspaceUrl, type AdminFetch } from './admin-workspace.ts';

const endpoint=workspaceUrl('coupons');
const labels={percent:'Percentage',fixed:'Fixed amount','free-night':'Complimentary nights'};
const dateInput=(value:string|null|undefined)=>value?new Date(Date.parse(value)+8*3600000).toISOString().slice(0,16):'';
const displayDate=(value:string|null)=>value?new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}):'—';

export async function renderCoupons(container:HTMLElement, request:AdminFetch) {
  container.innerHTML=`<div class="workspace-heading"><h2>Coupons &amp; Promotions</h2><button type="button" class="owner-primary" data-new>Create coupon</button></div>
    <p class="owner-hint">Approving a stay commits its redemption. Cancellation preserves redemption history and usage. Discounts apply to eligible room charges.</p>
    <p class="workspace-status" role="status" data-message></p><div class="workspace-grid" data-metrics></div><div data-editor></div>
    <div class="workspace-form"><label>Search coupons<input type="search"></label><label>View<select data-status><option value="all">All</option><option value="active">Active</option><option value="scheduled">Scheduled</option><option value="expired">Expired</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select></label><label>Sort<select data-sort><option value="new">Newest first</option><option value="popular">Most redeemed</option><option value="name">Name</option></select></label></div>
    <div class="workspace-table-wrap" data-coupons></div><div class="workspace-actions"><button type="button" data-prev>Previous</button><small data-page></small><button type="button" data-next>Next</button></div>
    <details><summary>Recent redemptions</summary><div class="workspace-table-wrap" data-redemptions></div></details>`;
  const get=<T extends HTMLElement>(selector:string)=>container.querySelector<T>(selector)!;
  const message=get<HTMLElement>('[data-message]');
  const editor=get<HTMLElement>('[data-editor]');
  const search=get<HTMLInputElement>('input[type=search]');
  const view=get<HTMLSelectElement>('[data-status]');
  const sort=get<HTMLSelectElement>('[data-sort]');
  const previous=get<HTMLButtonElement>('[data-prev]');
  const next=get<HTMLButtonElement>('[data-next]');
  let coupons:Coupon[]=[];
  let usage:Record<string,number>={};
  let at='';
  let page=0;
  let dirty=false;
  let saving=false;
  const uses=(code:string)=>Number(usage[code]??0);
  const valueText=(coupon:Coupon)=>coupon.kind==='percent'?`${coupon.value/100}%`:coupon.kind==='fixed'?money(coupon.value):`${coupon.value} free per ${coupon.paidNights} paid`;
  protectDraft(container,()=>dirty||saving);
  function draw() {
    const query=search.value.trim().toLowerCase();
    const rows=coupons.filter(coupon=>(view.value==='all'||couponStatus(coupon,at)===view.value)&&[coupon.name,coupon.code,coupon.description].some(text=>text.toLowerCase().includes(query)));
    rows.sort((a,b)=>sort.value==='name'?a.name.localeCompare(b.name):sort.value==='popular'?uses(b.code)-uses(a.code):b.createdAt.localeCompare(a.createdAt));
    const size=15, pages=Math.max(1,Math.ceil(rows.length/size));
    page=Math.min(page,pages-1); previous.disabled=page===0;next.disabled=page>=pages-1;
    get('[data-page]').textContent=`Page ${page+1} of ${pages}`;
    get('[data-coupons]').innerHTML=rows.length?`<table class="workspace-table"><thead><tr><th>Promotion</th><th>Discount</th><th>Room</th><th>Schedule</th><th>Redemptions</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>${rows.slice(page*size,(page+1)*size).map(coupon=>`<tr><td><strong>${escape(coupon.name)}</strong><br><code>${coupon.code}</code></td><td>${labels[coupon.kind]} · ${valueText(coupon)}</td><td>${coupon.rooms.join(', ')}</td><td>${displayDate(coupon.startsAt)} → ${displayDate(coupon.endsAt)}</td><td>${uses(coupon.code)} / ${coupon.limit??'∞'}</td><td>${couponStatus(coupon,at)}</td><td>${displayDate(coupon.createdAt)}</td><td><button type="button" data-edit="${coupon.code}">Edit</button></td></tr>`).join('')}</tbody></table>`:'<p>No matching promotions.</p>';
    const popular=[...coupons].sort((a,b)=>uses(b.code)-uses(a.code))[0];
    const discount=coupons.reduce((sum,coupon)=>sum+Number(usage[coupon.code+':discount']??0),0);
    get('[data-metrics]').innerHTML=`<div class="workspace-stat">Redemptions<strong>${coupons.reduce((sum,coupon)=>sum+uses(coupon.code),0)}</strong></div><div class="workspace-stat">Discounts granted<strong>${money(discount)}</strong></div><div class="workspace-stat">Most redeemed<strong>${popular&&uses(popular.code)?escape(popular.code):'—'}</strong></div>`;
  }
  async function load() {
    const data=await request(endpoint);
    coupons=data.coupons as Coupon[]; usage=data.usage as Record<string,number>; at=String(data.at);
    const redemptions=data.redemptions as Array<{code:string;bookingId:string;room:string;at:string;discountCents:number}>;
    get('[data-redemptions]').innerHTML=redemptions.length?`<table class="workspace-table"><thead><tr><th>Code</th><th>Reservation</th><th>Room</th><th>Date</th><th>Discount</th></tr></thead><tbody>${redemptions.map(row=>`<tr><td>${escape(row.code)}</td><td><a href="/admin#request-${encodeURIComponent(row.bookingId)}">${escape(row.bookingId)}</a></td><td>${escape(row.room)}</td><td>${displayDate(row.at)}</td><td>${money(row.discountCents)}</td></tr>`).join('')}</tbody></table>`:'<p>No promotions have been redeemed yet.</p>';
    draw();
  }
  function open(coupon?:Coupon) {
    if(saving||(dirty&&!confirm('Discard your unsaved coupon changes?')))return;
    dirty=false;
    const number=(name:string,label:string,value:number|null|undefined,step='1',min=0)=>`<label>${label}<input name="${name}" type="number" min="${min}" step="${step}" value="${value??''}"></label>`;
    editor.innerHTML=`<form class="workspace-form workspace-entry"><h3 class="workspace-full">${coupon?'Edit promotion':'New promotion'}</h3>
      <label>Name<input name="name" maxlength="100" required value="${escape(coupon?.name)}"></label><label>Promo code<input name="code" maxlength="24" required ${coupon?'readonly':''} value="${coupon?.code??''}"></label>
      ${coupon?'':'<button type="button" data-generate>Generate code</button>'}<label>Discount type<select name="kind">${Object.entries(labels).map(([key,label])=>`<option value="${key}" ${coupon?.kind===key?'selected':''}>${label}</option>`).join('')}</select></label>
      ${number('value','Discount value (%)',coupon?coupon.kind==='free-night'?coupon.value:coupon.value/100:10,'0.01',0.01)}
      <label>Eligible room<select name="room"><option>KASAG</option></select></label><label>Status<select name="status">${['active','inactive','archived'].map(status=>`<option value="${status}" ${(coupon?.status??'inactive')===status?'selected':''}>${status}</option>`).join('')}</select></label>
      <fieldset class="workspace-full coupon-packages"><legend>Eligible rate packages</legend>${PACKAGES.map(pack=>`<label><input type="checkbox" name="packages" value="${pack}" ${(coupon?.packages??PACKAGES).includes(pack)?'checked':''}>${pack}</label>`).join('')}</fieldset>
      ${number('paidNights','Minimum paid nights per free-night offer',coupon?.paidNights??3,'1',1)}${number('maxFree','Maximum complimentary nights',coupon?.maxFree??1,'1',1)}
      ${number('minCents','Minimum room subtotal (PHP)',coupon?coupon.minCents/100:0,'0.01')}${number('maxDiscountCents','Maximum discount (PHP)',coupon?.maxDiscountCents!=null?coupon.maxDiscountCents/100:null,'0.01',0.01)}
      ${number('minNights','Minimum stay length',coupon?.minNights??2,'1',1)}${number('maxNights','Maximum stay length',coupon?.maxNights,'1',1)}
      <label>Starts (Philippine time)<input name="startsAt" type="datetime-local" value="${dateInput(coupon?.startsAt)}"></label><label>Expires (Philippine time)<input name="endsAt" type="datetime-local" value="${dateInput(coupon?.endsAt)}"></label>
      <label>Earliest check-in<input name="checkInFrom" type="date" value="${coupon?.checkInFrom??''}"></label><label>Latest check-in<input name="checkInThrough" type="date" value="${coupon?.checkInThrough??''}"></label>
      ${number('minLead','Minimum advance booking days',coupon?.minLead)}${number('maxLead','Maximum advance booking days',coupon?.maxLead)}
      ${number('limit','Overall redemption limit',coupon?.limit,'1',1)}${number('perGuest','Redemption limit per guest email',coupon?.perGuest,'1',1)}
      <label class="workspace-full"><span><input type="checkbox" name="combinable" ${coupon?.combinable?'checked':''}> Can combine with other combinable codes</span></label>
      <label class="workspace-full">Description<textarea name="description" rows="2" maxlength="400">${escape(coupon?.description)}</textarea></label><label class="workspace-full">Internal notes<textarea name="notes" rows="2" maxlength="800">${escape(coupon?.notes)}</textarea></label>
      <div class="workspace-actions workspace-full"><button type="submit" class="owner-primary">Save promotion</button><button type="button" data-close>Close</button></div></form>`;
    const form=editor.querySelector('form')!;
    const kind=form.elements.namedItem('kind') as HTMLSelectElement;
    const amount=form.elements.namedItem('value') as HTMLInputElement;
    function updateKind() {
      const free=kind.value==='free-night';
      amount.parentElement!.firstChild!.textContent=free?'Free nights per offer':kind.value==='fixed'?'Discount amount (PHP)':'Percentage discount';
      amount.step=free?'1':'0.01'; amount.required=true; amount.min=free?'1':'0.01';
      for (const key of ['paidNights','maxFree']) (form.elements.namedItem(key) as HTMLInputElement).parentElement!.hidden=!free;
    }
    updateKind();kind.onchange=updateKind;
    form.oninput=()=>{dirty=true;};
    form.querySelector<HTMLButtonElement>('[data-generate]')?.addEventListener('click',()=>{(form.elements.namedItem('code') as HTMLInputElement).value='MC-'+crypto.randomUUID().slice(0,8).toUpperCase();dirty=true;});
    form.querySelector<HTMLButtonElement>('[data-close]')!.onclick=()=>{if(!dirty||confirm('Discard your unsaved coupon changes?')){editor.replaceChildren();dirty=false;}};
    form.onsubmit=async event=>{
      event.preventDefault();
      if(saving)return;
      const data=new FormData(form), str=(name:string)=>String(data.get(name)??'').trim(), optional=(name:string)=>str(name)?Number(str(name)):null;
      const instant=(name:string)=>str(name)?new Date(str(name)+':00+08:00').toISOString():null;
      const rule:CouponRule={code:str('code'),name:str('name'),description:str('description'),notes:str('notes'),kind:kind.value as CouponRule['kind'],value:Math.round(Number(amount.value)*(kind.value==='free-night'?1:100)),rooms:[str('room')],packages:data.getAll('packages') as CouponRule['packages'],
        minCents:Math.round(Number(str('minCents'))*100),minNights:Number(str('minNights')),maxNights:optional('maxNights'),startsAt:instant('startsAt'),endsAt:instant('endsAt'),checkInFrom:str('checkInFrom')||null,checkInThrough:str('checkInThrough')||null,
        minLead:optional('minLead'),maxLead:optional('maxLead'),limit:optional('limit'),perGuest:optional('perGuest'),maxDiscountCents:str('maxDiscountCents')?Math.round(Number(str('maxDiscountCents'))*100):null,
        paidNights:Number(str('paidNights')),maxFree:Number(str('maxFree')),combinable:data.has('combinable'),status:str('status') as CouponRule['status']};
      saving=true;
      try {await request(endpoint,'PATCH',{previous:coupon?.revision??'',rule});dirty=false;editor.replaceChildren();message.textContent='Promotion saved.';await load();} catch(error){showError(message,error);} finally {saving=false;}
    };
    form.querySelector('input')!.focus();
  }
  get<HTMLButtonElement>('[data-new]').onclick=()=>open();
  get('[data-coupons]').onclick=event=>{const code=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-edit]')?.dataset.edit;const coupon=coupons.find(item=>item.code===code);if(coupon)open(coupon);};
  for(const control of [search,view,sort])control.oninput=()=>{page=0;draw();};
  previous.onclick=()=>{page--;draw();};next.onclick=()=>{page++;draw();};
  try {await load();} catch(error){showError(message,error);}
}
