import { test, expect } from '@playwright/test';
import { calculatePricing } from '../../shared/pricing.ts';
import { applyAdjustments } from '../../shared/coupons.ts';
import { DEFAULT_CONFIG } from '../../src/business.ts';

test('theme and language persist, Arabic lays out booking labels RTL, and reduced motion disables stars',async({page})=>{
  await page.setViewportSize({width:360,height:900});
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  await page.goto('/booking');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.locator('.starfield .twinkle').first()).toHaveCSS('animation-name','none');
  await page.locator('summary[aria-label=Appearance]').click();
  await page.locator('[data-theme-control]').selectOption('light');
  await page.locator('summary[aria-label=Language]').click();
  await page.locator('[data-language-select]').selectOption('ar');
  await expect(page.locator('.booking-main')).toHaveAttribute('dir','rtl');
  await expect(page.locator('[data-i18n=promo]')).toContainText('رمز ترويجي');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await expect(page.locator('.booking-main')).toHaveAttribute('dir','rtl');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('an applied offer changes the quote and removal restores the server rate',async({page})=>{
  await page.clock.setFixedTime(new Date('2026-11-19T08:00:00Z'));
  const base=calculatePricing(7,2);
  await page.route('**/api/config',route=>route.fulfill({json:DEFAULT_CONFIG}));
  await page.route('**/api/availability?*',route=>route.fulfill({json:{configured:true,blockedDates:[]}}));
  await page.route('**/api/quote**',route=>{
    const codes=route.request().method()==='POST'?route.request().postDataJSON().codes:[];
    return route.fulfill({json:{pricing:codes.length?applyAdjustments(base,[{code:'ISLAND10',name:'Island stay',revision:'v1',discountCents:80000}]):base}});
  });
  await page.goto('/booking');
  await page.getByRole('button',{name:'Next month'}).click();
  await page.getByRole('button',{name:/Dec 1, 2026, available/}).click();
  await page.getByRole('button',{name:/Dec 8, 2026, available/}).click();
  await page.getByLabel('Have a promo code?').fill('island10');
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.locator('.estimate-persistent')).toContainText('₱7,200');
  await expect(page.locator('.estimate-persistent')).toContainText('₱3,600');
  await page.getByRole('button',{name:'Remove ISLAND10'}).click();
  await expect(page.locator('.estimate-persistent')).toContainText('₱8,000');
});
