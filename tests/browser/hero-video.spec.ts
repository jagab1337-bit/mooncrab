import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`KASAG tour autoplays silently at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const video = page.locator('.hero-video');
    await expect(video).toHaveJSProperty('muted', true);
    await expect(video).toHaveJSProperty('playsInline', true);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
    await expect(video).toHaveJSProperty('videoWidth', 720);
    await expect(video).toHaveJSProperty('videoHeight', 1280);
    await expect(video).toHaveCSS('object-fit', 'contain');
    await page.getByRole('button', { name: 'Pause video' }).click();
    await expect(video).toHaveJSProperty('paused', true);
    await page.getByRole('button', { name: 'Play video' }).click();
    await expect(video).toHaveJSProperty('paused', false);
  });
}

test('reduced motion keeps the bedroom poster and lets visitors start the tour', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const video = page.locator('.hero-video');
  await expect(video).toHaveAttribute('poster', '/images/bedroom.webp');
  await expect(video).not.toHaveAttribute('src', /.+/);
  await expect(video).toHaveJSProperty('paused', true);
  await page.getByRole('button', { name: 'Play video' }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
});
