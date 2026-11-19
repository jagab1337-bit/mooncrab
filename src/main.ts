import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-400-italic.css';
import '@fontsource/lekton/latin-400.css';
import './style.css';
import { startPhotoViewer } from './lightbox.ts';
import { createBookingUi, phoneFields, bookingAlternatives } from './booking-ui.ts';
import { renderExplore } from './explore.ts';
import { startExploreCarousel } from './explore-carousel.ts';
import { startRoomCarousel } from './room-carousel.ts';
import { getPublicConfig, hydrateContacts } from './business.ts';
import { DIRECT_POLICY } from '../shared/booking-terms.ts';
import { arrow, book, header, footer, home, icon, renderLanding, startMotion } from './site.ts';

import { startAnalytics, track } from './analytics.ts';
import { currentLanguage, mountAppearance } from './appearance.ts';

startAnalytics();
const app = document.querySelector<HTMLDivElement>('#app')!;
function todayInManila(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
}
const dateLabel = (value: string) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
function booking() {
  document.title = 'Find your dates — KASAG at Mooncrab Siargao';
  app.innerHTML = `${header()}<main id="main" class="booking-main wrap">
    <div class="booking-heading"><div><p class="eyebrow">YOUR DATES. YOUR LITTLE ISLAND ROOM.</p><h1>A little room<br>for <em>your dates.</em></h1></div><p>Choose your stay at KASAG.<br>We’ll confirm the total and help you settle the details.</p></div>
    <div class="booking-layout"><aside class="booking-room"><div class="booking-room-photo"><img src="/images/bedroom.webp" alt="KASAG’s bedroom at Mooncrab Siargao" width="1086" height="1448"></div><div class="booking-room-info"><p class="eyebrow">OUR ONE & ONLY ROOM</p><h2>KASAG</h2><p>2 guests included · maximum 3</p><ul><li>${icon('bath')} En suite bathroom & hot shower</li><li>${icon('kitchen')} Shared kitchen beside the room</li><li>${icon('clock')} Check-in 2:00 PM · check-out 11:00 AM</li></ul><div class="published-rates"><div><strong data-rate="nightlyPhp">₱1,300</strong><small>per night · minimum 2</small></div><div><strong data-rate="weeklyPhp">₱8,000</strong><small>7-night package</small></div><div><strong data-rate="monthlyPhp">₱30,000</strong><small>30-night package</small></div></div><div class="monthly-inclusions"><strong>For monthly stays</strong>Electricity, water & Wi-Fi included. Weekly housekeeping, private en suite with hot shower, and a private kitchen.</div><div class="rate-note"><strong>A third guest is welcome.</strong><p>One additional guest: ₱500 per night. Your host will confirm the room rate and full total for your stay.</p></div><div class="deposit-note"><span class="eyebrow">RESERVING YOUR DATES</span><strong>50% deposit, after your quote.</strong><p>We’ll send bank transfer or receiving QR details once availability and your booking total are agreed. Your dates are reserved after we verify receipt.</p></div><a class="under-link" href="${home}#details">House rules & stay details ${arrow}</a>${bookingAlternatives()}</div></aside>
    <section class="calendar-panel" aria-labelledby="calendar-title"><div class="booking-calendar"><div class="calendar-intro"><p class="eyebrow">01 / CHOOSE YOUR DATES</p><h2 id="calendar-title">When shall we see you?</h2><p>Select your check-in, then your check-out. Stay for at least 2 nights. See your estimate as you choose.</p></div>
    <div class="calendar-controls"><button type="button" class="icon-button" id="prev-month" aria-label="Previous month">←</button><h3 id="calendar-month"></h3><button type="button" class="icon-button" id="next-month" aria-label="Next month">→</button></div><div class="weekdays" aria-hidden="true">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<span>${d}</span>`).join('')}</div><div id="calendar-days" class="calendar-days" aria-label="Choose stay dates"></div><div class="calendar-legend"><span><i class="legend-free"></i>Available</span><span><i class="legend-blocked"></i>Unavailable</span><span><i class="legend-selected"></i>Your stay</span></div><div id="calendar-status" class="calendar-status" role="status" aria-live="polite"></div><button type="button" id="retry-calendar" class="under-link retry-button" hidden>Try again ↗</button>
    <div class="date-summary"><div><span>CHECK-IN · 2:00 PM</span><strong id="check-in">Choose a date</strong></div><span class="summary-arrow" aria-hidden="true">→</span><div><span>CHECK-OUT · 11:00 AM</span><strong id="check-out">Choose a date</strong></div><button class="under-link" type="button" id="clear-dates">Clear</button></div><p id="stay-length" class="stay-length" aria-live="polite">Minimum 2 nights, up to 90 nights per request. Dates are in Philippine time.</p></div>
    <form id="booking-form" class="booking-form"><p class="eyebrow">02 / MAKE IT YOUR STAY</p><div class="guest-selector"><label for="guest-count">Number of guests</label><select id="guest-count" name="guests"><option value="1">1 guest</option><option value="2" selected>2 guests</option><option value="3">3 guests · +₱500 per night</option></select><p id="guest-charge" aria-live="polite">Two guests are included in the standard room rate.</p></div><div class="form-row"><label><span data-i18n="name">Your name</span><input name="name" autocomplete="name" maxlength="100" required placeholder="Full name"></label><label><span data-i18n="email">Email address</span><input name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com"></label></div>${phoneFields()}<label>A note for your host <span class="optional">(optional)</span><textarea name="message" maxlength="1000" rows="3" placeholder="Airport transfers, a pickup rental, island tours, or anything else?"></textarea></label><label class="consent"><input type="checkbox" name="consent" required><span>I agree to share these details with Mooncrab to respond to my stay request.</span></label><section class="booking-policy" aria-labelledby="booking-policy-title"><h3 id="booking-policy-title"><span data-i18n="policy">Booking &amp; Cancellation Policy</span></h3><p><span data-policy-copy>${DIRECT_POLICY.deposit} ${DIRECT_POLICY.cancellation}</span> Reservations are subject to Moon Crab’s confirmation.</p><label class="consent"><input type="checkbox" name="policyAccepted" required><span data-policy-agreement-copy>I have read and agree to Moon Crab Siargao’s booking, cancellation, and non-refundable deposit policies.</span></label></section><button type="submit" class="button" id="request-stay" disabled><span data-i18n="request">Request this stay</span> ${arrow}</button><p class="request-note">Your host will confirm availability and the booking total before sending bank/QR details for a 50% deposit. Wait for Moon Crab’s confirmation before making travel arrangements.</p><p class="privacy-note">Only the host can view your name, email, and note. Please don’t include passwords, banking details, or sensitive information.</p><div id="request-status" role="status" aria-live="polite"></div></form></section></div></main>${footer()}`;
  const today = todayInManila();
  const firstMonth = today.slice(0, 7);
  const [fy, fm] = firstMonth.split('-').map(Number);
  const lastDay = new Date(Date.UTC(fy, fm - 1 + 24, 0)).toISOString().slice(0, 10);
  let view = new Date(`${firstMonth}-01T00:00:00Z`);
  let checkIn = '';
  let checkOut = '';
  let busy = false;
  let requestId = crypto.randomUUID();
  let fetchGeneration = 0;
  let dataReady = false;
  const cache = new Map<string, Set<string>>();
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
  const monthKey = () => view.toISOString().slice(0, 7);
  const status = $('#calendar-status');
  const retry = $('#retry-calendar');
  const submit = $<HTMLButtonElement>('#request-stay');
  const form = $<HTMLFormElement>('#booking-form');
  form.addEventListener('input', () => { track('interaction'); requestId = crypto.randomUUID(); updateSummary(); });
  const interests: Record<string, string> = {
    'airport-transfer': 'Please help arrange airport pickup/drop-off at ₱350 per person each way.',
    'pickup-rental': 'I’m interested in the red 2023 Mitsubishi Strada GLS guest rental from ₱2,500 per day.',
    'island-tours': 'Please help coordinate local island tours and activities with the operators.',
    'motorbike-rental': 'Please help arrange a motorbike rental at the guest rate.',
  };
  const interest = new URLSearchParams(location.search).get('interest') || '';
  if (interests[interest]) form.querySelector<HTMLTextAreaElement>('[name=message]')!.value = interests[interest];
  const bookingUi = createBookingUi(form, () => { updateSummary(); });
  function updateSummary() {
    $('#check-in').textContent = checkIn ? dateLabel(checkIn) : 'Choose a date';
    $('#check-out').textContent = checkOut ? dateLabel(checkOut) : 'Choose a date';
    const nights = checkIn && checkOut ? Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000) : 0;
    $('#stay-length').textContent = nights ? `${nights} ${nights === 1 ? 'night' : 'nights'} at KASAG · Check-out day is not an overnight stay.` : 'Minimum 2 nights, up to 90 nights per request. Dates are in Philippine time.';
    const guests = Number($<HTMLSelectElement>('#guest-count').value);
    const extraFee = nights * 500;
    $('#guest-charge').textContent = guests === 3
      ? nights ? `Third guest supplement: ₱${extraFee.toLocaleString('en-PH')} for ${nights} nights (₱500 per night), added to the room rate.` : 'One additional guest: ₱500 per night, added to the room rate.'
      : 'Up to two guests are included in the standard room rate.';
    const quoteValid = bookingUi.update(checkIn, checkOut, guests);
    submit.disabled = busy || !dataReady || !quoteValid;
  }
  function draw() {
    $('#calendar-month').textContent = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(view);
    $<HTMLButtonElement>('#prev-month').disabled = monthKey() <= firstMonth || busy;
    $<HTMLButtonElement>('#next-month').disabled = monthKey() >= lastDay.slice(0, 7) || busy;
    const year = view.getUTCFullYear();
    const month = view.getUTCMonth();
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const offset = (view.getUTCDay() + 6) % 7;
    const grid = $('#calendar-days');
    grid.replaceChildren();
    for (let i = 0; i < offset; i++) { const gap = document.createElement('span'); gap.className = 'calendar-gap'; grid.append(gap); }
    for (let day = 1; day <= days; day++) {
      const iso = `${monthKey()}-${String(day).padStart(2, '0')}`;
      const blocked = cache.get(monthKey())?.has(iso) ?? false;
      const past = iso < today;
      const btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = String(day);
      btn.className = 'day';
      const selected = iso === checkIn || iso === checkOut;
      if (blocked) btn.classList.add('blocked');
      if (selected) btn.classList.add('selected');
      if (checkIn && checkOut && iso > checkIn && iso < checkOut) btn.classList.add('in-range');
      if (iso === today) btn.classList.add('today');
      const checkoutCandidate = !!checkIn && !checkOut && iso > checkIn && !past;
      btn.disabled = !dataReady || busy || past || (blocked && !checkoutCandidate);
      btn.setAttribute('aria-label', `${dateLabel(iso)}${past ? ', past date' : blocked ? checkoutCandidate ? ', unavailable overnight; may be selected for check-out' : ', unavailable' : dataReady ? ', available' : ', availability not loaded'}`);
      btn.setAttribute('aria-pressed', String(selected));
      btn.addEventListener('click', () => { void select(iso); });
      grid.append(btn);
    }
    updateSummary();
  }
  async function getMonth(key: string, force = false): Promise<Set<string>> {
    if (!force && cache.has(key)) return cache.get(key)!;
    const response = await fetch(`/api/availability?month=${encodeURIComponent(key)}`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok || data.configured !== true || !Array.isArray(data.blockedDates) || data.blockedDates.some((d: unknown) => typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error('unavailable');
    const dates = new Set<string>(data.blockedDates);
    cache.set(key, dates);
    return dates;
  }
  async function load() {
    const gen = ++fetchGeneration;
    dataReady = false; retry.hidden = true;
    status.className = 'calendar-status'; status.textContent = 'Checking KASAG’s calendar…';
    draw();
    try {
      await getMonth(monthKey(), true);
      if (gen !== fetchGeneration) return;
      dataReady = true;
      status.textContent = 'Live availability for KASAG. Choose your check-in date.';
    } catch {
      if (gen !== fetchGeneration) return;
      status.className = 'calendar-status status-warning';
      status.textContent = 'Our booking calendar is not available just yet. Please check back soon to find your dates.';
      retry.hidden = false;
    }
    draw();
  }
  async function select(iso: string) {
    $('#request-status').textContent = '';
    requestId = crypto.randomUUID();
    if (!checkIn || checkOut || iso <= checkIn) {
      if (cache.get(iso.slice(0, 7))?.has(iso)) return;
      checkIn = iso; checkOut = ''; status.textContent = 'Lovely. Now choose your check-out date.'; draw(); return;
    }
    const nights = (Date.parse(iso) - Date.parse(checkIn)) / 86400000;
    if (nights < bookingUi.rates.minimumNights) { status.textContent = `KASAG has a minimum stay of ${bookingUi.rates.minimumNights} nights. Please choose a later check-out date.`; return; }
    if (nights > bookingUi.rates.maxNights) { status.textContent = `Please choose a stay of up to ${bookingUi.rates.maxNights} nights.`; return; }
    busy = true; status.textContent = 'Checking every night of your stay…'; draw();
    try {
      const months = new Set<string>();
      const dates: string[] = [];
      for (let d = new Date(`${checkIn}T00:00:00Z`); d.toISOString().slice(0, 10) < iso; d.setUTCDate(d.getUTCDate() + 1)) { const date = d.toISOString().slice(0, 10); dates.push(date); months.add(date.slice(0, 7)); }
      await Promise.all([...months].map(m => getMonth(m, true)));
      if (dates.some(d => cache.get(d.slice(0, 7))!.has(d))) { status.textContent = 'Part of that stay is unavailable. Please choose an earlier check-out or a new check-in.'; }
      else { checkOut = iso; track('dates'); status.textContent = 'Your dates are selected. Tell us a little about yourself below.'; }
    } catch { dataReady = false; status.textContent = 'We couldn’t check all those nights. Please retry the calendar.'; retry.hidden = false; }
    busy = false; draw();
  }
  $('#prev-month').addEventListener('click', () => { view.setUTCMonth(view.getUTCMonth() - 1); void load(); });
  $('#next-month').addEventListener('click', () => { view.setUTCMonth(view.getUTCMonth() + 1); void load(); });
  retry.addEventListener('click', () => { void load(); });
  $('#clear-dates').addEventListener('click', () => { if (busy) return; checkIn = ''; checkOut = ''; requestId = crypto.randomUUID(); status.textContent = dataReady ? 'Choose your check-in date.' : status.textContent; draw(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !checkIn || !checkOut || !dataReady || !bookingUi.ready || !form.reportValidity()) return;
    const phone = bookingUi.normalizedPhone();
    if (!phone) return;
    busy = true; draw();
    const result = $('#request-status');
    result.className = 'request-status'; result.textContent = 'Sending your stay request…';
    const fields = new FormData(form);
    try {
      const response = await fetch('/api/booking-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: 'KASAG', phone, whatsapp: fields.get('whatsapp') === 'on', checkIn, checkOut, guests: Number(fields.get('guests')), name: String(fields.get('name')).trim(), email: String(fields.get('email')).trim(), message: String(fields.get('message')).trim(), idempotencyKey: requestId, policyVersion: DIRECT_POLICY.version, policyAccepted: fields.get('policyAccepted') === 'on', couponCodes: bookingUi.codes, locale: currentLanguage() }), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) { checkOut = ''; cache.clear(); result.textContent = 'Those dates have just become unavailable. Please choose another stay.'; }
        else if (response.status === 400 && typeof data.error === 'string') { result.textContent = data.error; }
        else if (response.status === 429) { result.textContent = 'You’ve sent a few requests already. Please try again in an hour.'; }
        else { result.textContent = 'Your request could not be sent. Please try again shortly. No reservation has been made.'; }
        result.classList.add('status-warning');
      } else if (typeof data.id === 'string' && data.status === 'pending' && data.pricing && Number.isFinite(data.pricing.totalPhp)) {
        bookingUi.showSuccess(data, String(fields.get('name')));
        result.classList.add('status-success'); result.textContent = `Your request is with Mooncrab. Please chat with us on WhatsApp to agree the total and receive bank/QR instructions for your 50% deposit. Reference: ${data.id}. Your room is not reserved until confirmed.`;
        form.reset(); bookingUi.resetPromo(); checkIn = ''; checkOut = ''; requestId = crypto.randomUUID();
        status.textContent = 'Your request has been sent. You can choose new dates for another enquiry.';
      } else { throw new Error('Unexpected response'); }
    } catch { result.classList.add('status-warning'); result.textContent = 'We couldn’t confirm delivery. Please retry with the same details; we’ll avoid creating a duplicate request.'; }
    busy = false; draw();
    if (!checkOut && !result.classList.contains('status-success')) void load();
  });
  void load();
}

const ownerPath = location.pathname.replace(/\/+$/, '');
if (ownerPath === '/manage' || ownerPath === '/admin' || ownerPath.startsWith('/admin/')) {
  document.title = 'Owner dashboard — Mooncrab Siargao';
  app.innerHTML = `${header()}<main id="main" class="manage-root"></main>${footer()}`;
  void import('./manage.ts').then(module => module.renderManage(document.querySelector('#main')!));
} else if (location.pathname.startsWith('/explore-siargao')) renderExplore(app, location.pathname);
else if (ownerPath === '/booking' || (ownerPath === '' && location.hostname === 'booking.mooncrabsiargao.com')) booking();
else renderLanding(app);
mountAppearance();
startMotion();
startPhotoViewer();
startExploreCarousel();
startRoomCarousel();

hydrateContacts();
void getPublicConfig().then(config => { hydrateContacts(config.contacts); document.querySelectorAll<HTMLElement>('[data-rate]').forEach(el => { const key = el.dataset.rate as 'nightlyPhp'|'weeklyPhp'|'monthlyPhp'; el.textContent = new Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP',maximumFractionDigits:0}).format(config.pricing[key]); }); }).catch(() => {});
