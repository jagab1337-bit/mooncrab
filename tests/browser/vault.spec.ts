import { test, expect } from '@playwright/test';

test('Logins masks secrets, reveals on hover, copies without revealing, and hides again when locked', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const password = 'fictional test password with <br> & spaces';
  const record = { id:'242c4998-09a4-4876-bd8d-e3bdc5cd1195', revision:'demo', name:'Test mailbox', username:'admin@example.test', url:'https://mail.example.test/' };
  let unlocked = false;
  let saved = false;
  const requests: string[] = [];
  await page.route('**/api/admin/session', route => route.fulfill({json:{authenticated:true}}));
  await page.route('**/api/admin/workspace?section=logins', async route => {
    const body = route.request().postDataJSON() as Record<string,unknown> | null;
    if (body?.action === 'unlock') {
      expect(body).toMatchObject({adminPassword:'fake-admin-credential', code:'123456'});
      unlocked = true;
    }
    if (body?.action === 'save') {
      expect(body.password).toBe(password);
      expect(body.username).toBe(record.username);
      saved = true;
    }
    if (body?.action === 'reveal') {
      requests.push(String(body.reason));
      await route.fulfill({json:{password}});
      return;
    }
    if (body?.action === 'lock') unlocked = false;
    await route.fulfill({json:{enrolled:true,unlockedUntil:unlocked ? Date.now()+300000 : null, logins:unlocked && saved ? [record] : []}});
  });
  let notes: Record<string,unknown>[] = [];
  await page.route('**/api/admin/workspace?section=notes', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      notes = [{id:'note-example',revision:'example',...body.record}];
    }
    await route.fulfill({json:{records:notes}});
  });
  await page.route('**/api/admin/workspace?section=files', route => route.fulfill({json:{files:[]}}));
  await page.goto('/admin/vault');
  await expect(page.getByRole('heading',{name:'Logins & Notes',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Add Login',exact:true})).toBeHidden();
  await page.getByLabel('Administrator password',{exact:true}).fill('fake-admin-credential');
  await page.getByLabel('Authenticator code',{exact:true}).fill('123456');
  await page.getByRole('button',{name:'Unlock Logins',exact:true}).click();
  await page.getByRole('button',{name:'Add Login',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill(record.name);
  await page.getByLabel('Username or email',{exact:true}).fill(record.username);
  await page.getByLabel('Login link',{exact:true}).fill(record.url);
  await page.locator('.vault-login-editor').getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Save Login',exact:true}).click();
  const mask = page.getByRole('button',{name:'Reveal password for Test mailbox',exact:true});
  await expect(mask).toHaveText(/^•+$/);
  expect(requests).toEqual([]);
  await mask.hover();
  await expect(mask).toHaveText(password.trim());
  await page.getByRole('link',{name:/Open login link/}).hover();
  await expect(mask).toHaveText(/^•+$/);
  await page.getByRole('button',{name:'Copy Password',exact:true}).click();
  await expect(page.getByText('Password copied.',{exact:true})).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(password);
  await expect(mask).toHaveText(/^•+$/);
  expect(requests).toEqual(['hover','copy']);
  await page.getByRole('button',{name:'Lock Logins',exact:true}).click();
  await expect(mask).toBeHidden();
  await expect(page.getByRole('button',{name:'Unlock Logins',exact:true})).toBeVisible();

  await page.setViewportSize({width:390,height:900});
  await page.getByRole('button',{name:'Add Note',exact:true}).click();
  await page.getByLabel('Title',{exact:true}).fill('Owner note');
  await page.getByLabel('Note',{exact:true}).fill('Private text here');
  await page.getByRole('button',{name:'Save Note',exact:true}).click();
  await expect(page.getByText('Private text here',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Add property',exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
