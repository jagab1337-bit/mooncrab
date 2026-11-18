import { test, expect, type Page } from '@playwright/test';
import { createFinanceHandler } from '../../server/finance.ts';
import type { ApiResponse, RedisCommand } from '../../server/availability.ts';

async function openLedger(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-19T04:00:00Z'));
  const record = { revision:'original-version', createdAt:'2026-11-01T00:00:00Z', updatedAt:'2026-11-01T00:00:00Z' };
  const rows = [
    { ...record, id:'expense', kind:'out', name:'Ride', category:'Transportation', date:'2026-11-10', cents:100000, notes:'Split fare',
      parties:[{name:'Jake',cents:70000},{name:'James',cents:30000}] },
    { ...record, id:'income', kind:'in', name:'Room payment', category:'Daily accommodation', date:'2026-11-19', cents:250000, notes:'',
      parties:[{name:'Kile',cents:250000}] },
    { ...record, id:'december-expense', kind:'out', name:'Utilities', category:'Utilities', date:'2026-12-02', cents:5500, notes:'',
      parties:[{name:'Kile',cents:5500}] },
    { ...record, id:'january-income', kind:'in', name:'January payment', category:'Advance payment', date:'2027-01-02', cents:500000, notes:'',
      parties:[{name:'Kile',cents:500000}] },
  ];
  let raw = JSON.stringify({ records:rows, imports:['payable-2026-11'] });
  const command: RedisCommand = async ([operation, , , , expected, next]) => {
    if (operation === 'GET') return raw;
    if (operation === 'EVAL') {
      if (expected !== raw) return 0;
      raw = String(next);
      return 1;
    }
    throw new Error('Unexpected Redis operation');
  };
  const handler = createFinanceHandler({
    command,
    env:{ KV_REST_API_URL:'https://example.invalid', KV_REST_API_TOKEN:'fake', BOOKING_ADMIN_TOKEN:'test-owner' },
  });
  await page.route('**/api/admin/session', route => route.fulfill({ json:{ authenticated:true } }));
  await page.route('**/api/admin/workspace?section=finance', async route => {
    const request = route.request();
    const headers = request.headers();
    const url = new URL(request.url());
    let code = 200;
    let result: unknown = null;
    const res: ApiResponse = {
      setHeader() {},
      status(value) { code = value; return res; },
      json(value) { result = value; },
    };
    await handler({
      method:request.method(),
      headers:{ ...headers, host:url.host, authorization:'Bearer test-owner' },
      body:request.postDataJSON(),
    }, res);
    await route.fulfill({ status:code, json:result });
  });
  await page.goto('/admin/finance?month=2026-11');
  await expect(page.getByRole('cell', {name:'Room payment', exact:false})).toBeVisible();
  return {
    receivable:page.getByRole('region', {name:'Accounts Receivable', exact:true}),
    payable:page.getByRole('region', {name:'Accounts Payable', exact:true}),
    state:() => JSON.parse(raw),
  };
}

test('two independent ledgers and one month picker on desktop and phone', async ({ page }) => {
  await page.setViewportSize({width:1440,height:1000});
  const { receivable, payable } = await openLedger(page);
  await expect(receivable.getByRole('table')).toBeVisible();
  await expect(payable.getByRole('table')).toBeVisible();
  const left = (await receivable.boundingBox())!;
  const right = (await payable.boundingBox())!;
  expect(right.x).toBeGreaterThan(left.x + left.width - 1);
  expect(right.y).toBe(left.y);
  await expect(page.getByLabel('Monthly cash flow').getByText('₱1,500.00', {exact:true})).toBeVisible();
  await receivable.getByRole('searchbox').fill('missing');
  await expect(receivable.getByText('No transactions match these filters.')).toBeVisible();
  await expect(payable.getByRole('cell', {name:/Ride/})).toBeVisible();
  await receivable.getByRole('searchbox').clear();
  const download = page.waitForEvent('download');
  await payable.getByRole('button', {name:'Export CSV'}).click();
  expect((await download).suggestedFilename()).toBe('mooncrab-payable-2026-11.csv');
  await page.getByRole('button', {name:'Next month', exact:true}).click();
  await expect(page).toHaveURL(/month=2026-12/);
  await expect(payable.getByRole('cell', {name:'₱55.00', exact:true})).toBeVisible();
  await expect(receivable.getByText('No money in recorded for this month.')).toBeVisible();
  await page.getByRole('button', {name:'Next month', exact:true}).click();
  await expect(page).toHaveURL(/month=2027-01/);
  await expect(receivable.getByRole('cell', {name:/January payment/})).toBeVisible();
  await expect(payable.getByText('No money out recorded for this month.')).toBeVisible();
  await page.getByText('January 2027', {exact:true}).click();
  await page.getByRole('button', {name:'Previous year'}).click();
  await page.getByRole('combobox', {name:'Month', exact:true}).selectOption('11');
  await page.getByRole('button', {name:'Show month'}).click();
  await expect(page).toHaveURL(/month=2026-11/);
  await page.setViewportSize({width:390,height:900});
  const top = (await receivable.boundingBox())!;
  const bottom = (await payable.boundingBox())!;
  expect(bottom.y).toBeGreaterThan(top.y + top.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const titleFont = await page.locator('#finance-in-title').evaluate(el => getComputedStyle(el).fontFamily);
  expect(titleFont).toContain('Cormorant Garamond');
});

test('both ledgers can select, save, and filter preset and custom categories', async ({ page }) => {
  const { receivable, payable } = await openLedger(page);
  for (const [ledger, original, name, preset, custom, otherPreset] of [
    [receivable, 'Room payment', 'Group payment', 'Booking payment', 'Group stays', 'Utilities'],
    [payable, 'Ride', 'Laundry service', 'Supplies', 'Laundry & linen', 'Booking payment'],
  ] as const) {
    const editor = ledger.locator('.finance-editor');
    const category = editor.getByRole('combobox', {name:'Category', exact:true});
    const filter = ledger.getByRole('combobox', {name:'Category', exact:true}).first();
    const row = ledger.getByRole('row', {name:new RegExp(name)});
    await ledger.getByRole('button', {name:'Add Transaction', exact:true}).click();
    await expect(category).toHaveValue('');
    await expect(category.locator('option').filter({hasText:otherPreset})).toHaveCount(0);
    await category.selectOption(preset);
    await editor.getByLabel('Transaction', {exact:true}).fill(name);
    await editor.getByLabel('Amount (PHP)', {exact:true}).fill('100');
    await editor.getByRole('combobox', {name:'Person 1', exact:true}).selectOption({label:'Kile'});
    await editor.getByRole('button', {name:'Save transaction'}).click();
    await expect(row).toContainText(preset);

    await row.getByRole('button', {name:'Edit', exact:true}).click();
    await expect(category).toHaveValue(preset);
    await category.selectOption({label:'Add custom category…'});
    const customField = editor.getByLabel('Custom category', {exact:true});
    await expect(customField).toBeFocused();
    await customField.fill(custom);
    await editor.getByRole('button', {name:'Save transaction'}).click();
    await expect(row).toContainText(custom);

    await page.reload();
    await expect(row).toContainText(custom);
    await filter.selectOption(custom);
    await expect(ledger.getByRole('row', {name:new RegExp(original)})).toBeHidden();
    await expect(row).toBeVisible();
    await row.getByRole('button', {name:'Edit', exact:true}).click();
    await expect(category).toHaveValue(custom);
    await expect(customField).toBeHidden();
    await editor.getByRole('button', {name:'Cancel'}).click();
    await filter.selectOption('');
  }
});

test('person IDs survive rename and archive, split totals and historical rows survive', async ({ page }) => {
  const { receivable, payable, state } = await openLedger(page);
  const original = state().records[0];
  await receivable.getByRole('button', {name:'Add Transaction', exact:true}).click();
  const editor = receivable.locator('.finance-editor');
  await editor.getByLabel('Transaction', {exact:true}).fill('Test income');
  await editor.getByRole('combobox', {name:'Category', exact:true}).selectOption('Booking payment');
  await editor.getByLabel('Amount (PHP)', {exact:true}).fill('600');
  await editor.getByRole('combobox', {name:'Person 1', exact:true}).selectOption('new');
  const dialog = page.getByRole('dialog', {name:'People directory'});
  await dialog.getByLabel('New person', {exact:true}).fill('Alex Rivera');
  await dialog.getByRole('button', {name:'Add Person', exact:true}).click();
  await expect(dialog).toBeHidden();
  await expect(editor.getByRole('combobox', {name:'Person 1', exact:true}).locator('option:checked')).toHaveText('Alex Rivera');
  await editor.getByRole('button', {name:'Save transaction'}).click();
  await expect(receivable.getByRole('cell', {name:'Test income', exact:false})).toBeVisible();
  await expect(page.getByLabel('Monthly cash flow').getByText('₱2,100.00', {exact:true})).toBeVisible();
  const personId = state().records.find((row: {name:string}) => row.name === 'Test income').parties[0].personId;
  const filter = receivable.locator('[data-party]');
  await filter.selectOption(personId);
  await expect(receivable.getByRole('cell', {name:/Room payment/})).toBeHidden();
  await expect(payable.getByRole('cell', {name:/Ride/})).toBeVisible();
  await page.getByRole('button', {name:'Manage People'}).click();
  await dialog.getByLabel('New person').fill(' alex rivera ');
  await dialog.getByRole('button', {name:'Add Person', exact:true}).click();
  await expect(dialog.getByText(/already belongs/)).toBeVisible();
  const person = dialog.locator(`form[data-person="${personId}"]`);
  await person.getByLabel('Name', {exact:true}).fill('Alex R.');
  await person.getByRole('button', {name:'Save name for Alex Rivera'}).click();
  await expect(person.getByRole('button', {name:'Save name for Alex R.'})).toBeVisible();
  page.once('dialog', item => item.accept());
  await person.getByRole('button', {name:'Archive', exact:true}).click();
  await expect(person.getByRole('button', {name:'Restore', exact:true})).toBeVisible();
  await dialog.getByRole('button', {name:'Close', exact:true}).click();
  await expect(filter.locator('option:checked')).toHaveText('Alex R. (archived)');
  await expect(receivable.getByRole('cell', {name:'Alex R.', exact:true})).toBeVisible();
  await expect(payable.getByRole('cell', {name:'₱1,000.00', exact:true})).toBeVisible();
  await expect(payable.getByRole('cell', {name:/Jake.*₱700.00.*James.*₱300.00/})).toBeVisible();
  await payable.getByRole('button', {name:'Edit', exact:true}).click();
  const edit = payable.locator('.finance-editor');
  await edit.getByLabel('Contribution (PHP)').first().fill('750');
  await edit.getByRole('button', {name:'Save transaction'}).click();
  await expect(payable.getByText('Contributions must add up to the transaction amount.')).toBeVisible();
  expect(state().records[0]).toEqual(original);
  await edit.getByLabel('Contribution (PHP)').last().fill('250');
  await edit.getByRole('button', {name:'Save transaction'}).click();
  await expect(payable.getByText('Transaction saved.')).toBeVisible();
  expect(state().records[0].cents).toBe(100000);
  expect(state().records[0].parties.map((party: {cents:number}) => party.cents)).toEqual([75000,25000]);
  await page.reload();
  await expect(receivable.getByRole('cell', {name:'Alex R.', exact:true})).toBeVisible();
  page.once('dialog', item => item.accept());
  await receivable.getByRole('row', {name:/Test income/}).getByRole('button', {name:'Delete', exact:true}).click();
  await expect(receivable.getByRole('cell', {name:'Test income', exact:false})).toBeHidden();
  await expect(page.getByLabel('Monthly cash flow').getByText('₱1,500.00', {exact:true})).toBeVisible();
});
