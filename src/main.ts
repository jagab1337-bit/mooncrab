import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import '@fontsource/cormorant-garamond/latin-400-italic.css';
import '@fontsource/lekton/latin-400.css';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const bookingHost = location.hostname === 'booking.mooncrabsiargao.com';
const home = bookingHost ? 'https://mooncrabsiargao.com/' : '/';
const book = ['mooncrabsiargao.com', 'www.mooncrabsiargao.com'].includes(location.hostname) ? 'https://booking.mooncrabsiargao.com/' : '/booking';
const moon = `<span class="brand-art" aria-hidden="true"><img src="/images/brand-board.png" alt="" width="1025" height="823"></span>`;
const arrow = `<svg class="arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" aria-hidden="true"><path d="M5 19 19 5M5 5h14v14"/></svg>`;
const icons: Record<string, string> = {
  bath: '<path d="M4 13h16v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Zm2 8-1 2m13-2 1 2M5 13V5a3 3 0 0 1 6 0v1m-2 2h4"/>',
  shower: '<path d="M5 21V5a3 3 0 0 1 6 0v2m-3 2h6M9 12v1m4-1v1m-4 3v1m4-1v1m4-4v1m0 3v1"/>',
  kitchen: '<path d="M4 4v6m3-6v6m3-6v6M4 8h6m-3 2v12m11-18v18m0-18c-4 3-4 8 0 9"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4m-9 8h2m3 0h2m3 0h1"/>',
  palm: '<path d="M10 22q4-8 2-15m0 0Q7 2 2 7q6-1 10 0Zm0 0q3-6 9-4-3 1-9 4Zm0 0q6-1 10 5-6-3-10-5Zm0 0Q6 6 3 13q5-4 9-6Z"/>',
};
function icon(name: string) { return `<svg viewBox="0 0 24 26" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.calendar}</svg>`; }
function header(active = '') {
  return `<header class="header"><a class="brand" href="${home}" aria-label="Mooncrab Siargao home">${moon}</a><nav aria-label="Main navigation"><a href="${home}#kasag" ${active === 'room' ? 'aria-current="page"' : ''}>The room</a><a href="${home}#island">Island living</a><a href="${home}#details">Good to know</a></nav><a class="button button-small" href="${book}">Plan your stay ${arrow}</a></header>`;
}
function footer() {
  return `<footer class="footer"><div class="footer-top"><a class="brand" href="${home}" aria-label="Mooncrab Siargao home">${moon}</a><p>A little room for island living.</p><a class="text-link" href="${book}">Find your dates ${arrow}</a></div><div class="footer-bottom"><span>Siargao, Philippines</span><span>© ${new Date().getFullYear()} Mooncrab Siargao</span><span>Slow days. Thoughtful stays.</span></div></footer>`;
}
function landing() {
  app.innerHTML = `${header()}<main id="main">
    <section class="hero"><div class="hero-copy"><p class="eyebrow"><span class="tiny-star">✳</span> A SMALL STAY. A BEAUTIFUL ISLAND.</p><h1>Find your<br>island <em>rhythm.</em></h1><p class="hero-description">A little less rush. A little more room to breathe.<br>Welcome to your easygoing corner of Siargao.</p><div class="hero-actions"><a class="button" href="${book}">Make yourself at home ${arrow}</a><a class="under-link" href="#kasag">Meet KASAG <span aria-hidden="true">↓</span></a></div><div class="hero-note"><span class="note-line"></span>Thoughtful comfort. Down-to-earth stays.</div></div><div class="hero-art"><img src="/images/bedroom.webp" alt="KASAG’s warm bedroom, with a wooden bed, fresh linens, and hanging leaf details" fetchpriority="high" width="1200" height="1600"><div class="art-stamp">SLOW DOWN<br><span>you’re on island time</span><span class="stamp-star">✴</span></div><span class="art-coordinate">SIARGAO ISLAND · PHILIPPINES</span></div></section>
    <div class="amenity-strip"><span class="strip-intro">YOUR STAY, SIMPLY</span><span>${icon('bath')}En suite bathroom</span><span>${icon('shower')}Hot shower</span><span>${icon('kitchen')}Shared kitchen beside your room</span><span class="strip-end">Just one room.<br><em>All yours to settle into.</em></span></div>
    <section class="intro section" id="our-story"><p class="eyebrow">A WARM WELCOME TO MOONCRAB</p><h2>Good things come<br>in <em>small stays.</em></h2><div><p>We believe an island escape should feel special—and still leave room in your budget for the island itself.</p><p>Mooncrab keeps it simple: one room, the comforts that matter, and space to find your own pace. Nothing overdone. Just an easy place to come back to.</p><span class="signature">See you on the island.</span></div></section>
    <section class="room-section section" id="kasag"><div class="section-top"><p class="eyebrow">YOUR LITTLE ISLAND ADDRESS</p><span class="index-label">01 / THE ROOM</span></div><div class="room-grid"><figure class="room-photo"><img src="/images/room-entry.webp" alt="A view into KASAG through its red door, with a neatly made wooden bed" loading="lazy" width="1200" height="1600"><figcaption><span>KASAG</span><small>YOUR LITTLE ISLAND RETREAT</small></figcaption></figure><div class="room-copy"><span class="pill">OUR ONE & ONLY ROOM</span><h2>Meet <em>KASAG.</em></h2><p class="room-lead">Small in scale.<br>Generous in comfort.</p><p>Your place to pause between island days. KASAG brings together the essentials for an easy, comfortable stay—with a little Mooncrab character.</p><ul class="room-amenities"><li>${icon('bath')}<div><strong>Your own bathroom</strong><span>An en suite bathroom, just for your room.</span></div></li><li>${icon('shower')}<div><strong>A warm welcome back</strong><span>A hot shower at the end of the day.</span></div></li><li>${icon('kitchen')}<div><strong>A little home comfort</strong><span>A shared kitchen right beside the room.</span></div></li></ul><a class="text-link" href="${book}">See KASAG’s available dates ${arrow}</a></div></div><p class="image-caption">A real look at KASAG. One room, with the comforts that matter.</p></section>
    <section class="gallery-section section" aria-labelledby="gallery-title"><div class="section-top"><p class="eyebrow">A CLOSER LOOK</p><span class="index-label">AT HOME IN KASAG</span></div><div class="gallery-heading"><h2 id="gallery-title">Little details.<br><em>A warmer welcome.</em></h2><p>Step inside your room and the shared spaces beside it.</p></div><div class="photo-gallery"><figure><img src="/images/bedroom-wide.webp" alt="KASAG’s wooden bed, fresh linens, and hanging leaf details" width="1200" height="1600" loading="lazy"><figcaption>Your space to settle in</figcaption></figure><figure><img src="/images/kitchen.webp" alt="The shared kitchen beside KASAG, with wooden cabinets and a dining table" width="1200" height="1600" loading="lazy"><figcaption>The shared kitchen next door</figcaption></figure><figure><img src="/images/bathroom.webp" alt="KASAG’s en suite bathroom with its hot shower, sink, and toilet" width="1200" height="1600" loading="lazy"><figcaption>A private bathroom & hot shower</figcaption></figure><figure><img src="/images/dining.webp" alt="The wooden dining table set with plates and woven placemats" width="1200" height="900" loading="lazy"><figcaption>Room for a slow breakfast</figcaption></figure><figure><img src="/images/workspace.webp" alt="A wooden desk and chair beneath a round woven mirror" width="1200" height="1600" loading="lazy"><figcaption>A quiet little corner</figcaption></figure><figure><img src="/images/exterior.webp" alt="Mooncrab’s building with a planted frontage, blue windows, and an outside staircase" width="1200" height="1600" loading="lazy"><figcaption>Your Siargao home base</figcaption></figure></div></section>
    <section class="island-section section" id="island"><div class="section-top"><p class="eyebrow">LESS ON THE AGENDA. MORE IN THE MOMENT.</p><span class="index-label">02 / ISLAND LIVING</span></div><div class="island-heading"><h2>Leave a little<br>room for <em>Siargao.</em></h2><p>For unhurried mornings, spontaneous detours, and the kind of days you don’t need to plan. Make the island your own.</p></div><div class="island-cards"><article><span class="card-number">01</span>${icon('kitchen')}<h3>Mornings, your way.</h3><p>Make a simple breakfast in the shared kitchen. Take your time with the first part of your day.</p></article><article><span class="card-number">02</span>${icon('palm')}<h3>Follow the island.</h3><p>Head out and discover Siargao at your own pace. Leave a little space for the unexpected.</p></article><article><span class="card-number">03</span>${moon}<h3>Come back to comfort.</h3><p>A hot shower. Your own room. The simple pleasure of settling in after a day out.</p></article></div></section>
    <section class="details-section section" id="details"><div><p class="eyebrow">A FEW LITTLE DETAILS</p><h2>Before you<br><em>make yourself at home.</em></h2></div><div class="faq"><details open><summary>What is included with KASAG?<span aria-hidden="true">+</span></summary><p>KASAG has an en suite bathroom with a hot shower. You can also use the shared kitchen located beside the room.</p></details><details><summary>Is the kitchen private?<span aria-hidden="true">+</span></summary><p>The bathroom is private to your room; the kitchen beside KASAG is shared.</p></details><details><summary>How do I check dates and rates?<span aria-hidden="true">+</span></summary><p>Open our booking calendar to choose your dates and send a stay request. We’ll confirm the nightly rate and your stay details before you commit. A request is not a confirmed reservation.</p></details><details><summary>How many rooms are there?<span aria-hidden="true">+</span></summary><p>We currently have just one room, KASAG. The calendar shows availability for this room only.</p></details></div></section>
    <section class="cta-section"><span class="eyebrow">A LITTLE ROOM IS WAITING</span><h2>Your island days<br><em>start here.</em></h2><a class="button button-light" href="${book}">Let’s find your dates ${arrow}</a><span class="cta-mark" aria-hidden="true">${moon}</span></section>
    </main>${footer()}`;
}

function todayInManila(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
}
const dateLabel = (value: string) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
function booking() {
  document.title = 'Find your dates — KASAG at Mooncrab Siargao';
  app.innerHTML = `${header()}<main id="main" class="booking-main"><div class="booking-heading"><p class="eyebrow">ONE ROOM. YOUR OWN ISLAND RHYTHM.</p><h1>A little room<br>for <em>your dates.</em></h1><p>Find a moment for yourself at KASAG.</p></div><div class="booking-layout"><aside class="booking-room"><div class="booking-room-photo"><img src="/images/bedroom.webp" alt="KASAG’s bedroom at Mooncrab Siargao" width="1200" height="1600"></div><div class="booking-room-info"><span class="eyebrow">YOUR ROOM</span><h2>KASAG</h2><p>Our one & only room.</p><ul><li>${icon('bath')} En suite bathroom</li><li>${icon('shower')} Hot shower</li><li>${icon('kitchen')} Shared kitchen beside the room</li></ul><div class="rate-note">A thoughtful stay, a friendly rate.<small>Your host will confirm the rate for your dates before you commit.</small></div></div></aside><section class="calendar-panel" aria-labelledby="calendar-title"><div class="calendar-intro"><span class="eyebrow">01 / CHOOSE YOUR DATES</span><h2 id="calendar-title">When shall we see you?</h2><p>Select your check-in, then your check-out.</p></div><div class="calendar-controls"><button type="button" class="icon-button" id="prev-month" aria-label="Previous month">←</button><h3 id="calendar-month"></h3><button type="button" class="icon-button" id="next-month" aria-label="Next month">→</button></div><div class="weekdays" aria-hidden="true">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => `<span>${d}</span>`).join('')}</div><div id="calendar-days" class="calendar-days" aria-label="Choose stay dates"></div><div class="calendar-legend"><span><i class="legend-free"></i>Available</span><span><i class="legend-blocked"></i>Unavailable</span><span><i class="legend-selected"></i>Your stay</span></div><div id="calendar-status" class="calendar-status" role="status" aria-live="polite"></div><button type="button" id="retry-calendar" class="under-link retry-button" hidden>Try again ↗</button><div class="date-summary"><div><span>CHECK-IN</span><strong id="check-in">Choose a date</strong></div><span class="summary-arrow" aria-hidden="true">→</span><div><span>CHECK-OUT</span><strong id="check-out">Choose a date</strong></div><button class="under-link" type="button" id="clear-dates">Clear</button></div><p id="stay-length" class="stay-length" aria-live="polite">A maximum of 30 nights per request. Dates are in Philippine time.</p><form id="booking-form" class="booking-form"><span class="eyebrow">02 / A FEW DETAILS</span><div class="form-row"><label>Your name<input name="name" autocomplete="name" maxlength="100" required placeholder="Full name"></label><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com"></label></div><label>A note for your host <span class="optional">(optional)</span><textarea name="message" maxlength="1000" rows="3" placeholder="Anything you’d like us to know about your stay?"></textarea></label><label class="consent"><input type="checkbox" name="consent" required><span>I agree to share these details with Mooncrab to respond to my stay request.</span></label><button type="submit" class="button" id="request-stay" disabled>Request this stay ${arrow}</button><p class="request-note">A request isn’t a reservation. Your host will confirm availability and the rate with you before your stay is confirmed. No payment is collected here.</p><p class="privacy-note">Your name, email, and message are visible only to the property’s host, to manage this enquiry. Please don’t include sensitive information.</p><div id="request-status" role="status" aria-live="polite"></div></form></section></div></main>${footer()}`;
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
  form.addEventListener('input', () => { requestId = crypto.randomUUID(); });
  function updateSummary() {
    $('#check-in').textContent = checkIn ? dateLabel(checkIn) : 'Choose a date';
    $('#check-out').textContent = checkOut ? dateLabel(checkOut) : 'Choose a date';
    const nights = checkIn && checkOut ? Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000) : 0;
    $('#stay-length').textContent = nights ? `${nights} ${nights === 1 ? 'night' : 'nights'} at KASAG · Check-out day is not an overnight stay.` : 'A maximum of 30 nights per request. Dates are in Philippine time.';
    submit.disabled = busy || !dataReady || !nights;
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
    if (nights > 30) { status.textContent = 'Please choose a stay of up to 30 nights.'; return; }
    busy = true; status.textContent = 'Checking every night of your stay…'; draw();
    try {
      const months = new Set<string>();
      const dates: string[] = [];
      for (let d = new Date(`${checkIn}T00:00:00Z`); d.toISOString().slice(0, 10) < iso; d.setUTCDate(d.getUTCDate() + 1)) { const date = d.toISOString().slice(0, 10); dates.push(date); months.add(date.slice(0, 7)); }
      await Promise.all([...months].map(m => getMonth(m, true)));
      if (dates.some(d => cache.get(d.slice(0, 7))!.has(d))) { status.textContent = 'Part of that stay is unavailable. Please choose an earlier check-out or a new check-in.'; }
      else { checkOut = iso; status.textContent = 'Your dates are selected. Tell us a little about yourself below.'; }
    } catch { dataReady = false; status.textContent = 'We couldn’t check all those nights. Please retry the calendar.'; retry.hidden = false; }
    busy = false; draw();
  }
  $('#prev-month').addEventListener('click', () => { view.setUTCMonth(view.getUTCMonth() - 1); void load(); });
  $('#next-month').addEventListener('click', () => { view.setUTCMonth(view.getUTCMonth() + 1); void load(); });
  retry.addEventListener('click', () => { void load(); });
  $('#clear-dates').addEventListener('click', () => { if (busy) return; checkIn = ''; checkOut = ''; requestId = crypto.randomUUID(); status.textContent = dataReady ? 'Choose your check-in date.' : status.textContent; draw(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !checkIn || !checkOut || !dataReady || !form.reportValidity()) return;
    busy = true; draw();
    const result = $('#request-status');
    result.className = 'request-status'; result.textContent = 'Sending your stay request…';
    const fields = new FormData(form);
    try {
      const response = await fetch('/api/booking-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkIn, checkOut, name: String(fields.get('name')).trim(), email: String(fields.get('email')).trim(), message: String(fields.get('message')).trim(), idempotencyKey: requestId }), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) { checkOut = ''; cache.clear(); result.textContent = 'Those dates have just become unavailable. Please choose another stay.'; }
        else if (response.status === 429) { result.textContent = 'You’ve sent a few requests already. Please try again in an hour.'; }
        else { result.textContent = 'Your request could not be sent. Please try again shortly. No reservation has been made.'; }
        result.classList.add('status-warning');
      } else if (typeof data.id === 'string' && data.status === 'pending') {
        result.classList.add('status-success'); result.textContent = `Your request is with Mooncrab. Your host will contact you by email to discuss the rate and confirm your stay. Reference: ${data.id}. Your room is not reserved until confirmed.`;
        form.reset(); checkIn = ''; checkOut = ''; requestId = crypto.randomUUID();
      } else { throw new Error('Unexpected response'); }
    } catch { result.classList.add('status-warning'); result.textContent = 'We couldn’t confirm delivery. Please retry with the same details; we’ll avoid creating a duplicate request.'; }
    busy = false; draw();
    if (!checkOut && !result.classList.contains('status-success')) void load();
  });
  void load();
}

if (location.pathname === '/manage') {
  app.innerHTML = `${header()}<main id="main" class="manage-root"></main>${footer()}`;
  void import('./manage.ts').then(module => module.renderManage(document.querySelector('#main')!));
} else if (bookingHost || location.pathname === '/booking') booking();
else landing();
