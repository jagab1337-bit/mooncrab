import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { createReviewHandler } from '../../server/reviews.ts';
import { reviewHeaders, reviewResponse, reviewStorage } from '../review-fixtures.ts';

test('admin publishing updates the live homepage data with no build, including a redacted photo', async ({ page, context }) => {
  const { options } = reviewStorage();
  const admin = createReviewHandler(true,options);
  const publicReviews = createReviewHandler(false,options);
  await context.route('**/api/admin/session', route => route.fulfill({ json:{authenticated:true,mustChangePassword:false} }));
  await context.route(url => (url.pathname === '/api/admin/workspace' && url.searchParams.get('section') === 'reviews')
    || (url.pathname === '/api/config' && (url.searchParams.has('reviews') || url.searchParams.has('reviewImage'))), async route => {
    const request = route.request();
    const url = new URL(request.url());
    const isAdmin = url.pathname.includes('/admin/');
    const response = reviewResponse();
    const handler = isAdmin ? admin : publicReviews;
    await handler({ method:request.method(), headers:isAdmin ? reviewHeaders : {},
      query:Object.fromEntries(url.searchParams), ...(request.method()==='POST' ? {body:request.postDataJSON()} : {}) }, response);
    const { code, headers, body } = response;
    await route.fulfill(Buffer.isBuffer(body) ? {status:code,headers,body} : {status:code,headers,json:body});
  });

  await page.goto('/admin/reviews');
  await expect(page.getByRole('heading',{name:'Guest Reviews'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Nikki'})).toBeVisible();
  await page.getByRole('button',{name:'Add Review'}).click();
  await page.getByLabel('Guest display name').fill('Sample Guest');
  await page.getByLabel('Review text').fill('A quiet, lovely stay.');
  await page.locator('[data-editor]').getByLabel('Private notes').fill('Internal review note.');
  await page.getByRole('button',{name:'Save draft'}).click();

  const home = await context.newPage();
  await home.setViewportSize({width:390,height:844});
  await home.emulateMedia({reducedMotion:'reduce',colorScheme:'dark'});
  await home.goto('/');
  const reviews = home.locator('#reviews');
  await expect(reviews.getByText('Nikki')).toBeVisible();
  await expect(reviews.getByText('Sample Guest')).toHaveCount(0);
  await expect(home.locator('html')).toHaveAttribute('data-theme','dark');
  await home.emulateMedia({colorScheme:'light'});
  await expect(home.locator('html')).toHaveAttribute('data-theme','light');

  const row = page.locator('[data-list] article').filter({hasText:'Sample Guest'});
  await expect(row.getByText('Draft',{exact:true})).toBeVisible();
  await row.getByRole('button',{name:'Edit'}).click();
  const bytes = await sharp({create:{width:1000,height:500,channels:3,background:'#ffd139'}}).png().toBuffer();
  await page.locator('input[type=file]').setInputFiles({name:'review.png',mimeType:'image/png',buffer:bytes});
  await page.getByLabel('Image description').fill('Guest review screenshot');
  await page.getByRole('button',{name:'Redact private details'}).click();
  const canvas = page.locator('.review-redaction-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .08, box.y + box.height * .08);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .26,{steps:4});
  await page.mouse.up();
  await expect(page.getByRole('button',{name:'Undo redaction'})).toBeVisible();
  await page.getByRole('checkbox',{name:'Featured'}).check();
  await page.getByRole('button',{name:'Preview',exact:true}).click();
  await expect(page.locator('.review-admin-preview').getByRole('img',{name:'Guest review screenshot'})).toBeVisible();
  await page.getByRole('checkbox',{name:/I have permission/}).check();
  await page.locator('[data-editor]').getByRole('button',{name:'Publish Review'}).click();
  await expect(row.getByText('Published',{exact:true})).toBeVisible();

  await home.reload();
  const published = reviews.locator('.review-card').first();
  await expect(published.getByText('A quiet, lovely stay.',{exact:false})).toBeVisible();
  await expect(published.getByText('Internal review note.')).toHaveCount(0);
  await expect(reviews.getByRole('button',{name:'Next review'})).toBeVisible();
  await reviews.getByRole('button',{name:'Next review'}).click();
  await expect(reviews.getByRole('button',{name:'Previous review'})).toBeEnabled();
  await reviews.getByRole('button',{name:'Previous review'}).click();
  const image = published.getByRole('link',{name:/View full review image/});
  await image.click();
  await expect(home.getByRole('dialog')).toBeVisible();
  await expect(home.locator('.photo-viewer-image')).toHaveJSProperty('naturalWidth',1000);
  await home.getByRole('button',{name:'Close photo viewer'}).click();
  expect(await home.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await row.getByRole('button',{name:'Edit'}).click();
  await page.getByLabel('Review text').fill('An updated review excerpt.');
  await page.getByRole('checkbox',{name:/I have permission/}).check();
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(row.getByText('An updated review excerpt.')).toBeVisible();
  await home.reload();
  await expect(reviews.getByText('An updated review excerpt.',{exact:false})).toBeVisible();

  await row.getByRole('button',{name:'Unpublish'}).click();
  await expect(row.getByText('Hidden',{exact:true})).toBeVisible();
  await home.reload();
  await expect(reviews.getByText('Nikki')).toBeVisible();
  await expect(reviews.getByText('Sample Guest')).toHaveCount(0);
  await row.getByRole('button',{name:'Archive'}).click();
  await expect(row.getByText('Archived',{exact:true})).toBeVisible();
  await row.getByRole('button',{name:'Restore to draft'}).click();
  await expect(row.getByText('Draft',{exact:true})).toBeVisible();
});
