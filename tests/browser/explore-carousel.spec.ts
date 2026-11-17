import { test, expect, type Page } from '@playwright/test';
import { destinations } from '../../src/destinations.ts';

const carousel = (page: Page) => page.locator('[data-explore-carousel]');
const thumbnail = (page: Page, index: number) => carousel(page).getByRole('button', { name: `Show ${destinations[index].title}`, exact: true });

async function expectDestination(page: Page, index: number): Promise<void> {
  const root = carousel(page);
  await expect(root.locator('[data-carousel-count]')).toHaveText(`${String(index + 1).padStart(2, '0')} / 08`);
  await expect(root.locator('[data-carousel-title]')).toHaveText(destinations[index].title);
  await expect(thumbnail(page, index)).toHaveAttribute('aria-current', 'true');
  const active = root.locator('.island-carousel-slide').nth(index);
  await expect(active).toHaveJSProperty('inert', false);
  await expect(active.getByRole('link', { name: /discover this place/i })).toHaveAttribute('href', `/explore-siargao/${destinations[index].slug}`);
  await expect.poll(() => root.locator('.island-carousel-track').evaluate((track, position) => {
    const slides = track.querySelectorAll<HTMLElement>('.island-carousel-slide');
    return Math.abs(track.scrollLeft - (slides[position].offsetLeft - slides[0].offsetLeft));
  }, index)).toBeLessThan(2);
}

test('homepage carousel arrows, photo thumbnails and keyboard controls open the corresponding guide', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  const root = carousel(page);
  await expect(root).toHaveAttribute('role', 'region');
  await expect(root).toHaveAttribute('aria-roledescription', 'carousel');
  await expect(root.locator('.island-carousel-slide')).toHaveCount(8);
  await expectDestination(page, 0);
  await expect(root.getByRole('button', { name: 'Previous destination', exact: true })).toBeDisabled();
  await root.getByRole('button', { name: 'Next destination', exact: true }).click();
  await expectDestination(page, 1);
  await thumbnail(page, 4).click();
  await expectDestination(page, 4);
  await expect(root.locator('.island-carousel-slide[inert]')).toHaveCount(7);
  const track = root.locator('.island-carousel-track');
  await track.focus();
  await page.keyboard.press('Home');
  await expectDestination(page, 0);
  await page.keyboard.press('ArrowRight');
  await expectDestination(page, 1);
  await page.keyboard.press('ArrowLeft');
  await expectDestination(page, 0);
  await page.keyboard.press('End');
  await expectDestination(page, 7);
  await expect(root.getByRole('button', { name: 'Next destination', exact: true })).toBeDisabled();
  await root.locator('.island-carousel-slide').nth(7).getByRole('link', { name: /discover this place/i }).click();
  await expect(page).toHaveURL('/explore-siargao/general-luna');
  await expect(page.getByRole('heading', { name: 'General Luna', exact: true, level: 1 })).toBeVisible();
});

test.describe('phone carousel', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('native horizontal scrolling updates the selected destination without page overflow', async ({ page }) => {
    await page.goto('/');
    const root = carousel(page);
    const track = root.locator('.island-carousel-track');
    await root.scrollIntoViewIfNeeded();
    await expectDestination(page, 0);
    await expect(track).toHaveCSS('scroll-snap-type', 'x mandatory');
    await track.evaluate(element => {
      const slides = element.querySelectorAll<HTMLElement>('.island-carousel-slide');
      element.scrollTo({ left: slides[3].offsetLeft - slides[0].offsetLeft, behavior: 'instant' });
    });
    await expectDestination(page, 3);
    await expect(root.locator('.island-carousel-slide').nth(3).locator('.explore-credit')).toContainText('CC BY-SA');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test('reduced-motion navigation remains aligned after the viewport changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 768, height: 1000 });
  await page.goto('/');
  const track = carousel(page).locator('.island-carousel-track');
  await expect(track).toHaveCSS('scroll-behavior', 'auto');
  await track.focus();
  await page.keyboard.press('ArrowRight');
  await expectDestination(page, 1);
  await expect(track).toBeFocused();
  await page.setViewportSize({ width: 1920, height: 1000 });
  await expectDestination(page, 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
