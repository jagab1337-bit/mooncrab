import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { calculatePricing, formatPhp, type PricingSnapshot } from '../shared/pricing.ts';
import { CHANNELS, CONTACTS, externalArrow, DEFAULT_CONFIG, escapeHtml, getPublicConfig, type PublicConfig } from './business.ts';
import './booking-ui.css';

export function phoneFields(): string {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  const countries = getCountries().sort((a,b) => (names.of(a)||a).localeCompare(names.of(b)||b));
  return `<div class="phone-fields"><label for="phone-country">Country code<select id="phone-country" name="phoneCountry" autocomplete="country">${countries.map(code => `<option value="${code}"${code==='PH'?' selected':''}>${escapeHtml(names.of(code)||code)} +${getCountryCallingCode(code)}</option>`).join('')}</select></label><label for="guest-phone">Phone or WhatsApp number<input id="guest-phone" name="phone" type="tel" autocomplete="tel-national" inputmode="tel" maxlength="40" required placeholder="912 345 6789" aria-describedby="phone-hint"></label></div><p class="phone-hint" id="phone-hint">Include a number where we can reach you about your stay.</p><label class="whatsapp-choice"><input type="checkbox" name="whatsapp" checked> This number is available on WhatsApp</label>`;
}
export function bookingAlternatives(): string {
  return `<div class="booking-alternatives"><p class="eyebrow">MORE WAYS TO PLAN YOUR STAY</p><p>Prefer your usual booking platform?</p><div><a href="${CHANNELS.airbnb}" target="_blank" rel="noopener noreferrer">Book on Airbnb ${externalArrow}</a><a href="${CHANNELS.booking}" target="_blank" rel="noopener noreferrer">Book on Booking.com ${externalArrow}</a></div><small>Reservations and payments on these platforms are completed there.</small></div>`;
}
export function createBookingUi(form: HTMLFormElement, onConfig: () => void) {
  let config: PublicConfig = DEFAULT_CONFIG;
  let ready = false;
  let configFailed = false;
  let quoteGeneration = 0;
  let lastSelection = '';
  let popupDismissed = false;
  const calendarIntro = document.querySelector('.calendar-intro')!;
  calendarIntro.insertAdjacentHTML('beforeend', '<label class="room-selection" for="room-selection">Your room<select name="room" id="room-selection" form="booking-form"><option value="KASAG">KASAG · Private room · 1–3 guests</option></select></label>');
  form.insertAdjacentHTML('beforeend','<div class="estimate-persistent" aria-live="polite"></div>');
  const persistent = form.querySelector<HTMLElement>('.estimate-persistent')!;
  form.querySelector('#request-stay')!.before(persistent);
  const summary = document.querySelector('.date-summary')!;
  summary.insertAdjacentHTML('afterend','<aside class="estimate-popup" aria-label="Your estimated stay price" hidden><button type="button" aria-label="Dismiss price summary">×</button><div class="estimate-content" aria-live="polite"></div></aside>');
  const popup = document.querySelector<HTMLElement>('.estimate-popup')!;
  popup.querySelector('button')!.addEventListener('click',()=>{popupDismissed=true;popup.hidden=true;});
  const phone = form.querySelector<HTMLInputElement>('[name="phone"]')!;
  const country = form.querySelector<HTMLSelectElement>('[name="phoneCountry"]')!;
  phone.addEventListener('input',()=>phone.setCustomValidity(''));
  country.addEventListener('change',()=>phone.setCustomValidity(''));
  function normalizedPhone(): string | null {
    const parsed = parsePhoneNumberFromString(phone.value, country.value as CountryCode);
    if (!parsed?.isValid()) {phone.setCustomValidity('Enter a valid phone number for the selected country.');phone.reportValidity();return null;}
    phone.setCustomValidity('');return parsed.number;
  }
  const breakdown = (pricing: PricingSnapshot) => `<p class="eyebrow">YOUR MOON CRAB STAY</p><p class="estimate-dates">KASAG · ${lastSelection.split('|').slice(0,2).map(escapeHtml).join(' → ')}</p><div class="estimate-lines">${pricing.lineItems.map(line=>`<p><span>${line.quantity} × ${escapeHtml(line.label)}</span><strong>${formatPhp(line.amountPhp)}</strong></p>`).join('')}</div><p class="estimate-total"><span>Estimated total · ${pricing.nights} nights</span><strong>${formatPhp(pricing.totalPhp)}</strong></p><p class="estimate-deposit">50% deposit after agreement: <b>${formatPhp(pricing.depositPhp)}</b></p><small>Final reservation subject to availability confirmation.</small>`;
  function displayPrice(pricing: PricingSnapshot) {
    persistent.innerHTML=breakdown(pricing);
    popup.querySelector('.estimate-content')!.innerHTML=breakdown(pricing);
  }
  function update(checkIn:string,checkOut:string,guests:number): boolean {
    const nights = checkIn&&checkOut?(Date.parse(checkOut)-Date.parse(checkIn))/86400000:0;
    if (!ready) {persistent.textContent=configFailed?'Current room rates could not load. Please refresh the page or contact greetings@mooncrabsiargao.com.':'Loading current room rates…';popup.hidden=true;return false;}
    if (!checkIn||!checkOut||nights<config.pricing.minimumNights||nights>config.pricing.maxNights) {quoteGeneration++;lastSelection='';persistent.textContent=checkIn&&!checkOut?'Choose your check-out date to see your estimated total.':`Choose a stay of ${config.pricing.minimumNights}–${config.pricing.maxNights} nights to see your estimated total.`;popup.hidden=true;return false;}
    const key=[checkIn,checkOut,guests].join('|');
    if(key!==lastSelection){
      lastSelection=key;popupDismissed=false;
      displayPrice(calculatePricing(nights,guests,config.pricing));
      const generation=++quoteGeneration;
      const query=new URLSearchParams({room:'KASAG',checkIn,checkOut,guests:String(guests)});
      void fetch(`/api/quote?${query}`,{signal:AbortSignal.timeout(10000)}).then(async response=>{if(!response.ok)throw Error();const data=await response.json();if(generation===quoteGeneration&&data.pricing&&Number.isFinite(data.pricing.totalPhp)){config.pricing=data.pricing.rates;displayPrice(data.pricing);}}).catch(()=>{if(generation===quoteGeneration)persistent.querySelector('small')!.textContent='This estimate uses the latest loaded rates. Your host will confirm the total.';});
    }
    popup.hidden=popupDismissed;return true;
  }
  function showSuccess(data:{id:string;room:string;checkIn:string;checkOut:string;guests:number;pricing:PricingSnapshot},name:string): void {
    const first = name.trim().split(/\s+/)[0] || 'there';
    const dialog=document.createElement('dialog');dialog.className='request-dialog';
    const contacts=config.contacts;
    const message=`Hi Moon Crab! I’m ${first}. My KASAG request is ${data.checkIn} to ${data.checkOut}, ${data.pricing.nights} nights, estimated ${formatPhp(data.pricing.totalPhp)}. Reference ${data.id}.`;
    const whatsapp=new URL(contacts.whatsappUrl);if(whatsapp.hostname==='wa.me'&&!whatsapp.pathname.startsWith('/qr/'))whatsapp.searchParams.set('text',message);
    dialog.setAttribute('aria-labelledby','request-dialog-title');
    dialog.innerHTML=`<button class="request-dialog-close" type="button" aria-label="Close booking request summary" autofocus>×</button><p class="eyebrow">MOON CRAB SIARGAO</p><h2 id="request-dialog-title">Thank you for reaching out, <em>${escapeHtml(first)}!</em></h2><p>We’ve received your booking request. To finish your booking, please chat with us on WhatsApp. We’ll confirm availability and the next steps together.</p><div class="request-dialog-summary"><p>KASAG · ${escapeHtml(data.checkIn)} → ${escapeHtml(data.checkOut)}</p><p>${data.pricing.nights} nights · ${data.guests} guests</p><strong>Estimated total: ${formatPhp(data.pricing.totalPhp)}</strong></div><p class="request-dialog-pending">Your reservation is not yet confirmed. A 50% deposit is required after we agree your total.</p><a class="button" href="${escapeHtml(whatsapp.href)}" target="_blank" rel="noopener noreferrer">Chat With Us on WhatsApp ${externalArrow}</a><small>${escapeHtml(contacts.phone)}</small><p class="request-dialog-secondary">Or reach us through:</p><div class="request-dialog-social"><a href="${escapeHtml(contacts.facebookUrl)}" target="_blank" rel="noopener noreferrer">Facebook page ${externalArrow}</a><a href="${escapeHtml(contacts.instagramUrl)}" target="_blank" rel="noopener noreferrer">Instagram ${externalArrow}</a></div><p class="request-dialog-reference">Request reference: ${escapeHtml(data.id)}</p>`;
    const opener=document.activeElement as HTMLElement|null;
    document.body.append(dialog);dialog.showModal();
    document.documentElement.classList.add('request-dialog-open');
    dialog.querySelector('button')!.addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>{document.documentElement.classList.remove('request-dialog-open');dialog.remove();opener?.focus();});
  }
  getPublicConfig().then(value=>{config=value;ready=true;document.querySelectorAll<HTMLElement>('[data-rate]').forEach(el=>{const key=el.dataset.rate as 'nightlyPhp'|'weeklyPhp'|'monthlyPhp';el.textContent=formatPhp(config.pricing[key]);});onConfig();}).catch(()=>{configFailed=true;onConfig();});
  return { update, normalizedPhone, showSuccess, get ready(){return ready;}, get rates(){return config.pricing;} };
}
