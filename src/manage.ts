import './manage.css';

type CalendarResponse = { blockedDates: string[]; initialized: boolean; error?: string };
type BookingRequest = { id: string; checkIn: string; checkOut: string; name: string; email: string; message: string; status: 'pending' | 'confirmed' | 'declined' | 'cancelled'; createdAt: string; updatedAt: string };

/** Owner-only calendar. Credentials stay in this function's memory. */
export async function renderManage(container: HTMLElement): Promise<void> {
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
  let busy = false;
  let initialized = false;
  let initializeApproved = false;
  let requestsBusy = false;
  let bookingRequests: BookingRequest[] = [];
  let savedDates = new Set<string>();
  const additions = new Set<string>();
  const removals = new Set<string>();

  const describe = (key: string) => new Intl.DateTimeFormat('en', {
    timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date(`${key}T12:00:00Z`));
  const monthName = () => new Intl.DateTimeFormat('en', {
    timeZone: 'UTC', month: 'long', year: 'numeric',
  }).format(new Date(Date.UTC(Math.floor(shownMonth / 12), shownMonth % 12, 1)));
  const isBlocked = (key: string) => additions.has(key) || (savedDates.has(key) && !removals.has(key));

  container.innerHTML = `
    <section class="owner-panel" aria-labelledby="owner-title">
      <a class="owner-back" href="/">← Back to Mooncrab</a>
      <div class="owner-heading"><p class="owner-eyebrow">MOONCRAB SIARGAO · OWNER ACCESS</p>
        <h1 id="owner-title">A little planning.<br><em>More island days.</em></h1>
        <p>Manage KASAG’s calendar. Block every existing reservation before sharing live availability with guests.</p>
      </div>
      <div class="owner-card">
        <form id="owner-unlock" class="owner-unlock">
          <label for="owner-token">Calendar access key</label>
          <p class="owner-hint" id="owner-token-help">Use your private owner key. Access lasts only while this page is open.</p>
          <div class="owner-unlock-row"><input id="owner-token" type="password" autocomplete="off" spellcheck="false" required aria-describedby="owner-token-help" placeholder="Enter your owner key" />
            <button class="owner-primary" type="submit">Unlock calendar</button></div>
        </form>
        <div id="owner-calendar-area" hidden>
          <div class="owner-access"><span><span class="owner-access-dot"></span> Owner calendar · KASAG</span><button id="owner-lock" type="button">Lock calendar</button></div>
          <p class="owner-instructions" id="owner-calendar-help">Select a date to block or reopen it. Changes become public only after you save. Dates use Philippine time.</p>
          <div class="owner-month-navigation"><button id="owner-prev" type="button" aria-label="Previous month">←</button><h2 id="owner-month"></h2><button id="owner-next" type="button" aria-label="Next month">→</button></div>
          <div class="owner-weekdays" aria-hidden="true"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div>
          <div id="owner-days" class="owner-days" role="group" aria-labelledby="owner-month" aria-describedby="owner-calendar-help"></div>
          <div class="owner-legend"><span><i class="owner-legend-open"></i> Open</span><span><i class="owner-legend-blocked"></i> Blocked</span><span><i class="owner-legend-edited"></i> Unsaved change</span></div>
          <label class="owner-initialize" id="owner-initialize-area"><input id="owner-initialize" type="checkbox" /><span>I have checked all existing reservations and blocked their dates. Publish this calendar for guests.</span></label>
          <div class="owner-save-row"><p id="owner-change-count">No unsaved changes</p><div><button type="button" id="owner-discard">Discard changes</button><button class="owner-primary" type="button" id="owner-save">Save changes</button></div></div>
          <p class="owner-footnote">Block dates from other booking channels here. Confirmed stays remain blocked when manual dates are reopened. Calendar edits do not cancel a guest reservation. Keep your other booking channels in sync.</p>
        </div>
        <p class="owner-status" id="owner-status" role="status" aria-live="polite"></p>
      </div>
      <section class="owner-card owner-requests" id="owner-requests-area" hidden aria-labelledby="owner-requests-title">
        <div class="owner-requests-heading"><h2 id="owner-requests-title">Stay requests</h2><button id="owner-refresh-requests" type="button">Refresh requests</button></div>
        <p class="owner-instructions">Requests do not hold dates. Agree the rate and stay details with the guest before confirming. A confirmation blocks the room’s nights automatically; contact the guest to confirm their stay.</p>
        <p id="owner-requests-status" class="owner-status" role="status" aria-live="polite"></p>
        <div id="owner-requests-list"></div>
      </section>
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

  function say(message: string, error = false): void {
    status.textContent = message;
    status.classList.toggle('owner-status-error', error);
  }

  function lockCalendar(): void {
    token = '';
    authenticated = false;
    additions.clear();
    removals.clear();
    savedDates.clear();
    bookingRequests = [];
    requestsList.replaceChildren();
    requestsArea.hidden = true;
    requestsStatus.textContent = '';
    initialized = false;
    initializeApproved = false;
    initialize.checked = false;
    tokenInput.value = '';
    days.replaceChildren();
    form.hidden = false;
    calendarArea.hidden = true;
    say('Calendar locked. Enter your owner key to continue.');
    tokenInput.focus();
  }

  function setBusy(value: boolean): void {
    busy = value;
    form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach((element) => { element.disabled = value; });
    lock.disabled = value;
    initialize.disabled = value;
    if (authenticated) draw();
  }

  async function requestBookings(method: 'GET' | 'PATCH', body?: unknown): Promise<unknown> {
    const response = await fetch('/api/admin/booking-requests', {
      method, cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('The owner key was not accepted. Lock the calendar and sign in again.');
      if (response.status === 409) throw new Error('This request could not be updated: the dates or request status may have changed. Refresh requests and review the calendar.');
      if (response.status === 503) throw new Error('Stay requests are not connected yet. Complete the booking setup first.');
      throw new Error('This request could not be completed. Refresh before trying again.');
    }
    return response.json();
  }

  function drawRequests(): void {
    requestsList.replaceChildren();
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
      const email = document.createElement('a');
      email.className = 'owner-request-email';
      email.href = `mailto:${encodeURIComponent(booking.email)}`;
      email.textContent = booking.email;
      const message = document.createElement('p');
      message.className = 'owner-request-message';
      message.textContent = booking.message || 'No additional message.';
      const id = document.createElement('p');
      id.className = 'owner-request-id';
      id.textContent = `Reference ${booking.id}`;
      card.append(heading, dates, email, message, id);
      if (booking.status === 'pending') {
        const agreement = document.createElement('label');
        agreement.className = 'owner-request-agreement';
        const agreed = document.createElement('input');
        agreed.type = 'checkbox';
        const agreementLabel = document.createElement('span');
        agreementLabel.textContent = 'Rate and stay details agreed with the guest';
        agreement.append(agreed, agreementLabel);
        const actions = document.createElement('div');
        actions.className = 'owner-request-actions';
        const confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'owner-primary';
        confirm.textContent = 'Confirm agreed stay';
        confirm.disabled = true;
        const decline = document.createElement('button');
        decline.type = 'button';
        decline.className = 'owner-request-decline';
        decline.textContent = 'Decline request';
        decline.disabled = requestsBusy;
        agreed.disabled = requestsBusy;
        agreed.addEventListener('change', () => { confirm.disabled = !agreed.checked || requestsBusy; });
        confirm.addEventListener('click', () => { if (agreed.checked) void actOnRequest(booking.id, 'confirm'); });
        decline.addEventListener('click', () => { void actOnRequest(booking.id, 'decline'); });
        actions.append(confirm, decline);
        card.append(agreement, actions);
      } else if (booking.status === 'confirmed') {
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
      requestsList.append(card);
    }
  }

  async function loadRequests(): Promise<void> {
    if (!authenticated || requestsBusy) return;
    const sessionToken = token;
    requestsBusy = true;
    refreshRequests.disabled = true;
    requestsStatus.textContent = 'Loading stay requests…';
    try {
      const result = await requestBookings('GET');
      if (!authenticated || token !== sessionToken) return;
      if (!result || typeof result !== 'object' || !('requests' in result) || !Array.isArray(result.requests)) throw new Error('Stay requests returned an unexpected response. Please try again.');
      const valid = result.requests.every((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return false;
        const row = entry as Record<string, unknown>;
        return ['id', 'checkIn', 'checkOut', 'name', 'email', 'message', 'status'].every((key) => typeof row[key] === 'string') && ['pending', 'confirmed', 'declined', 'cancelled'].includes(String(row.status)) && /^\d{4}-\d{2}-\d{2}$/.test(String(row.checkIn)) && /^\d{4}-\d{2}-\d{2}$/.test(String(row.checkOut));
      });
      if (!valid) throw new Error('Stay requests returned an unexpected response. Please try again.');
      bookingRequests = result.requests as BookingRequest[];
      requestsStatus.textContent = `${bookingRequests.filter((booking) => booking.status === 'pending').length} pending requests`;
    } catch (error) {
      if (authenticated) requestsStatus.textContent = error instanceof Error ? error.message : 'Stay requests could not be loaded. Try again.';
    } finally {
      requestsBusy = false;
      refreshRequests.disabled = false;
      if (authenticated) drawRequests();
    }
  }

  async function actOnRequest(id: string, action: 'confirm' | 'decline' | 'cancel'): Promise<void> {
    if (!authenticated || requestsBusy || busy) return;
    if (additions.size + removals.size > 0) { requestsStatus.textContent = 'Save or discard calendar changes before handling stay requests.'; return; }
    requestsBusy = true;
    refreshRequests.disabled = true;
    setBusy(true);
    drawRequests();
    requestsStatus.textContent = action === 'confirm' ? 'Confirming the agreed stay…' : action === 'cancel' ? 'Cancelling the agreed stay…' : 'Declining the request…';
    try {
      await requestBookings('PATCH', { id, action });
      if (!authenticated) return;
      const calendar = await request('GET');
      savedDates = new Set(calendar.blockedDates);
      initialized = calendar.initialized;
      const result = await requestBookings('GET');
      if (!result || typeof result !== 'object' || !('requests' in result) || !Array.isArray(result.requests)) throw new Error('The action completed, but the list could not refresh. Refresh requests to check its status.');
      bookingRequests = result.requests as BookingRequest[];
      requestsStatus.textContent = action === 'confirm' ? 'Stay confirmed and dates blocked. Contact the guest with their confirmation.' : action === 'cancel' ? 'Stay cancelled. Its nights are open again unless manually blocked. No email was sent; keep the guest informed directly.' : 'Request declined. Contact the guest to let them know.';
    } catch (error) {
      requestsStatus.textContent = error instanceof Error ? error.message : 'The action could not be completed. Refresh requests before trying again.';
    } finally {
      requestsBusy = false;
      refreshRequests.disabled = false;
      setBusy(false);
      if (authenticated) drawRequests();
    }
  }

  async function request(method: 'GET' | 'PATCH', body?: unknown): Promise<CalendarResponse> {
    const response = await fetch('/api/admin/availability', {
      method, cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('The owner key was not accepted. Check your key and try again.');
      if (response.status === 503) throw new Error('The calendar is not connected yet. Complete the calendar setup before managing dates.');
      if (response.status === 400) throw new Error('The selected dates could not be saved. Reload the calendar and try again.');
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
      const edited = additions.has(key) || removals.has(key);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = String(day);
      button.dataset.date = key;
      button.className = `owner-day${blocked ? ' owner-day-blocked' : ''}${edited ? ' owner-day-edited' : ''}`;
      button.disabled = busy || key < today;
      button.setAttribute('aria-pressed', String(blocked));
      button.setAttribute('aria-label', `${describe(key)}, ${blocked ? 'blocked' : 'open'}${edited ? ', unsaved change' : ''}${key < today ? ', past date' : ''}`);
      if (key === today) button.setAttribute('aria-current', 'date');
      button.addEventListener('click', () => {
        if (busy || key < today) return;
        if (savedDates.has(key)) {
          if (removals.has(key)) removals.delete(key); else removals.add(key);
        } else {
          if (additions.has(key)) additions.delete(key); else additions.add(key);
        }
        say('Review your changes, then save to update guest availability.');
        draw();
        days.querySelector<HTMLButtonElement>(`[data-date="${key}"]`)?.focus();
      });
      days.append(button);
    }
    const changes = additions.size + removals.size;
    query<HTMLElement>('#owner-initialize-area').hidden = initialized;
    query<HTMLElement>('#owner-change-count').textContent = changes ? `${changes} unsaved ${changes === 1 ? 'change' : 'changes'}` : 'No unsaved changes';
    save.disabled = busy || (changes === 0 && (initialized || !initializeApproved));
    save.textContent = busy ? 'Saving…' : !initialized && initializeApproved ? 'Save & publish calendar' : 'Save changes';
    discard.disabled = busy || changes === 0;
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
      const result = await request('GET');
      savedDates = new Set(result.blockedDates);
      initialized = result.initialized;
      authenticated = true;
      tokenInput.value = '';
      form.hidden = true;
      calendarArea.hidden = false;
      requestsArea.hidden = false;
      say('Calendar loaded. Block all existing reservations before opening dates to guests.');
      query<HTMLElement>('#owner-month').setAttribute('tabindex', '-1');
      query<HTMLElement>('#owner-month').focus();
      void loadRequests();
    } catch (error) {
      token = '';
      say(error instanceof Error && error.name !== 'TimeoutError' && error.name !== 'AbortError' ? error.message : 'The calendar took too long to respond. Please try again.', true);
    } finally { setBusy(false); }
  });
  prev.addEventListener('click', () => { if (shownMonth > firstMonth && !busy) { shownMonth--; draw(); } });
  next.addEventListener('click', () => { if (shownMonth < lastMonth && !busy) { shownMonth++; draw(); } });
  lock.addEventListener('click', lockCalendar);
  initialize.addEventListener('change', () => { initializeApproved = initialize.checked; draw(); });
  refreshRequests.addEventListener('click', () => { void loadRequests(); });
  discard.addEventListener('click', () => { additions.clear(); removals.clear(); draw(); say('Unsaved changes discarded.'); });
  save.addEventListener('click', async () => {
    if (busy || !authenticated || (additions.size + removals.size === 0 && (initialized || !initializeApproved))) return;
    setBusy(true);
    say('Saving your calendar…');
    try {
      const result = await request('PATCH', { add: [...additions], remove: [...removals], ...(!initialized && initializeApproved ? { initialize: true } : {}) });
      savedDates = new Set(result.blockedDates);
      initialized = result.initialized;
      additions.clear();
      removals.clear();
      say(initialized ? 'Saved. Guest availability now reflects these blocked dates.' : 'Blocked dates saved. Verify existing reservations and publish the calendar when you are ready.');
    } catch (error) {
      say(error instanceof Error && error.name !== 'TimeoutError' && error.name !== 'AbortError' ? error.message : 'The calendar took too long to respond. Your changes remain unsaved. Please try again.', true);
    } finally { setBusy(false); }
  });
  window.addEventListener('beforeunload', (event) => {
    if (additions.size + removals.size > 0) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => { token = ''; });
  window.addEventListener('pageshow', (event) => { if (event.persisted) lockCalendar(); });
}
