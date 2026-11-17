import './explore-carousel.css';

/** Native scrolling keeps swipes, trackpads and the no-script fallback usable. */
export function startExploreCarousel(): void {
  const carousel = document.querySelector<HTMLElement>('[data-explore-carousel]');
  if (!carousel || carousel.dataset.ready) return;
  carousel.dataset.ready = 'true';
  const track = carousel.querySelector<HTMLElement>('.island-carousel-track')!;
  const slides = [...track.querySelectorAll<HTMLElement>('.island-carousel-slide')];
  const thumbnails = [...carousel.querySelectorAll<HTMLButtonElement>('.island-carousel-thumbnail')];
  const rail = carousel.querySelector<HTMLElement>('.island-carousel-thumbnails')!;
  const previous = carousel.querySelector<HTMLButtonElement>('[data-carousel-previous]')!;
  const next = carousel.querySelector<HTMLButtonElement>('[data-carousel-next]')!;
  const count = carousel.querySelector<HTMLElement>('[data-carousel-count]')!;
  const title = carousel.querySelector<HTMLElement>('[data-carousel-title]')!;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let current = -1;
  let settleTimer: ReturnType<typeof setTimeout>;
  const offset = (index: number) => slides[index].offsetLeft - slides[0].offsetLeft;
  function activate(index: number): void {
    if (current === index) return;
    current = index;
    if (slides.some((slide,i)=>i!==index && slide.contains(document.activeElement))) track.focus({preventScroll:true});
    slides.forEach((slide,i)=>{slide.inert=i!==index;slide.setAttribute('aria-hidden',String(i!==index));});
    thumbnails.forEach((button,i)=>{if(i===index)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');});
    previous.disabled=index===0;next.disabled=index===slides.length-1;
    count.textContent=`${String(index+1).padStart(2,'0')} / ${String(slides.length).padStart(2,'0')}`;
    title.textContent=slides[index].dataset.title!;
    const thumb=thumbnails[index];
    rail.scrollTo({left:thumb.offsetLeft-thumbnails[0].offsetLeft-(rail.clientWidth-thumb.offsetWidth)/2,behavior:motion.matches?'auto':'smooth'});
    slides[(index+1)%slides.length].querySelector<HTMLImageElement>('img')!.loading='eager';
  }
  function move(index: number, animate = true): void {
    const bounded=Math.min(slides.length-1,Math.max(0,index));
    activate(bounded);
    track.scrollTo({left:offset(bounded),behavior:animate&&!motion.matches?'smooth':'instant'});
  }
  function synchronize(): void {
    clearTimeout(settleTimer);
    const nearest=slides.reduce((best,_,index)=>Math.abs(offset(index)-track.scrollLeft)<Math.abs(offset(best)-track.scrollLeft)?index:best,0);
    activate(nearest);
  }
  previous.addEventListener('click',()=>move(current-1));
  next.addEventListener('click',()=>move(current+1));
  thumbnails.forEach((button,index)=>button.addEventListener('click',()=>move(index)));
  carousel.addEventListener('keydown',event=>{
    if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    const targets: Record<string,number>={ArrowLeft:current-1,ArrowRight:current+1,Home:0,End:slides.length-1};
    const target=targets[event.key];
    if(target===undefined)return;
    event.preventDefault();move(target);
  });
  track.addEventListener('scroll',()=>{clearTimeout(settleTimer);settleTimer=setTimeout(synchronize,140);},{passive:true});
  track.addEventListener('scrollend',synchronize);
  new ResizeObserver(()=>move(Math.max(0,current),false)).observe(track);
  activate(0);
}
