import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`KASAG tour autoplays and loops silently at ${width}px`, async ({ page }) => {
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
    await expect(video).toHaveJSProperty('controls', false);
    await expect(page.locator('.hero-art button')).toHaveCount(0);
    const position = await video.evaluate((element: HTMLVideoElement) => {
      element.currentTime = element.duration - 0.2;
      return element.currentTime;
    });
    expect(position).toBeGreaterThan(20);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeLessThan(2);
    await expect(video).toHaveJSProperty('paused', false);
  });
}

test('reduced motion shows the bedroom poster without loading the tour', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const video = page.locator('.hero-video');
  await expect(video).toHaveAttribute('poster', '/images/bedroom.webp');
  await expect(video).not.toHaveAttribute('src', /.+/);
  await expect(video).toHaveJSProperty('paused', true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(video).toHaveJSProperty('paused', true);
  await expect(video).toHaveCSS('opacity', '0');
});
