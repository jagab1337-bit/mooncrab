import { test, expect } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`photos open at their original dimensions without cropping at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const trigger = page.locator('.hero-art .photo-link');
    await expect(trigger).toHaveAttribute('href', '/images/full/bedroom.webp');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'A closer look at Mooncrab' });
    await expect(dialog).toBeVisible();
    const image = dialog.locator('.photo-viewer-image');
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(1086);
    const sizing = await image.evaluate((element: HTMLImageElement) => {
      const bounds = element.getBoundingClientRect();
      return { width: element.naturalWidth, height: element.naturalHeight, ratio: bounds.width / bounds.height, fit: getComputedStyle(element).objectFit, top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
    });
    expect(sizing.height).toBe(1448);
    expect(sizing.fit).toBe('contain');
    expect(sizing.ratio).toBeCloseTo(1086 / 1448, 3);
    expect(sizing.top).toBeGreaterThanOrEqual(0);
    expect(sizing.bottom).toBeLessThanOrEqual(900);
    expect(sizing.left).toBeGreaterThanOrEqual(0);
    expect(sizing.right).toBeLessThanOrEqual(width);
    await expect(dialog.getByRole('link', { name: 'Open full-resolution image' })).toHaveAttribute('href', /\/images\/full\/bedroom.webp$/);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
    await page.keyboard.press('ArrowRight');
    await expect(image).toHaveAttribute('src', /\/images\/full\/room-entry.webp$/);
    await page.keyboard.press('ArrowLeft');
    await expect(image).toHaveAttribute('src', /\/images\/full\/bedroom.webp$/);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.classList.contains('photo-viewer-open'))).toBe(false);
  });
}

test('pickup viewer loads the supplied full landscape photo and closes with its button', async ({ page }) => {
  await page.goto('/');
  await page.locator('.pickup-photo .photo-link').click();
  const dialog = page.getByRole('dialog');
  const image = dialog.locator('.photo-viewer-image');
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(1448);
  expect(await image.evaluate((element: HTMLImageElement) => element.naturalHeight)).toBe(1086);
  await dialog.getByRole('button', { name: 'Close photo viewer' }).click();
  await expect(dialog).not.toBeVisible();
});

test('booking room photo also opens in the viewer', async ({ page }) => {
  await page.route('**/api/availability?*', route => route.fulfill({ json: { configured: true, blockedDates: [] } }));
  await page.goto('/booking');
  await page.locator('.booking-room-photo .photo-link').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.photo-viewer-image')).toHaveAttribute('src', /\/images\/full\/bedroom.webp$/);
});
