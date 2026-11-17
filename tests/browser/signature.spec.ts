import { test, expect } from '@playwright/test';
test('both reusable signature previews render without embedded frames at phone width', async ({ page }) => {
  await page.setViewportSize({width:360,height:900});
  await page.goto('/email-signature/');
  await expect(page.locator('.signature-preview > table')).toHaveCount(2);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('.signature-preview').first()).toContainText('greetings@mooncrabsiargao.com');
  await page.getByText('Prefer four QR codes? View the expanded signature.').click();
  await expect(page.locator('.signature-preview').last()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
