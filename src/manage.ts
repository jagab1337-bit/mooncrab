import './manage.css';
import './admin-workspace.css';
import { showError } from './admin-workspace.ts';
import { bindManualBooking, bindPayment, manualBookingFields, paymentFields } from './admin-bookings.ts';
import { centsFromInput, externalSource, hasRecordedDirectPolicy } from '../shared/booking-terms.ts';
import { localizedPolicy } from '../shared/locale-data.ts';
import type { BookingAgreement, BookingPayment } from '../shared/booking-terms.ts';
import type { Communication } from './admin-email.ts';
import type { PricingSnapshot } from '../shared/pricing.ts';
import { formatPhp } from '../shared/pricing.ts';
import { reviewLabelMarkup, translateReviewLabels } from './review-labels.ts';

const workspacePages = {
  '/admin/reviews': { label: 'Guest Reviews', load: async () => (await import('./admin-reviews.ts')).renderAdminReviews },
  '/admin/finance': { label: 'Finance Tracker', load: async () => (await import('./admin-finance.ts')).renderFinance },
  '/admin/vault': { label: 'Logins &amp; Notes', load: async () => (await import('./admin-vault.ts')).renderVault },
  '/admin/projects': { label: 'Project Management', load: async () => (await import('./admin-projects.ts')).renderProjects },
  '/admin/settings/notifications': { label: 'Notification Settings', load: async () => (await import('./admin-notifications.ts')).renderNotifications },
  '/admin/email-automations': { label: 'Email Automations', load: async () => (await import('./admin-email.ts')).renderEmailAutomations },
  '/admin/coupons': { label: 'Coupons &amp; Promotions', load: async () => (await import('./admin-coupons.ts')).renderCoupons },
  '/admin/analytics': { label: 'Web Analytics', load: async () => (await import('./admin-analytics.ts')).renderAnalytics },
};
type NotificationJob = { id: string; bookingId: string; kind: string; status: string; lastAttempt?: string; acceptedAt?: string; recipient?: string; delivery?: number; safeToRetry: boolean; lastError?: string };


type DateSource = '' | 'airbnb' | 'booking' | 'direct';
type DateDetail = { source:DateSource; notes:string };
type CalendarResponse = { blockedDates: string[]; manualDates?: string[]; confirmedDates?: string[]; importedDates?: string[]; dateDetails?:Record<string,DateDetail>; dateSources?:Record<string,Exclude<DateSource,''>[]>; initialized: boolean; error?: string };
type BookingRequest = { id: string; checkIn: string; checkOut: string; name: string; email: string; phone?: string; whatsapp?: boolean; room?: string; pricing?: PricingSnapshot; message: string; guests?: number; extraGuestFeePhp?: number; status: 'pending' | 'confirmed' | 'declined' | 'cancelled'; createdAt: string; updatedAt: string; manual?: boolean; source?: string; agreement?: BookingAgreement; payment?: BookingPayment; priceAudit?: Array<{at:string;reason:string;previous:PricingSnapshot;adjusted:PricingSnapshot}>; archivedAt?:string };

/** Owner-only calendar. Credentials stay in this function's memory. */
export async function renderManage(container: HTMLElement): Promise<void> {
  const route = () => location.pathname.replace(/\/+$/, '');
  const activePage = () => workspacePages[route() as keyof typeof workspacePages];
  let notifications = new Map<string, NotificationJob>();
  const confirmations = new Map<string, NotificationJob>();
  const communications = new Map<string, Communication[]>();
  const robots = document.createElement('meta');
  robots.name = 'robots';
  robots.content = 'noindex, nofollow';
  document.head.append(robots);
  document.title = 'Manage KASAG availability — Mooncrab Siargao';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const firstMonth = Number(part('year')) * 12 + Number(part('month')) - 1;
  const lastMonth = firstMonth + 23;
  let shownMonth = firstMonth;
  let token = '';
  let authenticated = false;
  let authState: 'checking' | 'authenticated' | 'unauthenticated' = 'checking';
  let sessionCheck = 0;
  let mountedUrl = location.href;
  let busy = false;
  let initialized = false;
  let initializeApproved = false;
  let requestsBusy = false;
  let requestsLoadingAt = -1;
  let requestsLoaded = false;
  let bookingRequests: BookingRequest[] = [];
  let requestOffset=0, requestTotal=0, requestSize=25;
  let pendingCount=0, upcomingCount=0;
  let pendingRanges:string[][]=[];
  let savedDates = new Set<string>();
  let confirmedDates = new Set<string>();
  let importedDates = new Set<string>();
  let dateDetails:Record<string,DateDetail> = {};
  let dateSources:Record<string,Exclude<DateSource,''>[]> = {};
  let selectedDate:string | null = null;
  const pendingDetails = new Map<string,DateDetail | null>();
  const additions = new Set<string>();
  const removals = new Set<string>();
  const sourceLabels:Record<Exclude<DateSource,''>,string> = {airbnb:'Airbnb',booking:'Booking.com',direct:'Direct booking'};
  const detectedSources = (key:string) => dateSources[key] ?? (confirmedDates.has(key)?['direct' as const]:[]);
  const defaultDetail = (key:string):DateDetail => ({source:detectedSources(key).length===1?detectedSources(key)[0]:'',notes:''});
  const savedDetail = (key:string):DateDetail => dateDetails[key] ?? defaultDetail(key);
  const currentDetail = (key:string):DateDetail => pendingDetails.has(key)?pendingDetails.get(key)??defaultDetail(key):savedDetail(key);
  const changeCount = () => new Set([...additions,...removals,...pendingDetails.keys()]).size;

  const describe = (key: string) => new Intl.DateTimeFormat('en', {
    timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date(`${key}T12:00:00Z`));
  const monthName = () => new Intl.DateTimeFormat('en', {
    timeZone: 'UTC', month: 'long', year: 'numeric',
  }).format(new Date(Date.UTC(Math.floor(shownMonth / 12), shownMonth % 12, 1)));
  const isBlocked = (key: string) => confirmedDates.has(key) || importedDates.has(key) || additions.has(key) || (savedDates.has(key) && !removals.has(key));

  container.innerHTML = `
    <section class="owner-panel${activePage() ? ' workspace-wide' : ''}" aria-labelledby="owner-title">
      <a class="owner-back" href="https://mooncrabsiargao.com/">← Back to Mooncrab</a>
      <div class="owner-heading"><p class="owner-eyebrow">MOONCRAB SIARGAO · OWNER ACCESS</p>
        <h1 id="owner-title">A little planning.<br><em>More island days.</em></h1>
        <p>Manage KASAG’s calendar. Block every existing reservation before sharing live availability with guests.</p>
      </div>
      <nav class="workspace-nav" id="workspace-nav" aria-label="Owner navigation" hidden>
        <a href="/admin">Dashboard</a>
        <a href="/admin#owner-requests-area">Bookings</a>
        <a href="/admin#owner-settings-area">Settings</a>
        ${Object.entries(workspacePages).map(([path, page]) => `<a href="${path}">${path === '/admin/reviews' ? reviewLabelMarkup('admin') : page.label}</a>`).join('')}
        <button id="workspace-sign-out" type="button">Sign out</button>
      </nav>
      <div id="owner-session-status" class="owner-card workspace-panel" role="status">
        <span id="owner-session-message">Checking your session…</span>
        <button type="button" id="owner-session-retry" hidden>Try again</button>
      </div>
      <div id="workspace-page" class="owner-card workspace-panel" hidden></div>
      <div class="owner-card" id="owner-auth-card" hidden>
        <form id="owner-login" class="owner-login owner-unlock">
          <h2>Administrator sign-in</h2><p class="owner-hint">Use your administrator account. Sessions expire after eight hours.</p>
          <label for="owner-username">Username</label><input id="owner-username" name="username" autocomplete="username" required value="admin">
          <label for="owner-password">Password</label><input id="owner-password" name="password" type="password" autocomplete="current-password" required maxlength="128">
          <button class="owner-primary" type="submit">Sign in</button>
        </form>
        <details id="owner-recovery"><summary>Use a private recovery key</summary><form id="owner-unlock" class="owner-unlock">
          <label for="owner-token">Calendar access key</label>
          <p class="owner-hint" id="owner-token-help">Use your private owner key. Access lasts only while this page is open.</p>
          <div class="owner-unlock-row"><input id="owner-token" type="password" autocomplete="off" spellcheck="false" required aria-describedby="owner-token-help" placeholder="Enter your owner key" />
            <button class="owner-primary" type="submit">Unlock calendar</button></div>
        </form></details>
        <section id="owner-password-area" hidden><h2 id="owner-password-title">Change your password</h2><p class="owner-hint">Choose a new password of at least 12 characters. Your first sign-in requires this step before calendar access.</p><form id="owner-password-form" class="owner-login"><label for="owner-current-password">Current password</label><input id="owner-current-password" type="password" autocomplete="current-password" required maxlength="128"><label for="owner-new-password">New password</label><input id="owner-new-password" type="password" autocomplete="new-password" required minlength="12" maxlength="128"><button class="owner-primary" type="submit">Save new password</button><p id="owner-password-status" class="owner-status" role="status"></p></form></section>
        <div id="owner-calendar-area" hidden>
          <div class="owner-access"><span><span class="owner-access-dot"></span> Owner calendar · KASAG</span><button id="owner-lock" type="button">Lock calendar</button></div>
          <p class="owner-instructions" id="owner-calendar-help">Select a date to edit its booking source, private notes, and availability. Save changes when you’re done. Dates use Philippine time.</p>
          <div id="owner-overview" class="owner-overview" aria-label="Booking overview"></div>
          <div class="owner-range"><label>From<input id="owner-range-start" type="date" min="${today}"></label><label>Through<input id="owner-range-end" type="date" min="${today}"></label><button id="owner-range-block" type="button">Block range</button><button id="owner-range-open" type="button">Reopen range</button></div>
          <div class="owner-month-navigation"><button id="owner-prev" type="button" aria-label="Previous month">←</button><h2 id="owner-month"></h2><button id="owner-next" type="button" aria-label="Next month">→</button></div>
          <div class="owner-weekdays" aria-hidden="true"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div>
          <div id="owner-days" class="owner-days" role="group" aria-labelledby="owner-month" aria-describedby="owner-calendar-help"></div>
          <section id="owner-date-editor" class="owner-date-editor" aria-labelledby="owner-date-title" hidden>
            <div class="owner-date-heading"><div><p class="owner-eyebrow">SELECTED DATE</p><h3 id="owner-date-title"></h3></div><button id="owner-date-close" type="button" aria-label="Close date editor">×</button></div>
            <p id="owner-date-state" class="owner-date-state"></p>
            <div class="owner-date-fields"><label for="owner-date-source">Booking source<select id="owner-date-source"><option value="">Not specified</option><option value="airbnb">Airbnb</option><option value="booking">Booking.com</option><option value="direct">Direct booking</option></select></label><label for="owner-date-notes">Private notes<textarea id="owner-date-notes" rows="4" maxlength="2000" placeholder="Arrival plans, guest requests, reminders…" aria-describedby="owner-date-privacy"></textarea></label></div>
            <p id="owner-date-privacy" class="owner-hint">Source labels and notes are visible only in the owner dashboard. They do not change guest availability.</p>
            <label class="owner-date-block"><input id="owner-date-blocked" type="checkbox"><span>Unavailable for guests</span></label><p id="owner-date-protection" class="owner-hint"></p>
            <p class="owner-date-save-hint">Use <strong>Save changes</strong> below to save this date and any other pending edits.</p>
          </section>
          <div class="owner-legend"><span><i class="owner-legend-open"></i> Open</span><span><i class="owner-legend-blocked"></i> Manual block</span><span><i class="owner-legend-confirmed"></i> Confirmed</span><span><i class="owner-legend-imported"></i> Imported</span><span><i class="owner-legend-pending"></i> Pending inquiry</span><span><i class="owner-legend-edited"></i> Unsaved change</span></div>
          <label class="owner-initialize" id="owner-initialize-area"><input id="owner-initialize" type="checkbox" /><span>I have checked all existing reservations and blocked their dates. Publish this calendar for guests.</span></label>
          <div class="owner-save-row"><p id="owner-change-count">No unsaved changes</p><div><button type="button" id="owner-discard">Discard changes</button><button class="owner-primary" type="button" id="owner-save">Save changes</button></div></div>
          <p class="owner-footnote">Imported and confirmed stays control their own availability. You can add private notes to any displayed date. Calendar edits do not cancel a guest reservation or update other booking channels.</p>
        </div>
        <p class="owner-status" id="owner-status" role="status" aria-live="polite"></p>
      </div>
      <section class="owner-card owner-requests" id="owner-requests-area" hidden aria-labelledby="owner-requests-title">
        <div class="owner-requests-heading"><h2 id="owner-requests-title">Stay requests</h2><button id="owner-refresh-requests" type="button">Refresh requests</button></div>
        <p class="owner-instructions">Pending requests leave dates open. Agree the accommodation total and record any payment you’ve verified. Confirming blocks the dates and queues an official email for website reservations.</p>
        <details class="owner-manual-booking"><summary>Add manual reservation</summary><form id="owner-manual-booking">${manualBookingFields}</form></details>
        <form id="owner-request-filters" class="workspace-form owner-booking-review"><label>View<select name="view"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All Requests</option></select></label><label>Search stay requests<input name="search" type="search" placeholder="Name, reference, email, phone or room"></label>
        <label>Booking status<select name="status"><option value="">All statuses</option><option>pending</option><option>confirmed</option><option>declined</option><option>cancelled</option></select></label><label>Reservation channel<input name="source" placeholder="Exact source, e.g. Website"></label>
        <label>Stay from<input name="start" type="date"></label><label>Stay through<input name="end" type="date"></label><label>Archived on<input name="archived" type="date"></label><label>Requests per page<select name="size"><option>10</option><option selected>25</option><option>50</option></select></label><button type="submit">Apply filters</button></form>
        <div class="workspace-actions"><button type="button" id="owner-archive-selected" disabled>Archive selected</button><button type="button" id="owner-restore-selected" disabled>Restore selected</button></div>
        <p id="owner-requests-status" class="owner-status" role="status" aria-live="polite"></p>
        <div id="owner-requests-list"></div>
        <div class="workspace-actions"><button type="button" id="owner-requests-prev" disabled>Previous</button><span id="owner-requests-page"></span><button type="button" id="owner-requests-next" disabled>Next</button></div>
      </section>
      <section id="owner-settings-area" class="owner-card owner-settings" hidden><h2>Rates & business settings</h2><p class="owner-hint">KASAG is the only room. Rate changes apply to new quotes; existing requests retain their original estimate.</p><form id="owner-settings-form"><div class="owner-settings-grid"><label>Nightly rate · PHP<input name="nightlyPhp" type="number" min="1" step="1" required></label><label>Weekly package · PHP<input name="weeklyPhp" type="number" min="1" step="1" required></label><label>30-night package · PHP<input name="monthlyPhp" type="number" min="1" step="1" required></label><label>Minimum nights<input name="minimumNights" type="number" min="2" max="90" step="1" required></label><label>Maximum nights<input name="maxNights" type="number" min="2" max="90" step="1" required></label></div><div class="owner-check-options"><label><input name="weeklyEnabled" type="checkbox"> Enable 7-night packages</label><label><input name="monthlyEnabled" type="checkbox"> Enable 30-night packages</label></div><div class="owner-settings-grid"><label>Business phone<input name="phone" type="tel" required></label><label>WhatsApp link<input name="whatsappUrl" type="url" required></label><label>Facebook URL<input name="facebookUrl" type="url" required></label><label>Instagram URL<input name="instagramUrl" type="url" required></label><label>Business email<input name="email" type="email" required></label><label>Booking sender alias<input name="bookingEmail" type="email" required></label></div><label class="owner-manual-notes">Additional booking sources <small>One per line</small><textarea name="bookingSources" rows="3" maxlength="1220"></textarea></label><p class="owner-hint">Changing an email address here does not authorize its sending alias in Spacemail. Provider configuration is still required.</p><button class="owner-primary" type="submit">Save rates & settings</button><p id="owner-settings-status" class="owner-status" role="status"></p></form><button id="owner-show-password" type="button" class="owner-text-button">Change administrator password</button></section>
      <section id="owner-integrations-area" class="owner-card owner-settings" hidden><h2>Calendar & email connections</h2><p class="owner-hint">External calendars update periodically and may be delayed. Feed URLs and email credentials stay on the server.</p><div class="owner-integration-actions"><button id="owner-sync-calendars" type="button">Refresh external calendars</button><button id="owner-drain-email" type="button">Process queued emails</button><button id="owner-refresh-integrations" type="button">Refresh connection status</button></div><p id="owner-integrations-status" class="owner-status" role="status"></p><div id="owner-calendar-connections"></div><div id="owner-email-connections"></div></section>
    </section>`;

  const query = <T extends HTMLElement>(selector: string) => container.querySelector<T>(selector)!;
  const form = query<HTMLFormElement>('#owner-unlock');
  const tokenInput = query<HTMLInputElement>('#owner-token');
  const calendarArea = query<HTMLElement>('#owner-calendar-area');
  const status = query<HTMLElement>('#owner-status');
  const days = query<HTMLElement>('#owner-days');
  const save = query<HTMLButtonElement>('#owner-save');
  const discard = query<HTMLButtonElement>('#owner-discard');
  const prev = query<HTMLButtonElement>('#owner-prev');
  const next = query<HTMLButtonElement>('#owner-next');
  const lock = query<HTMLButtonElement>('#owner-lock');
  const initialize = query<HTMLInputElement>('#owner-initialize');
  const requestsArea = query<HTMLElement>('#owner-requests-area');
  const requestsList = query<HTMLElement>('#owner-requests-list');
  const requestsStatus = query<HTMLElement>('#owner-requests-status');
  const refreshRequests = query<HTMLButtonElement>('#owner-refresh-requests');
  const loginForm = query<HTMLFormElement>('#owner-login');
  const recovery = query<HTMLDetailsElement>('#owner-recovery');
  const passwordArea = query<HTMLElement>('#owner-password-area');
  const passwordForm = query<HTMLFormElement>('#owner-password-form');
  const settingsArea = query<HTMLElement>('#owner-settings-area');
  const settingsForm = query<HTMLFormElement>('#owner-settings-form');
  const manualForm = query<HTMLFormElement>('#owner-manual-booking');
  const requestFilters=query<HTMLFormElement>('#owner-request-filters');
  const requestPrev=query<HTMLButtonElement>('#owner-requests-prev'),requestNext=query<HTMLButtonElement>('#owner-requests-next');
  const bulkArchive=query<HTMLButtonElement>('#owner-archive-selected'),bulkRestore=query<HTMLButtonElement>('#owner-restore-selected');
  const selectedArchives=new Set<string>();
  let followRequestLink=true;
  const sourceSettings = settingsForm.elements.namedItem('bookingSources') as HTMLTextAreaElement;
  const setManualSources = bindManualBooking(manualForm, saveManual, message => { requestsStatus.textContent = message; });
  const integrationsArea = query<HTMLElement>('#owner-integrations-area');
  const passwordLogout = document.createElement('button');
  passwordLogout.type = 'button'; passwordLogout.className = 'owner-text-button'; passwordLogout.textContent = 'Sign out';
  passwordArea.append(passwordLogout);
  passwordLogout.addEventListener('click', () => { void signOut(); });
  const nav = query<HTMLElement>('#workspace-nav');
  const workspace = query<HTMLElement>('#workspace-page');
  const authCard = query<HTMLElement>('#owner-auth-card');
  const sessionStatus = query<HTMLElement>('#owner-session-status');
  const sessionMessage = query<HTMLElement>('#owner-session-message');
  const sessionRetry = query<HTMLButtonElement>('#owner-session-retry');
  const ownerPanel = query<HTMLElement>('.owner-panel');
  sessionRetry.onclick = () => { void checkSession(); };
  query<HTMLButtonElement>('#workspace-sign-out').onclick = () => { void signOut(); };
  const authHeaders = (): Record<string, string> => token ? { Authorization: `Bearer ${token}` } : {};

  function setCalendar(result: CalendarResponse): void {
    savedDates = new Set(result.manualDates ?? result.blockedDates);
    confirmedDates = new Set(result.confirmedDates ?? []);
    importedDates = new Set(result.importedDates ?? []);
    dateDetails = result.dateDetails ?? {};
    dateSources = result.dateSources ?? {};
    initialized = result.initialized;
  }

  document.addEventListener('mooncrab-language-change', () => translateReviewLabels(nav));

  async function adminFetch(path: string, method = 'GET', body?: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: { ...authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    const result = await response.json() as Record<string, unknown>;
    if (response.status === 401 && authenticated) expireSession();
    if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'The request could not be completed.');
    return result;
  }

  function setAuthState(state: typeof authState): void {
    authState = state;
    authenticated = state === 'authenticated';
    sessionStatus.hidden = state !== 'checking';
    if (state === 'checking') {
      sessionMessage.textContent = 'Checking your session…';
      sessionRetry.hidden = true;
    }
    authCard.hidden = state !== 'unauthenticated';
  }

  function hideOwnerContent(): void {
    workspace.hidden = true;
    workspace.replaceChildren();
    for (const panel of [calendarArea, requestsArea, settingsArea, integrationsArea]) panel.hidden = true;
  }

  function scrollToSection(): void {
    const id = location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }

  async function openCalendar(verified?: CalendarResponse): Promise<void> {
    const page = activePage();
    const check = sessionCheck;
    const recoveryCalendar = verified ?? (token ? await request('GET') : undefined);
    if (check !== sessionCheck) return;
    setAuthState('authenticated');
    tokenInput.value = '';
    loginForm.hidden = true;
    recovery.hidden = true;
    passwordArea.hidden = true;
    nav.hidden = false;
    mountedUrl = location.href;
    ownerPanel.classList.toggle('workspace-wide', !!page);
    const activeLink = location.hash === '#owner-requests-area' || location.hash === '#owner-settings-area'
      ? '/admin' + location.hash : page ? route() : '/admin';
    nav.querySelectorAll<HTMLAnchorElement>('a').forEach(link => {
      if (link.getAttribute('href') === activeLink) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    if (page) {
      workspace.hidden = false;
      const mount = document.createElement('div');
      mount.textContent = 'Loading workspace…';
      workspace.replaceChildren(mount);
      try {
        const render = await page.load();
        if (authenticated && mount.isConnected) await render(mount, adminFetch);
      } catch (error) { showError(mount, error); }
      scrollToSection();
      return;
    }
    authCard.hidden = false;
    calendarArea.hidden = true;
    requestsArea.hidden = false;
    settingsArea.hidden = false;
    integrationsArea.hidden = false;
    say('Loading availability…');
    try {
      const result = recoveryCalendar ?? await request('GET');
      if (check !== sessionCheck || !authenticated) return;
      setCalendar(result);
      calendarArea.hidden = false;
      draw();
      say('Calendar loaded. Review reservations and save any manual date changes.');
    } catch (error) {
      if (check !== sessionCheck || !authenticated) return;
      calendarArea.hidden = true;
      say(error instanceof Error ? error.message : 'Availability could not be loaded.', true);
    }
    void loadRequests();
    void loadSettings();
    void loadIntegrations();
    scrollToSection();
  }

  async function checkSession(): Promise<void> {
    const check = ++sessionCheck;
    const hadSession = authenticated;
    hideOwnerContent();
    setAuthState('checking');
    try {
      const session = token ? await request('GET') : await adminFetch('/api/admin/session');
      if (check !== sessionCheck) return;
      if (token) { await openCalendar(session as CalendarResponse); return; }
      const cookieSession = session as { authenticated?: boolean; mustChangePassword?: boolean };
      if (!cookieSession.authenticated) {
        lockCalendar(hadSession ? 'Your session expired. Sign in again.' : '');
        return;
      }
      if (cookieSession.mustChangePassword) {
        setAuthState('unauthenticated');
        nav.hidden = true;
        loginForm.hidden = true;
        recovery.hidden = true;
        passwordArea.hidden = false;
        say('Replace the temporary password to continue.');
        return;
      }
      await openCalendar();
    } catch {
      if (check !== sessionCheck) return;
      nav.hidden = true;
      sessionMessage.textContent = 'Your session could not be checked. Try again.';
      sessionRetry.hidden = false;
    }
  }

  function canLeavePage(): boolean {
    if (busy || requestsBusy) return false;
    if (changeCount() && !confirm('Discard your unsaved calendar changes?')) return false;
    if (workspace.firstElementChild?.dispatchEvent(new Event('owner-before-navigate', { cancelable: true })) === false) return false;
    additions.clear();
    removals.clear();
    pendingDetails.clear();
    return true;
  }

  nav.addEventListener('click', event => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (link.href === location.href) { scrollToSection(); return; }
    if (!canLeavePage()) return;
    history.pushState(null, '', link.href);
    void checkSession();
  });

  window.addEventListener('popstate', () => {
    if (location.href === mountedUrl) return;
    if (!canLeavePage()) {
      history.pushState(null, '', mountedUrl);
      return;
    }
    void checkSession();
  });

  async function loadSettings(): Promise<void> {
    try {
      const settings = await adminFetch('/api/admin/settings');
      const pricing = settings.pricing as Record<string, unknown>;
      const contacts = settings.contacts as Record<string, unknown>;
      const sources = Array.isArray(settings.bookingSources) ? settings.bookingSources as string[] : [];
      sourceSettings.value = sources.join('\n');
      setManualSources(sources);
      for (const [key, value] of Object.entries({ ...pricing, ...contacts })) {
        const input = settingsForm.elements.namedItem(key);
        if (input instanceof HTMLInputElement) { if (input.type === 'checkbox') input.checked = value === true; else input.value = String(value); }
      }
      query<HTMLElement>('#owner-settings-status').textContent = '';
    } catch (error) { query<HTMLElement>('#owner-settings-status').textContent = error instanceof Error ? error.message : 'Settings could not be loaded.'; }
  }

  function connectionDetails(target: HTMLElement, result: Record<string, unknown>, label: string): void {
    target.replaceChildren();
    const title = document.createElement('h3'); title.textContent = label; target.append(title);
    if (label === 'External calendars') {
      const sources = Array.isArray(result.sources) ? result.sources as Record<string, unknown>[] : [];
      for (const source of sources) {
        const item = document.createElement('div'); item.className = 'owner-connection-item';
        const heading = document.createElement('strong'); heading.textContent = source.source === 'airbnb' ? 'Airbnb' : 'Booking.com';
        const state = document.createElement('p');
        state.textContent = !source.configured ? 'Not connected. Add the private export feed in server configuration.' : source.error ? 'The last refresh failed. Previously imported nights remain blocked.' : source.lastSuccess ? `Last successful refresh: ${new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(String(source.lastSuccess)))} · ${Number(source.eventCount) || 0} events${source.stale ? ' · Refresh needed' : ''}` : 'Connected. Awaiting the first successful import.';
        item.append(heading, state); target.append(item);
      }
      if (!sources.length) { const note = document.createElement('p'); note.textContent = 'No calendar connections are configured.'; target.append(note); }
      return;
    }
    const config = result.config as { configured?: boolean; blockedReasons?: string[] } | undefined;
    const note = document.createElement('p'); note.className = 'owner-connection-item';
    note.textContent = config?.configured ? 'Email sender configured. Acceptance by the mail server is recorded separately from delivery.' : `Email sending is waiting for configuration. ${config?.blockedReasons?.join(' ') || ''}`;
    target.append(note);
    const counts = result.counts as Record<string, number> | undefined;
    if (counts) { const summary = document.createElement('p'); summary.className = 'owner-hint'; summary.textContent = `Recent retained messages: ${counts.queued || 0} queued · ${counts.sending || 0} sending · ${counts.accepted || 0} accepted by server · ${counts.failed || 0} failed · ${counts.unknown || 0} need manual reconciliation.`; target.append(summary); }
    const jobs = Array.isArray(result.jobs) ? result.jobs as Record<string, unknown>[] : [];
    for (const job of jobs) {
      if (job.status !== 'failed' && job.status !== 'unknown') continue;
      const item = document.createElement('div'); item.className = 'owner-connection-item';
      const heading = document.createElement('strong'); heading.textContent = `${job.kind === 'guest' ? 'Guest acknowledgment' : 'Owner notification'} · ${String(job.status)}`;
      const detail = document.createElement('p'); detail.textContent = `Request ${String(job.bookingId)} · ${Number(job.attempts) || 0} attempts${job.status === 'unknown' ? ' · Check the mailbox/provider before any resend to avoid duplicates.' : ''}`;
      item.append(heading, detail);
      if (job.safeToRetry === true && typeof job.id === 'string') {
        const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Retry failed email';
        retry.addEventListener('click', async () => { retry.disabled = true; try { await adminFetch('/api/admin/email-outbox', 'POST', { action: 'retry', id: job.id }); await loadIntegrations(); } catch (error) { query<HTMLElement>('#owner-integrations-status').textContent = error instanceof Error ? error.message : 'The email could not be retried.'; retry.disabled = false; } }); item.append(retry);
      }
      target.append(item);
    }
  }

  async function loadIntegrations(): Promise<void> {
    const results = await Promise.allSettled([adminFetch('/api/admin/calendar-sync'), adminFetch('/api/admin/email-outbox')]);
    if (!authenticated) return;
    if (results[1].status === 'fulfilled' && Array.isArray(results[1].value.jobs)) {
      const jobs = results[1].value.jobs as NotificationJob[];
      for (const job of jobs) if (job.kind === 'owner') notifications.set(job.bookingId, job);
      for (const card of requestsList.querySelectorAll<HTMLElement>('.owner-request')) {
        const id = card.dataset.request;
        if (id) drawNotification(card, id);
      }
    }
    const targets = [query<HTMLElement>('#owner-calendar-connections'), query<HTMLElement>('#owner-email-connections')];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') connectionDetails(targets[index], result.value, index === 0 ? 'External calendars' : 'Transactional emails');
      else targets[index].textContent = result.reason instanceof Error ? result.reason.message : 'Connection status is unavailable.';
    });
  }

  function say(message: string, error = false): void {
    status.textContent = message;
    status.classList.toggle('owner-status-error', error);
  }

  function lockCalendar(message = 'Signed out. Sign in to manage your calendar.'): void {
    ++sessionCheck;
    token = '';
    setAuthState('unauthenticated');
    nav.hidden = true;
    authCard.hidden = false;
    workspace.hidden = true;
    workspace.replaceChildren();
    notifications.clear();
    confirmations.clear();
    communications.clear();
    additions.clear();
    removals.clear();
    savedDates.clear();
    confirmedDates.clear();
    importedDates.clear();
    dateDetails = {};
    dateSources = {};
    pendingDetails.clear();
    selectedDate = null;
    query<HTMLElement>('#owner-date-editor').hidden = true;
    query<HTMLTextAreaElement>('#owner-date-notes').value = '';
    query<HTMLSelectElement>('#owner-date-source').value = '';
    query<HTMLElement>('#owner-date-title').textContent = '';
    query<HTMLElement>('#owner-date-state').textContent = '';
    query<HTMLElement>('#owner-date-protection').textContent = '';
    bookingRequests = [];
    requestsLoaded = false;
    pendingRanges=[];pendingCount=0;upcomingCount=0;requestFilters.reset();requestOffset=0;requestTotal=0;
    manualForm.reset();
    manualForm.closest('details')!.open = false;
    requestsList.replaceChildren();
    requestsArea.hidden = true;
    requestsStatus.textContent = '';
    query<HTMLElement>('#owner-overview').replaceChildren();
    query<HTMLElement>('#owner-calendar-connections').replaceChildren();
    query<HTMLElement>('#owner-email-connections').replaceChildren();
    passwordForm.reset();
    initialized = false;
    initializeApproved = false;
    initialize.checked = false;
    tokenInput.value = '';
    days.replaceChildren();
    form.hidden = false;
    loginForm.hidden = false;
    recovery.hidden = false;
    passwordArea.hidden = true;
    settingsArea.hidden = true;
    integrationsArea.hidden = true;
    calendarArea.hidden = true;
    say(message);
    query<HTMLInputElement>('#owner-password').value = '';
    if (message) query<HTMLInputElement>('#owner-username').focus();
    mountedUrl = location.href;
  }

  function expireSession(): void {
    lockCalendar('Your session expired. Sign in again.');
  }

  async function signOut(): Promise<void> {
    if (!canLeavePage()) return;
    ++sessionCheck;
    hideOwnerContent();
    nav.hidden = true;
    setAuthState('checking');
    sessionMessage.textContent = 'Signing out…';
    try {
      if (!token) await adminFetch('/api/admin/session', 'DELETE');
      lockCalendar();
    } catch {
      lockCalendar();
      say('Calendar hidden. Server sign-out could not be confirmed. Retry when the connection returns; the session expires automatically after eight hours.', true);
    }
  }

  function setBusy(value: boolean): void {
    busy = value;
    form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach((element) => { element.disabled = value; });
    loginForm.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach((element) => { element.disabled = value; });
    lock.disabled = value;
    initialize.disabled = value;
    if (authenticated) draw();
  }

  function requestBookings(method: 'GET' | 'PATCH' | 'POST', body?: unknown) {
    if (method==='GET') {
      const filters=new URLSearchParams(new FormData(requestFilters) as unknown as Record<string,string>);
      const id=location.hash.startsWith('#request-')?location.hash.slice(9):'';
      if (followRequestLink&&id) filters.set('id',id);
      filters.set('offset',String(requestOffset));
      requestSize=Number(filters.get('size')||25);
      return adminFetch('/api/admin/booking-requests?'+filters.toString());
    }
    return adminFetch('/api/admin/booking-requests', method, body);
  }

  function drawNotification(card: HTMLElement, id: string): void {
    card.querySelector('[data-owner-notification]')?.remove();
    const job = notifications.get(id);
    const row = document.createElement('div');
    row.dataset.ownerNotification = '';
    row.className = 'owner-hint';
    const message = document.createElement('p');
    const labels: Record<string, string> = { queued: 'Pending', sending: 'Sending', accepted: 'Accepted by Spacemail', failed: 'Failed', unknown: 'Outcome uncertain' };
    const last = job?.lastAttempt ? new Date(job.lastAttempt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : 'No recorded attempt';
    message.textContent = `Owner notification · ${job ? labels[job.status] || job.status : 'No retained email record'} · ${last}`;
    row.append(message);
    if (job?.lastError) {
      const error = document.createElement('p'); error.textContent = job.lastError; row.append(error);
    }
    if (job?.safeToRetry) {
      const retry = document.createElement('button');
      retry.type = 'button'; retry.textContent = 'Retry owner notification';
      retry.onclick = async () => {
        retry.disabled = true;
        try { await adminFetch('/api/admin/email-outbox', 'POST', {action:'retry', id:job.id}); await loadRequestNotifications(); }
        catch (error) { showError(message, error); retry.disabled = false; }
      };
      row.append(retry);
    }
    card.append(row);
  }

  const emailTime = (value: string) => new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
  const emailStatus: Record<string, string> = { queued: 'Queued for Spacemail', sending: 'Submitting', accepted: 'Accepted by Spacemail', failed: 'Submission failed', unknown: 'Outcome uncertain', suppressed: 'Suppressed' };
  function drawConfirmation(card: HTMLElement, booking: BookingRequest): void {
    card.querySelector('[data-booking-confirmation]')?.remove();
    const related = communications.get(booking.id) ?? [];
    const declined = booking.status === 'declined' && !booking.manual;
    const job = declined ? related.find(entry => entry.kind === 'decline') : confirmations.get(booking.id);
    if (!job && !declined && booking.status !== 'confirmed' && !related.length) return;
    const row = document.createElement('div');
    row.dataset.bookingConfirmation = '';
    row.className = 'owner-booking-mail';
    const status = document.createElement('p');
    const kind = declined ? 'decline' : 'confirmation';
    const label = declined ? 'Decline' : 'Confirmation';
    status.textContent = `${label} email · ${job ? emailStatus[job.status] ?? job.status : 'No retained submission'}`;
    row.append(status);
    const eligible = declined || (booking.status === 'confirmed' && booking.payment && booking.checkOut > today && !externalSource(booking.source) && (!booking.manual || hasRecordedDirectPolicy(booking.agreement?.version)));
    if (eligible && booking.email) {
      const preview = document.createElement('button'); preview.type='button'; preview.textContent='Preview Booking Email';
      preview.onclick = () => { void import('./admin-email.ts').then(({previewBookingEmail})=>previewBookingEmail(adminFetch, declined ? 'decline' : booking.manual ? 'manual' : 'confirmation', booking.id)).catch(error=>showError(status,error)); };
      row.append(preview);
      if (!job || job.status === 'suppressed') {
        const send = document.createElement('button'); send.type='button'; send.textContent=`Send Booking ${declined ? 'Decline Email' : 'Confirmation'}`;
        send.onclick=async()=>{
          if (!window.confirm(`Send this ${kind} to ${booking.email}?`)) return;
          send.disabled=true;
          try { await adminFetch('/api/admin/email-outbox','POST',{action:'send-booking',id:`${booking.id}:${kind}`}); await loadRequestNotifications(); }
          catch(error){showError(status,error);send.disabled=false;}
        };
        row.append(send);
      }
    }
    if (job) {
      const history = document.createElement('p');
      history.textContent = `To ${job.recipient ?? booking.email} · ${job.lastAttempt ? `Last attempt ${emailTime(job.lastAttempt)}` : 'No attempt recorded'}${job.acceptedAt ? ` · Accepted ${emailTime(job.acceptedAt)}` : ''}`;
      row.append(history);
      if (job.lastError) { const error = document.createElement('p'); error.textContent = job.lastError; row.append(error); }
      if (eligible && (job.safeToRetry || job.status === 'accepted' || (job.status === 'queued' && !declined))) {
        const resend = job.status === 'accepted';
        const queued = job.status === 'queued';
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = resend ? `Resend ${label}${declined ? ' Email' : ''}` : queued ? 'Submit Queued Confirmation' : `Retry ${label}`;
        button.onclick = async () => {
          if (!window.confirm(`Submit this ${kind} to ${booking.email}?`)) return;
          button.disabled = true;
          try {
            const result = await adminFetch('/api/admin/email-outbox', 'POST', { action: resend ? 'resend' : queued ? 'submit-confirmation' : 'retry', id: job.id, delivery: job.delivery });
            requestsStatus.textContent = emailStatus[String(result.state)] ?? 'Check the confirmation email status below.';
            await loadRequestNotifications();
          } catch (error) { showError(status, error); button.disabled = false; }
        };
        row.append(button);
      }
    }
    if (related.length) {
      const history = document.createElement('details');
      const heading = document.createElement('summary'); heading.textContent = 'View Communication History'; history.append(heading);
      for (const item of related) {
        const title = document.createElement('p'); title.textContent = `${item.kind} · ${emailStatus[item.status] ?? item.status}`; history.append(title);
        for (const attempt of item.history ?? []) {
          const text = document.createElement('p'); text.textContent = `${emailTime(attempt.at)} · ${emailStatus[attempt.state] ?? attempt.state} · ${attempt.to} · ${attempt.subject}${attempt.details ? ` · ${attempt.details}` : ''}`;
          history.append(text);
        }
      }
      row.append(history);
    }
    card.append(row);
  }

  function drawRequests(): void {
    requestsList.replaceChildren();
    selectedArchives.clear(); updateArchiveButtons();
    requestPrev.disabled=!requestsLoaded||requestOffset===0;requestNext.disabled=!requestsLoaded||requestOffset+requestSize>=requestTotal;
    query('#owner-requests-page').textContent=!requestsLoaded?'':requestTotal?`${requestOffset+1}–${Math.min(requestOffset+requestSize,requestTotal)} of ${requestTotal}`:'No matches';
    drawOverview();
    if (!requestsLoaded) return;
    if (bookingRequests.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'owner-requests-empty';
      empty.textContent = 'No stay requests yet. New requests will appear here.';
      requestsList.append(empty);
      return;
    }
    for (const booking of bookingRequests) {
      const card = document.createElement('article');
      card.className = 'owner-request';
      card.dataset.request = booking.id;
      card.id = 'request-' + booking.id;
      const heading = document.createElement('div');
      heading.className = 'owner-request-heading';
      const name = document.createElement('h3');
      name.textContent = booking.name;
      const badge = document.createElement('span');
      badge.className = `owner-request-status owner-request-${booking.status}`;
      badge.textContent = booking.status;
      heading.append(name, badge);
      const dates = document.createElement('p');
      dates.className = 'owner-request-dates';
      dates.textContent = `${describe(booking.checkIn)} → ${describe(booking.checkOut)}`;
      const occupancy = document.createElement('p');
      occupancy.className = 'owner-request-guests';
      const guests = booking.guests ?? 2;
      const supplement = booking.extraGuestFeePhp ?? 0;
      occupancy.textContent = `${guests} ${guests === 1 ? 'guest' : 'guests'} · ${supplement ? `PHP ${supplement.toLocaleString('en-PH')} extra guest fee (PHP 500/night)` : 'No extra guest fee'}`;
      const email = document.createElement('a');
      email.className = 'owner-request-email';
      email.href = `mailto:${encodeURIComponent(booking.email)}`;
      email.textContent = booking.email;
      email.hidden = !booking.email;
      const message = document.createElement('p');
      message.className = 'owner-request-message';
      message.textContent = booking.message || 'No additional message.';
      const id = document.createElement('p');
      id.className = 'owner-request-id';
      id.textContent = `Reference ${booking.id}`;
      card.append(heading, dates, occupancy, email, message, id);
      const archiveActions=document.createElement('div'); archiveActions.className='workspace-actions';
      const selection=document.createElement('label'); const checked=document.createElement('input'); checked.type='checkbox';
      selection.append(checked,' Select'); checked.onchange=()=>{if(checked.checked)selectedArchives.add(booking.id);else selectedArchives.delete(booking.id);updateArchiveButtons();};
      const archive=document.createElement('button');archive.type='button';archive.textContent=booking.archivedAt?'Restore Request':'Archive Request';
      archive.onclick=()=>{void changeArchives([booking.id],booking.archivedAt?'restore':'archive');};
      archiveActions.append(selection,archive);
      if (booking.archivedAt) {const at=document.createElement('small');at.textContent=`Archived ${emailTime(booking.archivedAt)}`;archiveActions.append(at);}
      card.append(archiveActions);
      const detail = document.createElement('p');
      detail.className = 'owner-request-detail';
      const nights = Math.round((Date.parse(booking.checkOut) - Date.parse(booking.checkIn)) / 86400000);
      const submitted = Number.isFinite(Date.parse(booking.createdAt)) ? new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(booking.createdAt)) : 'time unavailable';
      detail.textContent = `${booking.room || 'KASAG'} · ${nights} nights · Submitted ${submitted}${booking.pricing?.totalPhp !== undefined ? ` · Estimated PHP ${booking.pricing.totalPhp.toLocaleString('en-PH')}` : ''}`;
      card.append(detail);
      if (booking.pricing?.discountPhp) {
        const promo = document.createElement('p'); promo.className='owner-hint';
        promo.textContent=`Original quote ${formatPhp(booking.pricing.originalTotalPhp!)} · ${booking.pricing.coupons?.map(c=>c.code).join(', ')??'Agreed discount'} saves ${formatPhp(booking.pricing.discountPhp)} · New total ${formatPhp(booking.pricing.totalPhp)}.`;
        card.append(promo);
      }
      if (booking.priceAudit?.length) {
        const audit = document.createElement('details'); const label=document.createElement('summary');label.textContent='Quote changes';audit.append(label);
        for (const change of booking.priceAudit) {const line=document.createElement('p');line.textContent=`${emailTime(change.at)} · ${formatPhp(change.previous.totalPhp)} → ${formatPhp(change.adjusted.totalPhp)} · ${change.reason}`;audit.append(line);}
        card.append(audit);
      }
      const policy = document.createElement('p'); policy.className = 'owner-hint';
      policy.textContent = `${booking.source ?? 'Website'} · ${externalSource(booking.source) ? 'Booking platform policy applies.' : booking.agreement && hasRecordedDirectPolicy(booking.agreement.version)
        ? `Policy ${booking.agreement.version}, ${booking.agreement.recordedBy === 'guest' ? 'accepted by guest' : 'recorded by host'} ${emailTime(booking.agreement.acceptedAt)}. ${localizedPolicy('en', booking.agreement.version).slice(0, 2).join(' ')}`
        : booking.agreement ? `Recorded policy version ${booking.agreement.version}.` : 'No acceptance of the current policy is recorded.'}`;
      card.append(policy);
      if (!booking.manual) drawNotification(card, booking.id);
      if (booking.phone) {
        const phone = document.createElement('a'); phone.href = `tel:${booking.phone}`; phone.className = 'owner-request-email'; phone.textContent = `${booking.phone}${booking.whatsapp ? ' · WhatsApp available' : ''}`; card.append(phone);
      }
      if (booking.status === 'pending') {
        if (booking.pricing && !booking.manual) {
          const edit = document.createElement('details'); edit.className='owner-booking-review';
          edit.innerHTML='<summary>Adjust promotional quote</summary><form class="workspace-form"><label>Promo codes (comma separated)<input name="codes" maxlength="75"></label><label>Additional discount (PHP)<input name="discount" type="number" min="0" step="0.01"></label><label class="workspace-full">Reason for the change<input name="reason" maxlength="400" required></label><button type="submit">Save adjusted quote</button></form>';
          const priceForm=edit.querySelector('form')!;
          (priceForm.elements.namedItem('codes') as HTMLInputElement).value=booking.pricing.coupons?.map(c=>c.code).join(', ')??'';
          (priceForm.elements.namedItem('discount') as HTMLInputElement).value=String((booking.pricing.manualDiscountCents??0)/100);
          priceForm.onsubmit=event=>{
            event.preventDefault();
            if (!window.confirm('Save these quote changes? Agree the updated price with the guest before confirming.')) return;
            const data=new FormData(priceForm);
            void actOnRequest(booking.id,'adjust-price',{couponCodes:String(data.get('codes')).split(',').map(value=>value.trim()).filter(Boolean),manualDiscountCents:centsFromInput(String(data.get('discount')||0)),reason:data.get('reason'),expectedUpdatedAt:booking.updatedAt});
          };
          card.append(edit);
        }
        const review = document.createElement('form');
        review.className = 'owner-booking-review';
        review.innerHTML = paymentFields(booking.payment, booking.pricing?.totalPhp);
        const amounts = bindPayment(review, () => booking.source);
        const agreement = document.createElement('label');
        agreement.className = 'owner-request-agreement';
        const agreed = document.createElement('input');
        agreed.type = 'checkbox';
        const agreementLabel = document.createElement('span');
        agreementLabel.textContent = 'I reviewed the agreed total and the payment actually received.';
        agreement.append(agreed, agreementLabel);
        const sendEmail = document.createElement('input');
        sendEmail.type = 'checkbox';
        if (booking.manual && booking.email && !externalSource(booking.source) && booking.agreement && hasRecordedDirectPolicy(booking.agreement.version)) {
          const sendLabel = document.createElement('label'); sendLabel.className = 'owner-request-agreement';
          sendLabel.append(sendEmail, 'Send the guest a confirmation email');
          review.append(sendLabel);
        }
        const actions = document.createElement('div');
        actions.className = 'owner-request-actions';
        const confirm = document.createElement('button');
        confirm.type = 'submit';
        confirm.className = 'owner-primary';
        confirm.textContent = 'Confirm booking';
        confirm.disabled = true;
        const decline = document.createElement('button');
        decline.type = 'button';
        decline.className = 'owner-request-decline';
        decline.textContent = 'Decline request';
        decline.disabled = requestsBusy;
        agreed.disabled = requestsBusy;
        review.addEventListener('input', () => { confirm.disabled = !agreed.checked || requestsBusy || !amounts.read(); });
        review.onsubmit = event => {
          event.preventDefault();
          const payment = amounts.read();
          if (agreed.checked && payment) void actOnRequest(booking.id, 'confirm', { payment, sendEmail: sendEmail.checked });
        };
        decline.addEventListener('click', () => {
          const dialog = document.createElement('dialog');
          dialog.className='owner-card workspace-panel'; dialog.setAttribute('aria-label','Decline booking');
          dialog.innerHTML='<form class="workspace-form"><h3 class="workspace-full">Decline booking</h3><p class="workspace-full" data-stay></p><label class="workspace-full">Guest-facing reason (optional)<textarea name="reason" rows="3" maxlength="600"></textarea></label><div class="workspace-actions workspace-full"><button type="button" data-close>Go back</button><button type="submit" class="owner-primary">Confirm decline</button></div></form>';
          dialog.querySelector('[data-stay]')!.textContent = `${booking.name} · ${describe(booking.checkIn)} to ${describe(booking.checkOut)}. ${booking.manual ? 'Saved without a guest email.' : 'The decline email will be queued for the guest.'}`;
          dialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick=()=>dialog.close();
          const declineForm = dialog.querySelector('form')!;
          declineForm.onsubmit=event=>{
            event.preventDefault(); const reason = new FormData(declineForm).get('reason');
            dialog.close(); void actOnRequest(booking.id,'decline',{reason});
          };
          dialog.addEventListener('close',()=>dialog.remove(),{once:true});
          document.body.append(dialog); dialog.showModal();
        });
        actions.append(confirm, decline);
        review.append(agreement, actions);
        card.append(review);
      } else if (booking.status === 'confirmed') {
        const payments = document.createElement('details');
        payments.className = 'owner-booking-review';
        payments.innerHTML = `<summary>Payment details</summary><form>${paymentFields(booking.payment, booking.pricing?.totalPhp)}<button type="submit">Save payment details</button></form>`;
        const paymentForm = payments.querySelector('form')!;
        const amounts = bindPayment(paymentForm, () => booking.source);
        paymentForm.onsubmit = event => {
          event.preventDefault();
          const payment = amounts.read();
          if (payment) void actOnRequest(booking.id, 'payment', { payment, expectedUpdatedAt: booking.updatedAt });
        };
        card.append(payments);
        const note = document.createElement('p');
        note.className = 'owner-request-cancel-note';
        note.textContent = 'Cancelling reopens only this stay’s nights. Any manually blocked dates remain blocked. Notify the guest directly; this action does not send an email.';
        const agreement = document.createElement('label');
        agreement.className = 'owner-request-agreement';
        const agreed = document.createElement('input');
        agreed.type = 'checkbox';
        agreed.disabled = requestsBusy;
        const agreementLabel = document.createElement('span');
        agreementLabel.textContent = 'Cancellation agreed with the guest and guest notified directly';
        agreement.append(agreed, agreementLabel);
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'owner-request-cancel';
        cancel.textContent = 'Cancel confirmed stay';
        cancel.disabled = true;
        agreed.addEventListener('change', () => { cancel.disabled = !agreed.checked || requestsBusy; });
        cancel.addEventListener('click', () => { if (agreed.checked) void actOnRequest(booking.id, 'cancel'); });
        card.append(note, agreement, cancel);
      }
      drawConfirmation(card, booking);
      requestsList.append(card);
    }
  }

  async function loadRequestNotifications(): Promise<void> {
    const generation = sessionCheck;
    const ids = bookingRequests.map(booking => booking.id).filter(id => /^[0-9a-f-]{36}$/i.test(id));
    if (!ids.length) return;
    const chunks = [];
    for (let index = 0; index < ids.length; index += 50) chunks.push(ids.slice(index, index + 50));
    const results = await Promise.allSettled(chunks.map(chunk => adminFetch('/api/admin/email-outbox?bookings=' + chunk.join(','))));
    if (!authenticated || sessionCheck !== generation) return;
    for (const result of results) {
      if (result.status !== 'fulfilled' || !Array.isArray(result.value.jobs)) continue;
      for (const job of result.value.jobs as NotificationJob[]) {
        if (job.kind === 'owner') notifications.set(job.bookingId, job);
        if (job.kind === 'confirmation') confirmations.set(job.bookingId, job);
      }
      for (const id of new Set((result.value.jobs as Communication[]).map(job=>job.bookingId))) {
        communications.set(id,(result.value.jobs as Communication[]).filter(job=>job.bookingId===id));
      }
    }
    for (const card of requestsList.querySelectorAll<HTMLElement>('.owner-request')) {
      const booking = bookingRequests.find(row => row.id === card.dataset.request);
      if (!booking) continue;
      if (!booking.manual) drawNotification(card, booking.id);
      drawConfirmation(card, booking);
    }
  }

  async function loadRequests(): Promise<void> {
    const generation = sessionCheck;
    if (!authenticated || requestsBusy || requestsLoadingAt === generation) return;
    requestsLoadingAt = generation;
    refreshRequests.disabled = true;
    requestsStatus.textContent = 'Loading stay requests…';
    try {
      const result = await requestBookings('GET');
      if (!authenticated || sessionCheck !== generation) return;
      if (!result || typeof result !== 'object' || !('requests' in result) || !Array.isArray(result.requests)) throw new Error('Stay requests returned an unexpected response. Please try again.');
      const valid = result.requests.every((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return false;
        const row = entry as Record<string, unknown>;
        return ['id', 'checkIn', 'checkOut', 'name', 'email', 'message', 'status'].every((key) => typeof row[key] === 'string') && ['pending', 'confirmed', 'declined', 'cancelled'].includes(String(row.status)) && /^\d{4}-\d{2}-\d{2}$/.test(String(row.checkIn)) && /^\d{4}-\d{2}-\d{2}$/.test(String(row.checkOut))
          && (row.guests === undefined || (typeof row.guests === 'number' && Number.isInteger(row.guests) && row.guests >= 1 && row.guests <= 3))
          && (row.extraGuestFeePhp === undefined || (typeof row.extraGuestFeePhp === 'number' && Number.isSafeInteger(row.extraGuestFeePhp) && row.extraGuestFeePhp >= 0));
      });
      if (!valid) throw new Error('Stay requests returned an unexpected response. Please try again.');
      bookingRequests = result.requests as BookingRequest[];
      requestTotal=typeof result.total==='number'?result.total:bookingRequests.length;
      pendingCount=typeof result.pending==='number'?result.pending:bookingRequests.filter(booking=>booking.status==='pending').length;
      upcomingCount=typeof result.upcoming==='number'?result.upcoming:bookingRequests.filter(booking=>booking.status==='confirmed'&&booking.checkOut>today).length;
      pendingRanges=Array.isArray(result.pendingRanges)?result.pendingRanges as string[][]:bookingRequests.filter(booking=>booking.status==='pending').map(booking=>[booking.checkIn,booking.checkOut]);
      requestsLoaded = true;
      requestsStatus.textContent = `${pendingCount} active pending requests`;
    } catch (error) {
      if (authenticated && sessionCheck === generation) {
        requestsLoaded = false;
        bookingRequests = [];
        pendingRanges = [];
        requestTotal = pendingCount = upcomingCount = 0;
        requestsStatus.textContent = error instanceof Error ? error.message : 'Stay requests could not be loaded. Try again.';
      }
    } finally {
      if (requestsLoadingAt === generation) requestsLoadingAt = -1;
      if (authenticated && sessionCheck === generation) {
        refreshRequests.disabled = false;
        drawRequests();
        draw();
        void loadRequestNotifications();
        const target = location.hash.startsWith('#request-') && document.getElementById(location.hash.slice(1));
        if (target) { target.classList.add('owner-request-target'); target.scrollIntoView({ block: 'nearest' }); }
      }
    }
  }

  function updateArchiveButtons(){
    bulkArchive.disabled=!bookingRequests.some(booking=>selectedArchives.has(booking.id)&&!booking.archivedAt);
    bulkRestore.disabled=!bookingRequests.some(booking=>selectedArchives.has(booking.id)&&booking.archivedAt);
  }
  async function changeArchives(ids:string[],action:'archive'|'restore') {
    if (!ids.length||requestsBusy||!window.confirm(`${action==='archive'?'Archive':'Restore'} ${ids.length===1?'this request':`${ids.length} requests`}? Reservation dates, status, and emails stay as saved.`)) return;
    requestsBusy=true;
    try {await requestBookings('POST',{ids,action});followRequestLink=false;requestOffset=0;}
    catch(error){showError(requestsStatus,error);return;}
    finally{requestsBusy=false;}
    await loadRequests();
  }
  requestFilters.onsubmit=event=>{event.preventDefault();followRequestLink=false;requestOffset=0;void loadRequests();};
  requestPrev.onclick=()=>{requestOffset=Math.max(0,requestOffset-requestSize);void loadRequests();};
  requestNext.onclick=()=>{requestOffset+=requestSize;void loadRequests();};
  bulkArchive.onclick=()=>{void changeArchives(bookingRequests.filter(booking=>selectedArchives.has(booking.id)&&!booking.archivedAt).map(booking=>booking.id),'archive');};
  bulkRestore.onclick=()=>{void changeArchives(bookingRequests.filter(booking=>selectedArchives.has(booking.id)&&booking.archivedAt).map(booking=>booking.id),'restore');};

  async function saveBookingChange(method: 'POST' | 'PATCH', payload: Record<string, unknown>, start: string, finish: (result: Record<string, unknown>) => string): Promise<boolean> {
    if (!authenticated || requestsBusy || busy) return false;
    if (changeCount() > 0) { requestsStatus.textContent = 'Save or discard calendar changes before handling stay requests.'; return false; }
    const generation = sessionCheck;
    requestsBusy = true;
    refreshRequests.disabled = true;
    setBusy(true);
    requestsStatus.textContent = start;
    let saved = false;
    try {
      const result = await requestBookings(method, payload);
      if (!authenticated || sessionCheck !== generation) return false;
      const booking = result.request as BookingRequest | undefined;
      if (!booking?.id) throw new Error('Refresh bookings to verify the saved reservation.');
      const position = bookingRequests.findIndex(row => row.id === booking.id);
      const previous=bookingRequests[position];
      if (previous?.status==='pending'&&!previous.archivedAt) {
        pendingCount--;
        const range=pendingRanges.findIndex(([arrival,departure])=>arrival===previous.checkIn&&departure===previous.checkOut);
        if(range>=0)pendingRanges.splice(range,1);
      }
      if (booking.status==='pending'&&!previous?.archivedAt) {pendingCount++;pendingRanges.push([booking.checkIn,booking.checkOut]);}
      if (previous?.status==='confirmed'&&previous.checkOut>today)upcomingCount--;
      if (booking.status==='confirmed'&&booking.checkOut>today)upcomingCount++;
      if (position < 0) bookingRequests.unshift(booking);
      else bookingRequests[position] = { ...booking, archivedAt:previous.archivedAt };
      requestTotal=Math.max(requestTotal,bookingRequests.length);
      saved = true;
      requestsStatus.textContent = finish(result);
      try {
        const calendar = await request('GET');
        if (sessionCheck === generation) setCalendar(calendar);
      } catch {
        if (sessionCheck === generation) requestsStatus.textContent += ' Refresh the calendar to see the updated dates.';
      }
    } catch (error) {
      if (sessionCheck === generation) requestsStatus.textContent = error instanceof Error ? error.message : 'The action could not be completed. Refresh requests before trying again.';
    } finally {
      requestsBusy = false;
      refreshRequests.disabled = false;
      setBusy(false);
      if (saved && authenticated && sessionCheck === generation) { drawRequests(); void loadRequestNotifications(); }
    }
    return saved;
  }

  function confirmationResult(result: Record<string, unknown>): string {
    return result.confirmationEmail ? ` ${emailStatus[String(result.confirmationEmail)] ?? 'Check email submission status below.'}.` : '';
  }

  function saveManual(payload: Record<string, unknown>): Promise<boolean> {
    return saveBookingChange('POST', payload, 'Saving reservation…', result => `Reservation saved as ${(result.request as BookingRequest).status}.${confirmationResult(result)}`);
  }

  async function actOnRequest(id: string, action: 'confirm' | 'decline' | 'cancel' | 'payment' | 'adjust-price', extra: Record<string, unknown> = {}): Promise<void> {
    await saveBookingChange('PATCH', { id, action, ...extra }, 'Updating reservation…', result => {
      if (action === 'confirm') return `Stay confirmed and dates blocked.${confirmationResult(result)}`;
      if (action === 'cancel') return 'Stay cancelled. Any dates still blocked by a calendar or manual block remain unavailable.';
      if (action === 'adjust-price') return 'Adjusted quote saved. Review the new total with the guest before confirming.';
      return action === 'payment' ? 'Payment details saved.' : `Request declined.${result.declineEmail ? ` ${emailStatus[String(result.declineEmail)] ?? 'Check email status in the booking.'}.` : ''}`;
    });
  }

  async function request(method: 'GET' | 'PATCH', body?: unknown): Promise<CalendarResponse> {
    const response = await fetch('/api/admin/availability', {
      method, cache: 'no-store',
      credentials: 'same-origin',
      headers: { ...authHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      if (response.status === 401 && authenticated) expireSession();
      if (response.status === 401 || response.status === 403) throw new Error('The owner key was not accepted. Check your key and try again.');
      if (response.status === 503) throw new Error('The calendar is not connected yet. Complete the calendar setup before managing dates.');
      if (response.status === 400) { const error=await response.json().catch(()=>null); throw new Error(typeof error?.error==='string'?error.error:'The selected dates or private notes could not be saved. Review your changes and try again.'); }
      throw new Error('The calendar could not be reached. Your changes have not been saved. Please try again.');
    }
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || !('initialized' in result) || typeof result.initialized !== 'boolean' || !('blockedDates' in result) || !Array.isArray(result.blockedDates) || !result.blockedDates.every((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date))) {
      throw new Error('The calendar returned an unexpected response. Your changes remain unsaved.');
    }
    return result as CalendarResponse;
  }

  function draw(): void {
    query<HTMLElement>('#owner-month').textContent = monthName();
    prev.disabled = busy || shownMonth <= firstMonth;
    next.disabled = busy || shownMonth >= lastMonth;
    const year = Math.floor(shownMonth / 12);
    const month = shownMonth % 12;
    const startDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    days.replaceChildren();
    for (let empty = 0; empty < startDay; empty++) {
      const spacer = document.createElement('span');
      spacer.setAttribute('aria-hidden', 'true');
      days.append(spacer);
    }
    for (let day = 1; day <= count; day++) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const blocked = isBlocked(key);
      const confirmed = confirmedDates.has(key);
      const imported = importedDates.has(key);
      const pending = pendingRanges.some(([arrival,departure])=>arrival<=key&&departure>key);
      const edited = additions.has(key) || removals.has(key) || pendingDetails.has(key);
      const detail = currentDetail(key);
      const sources = detail.source ? [detail.source] : detectedSources(key);
      const button = document.createElement('button');
      button.type = 'button';
      const number=document.createElement('span'); number.textContent=String(day); button.append(number);
      if(sources.length) { const label=document.createElement('small'); label.className='owner-day-source'; label.textContent=sources.length>1?'Multiple':sources[0]==='booking'?'Booking':sources[0]==='direct'?'Direct':'Airbnb'; button.append(label); }
      if(detail.notes) { const marker=document.createElement('span'); marker.className='owner-day-note'; marker.setAttribute('aria-hidden','true'); marker.textContent='✎'; button.append(marker); }
      button.dataset.date = key;
      button.className = `owner-day${blocked ? ' owner-day-blocked' : ''}${confirmed ? ' owner-day-confirmed' : ''}${imported ? ' owner-day-imported' : ''}${pending ? ' owner-day-pending' : ''}${edited ? ' owner-day-edited' : ''}${selectedDate===key?' owner-day-selected':''}${key<today?' owner-day-past':''}`;
      button.disabled = busy;
      button.setAttribute('aria-pressed', String(selectedDate===key));
      button.setAttribute('aria-controls','owner-date-editor');
      button.setAttribute('aria-label', `${describe(key)}, ${confirmed ? 'confirmed booking' : imported ? 'imported booking' : blocked ? 'blocked' : 'open'}${sources.length?`, ${sources.map(source=>sourceLabels[source]).join(' and ')}`:''}${detail.notes?', has private note':''}${pending ? ', pending inquiry' : ''}${edited ? ', unsaved change' : ''}${key < today ? ', past date' : ''}`);
      if (key === today) button.setAttribute('aria-current', 'date');
      button.addEventListener('click', () => {
        if (busy) return;
        selectedDate=key;
        draw();
        query<HTMLElement>('#owner-date-title').setAttribute('tabindex','-1');
        query<HTMLElement>('#owner-date-title').focus({preventScroll:true});
        query<HTMLElement>('#owner-date-editor').scrollIntoView({behavior:'smooth',block:'nearest'});
      });
      days.append(button);
    }
    const changes = changeCount();
    query<HTMLElement>('#owner-initialize-area').hidden = initialized;
    query<HTMLElement>('#owner-change-count').textContent = changes ? `${changes} unsaved ${changes === 1 ? 'change' : 'changes'}` : 'No unsaved changes';
    save.disabled = busy || (changes === 0 && (initialized || !initializeApproved));
    save.textContent = busy ? 'Saving…' : !initialized && initializeApproved ? 'Save & publish calendar' : 'Save changes';
    discard.disabled = busy || changes === 0;
    drawDateEditor();
    drawOverview();
  }

  function drawDateEditor():void {
    const editor=query<HTMLElement>('#owner-date-editor');
    editor.hidden=!selectedDate;
    if(!selectedDate)return;
    const detail=currentDetail(selectedDate);
    query<HTMLElement>('#owner-date-title').textContent=describe(selectedDate);
    const source=query<HTMLSelectElement>('#owner-date-source');
    const notes=query<HTMLTextAreaElement>('#owner-date-notes');
    source.value=detail.source;
    if(notes.value!==detail.notes)notes.value=detail.notes;
    source.disabled=busy; notes.disabled=busy;
    const detected=detectedSources(selectedDate);
    const protectedDate=confirmedDates.has(selectedDate)||importedDates.has(selectedDate)||selectedDate<today;
    const blocked=query<HTMLInputElement>('#owner-date-blocked');
    blocked.checked=isBlocked(selectedDate); blocked.disabled=busy||protectedDate;
    query<HTMLElement>('#owner-date-state').textContent=`${isBlocked(selectedDate)?'Unavailable':'Available'}${confirmedDates.has(selectedDate)?' · Confirmed stay':importedDates.has(selectedDate)?' · Imported calendar':''}${detected.length?` · ${detected.map(source=>sourceLabels[source]).join(' + ')}`:''}`;
    query<HTMLElement>('#owner-date-protection').textContent=importedDates.has(selectedDate)?'Availability is managed by the connected calendar. Your private labels and notes stay editable.':confirmedDates.has(selectedDate)?'A confirmed stay protects this night. Manage that reservation in Stay requests; private notes stay editable.':selectedDate<today?'Past availability cannot be changed. You can still keep private notes for this date.':'Check to block this night, or uncheck to reopen it. Guest availability changes after you save.';
    query<HTMLButtonElement>('#owner-date-close').disabled=busy;
  }

  function stageDateDetails():void {
    if(!selectedDate||busy)return;
    const source=query<HTMLSelectElement>('#owner-date-source').value as DateSource;
    const notes=query<HTMLTextAreaElement>('#owner-date-notes').value;
    const original=savedDetail(selectedDate);
    if(source===original.source&&notes===original.notes)pendingDetails.delete(selectedDate);
    else pendingDetails.set(selectedDate,!source&&!notes?null:{source,notes});
    draw();
    say('Date details changed. Save changes to keep your private labels and notes.');
  }

  function drawOverview(): void {
    const overview = query<HTMLElement>('#owner-overview');
    overview.replaceChildren();
    const values = [
      [requestsLoaded ? pendingCount : '—', 'Pending requests'],
      [requestsLoaded ? upcomingCount : '—', 'Upcoming stays'],
      [[...savedDates].filter(date => date >= today).length, 'Manual blocked nights'],
      [[...importedDates].filter(date => date >= today).length, 'Imported nights'],
    ];
    for (const [value, label] of values) { const card = document.createElement('div'); const number = document.createElement('strong'); number.textContent = String(value); const text = document.createElement('span'); text.textContent = String(label); card.append(number, text); overview.append(card); }
  }

  function applyRange(block: boolean): void {
    const from = query<HTMLInputElement>('#owner-range-start').value;
    const through = query<HTMLInputElement>('#owner-range-end').value;
    const end = new Date(Date.UTC(Math.floor(lastMonth / 12), lastMonth % 12 + 1, 0)).toISOString().slice(0, 10);
    if (!from || !through || from < today || through < from || through > end) { say('Choose a valid date range within the next 24 months.', true); return; }
    const length = Math.round((Date.parse(through) - Date.parse(from)) / 86400000) + 1;
    if (length > 366) { say('Choose no more than 366 nights at a time.', true); return; }
    for (let time = Date.parse(from); time <= Date.parse(through); time += 86400000) {
      const date = new Date(time).toISOString().slice(0, 10);
      if (confirmedDates.has(date) || importedDates.has(date)) continue;
      if (block) { removals.delete(date); if (!savedDates.has(date)) additions.add(date); }
      else { additions.delete(date); if (savedDates.has(date)) removals.add(date); }
    }
    say('Range selected. Review and save changes. Confirmed and imported stays are protected.');
    draw();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const supplied = tokenInput.value.trim();
    if (!supplied) { tokenInput.focus(); return; }
    token = supplied;
    setBusy(true);
    say('Opening the calendar…');
    try {
      await openCalendar();
      query<HTMLElement>('#owner-month').setAttribute('tabindex', '-1');
      query<HTMLElement>('#owner-month').focus();
      void loadRequests();
    } catch (error) {
      token = '';
      say(error instanceof Error && error.name !== 'TimeoutError' && error.name !== 'AbortError' ? error.message : 'The calendar took too long to respond. Please try again.', true);
    } finally { setBusy(false); }
  });
  prev.addEventListener('click', () => { if (shownMonth > firstMonth && !busy) { shownMonth--; selectedDate=null; draw(); } });
  next.addEventListener('click', () => { if (shownMonth < lastMonth && !busy) { shownMonth++; selectedDate=null; draw(); } });
  lock.addEventListener('click', () => { void signOut(); });
  query<HTMLButtonElement>('#owner-range-block').addEventListener('click', () => { if (!busy) applyRange(true); });
  query<HTMLButtonElement>('#owner-range-open').addEventListener('click', () => { if (!busy) applyRange(false); });
  initialize.addEventListener('change', () => { initializeApproved = initialize.checked; draw(); });
  refreshRequests.addEventListener('click', () => { void loadRequests(); });
  query<HTMLSelectElement>('#owner-date-source').addEventListener('change',stageDateDetails);
  query<HTMLTextAreaElement>('#owner-date-notes').addEventListener('input',stageDateDetails);
  query<HTMLInputElement>('#owner-date-blocked').addEventListener('change',()=>{
    if(!selectedDate||busy||confirmedDates.has(selectedDate)||importedDates.has(selectedDate)||selectedDate<today)return;
    const blocked=query<HTMLInputElement>('#owner-date-blocked').checked;
    if(blocked) {removals.delete(selectedDate);if(!savedDates.has(selectedDate))additions.add(selectedDate);}
    else {additions.delete(selectedDate);if(savedDates.has(selectedDate))removals.add(selectedDate);}
    draw();say('Availability changed. Review and save your date changes.');
  });
  query<HTMLButtonElement>('#owner-date-close').addEventListener('click',()=>{const key=selectedDate;selectedDate=null;draw();if(key)days.querySelector<HTMLButtonElement>(`[data-date="${key}"]`)?.focus();});
  discard.addEventListener('click', () => { additions.clear(); removals.clear(); pendingDetails.clear(); draw(); say('Unsaved changes discarded.'); });
  save.addEventListener('click', async () => {
    if (busy || !authenticated || (changeCount() === 0 && (initialized || !initializeApproved))) return;
    setBusy(true);
    say('Saving your calendar…');
    try {
      const result = await request('PATCH', { add: [...additions], remove: [...removals], ...(pendingDetails.size?{dateDetails:Object.fromEntries(pendingDetails)}:{}), ...(!initialized && initializeApproved ? { initialize: true } : {}) });
      setCalendar(result);
      additions.clear();
      removals.clear();
      pendingDetails.clear();
      say(initialized ? 'Saved. Availability, booking sources, and private notes are up to date.' : 'Date details saved. Verify existing reservations and publish the calendar when you are ready.');
    } catch (error) {
      say(error instanceof Error && error.name !== 'TimeoutError' && error.name !== 'AbortError' ? error.message : 'The calendar took too long to respond. Your changes remain unsaved. Please try again.', true);
    } finally { setBusy(false); }
  });
  window.addEventListener('beforeunload', (event) => {
    if (changeCount() > 0 || workspace.firstElementChild?.dispatchEvent(new Event('owner-has-draft', { cancelable: true })) === false) {
      event.preventDefault(); event.returnValue = '';
    }
  });
  window.addEventListener('pagehide', event => {
    token = '';
    if (event.persisted) {
      ++sessionCheck;
      hideOwnerContent();
      nav.hidden = true;
      setAuthState('checking');
    }
  });
  window.addEventListener('pageshow', event => { if (event.persisted) void checkSession(); });
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || authState !== 'authenticated' || token) return;
    const check = sessionCheck;
    try {
      const session = await adminFetch('/api/admin/session');
      if (check === sessionCheck && (!session.authenticated || session.mustChangePassword)) expireSession();
    } catch { /* Server authorization is checked again on the next request. */ }
  });

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    say('Signing in…');
    try {
      token = '';
      const result = await adminFetch('/api/admin/session', 'POST', { username: query<HTMLInputElement>('#owner-username').value.trim(), password: query<HTMLInputElement>('#owner-password').value });
      query<HTMLInputElement>('#owner-password').value = '';
      if (result.mustChangePassword) {
        loginForm.hidden = true; recovery.hidden = true; passwordArea.hidden = false;
        say('Before opening the calendar, replace the temporary password.');
        query<HTMLInputElement>('#owner-current-password').focus();
      } else await openCalendar();
    } catch (error) { say(error instanceof Error ? error.message : 'Sign-in could not be completed.', true); }
    finally { setBusy(false); }
  });

  passwordForm.addEventListener('submit', async event => {
    event.preventDefault();
    const passwordStatus = query<HTMLElement>('#owner-password-status');
    const button = passwordForm.querySelector<HTMLButtonElement>('button')!;
    button.disabled = true; passwordStatus.textContent = 'Saving your new password…';
    try {
      await adminFetch('/api/admin/session', 'PATCH', { currentPassword: query<HTMLInputElement>('#owner-current-password').value, newPassword: query<HTMLInputElement>('#owner-new-password').value });
      passwordForm.reset(); passwordStatus.textContent = 'Password changed. Other signed-in sessions have expired.';
      await openCalendar();
    } catch (error) { passwordStatus.textContent = error instanceof Error ? error.message : 'The password could not be changed.'; }
    finally { button.disabled = false; }
  });
  query<HTMLButtonElement>('#owner-show-password').addEventListener('click', () => { passwordArea.hidden = !passwordArea.hidden; if (!passwordArea.hidden) query<HTMLInputElement>('#owner-current-password').focus(); });

  settingsForm.addEventListener('submit', async event => {
    event.preventDefault();
    const field = (name: string) => settingsForm.elements.namedItem(name) as HTMLInputElement;
    const pricing = Object.fromEntries(['nightlyPhp', 'weeklyPhp', 'monthlyPhp', 'minimumNights', 'maxNights'].map(key => [key, Number(field(key).value)]));
    const contacts = Object.fromEntries(['phone', 'whatsappUrl', 'facebookUrl', 'instagramUrl', 'email', 'bookingEmail'].map(key => [key, field(key).value.trim()]));
    const settingsStatus = query<HTMLElement>('#owner-settings-status');
    const button = settingsForm.querySelector<HTMLButtonElement>('button')!;
    button.disabled = true; settingsStatus.textContent = 'Saving rates and settings…';
    try {
      const bookingSources = sourceSettings.value.split('\n').map(source => source.trim()).filter(Boolean);
      await adminFetch('/api/admin/settings', 'PATCH', { pricing: { ...pricing, weeklyEnabled: field('weeklyEnabled').checked, monthlyEnabled: field('monthlyEnabled').checked }, contacts, bookingSources });
      setManualSources(bookingSources);
      settingsStatus.textContent = 'Saved. New quotes use these rates and manual reservations can use the updated sources.';
    }
    catch (error) { settingsStatus.textContent = error instanceof Error ? error.message : 'Settings could not be saved.'; }
    finally { button.disabled = false; }
  });

  query<HTMLButtonElement>('#owner-refresh-integrations').addEventListener('click', () => { void loadIntegrations(); });
  for (const [selector, path, body] of [
    ['#owner-sync-calendars', '/api/admin/calendar-sync', {}],
    ['#owner-drain-email', '/api/admin/email-outbox', { action: 'drain' }],
  ] as const) {
    query<HTMLButtonElement>(selector).addEventListener('click', async () => {
      const button = query<HTMLButtonElement>(selector); button.disabled = true;
      const integrationStatus = query<HTMLElement>('#owner-integrations-status');
      integrationStatus.textContent = 'Updating the connection…';
      try { await adminFetch(path, 'POST', body); integrationStatus.textContent = 'Update completed. Review the connection status below.'; await loadIntegrations(); setCalendar(await request('GET')); draw(); }
      catch (error) { integrationStatus.textContent = error instanceof Error ? error.message : 'The connection could not be updated.'; }
      finally { button.disabled = false; }
    });
  }
  await checkSession();
}
