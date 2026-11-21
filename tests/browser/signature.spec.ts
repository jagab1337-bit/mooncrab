import { test, expect } from '@playwright/test';
test('both reusable signature previews render without embedded frames at phone width', async ({ page }) => {
  await page.setViewportSize({width:360,height:900});
  await page.goto('/email-signature/');
  await expect(page.locator('.signature-preview > table')).toHaveCount(2);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('.signature-preview').first()).toContainText('greetings@mooncrabsiargao.com');
  const signature = page.locator('.signature-preview').first();
  await expect(signature.getByRole('link', {name:'Current direct booking policy'}))
    .toHaveAttribute('href', 'https://mooncrabsiargao.com/booking#booking-policy-title');
  const whatsapp = signature.getByRole('link', {name:'Chat on WhatsApp', exact:true});
  await expect(whatsapp).toHaveAttribute('href', 'https://wa.me/639625284264');
  await expect(whatsapp).toHaveCSS('background-color', 'rgb(71, 47, 41)');
  await expect(signature.getByRole('link', {name:'Message on Facebook'})).toHaveAttribute('href', 'https://m.me/61596234007690');
  await expect(signature.getByRole('link', {name:'Connect on Instagram'})).toHaveAttribute('href', 'https://www.instagram.com/mooncrabsiargao/');
  await expect(signature.getByRole('link', {name:'Visit Our Website'})).toHaveAttribute('href', 'https://mooncrabsiargao.com/');
  await page.getByText('Prefer four QR codes? View the expanded signature.').click();
  await expect(page.locator('.signature-preview').last()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
