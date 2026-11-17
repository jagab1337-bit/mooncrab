import { test, expect } from '@playwright/test';
import { destinations, mooncrabOrigin } from '../../src/destinations.ts';
import { destinationPhotos } from '../../src/destination-photos.ts';

test('Siargao journal filters and searches the eight real destination guides', async ({ page }) => {
  await page.goto('/explore-siargao');
  await expect(page.locator('.destination-card:visible')).toHaveCount(8);
  await page.getByRole('button', { name: 'Island hopping', exact: true }).click();
  await expect(page.locator('.destination-card:visible')).toHaveCount(3);
  await page.getByRole('button', { name: 'All places', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Find a place or activity' }).fill('Maasin');
  await expect(page.locator('.destination-card:visible')).toHaveCount(1);
  await expect(page.locator('.destination-card:visible h3')).toHaveText('Maasin River');
});

test('every guide has original content, genuine photos, SEO metadata and a route from Moon Crab', async ({ page }) => {
  for (const guide of destinations) {
    await page.goto(`/explore-siargao/${guide.slug}`);
    await expect(page.getByRole('heading', { name: guide.title, exact: true, level: 1 })).toBeVisible();
    expect(guide.introduction.split(/\s+/).length).toBeGreaterThanOrEqual(100);
    expect(guide.introduction.split(/\s+/).length).toBeLessThanOrEqual(180);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://mooncrabsiargao.com/explore-siargao/${guide.slug}`);
    const structured = JSON.parse(await page.locator('#explore-structured-data').textContent() || '{}');
    expect(structured['@type']).toBe('BlogPosting');
    expect(structured.headline).toContain(guide.title);
    const href = await page.getByRole('link', { name: 'Get directions from Moon Crab' }).getAttribute('href');
    const route = new URL(href!);
    expect(route.searchParams.get('origin')).toBe(mooncrabOrigin);
    expect(route.searchParams.get('destination')).toBe(guide.route.directionsDestination);
    if (guide.route.boat) {
      expect(route.searchParams.get('destination')).not.toContain(guide.title);
      await expect(page.getByText('The map ends at the mainland departure point.', { exact: false })).toBeVisible();
    }
    const cover = page.locator('.guide-cover img');
    await expect.poll(() => cover.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    expect(destinationPhotos[guide.slug].length).toBeGreaterThanOrEqual(1);
    for (const photo of destinationPhotos[guide.slug]) {
      expect(photo.sourceUrl).toMatch(/^https:\/\/(commons\.wikimedia\.org|unsplash\.com)\//);
      expect(photo.license).toBeTruthy(); expect(photo.author).toBeTruthy();
    }
  }
});

test('destination photographs open uncropped in the shared full-resolution viewer', async ({ page }) => {
  await page.goto('/explore-siargao/cloud-9');
  const trigger = page.locator('.guide-cover a[data-photo-viewer]');
  await trigger.click();
  const image = page.locator('.photo-viewer-image');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(2048);
  expect(await image.evaluate((element: HTMLImageElement) => element.naturalHeight)).toBe(1365);
  await expect(image).toHaveCSS('object-fit', 'contain');
  await page.keyboard.press('ArrowRight');
  await expect(image).toHaveAttribute('src', /cloud-9-2\.jpg$/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

for (const width of [360, 768, 1920]) {
  test(`travel guide layout fits a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/explore-siargao/sugba-lagoon');
    await expect(page.getByRole('heading', { name: 'Sugba Lagoon', level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.guide-cover img')).toHaveCSS('object-fit', 'cover');
    const link = page.getByRole('link', { name: 'Get directions from Moon Crab' });
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible();
  });
}
