import { test, expect, type Page } from '@playwright/test';

const photoNames = ['room-entry', 'bedroom-wide', 'kitchen', 'bathroom', 'workspace', 'room-greenery'];
const photoTitles = ['Come in. Make yourself at home.', 'Your own little island room.', 'A kitchen for slow mornings', 'Your own bathroom and hot shower', 'A quiet corner, just for you', 'A little green, right outside'];
const carousel = (page: Page) => page.locator('[data-room-carousel]');

async function expectPhoto(page: Page, index: number): Promise<void> {
  const root = carousel(page);
  const thumbnail = root.locator('.room-carousel-thumbnail').nth(index);
  const active = root.locator('.room-carousel-slide').nth(index);
  await expect(root.locator('[data-room-count]')).toHaveText(`${String(index + 1).padStart(2, '0')} / 06`);
  await expect(root.locator('[data-room-title]')).toHaveText(photoTitles[index]);
  await expect(thumbnail).toHaveAccessibleName(`Show ${photoTitles[index]}`);
  await expect(thumbnail).toHaveAttribute('aria-current', 'true');
  await expect(active).toHaveJSProperty('inert', false);
  await expect(active.getByRole('heading', { name: photoTitles[index], exact: true })).toBeVisible();
  await expect(active.locator('img')).toHaveAttribute('src', `/images/${photoNames[index]}.webp`);
  await expect.poll(() => root.locator('.room-carousel-track').evaluate((track, position) => {
    const slides = track.querySelectorAll<HTMLElement>('.room-carousel-slide');
    return Math.abs(track.scrollLeft - (slides[position].offsetLeft - slides[0].offsetLeft));
  }, index)).toBeLessThan(2);
}

test('room photos support arrows, named thumbnails and keyboard navigation while rates stay visible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const root = carousel(page);
  await expect(root).toHaveAttribute('role', 'region');
  await expect(root).toHaveAttribute('aria-roledescription', 'carousel');
  await expect(root.locator('.room-carousel-slide')).toHaveCount(6);
  await expect(root.getByRole('button', { name: /^Show / })).toHaveCount(6);
  await expect(root.locator('.room-carousel-thumbnail a')).toHaveCount(0);
  await expectPhoto(page, 0);
  await expect(root.locator('[data-room-previous]')).toBeDisabled();
  await root.locator('[data-room-next]').click();
  await expectPhoto(page, 1);
  await root.locator('[data-room-previous]').click();
  await expectPhoto(page, 0);
  await root.locator('.room-carousel-thumbnail').nth(3).click();
  await expectPhoto(page, 3);
  await expect(root.locator('.room-carousel-slide[inert]')).toHaveCount(5);
  await expect(page.locator('#kasag [data-rate="nightlyPhp"]')).toBeVisible();
  await expect(page.locator('#kasag a').filter({ hasText: 'See KASAG’s available dates' })).toBeVisible();
  const track = root.locator('.room-carousel-track');
  await track.focus();
  await page.keyboard.press('Home');
  await expectPhoto(page, 0);
  await page.keyboard.press('ArrowRight');
  await expectPhoto(page, 1);
  await page.keyboard.press('ArrowLeft');
  await expectPhoto(page, 0);
  await page.keyboard.press('End');
  await expectPhoto(page, 5);
  await expect(root.locator('[data-room-next]')).toBeDisabled();
});

test.describe('phone room photos', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('native scrolling selects the greenery photo and opens its complete full-resolution frame', async ({ page }) => {
    await page.goto('/');
    const root = carousel(page);
    const track = root.locator('.room-carousel-track');
    await root.scrollIntoViewIfNeeded();
    await expectPhoto(page, 0);
    await expect(track).toHaveCSS('scroll-snap-type', 'x mandatory');
    await track.evaluate(element => {
      const slides = element.querySelectorAll<HTMLElement>('.room-carousel-slide');
      element.scrollTo({ left: slides[5].offsetLeft - slides[0].offsetLeft, behavior: 'instant' });
    });
    await expectPhoto(page, 5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const trigger = root.locator('.room-carousel-slide').nth(5).getByRole('link');
    await expect(trigger).toHaveAttribute('href', '/images/full/room-greenery.webp');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'A closer look at Mooncrab' });
    await expect(dialog).toBeVisible();
    const fullImage = dialog.locator('.photo-viewer-image');
    await expect(fullImage).toHaveAttribute('src', /\/images\/full\/room-greenery.webp$/);
    await expect.poll(() => fullImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    const frame = await fullImage.evaluate((image: HTMLImageElement) => {
      const bounds = image.getBoundingClientRect();
      return { naturalRatio: image.naturalWidth / image.naturalHeight, renderedRatio: bounds.width / bounds.height, fit: getComputedStyle(image).objectFit, top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
    });
    expect(frame.fit).toBe('contain');
    expect(frame.renderedRatio).toBeCloseTo(frame.naturalRatio, 3);
    expect(frame.top).toBeGreaterThanOrEqual(0);
    expect(frame.bottom).toBeLessThanOrEqual(844);
    expect(frame.left).toBeGreaterThanOrEqual(0);
    expect(frame.right).toBeLessThanOrEqual(390);
    await expect(dialog.getByRole('link', { name: 'Open full-resolution image' })).toHaveAttribute('href', /\/images\/full\/room-greenery.webp$/);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expectPhoto(page, 5);
  });
});

test('reduced-motion room navigation keeps the selected photo aligned through responsive layout changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const root = carousel(page);
  const track = root.locator('.room-carousel-track');
  await expect(track).toHaveCSS('scroll-behavior', 'auto');
  await track.focus();
  await page.keyboard.press('ArrowRight');
  await expectPhoto(page, 1);
  await expect(track).toBeFocused();
  for (const width of [768, 1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectPhoto(page, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
