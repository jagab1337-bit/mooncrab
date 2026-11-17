import { test, expect } from '@playwright/test';

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
  await page.route('**/api/admin/booking-requests', route => route.fulfill({ json: { requests: [] } }));
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
  await expect(page.locator(`[data-date="${date(6)}"]`)).toBeDisabled();
  await expect(page.locator(`[data-date="${date(7)}"]`)).toBeDisabled();
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
