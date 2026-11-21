import { expect, test } from '@playwright/test';

for (const width of [360, 768, 1280, 1440]) {
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
    const frame = await video.boundingBox();
    const caption = await page.locator('.hero-art figcaption').boundingBox();
    expect(frame!.width / frame!.height).toBeCloseTo(720 / 1280, 2);
    expect(caption!.y).toBeGreaterThanOrEqual(frame!.y + frame!.height);
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

test('reduced motion shows the poster without loading or shifting the tour', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const video = page.locator('.hero-video');
  await expect(video).toHaveAttribute('poster', '/images/kasag-tour-poster.webp');
  const before = await video.boundingBox();
  await expect(video).not.toHaveAttribute('src', /.+/);
  await expect(video).toHaveJSProperty('paused', true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  expect(await video.boundingBox()).toEqual(before);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(video).toHaveJSProperty('paused', true);
  await expect(video).toHaveCSS('opacity', '0');
});

test('expanded video offers controls and returns to inline playback', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await page.goto('/');
  const inline = page.locator('.hero-video');
  await expect(inline).toHaveJSProperty('paused', false);
  const expand = page.getByRole('link', { name: 'Expand video' });
  await expand.click();
  const viewer = page.getByRole('dialog', { name: 'KASAG room tour' });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator('video')).toHaveJSProperty('controls', true);
  await expect(viewer.locator('video')).toHaveCSS('object-fit', 'contain');
  await expect(inline).toHaveJSProperty('paused', true);
  await page.keyboard.press('Escape');
  await expect(viewer).not.toBeVisible();
  await expect(expand).toBeFocused();
  await expect(inline).toHaveJSProperty('paused', false);
});
