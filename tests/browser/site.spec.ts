import { test, expect, type Page } from '@playwright/test';

const now = new Date();
const future = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const month = future.toISOString().slice(0, 7);
const date = (day: number) => `${month}-${String(day).padStart(2, '0')}`;

async function calendar(page: Page, blockedDates: string[] = []) {
  await page.route('**/api/availability?*', route => route.fulfill({ json: { configured: true, room: 'KASAG', blockedDates } }));
  await page.goto('/booking');
  await expect(page.locator('#calendar-status')).toContainText('Live availability');
  const target = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(future);
  while (await page.locator('#calendar-month').textContent() !== target) {
    await page.getByRole('button', { name: 'Next month', exact: true }).click();
    await expect(page.locator('#calendar-status')).toContainText('Live availability');
  }
}
function day(page: Page, n: number) { return page.locator('#calendar-days button').filter({ hasText: new RegExp(`^${n}$`) }); }

for (const width of [360, 768, 1440]) {
  test(`landing layout and booking navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('island rhythm');
    await expect(page.getByRole('heading', { name: 'Meet KASAG.' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('link', { name: 'Plan your stay' }).click();
    await expect(page).toHaveURL(/\/booking$/);
    await expect(page.getByRole('heading', { name: 'When shall we see you?' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
test('unconfigured API closes calendar instead of inventing availability', async ({ page }) => {
  await page.route('**/api/availability?*', route => route.fulfill({ status: 503, json: { configured: false } }));
  await page.goto('/booking');
  await expect(page.locator('#calendar-status')).toContainText('not available just yet');
  expect(await page.locator('#calendar-days button:enabled').count()).toBe(0);
  await expect(page.getByRole('button', { name: 'Request this stay' })).toBeDisabled();
});
test('blocked nights cannot be crossed; blocked date may be checkout', async ({ page }) => {
  await calendar(page, [date(12)]);
  await expect(day(page, 12)).toBeDisabled();
  await day(page, 10).click();
  await day(page, 14).click();
  await expect(page.locator('#calendar-status')).toContainText('Part of that stay is unavailable');
  await expect(page.locator('#check-out')).toHaveText('Choose a date');
  await day(page, 12).click();
  await expect(page.locator('#stay-length')).toContainText('2 nights');
  await expect(page.getByRole('button', { name: 'Request this stay' })).toBeEnabled();
});
test('calendar requires two nights before accepting a check-out date', async ({ page }) => {
  await calendar(page);
  await expect(page.locator('#stay-length')).toContainText('Minimum 2 nights');
  await day(page, 10).click();
  await day(page, 11).click();
  await expect(page.locator('#calendar-status')).toContainText('minimum stay of 2 nights');
  await expect(page.locator('#check-out')).toHaveText('Choose a date');
  await expect(page.getByRole('button', { name: 'Request this stay' })).toBeDisabled();
  await day(page, 12).click();
  await expect(page.locator('#stay-length')).toContainText('2 nights');
  await expect(page.getByRole('button', { name: 'Request this stay' })).toBeEnabled();
});
test('sends a pending request with actual selected dates, not a confirmed booking', async ({ page }) => {
  let payload: Record<string, unknown> = {};
  await page.route('**/api/booking-requests', async route => {
    payload = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { id: 'test-reference', status: 'pending' } });
  });
  await calendar(page);
  await day(page, 10).click(); await day(page, 13).click();
  await page.getByLabel('Your name').fill('Island Guest');
  await page.getByLabel('Email address').fill('guest@example.com');
  await page.getByLabel('A note for your host').fill('Looking forward to Siargao.');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Request this stay' }).click();
  await expect(page.locator('#request-status')).toContainText('Your room is not reserved until confirmed');
  expect(payload).toMatchObject({ checkIn: date(10), checkOut: date(13), name: 'Island Guest', email: 'guest@example.com' });
});
test('owner must verify existing reservations before publishing; key is not persisted', async ({ page }) => {
  let initialized = false;
  let blockedDates: string[] = [];
  let saved: Record<string, unknown> = {};
  await page.route('**/api/admin/availability', async route => {
    expect(route.request().headers()['authorization']).toBe('Bearer test-owner-key');
    if (route.request().method() === 'PATCH') { saved = route.request().postDataJSON(); initialized = saved.initialize === true; blockedDates = [...blockedDates, ...(saved.add as string[])]; }
    await route.fulfill({ json: { initialized, blockedDates } });
  });
  await page.route('**/api/admin/booking-requests', route => route.fulfill({ json: { requests: [] } }));
  await page.goto('/manage');
  await page.getByLabel('Calendar access key').fill('test-owner-key');
  await page.getByRole('button', { name: 'Unlock calendar' }).click();
  await expect(page.locator('#owner-calendar-area')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  const available = page.locator('#owner-days button:enabled').first();
  await available.click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('#owner-status')).toContainText('publish the calendar when you are ready');
  expect(initialized).toBe(false);
  expect(saved.initialize).toBeUndefined();
  expect((saved.add as unknown[]).length).toBe(1);
  await page.getByLabel('I have checked all existing reservations').check();
  await page.getByRole('button', { name: 'Save & publish calendar', exact: true }).click();
  await expect(page.locator('#owner-status')).toContainText('Saved');
  expect(saved.initialize).toBe(true);
  expect(await page.evaluate(() => `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`)).not.toContain('test-owner-key');
  await page.getByRole('button', { name: 'Lock calendar' }).click();
  await expect(page.locator('#owner-calendar-area')).toBeHidden();
  await expect(page.getByLabel('Calendar access key')).toHaveValue('');
});

test('owner cancellation requires guest agreement and sends the intended action', async ({ page }) => {
  let action: unknown;
  let current = 'confirmed';
  const booking = () => ({ id: 'c9dc880a-c70d-4a90-bcd2-b509728bd0f5', checkIn: date(10), checkOut: date(12), name: '<script>guest</script>', email: 'guest@example.com', message: '<img src=x onerror=alert(1)>', status: current });
  await page.route('**/api/admin/availability', route => route.fulfill({ json: { initialized: true, blockedDates: current === 'confirmed' ? [date(10), date(11)] : [] } }));
  await page.route('**/api/admin/booking-requests', async route => {
    if (route.request().method() === 'PATCH') { action = route.request().postDataJSON(); current = 'cancelled'; await route.fulfill({ json: { request: booking() } }); }
    else await route.fulfill({ json: { requests: [booking()] } });
  });
  await page.goto('/manage');
  await page.getByLabel('Calendar access key').fill('test-owner-key');
  await page.getByRole('button', { name: 'Unlock calendar' }).click();
  const cancel = page.getByRole('button', { name: 'Cancel confirmed stay' });
  await expect(cancel).toBeDisabled();
  await expect(page.locator('#owner-requests-list')).toContainText('<script>guest</script>');
  await expect(page.locator('.owner-request-guests')).toHaveText('2 guests · No extra guest fee');
  expect(await page.locator('#owner-requests-list script, #owner-requests-list img').count()).toBe(0);
  await page.getByLabel('Cancellation agreed with the guest and guest notified directly').check();
  await cancel.click();
  await expect(page.locator('#owner-requests-status')).toContainText('Stay cancelled');
  expect(action).toEqual({ id: booking().id, action: 'cancel' });
  await expect(page.locator('.owner-request-status')).toHaveText('cancelled');
});

test('owner reviews occupancy and verifies the manual deposit before confirming', async ({ page }) => {
  let action: unknown;
  let current = 'pending';
  const booking = () => ({ id: 'c9dc880a-c70d-4a90-bcd2-b509728bd0f5', checkIn: date(10), checkOut: date(12), name: 'Three Guests', email: 'guest@example.com', message: '', guests: 3, extraGuestFeePhp: 1000, status: current });
  await page.route('**/api/admin/availability', route => route.fulfill({ json: { initialized: true, blockedDates: current === 'confirmed' ? [date(10), date(11)] : [] } }));
  await page.route('**/api/admin/booking-requests', async route => {
    if (route.request().method() === 'PATCH') { action = route.request().postDataJSON(); current = 'confirmed'; await route.fulfill({ json: { request: booking() } }); }
    else await route.fulfill({ json: { requests: [booking()] } });
  });
  await page.goto('/manage');
  await page.getByLabel('Calendar access key').fill('test-owner-key');
  await page.getByRole('button', { name: 'Unlock calendar' }).click();
  await expect(page.locator('.owner-request-guests')).toHaveText('3 guests · PHP 1,000 extra guest fee (PHP 500/night)');
  const confirm = page.getByRole('button', { name: 'Confirm agreed stay' });
  await expect(confirm).toBeDisabled();
  expect(action).toBeUndefined();
  await page.getByLabel('Total rate agreed and 50% deposit verified in my bank account').check();
  await confirm.click();
  await expect(page.locator('#owner-requests-status')).toContainText('Stay confirmed and dates blocked');
  expect(action).toEqual({ id: booking().id, action: 'confirm' });
});
