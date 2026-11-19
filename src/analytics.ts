const reported=new Set<string>();
type Event='view'|'interaction'|'dates'|'engagement';
let context: { visitor:string; session:string; path:string; referrer:string; device:string } | undefined;

export function track(event:Event,seconds?:number) {
  if (!context || reported.has(event)) return;
  reported.add(event);
  const body=JSON.stringify({...context,event,seconds});
  if(event==='engagement'&&navigator.sendBeacon?.('/api/analytics',new Blob([body],{type:'application/json'})))return;
  void fetch('/api/analytics',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true}).catch(()=>{});
}

export function startAnalytics() {
  if(!/^\/(?:booking|explore-siargao(?:\/[a-z0-9-]+)?)?$/.test(location.pathname)||navigator.doNotTrack==='1'||(navigator as Navigator&{globalPrivacyControl?:boolean}).globalPrivacyControl)return;
  try {
    const visitor=localStorage.getItem('mooncrab-visitor')||crypto.randomUUID();
    const previous=JSON.parse(sessionStorage.getItem('mooncrab-visit')||'null') as {id:string;at:number}|null;
    const session=previous&&Date.now()-previous.at<30*60000?previous.id:crypto.randomUUID();
    localStorage.setItem('mooncrab-visitor',visitor);
    sessionStorage.setItem('mooncrab-visit',JSON.stringify({id:session,at:Date.now()}));
    const referrer=document.referrer?new URL(document.referrer).origin:'';
    const device=innerWidth<600?'Mobile':innerWidth<1024?'Tablet':'Desktop / other';
    context={visitor,session,path:location.pathname,referrer,device};
  } catch{return;}
  track('view');
  let visibleAt=Date.now();
  let time=0;
  const addTime=()=>{if(visibleAt) time+=Date.now()-visibleAt;visibleAt=0;};
  if(document.hidden)visibleAt=0;
  document.addEventListener('visibilitychange',()=>{if(document.hidden)addTime();else visibleAt=Date.now();});
  window.addEventListener('pagehide',()=>{addTime();if(time>=1000)track('engagement',time/1000);},{once:true});
}
