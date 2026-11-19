import './appearance.css';
import { locales, localizedPolicy, translation, type LocaleKey } from '../shared/locale-data.ts';

function detect() {
  for (const language of navigator.languages) {
    const tag=language.toLowerCase();
    if (tag.startsWith('zh')) return /tw|hk|mo|hant/.test(tag)?'zh-Hant':'zh-Hans';
    const code=language.split('-')[0];
    const supported=locales.find(record=>record.code===(code==='tl'?'fil':code));
    if(supported)return supported.code;
  }
  return 'en';
}
let language=detect();
try {const saved=localStorage.getItem('mooncrab-language');if(saved&&locales.some(item=>item.code===saved))language=saved;} catch {}
export const tr=(key:LocaleKey)=>translation(language,key);
export const currentLanguage=()=>language;
export function translatePage() {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(node=>{
    node.textContent=tr(node.dataset.i18n as LocaleKey);
    node.lang=language; node.dir=language==='ar'?'rtl':'ltr';
  });
  document.querySelector<HTMLElement>('.booking-main')?.setAttribute('dir',language==='ar'?'rtl':'ltr');
  const [deposit,cancellation,agreement]=localizedPolicy(language);
  for (const [selector,copy] of [['[data-policy-copy]',deposit+' '+cancellation],['[data-policy-agreement-copy]',agreement]]) {
    const node=document.querySelector<HTMLElement>(selector);
    if(node){node.textContent=copy;node.lang=language;}
  }
  const label=document.querySelector<HTMLElement>('[data-language-caption]');
  if(label)label.textContent=locales.find(item=>item.code===language)?.name??'English';
}
export function mountAppearance() {
  const theme=document.querySelector<HTMLSelectElement>('[data-theme-control]');
  if(theme)theme.value=document.documentElement.dataset.themePreference??'system';
  const menus=[...document.querySelectorAll<HTMLDetailsElement>('.appearance-controls details')];
  for(const menu of menus){
    menu.addEventListener('toggle',()=>{if(menu.open)for(const other of menus){if(other!==menu)other.open=false;}});
    menu.addEventListener('keydown',event=>{if(event.key==='Escape'){menu.open=false;menu.querySelector('summary')?.focus();}});
  }
  const select=document.querySelector<HTMLSelectElement>('[data-language-select]');
  const search=document.querySelector<HTMLInputElement>('[data-language-search]');
  if(select&&search) {
    const render=()=>{
      const value=search.value.trim().toLocaleLowerCase();
      select.replaceChildren(...locales.filter(item=>item.code===language||(item.name+' '+item.code).toLocaleLowerCase().includes(value)).map(({code,name})=>new Option(name,code,false,code===language)));
    };
    render();search.oninput=render;
    select.onchange=()=>{
      language=select.value;
      try{localStorage.setItem('mooncrab-language',language);}catch{}
      translatePage();
      document.dispatchEvent(new Event('mooncrab-language-change'));
    };
  }
  translatePage();
  const backdrop=document.querySelector('.hero-copy, .booking-heading');
  if(backdrop) {
    const field=document.createElement('span');field.className='starfield';field.setAttribute('aria-hidden','true');
    for(let i=0;i<84;i++){
      const star=document.createElement('span');
      const size=i%23===0?2.5:i%7===0?1.5:1;
      star.style.cssText='left:'+((i*127.1)%100)+'%;top:'+((i*61.7)%100)+'%;width:'+size+'px;height:'+size+'px;--duration:'+(5+i%6)+'s;--delay:-'+(i%13)+'s';
      if(i%5===0)star.className='twinkle';
      field.append(star);
    }
    backdrop.prepend(field);
  }
}
