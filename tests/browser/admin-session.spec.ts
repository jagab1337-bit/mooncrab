import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_CONFIG } from '../../src/business.ts';

type DateDetail = { source: '' | 'airbnb' | 'booking' | 'direct'; notes: string };
type CalendarPatch = { add: string[]; remove: string[]; dateDetails?: Record<string, DateDetail | null> };
const futureDate = (day: number) => `2030-04-${String(day).padStart(2, '0')}`;
const ownerDay = (page: Page, date: string) => page.locator(`#owner-days [data-date="${date}"]`);

async function editableCalendar(page: Page, initial: { manualDates?: string[]; confirmedDates?: string[]; importedDates?: string[]; dateDetails?: Record<string, DateDetail> } = {}) {
  await page.clock.setFixedTime(new Date('2030-03-15T04:00:00Z'));
  const manual = new Set(initial.manualDates ?? []);
  const confirmed = initial.confirmedDates ?? [];
  const imported = initial.importedDates ?? [];
  const details = { ...initial.dateDetails };
  const patches: CalendarPatch[] = [];
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: true, mustChangePassword: false } }));
  await page.route('**/api/admin/availability', async route => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON() as CalendarPatch;
      patches.push(patch);
      patch.add.forEach(date => manual.add(date));
      patch.remove.forEach(date => manual.delete(date));
      for (const [date, detail] of Object.entries(patch.dateDetails ?? {})) {
        if (detail === null) delete details[date];
        else details[date] = detail;
      }
    }
    const dateSources: Record<string, string[]> = Object.fromEntries(confirmed.map(date => [date, ['direct']]));
    imported.forEach(date => { dateSources[date] = ['airbnb']; });
    await route.fulfill({ json: { initialized: true, manualDates: [...manual], confirmedDates: confirmed, importedDates: imported, blockedDates: [...new Set([...manual, ...confirmed, ...imported])], dateDetails: details, dateSources } });
  });
  await page.route('**/api/admin/booking-requests*', route => route.fulfill({ json: { requests: [] } }));
  await page.route('**/api/admin/settings', route => route.fulfill({ json: DEFAULT_CONFIG }));
  await page.route('**/api/admin/calendar-sync', route => route.fulfill({ json: { sources: [] } }));
  await page.route('**/api/admin/email-outbox', route => route.fulfill({ json: { config: { configured: false }, counts: {}, jobs: [] } }));
  await page.goto('/manage');
  await expect(page.locator('#owner-calendar-area')).toBeVisible();
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect(page.locator('#owner-month')).toHaveText('April 2030');
  return { patches };
}

test('footer admin link and common owner routes open the protected sign-in page', async ({ page }) => {
  let privateRequests = 0;
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated:false } }));
  await page.route('**/api/admin/availability', route => {
    privateRequests++;
    return route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
  });
  await page.goto('/');
  const login=page.getByRole('link',{name:'Admin login',exact:true});
  await expect(login).toHaveAttribute('href','/admin');
  await login.click();
  await expect(page).toHaveURL('/admin');
  for(const path of ['/manage','/manage/','/admin','/admin/','/admin/finance','/admin/vault','/admin/projects','/admin/settings/notifications']) {
    await page.goto(path);
    await expect(page.getByRole('heading',{name:'Administrator sign-in'})).toBeVisible();
    await expect(page.locator('#owner-calendar-area')).toBeHidden();
    await expect(page.getByLabel('Private notes', { exact: true })).toBeHidden();
  }
  expect(privateRequests).toBe(0);
});

test('administrator changes the bootstrap password, protects reservations, blocks a range, and saves rates', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
  const year = Number(parts.find(part => part.type === 'year')!.value);
  const month = Number(parts.find(part => part.type === 'month')!.value);
  const date = (day: number) => new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
  let signedIn = false;
  let passwordChanged = false;
  let added: string[] = [];
  let savedSettings: Record<string, unknown> | undefined;
  await page.route('**/api/admin/session', async route => {
    const method = route.request().method();
    if (method === 'POST') { expect(route.request().postDataJSON()).toMatchObject({ username: 'admin', password: 'test-first-password' }); signedIn = true; }
    if (method === 'PATCH') { expect(route.request().postDataJSON()).toMatchObject({ newPassword: 'test-replacement-password' }); passwordChanged = true; }
    if (method === 'DELETE') signedIn = false;
    await route.fulfill({ json: { authenticated: signedIn, mustChangePassword: signedIn && !passwordChanged } });
  });
  await page.route('**/api/admin/availability', async route => {
    expect(signedIn && passwordChanged).toBe(true);
    if (route.request().method() === 'PATCH') added = route.request().postDataJSON().add;
    await route.fulfill({ json: { initialized: true, manualDates: added, confirmedDates: [date(6)], importedDates: [date(7)], blockedDates: [...added, date(6), date(7)] } });
  });
  await page.route('**/api/admin/booking-requests*', route => route.fulfill({ json: { requests: [] } }));
  await page.route('**/api/admin/settings', async route => {
    if (route.request().method() === 'PATCH') savedSettings = route.request().postDataJSON();
    await route.fulfill({ json: { room: 'KASAG', pricing: { nightlyPhp: 1300, weeklyPhp: 8000, monthlyPhp: 30000, minimumNights: 2, maxNights: 90, weeklyEnabled: true, monthlyEnabled: true }, contacts: { phone: '+639625284264', whatsappUrl: 'https://wa.me/639625284264', facebookUrl: 'https://www.facebook.com/share/1CsWCrqdR8/', instagramUrl: 'https://www.instagram.com/mooncrabsiargao/', email: 'greetings@mooncrabsiargao.com', bookingEmail: 'bookings@mooncrabsiargao.com', notificationEmail: 'greetings@mooncrabsiargao.com' } } });
  });
  await page.route('**/api/admin/calendar-sync', route => route.fulfill({ json: { sources: [{ source: 'airbnb', configured: false }, { source: 'booking', configured: false }] } }));
  await page.route('**/api/admin/email-outbox', route => route.fulfill({ json: { config: { configured: false, blockedReasons: ['SMTP is not configured.'] }, counts: { queued: 0 }, jobs: [] } }));
  await page.goto('/manage');
  await page.getByLabel('Username', { exact: true }).fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('test-first-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#owner-calendar-area')).toBeHidden();
  await expect(page.locator('#owner-password-area')).toBeVisible();
  await page.getByLabel('Current password', { exact: true }).fill('test-first-password');
  await page.getByLabel('New password', { exact: true }).fill('test-replacement-password');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.locator('#owner-calendar-area')).toBeVisible();
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await ownerDay(page, date(6)).click();
  await expect(page.getByLabel('Unavailable for guests', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Unavailable for guests', { exact: true })).toBeDisabled();
  await ownerDay(page, date(7)).click();
  await expect(page.getByLabel('Unavailable for guests', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Unavailable for guests', { exact: true })).toBeDisabled();
  await page.getByLabel('From', { exact: true }).fill(date(5));
  await page.getByLabel('Through', { exact: true }).fill(date(8));
  await page.getByRole('button', { name: 'Block range', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#owner-status')).toContainText('Saved.');
  expect(added).toEqual([date(5), date(8)]);
  await expect(page.getByLabel('Nightly rate · PHP')).toHaveValue('1300');
  await page.getByLabel('Nightly rate · PHP').fill('1500');
  await page.getByRole('button', { name: 'Save rates & settings' }).click();
  await expect(page.locator('#owner-settings-status')).toContainText('Saved.');
  expect(savedSettings).toMatchObject({ pricing: { nightlyPhp: 1500 } });
  await expect(page.locator('#owner-email-connections')).toContainText('SMTP is not configured.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Lock calendar' }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.locator('#owner-calendar-area')).toBeHidden();
});

test('private booking sources and notes survive changing selected dates, saving, and reloading', async ({ page }) => {
  const { patches } = await editableCalendar(page);
  const source = page.getByRole('combobox', { name: 'Booking source', exact: true });
  const notes = page.getByLabel('Private notes', { exact: true });
  const unavailable = page.getByLabel('Unavailable for guests', { exact: true });
  await ownerDay(page, futureDate(5)).click();
  await expect(unavailable).not.toBeChecked();
  await source.selectOption('airbnb');
  await notes.fill('Airbnb guest: late arrival\nAirport pickup requested.');
  await unavailable.check();
  await page.getByRole('button', { name: 'Close date editor' }).click();
  await expect(notes).toBeHidden();
  await ownerDay(page, futureDate(8)).click();
  await expect(source).toHaveValue('');
  await expect(notes).toHaveValue('');
  await expect(unavailable).not.toBeChecked();
  await source.selectOption('booking');
  await notes.fill('Booking.com guest: <script>private-note</script>');
  await ownerDay(page, futureDate(5)).click();
  await expect(source).toHaveValue('airbnb');
  await expect(notes).toHaveValue('Airbnb guest: late arrival\nAirport pickup requested.');
  await expect(unavailable).toBeChecked();
  expect(patches).toHaveLength(0);
  await page.locator('#owner-save').click();
  await expect(page.locator('#owner-status')).toContainText('Saved.');
  expect(patches).toHaveLength(1);
  expect(patches[0]).toMatchObject({ add: [futureDate(5)], remove: [], dateDetails: { [futureDate(5)]: { source: 'airbnb', notes: 'Airbnb guest: late arrival\nAirport pickup requested.' }, [futureDate(8)]: { source: 'booking', notes: 'Booking.com guest: <script>private-note</script>' } } });
  await page.reload();
  await expect(page.locator('#owner-calendar-area')).toBeVisible();
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await ownerDay(page, futureDate(5)).click();
  await expect(source).toHaveValue('airbnb');
  await expect(notes).toHaveValue('Airbnb guest: late arrival\nAirport pickup requested.');
  await expect(unavailable).toBeChecked();
  await ownerDay(page, futureDate(8)).click();
  await expect(source).toHaveValue('booking');
  await expect(notes).toHaveValue('Booking.com guest: <script>private-note</script>');
  await expect(unavailable).not.toBeChecked();
  expect(await page.evaluate(() => `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`)).not.toContain('private-note');
  expect(await page.locator('#owner-calendar-area script').count()).toBe(0);
});

test('discard restores saved private details and availability while an explicit metadata clear can be saved', async ({ page }) => {
  const saved = { source: 'airbnb' as const, notes: 'Existing guest note' };
  const { patches } = await editableCalendar(page, { manualDates: [futureDate(5)], dateDetails: { [futureDate(5)]: saved } });
  const source = page.getByRole('combobox', { name: 'Booking source', exact: true });
  const notes = page.getByLabel('Private notes', { exact: true });
  const unavailable = page.getByLabel('Unavailable for guests', { exact: true });
  await ownerDay(page, futureDate(5)).click();
  await source.selectOption('direct');
  await notes.fill('Unsaved replacement');
  await unavailable.uncheck();
  await ownerDay(page, futureDate(8)).click();
  await source.selectOption('booking');
  await notes.fill('Unsaved new date');
  await unavailable.check();
  await page.locator('#owner-discard').click();
  await expect(page.locator('#owner-change-count')).toContainText('No unsaved changes');
  await expect(page.locator('#owner-save')).toBeDisabled();
  expect(patches).toHaveLength(0);
  await ownerDay(page, futureDate(5)).click();
  await expect(source).toHaveValue('airbnb');
  await expect(notes).toHaveValue(saved.notes);
  await expect(unavailable).toBeChecked();
  await ownerDay(page, futureDate(8)).click();
  await expect(source).toHaveValue('');
  await expect(notes).toHaveValue('');
  await expect(unavailable).not.toBeChecked();
  await ownerDay(page, futureDate(5)).click();
  await source.selectOption('');
  await notes.fill('');
  await page.locator('#owner-save').click();
  await expect(page.locator('#owner-status')).toContainText('Saved.');
  expect(patches).toEqual([{ add: [], remove: [], dateDetails: { [futureDate(5)]: null } }]);
  await ownerDay(page, futureDate(8)).click();
  await ownerDay(page, futureDate(5)).click();
  await expect(source).toHaveValue('');
  await expect(notes).toHaveValue('');
  await expect(unavailable).toBeChecked();
});

test('confirmed, imported, and past dates permit private annotations while reopening only editable manual dates', async ({ page }) => {
  const past = '2030-03-10';
  const { patches } = await editableCalendar(page, { manualDates: [past, futureDate(8)], confirmedDates: [futureDate(6)], importedDates: [futureDate(7)] });
  const source = page.getByRole('combobox', { name: 'Booking source', exact: true });
  const notes = page.getByLabel('Private notes', { exact: true });
  const unavailable = page.getByLabel('Unavailable for guests', { exact: true });
  for (const [date, channel, note] of [[futureDate(6), 'direct', 'Confirmed guest note'], [futureDate(7), 'airbnb', 'Imported guest note']] as const) {
    await ownerDay(page, date).click();
    await expect(source).toHaveValue(channel);
    await expect(unavailable).toBeChecked();
    await expect(unavailable).toBeDisabled();
    await source.selectOption(channel);
    await notes.fill(note);
  }
  await page.getByLabel('From', { exact: true }).fill(futureDate(6));
  await page.getByLabel('Through', { exact: true }).fill(futureDate(8));
  await page.getByRole('button', { name: 'Reopen range', exact: true }).click();
  await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  await ownerDay(page, past).click();
  await expect(unavailable).toBeChecked();
  await expect(unavailable).toBeDisabled();
  await source.selectOption('booking');
  await notes.fill('Past booking follow-up');
  await page.locator('#owner-save').click();
  await expect(page.locator('#owner-status')).toContainText('Saved.');
  expect(patches).toHaveLength(1);
  expect(patches[0]).toMatchObject({ add: [], remove: [futureDate(8)], dateDetails: { [futureDate(6)]: { source: 'direct', notes: 'Confirmed guest note' }, [futureDate(7)]: { source: 'airbnb', notes: 'Imported guest note' }, [past]: { source: 'booking', notes: 'Past booking follow-up' } } });
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  for (const date of [futureDate(6), futureDate(7)]) {
    await ownerDay(page, date).click();
    await expect(unavailable).toBeChecked();
    await expect(unavailable).toBeDisabled();
  }
  await ownerDay(page, futureDate(8)).click();
  await expect(unavailable).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a slow session check never flashes the login form, and inner navigation keeps the document', async ({ page }) => {
  let signedIn = true;
  let release!: () => void;
  let gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/admin/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/admin/session') return (async () => {
      if (route.request().method() === 'DELETE') signedIn = false;
      await gate;
      await route.fulfill({ json: { authenticated: signedIn, mustChangePassword: false } });
    })();
    const payload = path.endsWith('/availability') ? { initialized:true, blockedDates:[] }
      : path.endsWith('/booking-requests') ? {requests:[]}
      : path.endsWith('/email-outbox') ? {smtp:{configured:false}, jobs:[]}
      : path.endsWith('/settings') ? DEFAULT_CONFIG : { records:[], files:[], sources:[] };
    return route.fulfill({ json: payload });
  });
  const login = page.getByRole('heading', { name: 'Administrator sign-in' });
  const checking = page.getByText('Checking your session…');
  await page.goto('/admin/finance', { waitUntil: 'domcontentloaded' });
  await expect(checking).toBeVisible();
  await expect(login).toBeHidden();
  release();
  await expect(page.getByRole('heading', { name:'Finance Tracker' })).toBeVisible();
  const time = await page.evaluate(() => performance.timeOrigin);
  for (const [link, heading] of [['Project Management','Project Management'], ['Logins & Notes','Logins & Notes'], ['Notification Settings','Booking notifications'], ['Dashboard','Stay requests']]) {
    const nav = page.getByRole('navigation', { name:'Owner navigation' });
    gate = new Promise<void>(resolve => { release = resolve; });
    await nav.getByRole('link', { name:link, exact:true }).click();
    await expect(checking).toBeVisible();
    await expect(login).toBeHidden();
    release();
    await expect(page.getByRole('heading', { name:heading, exact:true })).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(time);
  }
  await page.goBack();
  await expect(page.getByRole('heading', { name:'Booking notifications' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name:'Stay requests' })).toBeVisible();
  gate = new Promise<void>(resolve => { release = resolve; });
  await page.reload({ waitUntil:'domcontentloaded' });
  await expect(checking).toBeVisible();
  await expect(login).toBeHidden();
  release();
  await expect(page.getByRole('heading', { name:'Stay requests' })).toBeVisible();
  signedIn = false;
  await page.getByRole('navigation', { name:'Owner navigation' }).getByRole('link', { name:'Finance Tracker' }).click();
  await expect(login).toBeVisible();
  await expect(page.getByText('Your session expired. Sign in again.')).toBeVisible();
  await expect(page.getByRole('heading', { name:'Finance Tracker' })).toBeHidden();
  signedIn = true;
  await page.reload();
  await expect(page.getByRole('heading', { name:'Finance Tracker' })).toBeVisible();
  await page.getByRole('navigation', { name:'Owner navigation' }).getByRole('button', { name:'Sign out' }).click();
  await expect(login).toBeVisible();
  await expect(page.getByRole('heading', { name:'Finance Tracker' })).toBeHidden();
});
