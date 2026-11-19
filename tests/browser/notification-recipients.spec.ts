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
  const editor = page.getByRole('textbox', { name: /Owner alert recipients/ });
  const save = page.getByRole('button', { name: 'Save notification settings' });
  await expect(editor).toHaveValue('owner@example.com');
  await editor.fill('owner@example.com, desk@example.com\nmanager@example.com');
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Notification settings saved.' })).toBeVisible();
  const savedList = 'owner@example.com\ndesk@example.com\nmanager@example.com';
  await expect(editor).toHaveValue(savedList);
  await page.reload();
  await expect(editor).toHaveValue(savedList);
  await editor.fill('owner@example.com\nmanager@example.com');
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Notification settings saved.' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Owner navigation' }).getByRole('link', { name: 'Notification Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Booking notifications' })).toBeVisible();
  await expect(editor).toHaveValue('owner@example.com\nmanager@example.com');
});
