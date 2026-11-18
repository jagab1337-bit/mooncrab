import './room-carousel.css';
import { escapeHtml } from './business.ts';

export const roomPhotos = [
  { name:'room-entry', title:'Come in. Make yourself at home.', label:'The welcome', alt:'The view into KASAG through its red door' },
  { name:'bedroom-wide', title:'Your own little island room.', label:'The bedroom', alt:'KASAG’s wooden bed, fresh linens, and leaf wall hanging' },
  { name:'kitchen', title:'A kitchen for slow mornings', label:'The kitchen', alt:'The shared kitchen and wooden dining table beside KASAG' },
  { name:'bathroom', title:'Your own bathroom and hot shower', label:'The bathroom', alt:'KASAG’s private bathroom with a hot shower' },
  { name:'workspace', title:'A quiet corner, just for you', label:'Your quiet corner', alt:'A wooden desk beneath a woven mirror beside the bedroom curtains' },
  { name:'room-greenery', title:'A little green, right outside', label:'A greener view', alt:'Green tropical leaves framing the view into KASAG’s bedroom' },
];

const chevron = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
const expand = '<span class="photo-link-hint" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/></svg><span>View full photo</span></span>';

export function renderRoomCarousel(): string {
  return `<div class="room-carousel" data-room-carousel role="region" aria-roledescription="carousel" aria-label="A look around KASAG">
    <div class="room-carousel-track" id="room-photo-track" tabindex="0" aria-label="Room photographs. Use left and right arrow keys to browse.">${roomPhotos.map((photo,index)=>`<figure class="room-carousel-slide" role="group" aria-roledescription="slide" aria-label="${index+1} of ${roomPhotos.length}" data-title="${escapeHtml(photo.title)}"><a class="photo-link room-carousel-photo" href="/images/full/${photo.name}.webp" data-photo-viewer data-caption="${escapeHtml(photo.title)}"><img src="/images/${photo.name}.webp" alt="${escapeHtml(photo.alt)}" width="1086" height="1448" loading="lazy">${expand}</a><figcaption><span class="eyebrow">${escapeHtml(photo.label)}</span><h3>${escapeHtml(photo.title)}</h3></figcaption></figure>`).join('')}</div>
    <div class="room-carousel-navigation"><div class="room-carousel-status"><span data-room-count aria-live="polite">01 / 06</span><span>Swipe to explore. Tap a photo to see it all.</span><span class="visually-hidden" data-room-title aria-live="polite">${roomPhotos[0].title}</span></div><div class="room-carousel-arrows"><button type="button" data-room-previous aria-label="Previous room photo" disabled>${chevron}</button><button type="button" data-room-next aria-label="Next room photo">${chevron}</button></div></div>
    <div class="room-carousel-thumbnails" aria-label="Choose a room photograph">${roomPhotos.map((photo,index)=>`<button type="button" class="room-carousel-thumbnail" aria-label="Show ${escapeHtml(photo.title)}" aria-controls="room-photo-track"${index===0?' aria-current="true"':''}><img src="/images/${photo.name}.webp" alt="" width="1086" height="1448" loading="lazy"><span>${escapeHtml(photo.title)}</span></button>`).join('')}</div>
  </div>`;
}

/** Native scroll snapping supports touch, trackpads, buttons and keyboard alike. */
export function startRoomCarousel(): void {
  const carousel=document.querySelector<HTMLElement>('[data-room-carousel]');
  if(!carousel||carousel.dataset.ready)return;
  carousel.dataset.ready='true';
  const track=carousel.querySelector<HTMLElement>('.room-carousel-track')!;
  const slides=[...track.querySelectorAll<HTMLElement>('.room-carousel-slide')];
  const thumbnails=[...carousel.querySelectorAll<HTMLButtonElement>('.room-carousel-thumbnail')];
  const rail=carousel.querySelector<HTMLElement>('.room-carousel-thumbnails')!;
  const previous=carousel.querySelector<HTMLButtonElement>('[data-room-previous]')!;
  const next=carousel.querySelector<HTMLButtonElement>('[data-room-next]')!;
  const count=carousel.querySelector<HTMLElement>('[data-room-count]')!;
  const title=carousel.querySelector<HTMLElement>('[data-room-title]')!;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  let current=-1;
  let settleTimer:ReturnType<typeof setTimeout>;
  const offset=(index:number)=>slides[index].offsetLeft-slides[0].offsetLeft;
  function activate(index:number):void {
    if(current===index)return;
    current=index;
    if(slides.some((slide,i)=>i!==index&&slide.contains(document.activeElement)))track.focus({preventScroll:true});
    slides.forEach((slide,i)=>{slide.inert=i!==index;slide.setAttribute('aria-hidden',String(i!==index));});
    thumbnails.forEach((button,i)=>{if(i===index)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');});
    previous.disabled=index===0;next.disabled=index===slides.length-1;
    count.textContent=`${String(index+1).padStart(2,'0')} / ${String(slides.length).padStart(2,'0')}`;
    title.textContent=slides[index].dataset.title!;
    const thumb=thumbnails[index];
    rail.scrollTo({left:thumb.offsetLeft-thumbnails[0].offsetLeft-(rail.clientWidth-thumb.offsetWidth)/2,behavior:motion.matches?'auto':'smooth'});
    slides[index].querySelector('img')!.loading='eager';
    slides[Math.min(index+1,slides.length-1)].querySelector('img')!.loading='eager';
  }
  function move(index:number,animate=true):void {
    const bounded=Math.max(0,Math.min(slides.length-1,index));
    activate(bounded);
    track.scrollTo({left:offset(bounded),behavior:animate&&!motion.matches?'smooth':'instant'});
  }
  function synchronize():void {
    clearTimeout(settleTimer);
    const nearest=slides.reduce((best,_,index)=>Math.abs(offset(index)-track.scrollLeft)<Math.abs(offset(best)-track.scrollLeft)?index:best,0);
    activate(nearest);
  }
  previous.addEventListener('click',()=>move(current-1));
  next.addEventListener('click',()=>move(current+1));
  thumbnails.forEach((button,index)=>button.addEventListener('click',()=>move(index)));
  carousel.addEventListener('keydown',event=>{
    if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    const target:Record<string,number>={ArrowLeft:current-1,ArrowRight:current+1,Home:0,End:slides.length-1};
    if(target[event.key]===undefined)return;
    event.preventDefault();move(target[event.key]);
  });
  track.addEventListener('scroll',()=>{clearTimeout(settleTimer);settleTimer=setTimeout(synchronize,140);},{passive:true});
  track.addEventListener('scrollend',synchronize);
  new ResizeObserver(()=>move(Math.max(0,current),false)).observe(track);
  activate(0);
}
