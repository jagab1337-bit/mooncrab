import { escape, localDate, money, showError, workspaceUrl, type AdminFetch } from './admin-workspace.ts';

export async function renderAnalytics(container:HTMLElement, request:AdminFetch) {
  container.innerHTML=`<div class="workspace-heading"><h2>Web Analytics</h2></div><p class="owner-hint">First-party activity since tracking was enabled. Visits from browsers that block tracking are excluded. Inquiries and approvals come from saved bookings.</p>
  <form class="workspace-form"><label>Period<select name="period"><option value="1">Today</option><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="custom">Custom range</option></select></label><label>From<input type="date" name="start" required></label><label>Through<input type="date" name="end" required></label><button type="submit">Apply dates</button></form>
  <p role="status" class="workspace-status" data-message></p><div class="workspace-grid" data-kpi></div>
  <h3>Traffic by day</h3><div class="workspace-table-wrap" data-trend></div><h3>Booking funnel</h3><div class="workspace-grid" data-funnel></div><div class="workspace-grid" data-breakdown></div>`;
  const get=<T extends HTMLElement>(selector:string)=>container.querySelector<T>(selector)!;
  const form=get<HTMLFormElement>('form'), period=get<HTMLSelectElement>('[name=period]');
  const start=get<HTMLInputElement>('[name=start]'),end=get<HTMLInputElement>('[name=end]'),message=get<HTMLElement>('[data-message]');
  let version=0;
  function dates() {end.value=localDate();start.value=new Date(Date.parse(end.value)-(Number(period.value)-1)*86400000).toISOString().slice(0,10);}
  const stat=(label:string,value:unknown)=>`<div class="workspace-stat">${escape(label)}<strong>${escape(value)}</strong></div>`;
  async function load() {
    const latest=++version;
    message.textContent='Loading analytics…';
    try {
      const data=await request(workspaceUrl('analytics')+'&'+new URLSearchParams({start:start.value,end:end.value}));
      if(latest!==version)return;
      const series=data.series as Array<{date:string;counts:Record<string,number>}>;
      const total:Record<string,number>={};
      for(const {counts} of series)for(const [key,count] of Object.entries(counts))total[key]=(total[key]??0)+count;
      const views=total.view??0,booking=total['page:/booking']??0,requests=total.request??0,approvals=total.approval??0;
      message.textContent=views?'': 'No page traffic recorded in this range.';
      get('[data-kpi]').innerHTML=stat('Page views',views)+stat('Estimated unique visitors',data.visitors)+stat('Estimated sessions',data.sessions)
        +stat('Average engagement',total.engagement?Math.round((total.engagementSeconds??0)/total.engagement)+' sec':'—')+stat('Promo redemptions',data.redemptions)+stat('Discounts on approved stays',money(Number(data.discounts)));
      get('[data-funnel]').innerHTML=stat('Booking page views',booking)+stat('Form interactions',total.interaction??0)+stat('Date selections',total.dates??0)
        +stat('Requests submitted',requests)+stat('Website bookings approved',approvals)+stat('Requests per tracked booking view',booking?(requests/booking*100).toFixed(1)+'%':'—');
      const max=Math.max(1,...series.map(row=>row.counts.view??0));
      get('[data-trend]').innerHTML=`<table class="workspace-table"><thead><tr><th>Day</th><th>Page views</th><th>Requests</th><th>Approvals</th></tr></thead><tbody>${series.map(row=>`<tr><td>${row.date}</td><td><meter min="0" max="${max}" value="${row.counts.view??0}" aria-label="Views on ${row.date}"></meter> ${row.counts.view??0}</td><td>${row.counts.request??0}</td><td>${row.counts.approval??0}</td></tr>`).join('')}</tbody></table>`;
      const region=new Intl.DisplayNames(['en'],{type:'region'});
      get('[data-breakdown]').innerHTML=[['page','Popular pages'],['source','Traffic sources'],['device','Devices'],['country','Countries']].map(([prefix,label])=>{
        const rows=Object.entries(total).filter(([key])=>key.startsWith(prefix+':')).sort((a,b)=>b[1]-a[1]).slice(0,10);
        return `<section class="workspace-entry"><h3>${label}</h3>${rows.length?`<table class="workspace-table"><tbody>${rows.map(([key,count])=>{const value=key.slice(prefix.length+1);return `<tr><th scope="row">${escape(prefix==='country'&&value.length===2?region.of(value):value)}</th><td>${count}</td></tr>`;}).join('')}</tbody></table>`:'<p>No activity yet.</p>'}</section>`;
      }).join('');
    }catch(error){if(latest===version)showError(message,error);}
  }
  dates();
  period.onchange=()=>{if(period.value!=='custom'){dates();void load();}};
  for(const input of [start,end])input.oninput=()=>{period.value='custom';};
  form.onsubmit=event=>{event.preventDefault();void load();};
  await load();
}
