import { expect, test } from '@playwright/test';

test('owner alert recipients can be viewed, added, and removed from Email Automations', async ({ page }) => {
  const smtp = { configured: true, reason: null };
  let recipients = ['owner@example.com'];
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: true, mustChangePassword: false } }));
  await page.route('**/api/admin/email-outbox?automations=1', route => route.fulfill({
    json: { smtp, jobs: [], enabled: { owner: true }, ownerNotifications: { enabled: true, recipients }, lastTest: null },
  }));
  await page.route('**/api/admin/email-outbox?settings=1', route => {
    if (route.request().method() === 'POST') {
      const { action, settings } = route.request().postDataJSON();
      expect(action).toBe('save');
      expect(settings.enabled).toBe(true);
      recipients = settings.recipients;
    }
    return route.fulfill({ json: { enabled: true, recipients, smtp, lastTest: null } });
  });

  await page.goto('/admin/email-automations');
  await page.getByText('Manage owner alert recipients', { exact: true }).click();
  const editor = page.getByRole('textbox', { name: /Owner alert recipients/ });
  const save = page.getByRole('button', { name: 'Save notification settings' });
  await expect(editor).toHaveValue('owner@example.com');
  await editor.fill('owner@example.com, desk@example.com\nmanager@example.com');
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Notification settings saved.' })).toBeVisible();
  const savedList = 'owner@example.com\ndesk@example.com\nmanager@example.com';
  await expect(editor).toHaveValue(savedList);
  await page.reload();
  await page.getByText('Manage owner alert recipients', { exact: true }).click();
  await expect(editor).toHaveValue(savedList);
  await editor.fill('owner@example.com\nmanager@example.com');
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Notification settings saved.' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Owner navigation' }).getByRole('link', { name: 'Notification Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Booking notifications' })).toBeVisible();
  await expect(editor).toHaveValue('owner@example.com\nmanager@example.com');
});

test('email activity shows the newest 10 first and searches across every page', async ({ page }) => {
  const smtp = { configured: true, reason: null };
  const jobs = Array.from({ length: 23 }, (_, index) => {
    const serial = index + 1;
    const bookingId = String(serial).padStart(8, '0') + '-0000-4000-8000-000000000000';
    const at = '2030-01-' + String(serial).padStart(2, '0') + 'T12:00:00Z';
    return {
      id: bookingId + ':guest', bookingId, kind: 'guest', workflow: 'guest', status: 'accepted',
      lastAttempt: at, updatedAt: at, safeToRetry: false,
      history: [{ at, finishedAt: at, state: 'accepted', to: 'guest@example.com', subject: 'Request ' + serial }],
    };
  });
  await page.route('**/api/admin/session', route => route.fulfill({ json: { authenticated: true, mustChangePassword: false } }));
  await page.route('**/api/admin/email-outbox?automations=1', route => route.fulfill({
    json: { smtp, jobs, enabled: { guest: true }, ownerNotifications: { enabled: false, recipients: [] }, lastTest: null },
  }));
  await page.goto('/admin/email-automations');
  const activity = page.getByRole('region', { name: 'Email activity' });
  const rows = activity.locator('tbody tr');
  const previous = activity.getByRole('button', { name: 'Previous' });
  const next = activity.getByRole('button', { name: 'Next' });
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText('Request 23');
  await expect(rows.last()).toContainText('Request 14');
  await expect(activity.getByText('1–10 of 23 · Page 1 of 3')).toBeVisible();
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText('Request 13');
  await next.click();
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('Request 3');
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(rows.first()).toContainText('Request 13');
  await activity.getByRole('searchbox', { name: 'Search activity' }).fill('Request 2');
  await expect(rows).toHaveCount(5);
  await expect(rows.last()).toContainText('Request 2');
  await expect(activity.getByText('1–5 of 5 · Page 1 of 1')).toBeVisible();
});
