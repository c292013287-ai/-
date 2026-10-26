import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.APP_URL || 'http://127.0.0.1:5173';
const artifacts = '/private/tmp/resource-admin-contact-forecast';
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL });
const user = { id: 1, username: 'test', name: '测试用户', role: 'admin' };

try {
  for (const width of [1440, 768, 390]) {
    const timestamp = '2026-10-26T02:00:00Z';
    const entities = [1, 2, 3].map(id => ({ id, name: `测试主体${id}`, sku: '声乐', corpid: `test-corp-${id}`, secret: 'test-only',
      wecomApiBaseUrl: null, status: 'active', quotaTotal: 5000, quotaBalance: 4000, userCount: 20,
      lastSyncAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
      servedUserCount: id === 3 ? 5000 : 1000, servedUserCountUpdatedAt: timestamp,
      externalContactCapacity: id === 1 ? null : id === 2 ? 20000 : 5000,
      externalContactForecast: { status: id === 1 ? 'unconfigured' : id === 2 ? 'forecast' : 'limit_reached',
        capacity: id === 1 ? null : id === 2 ? 20000 : 5000, dailyNetGrowth: id === 2 ? 1000 : null,
        estimatedPurchaseDate: id === 2 ? '2026-12-01' : null } }));
    const saved = [];
    entities[1].externalContactValidFrom = '2026-11-24T02:03:00Z';
    entities[1].externalContactValidUntil = '2027-11-24T02:03:00Z';
    entities[2].externalContactValidFrom = '2025-11-24T02:03:00Z';
    entities[2].externalContactValidUntil = '2026-10-25T02:03:00Z';
    const context = await browser.newContext({ viewport: { width, height: 1000 }, timezoneId: 'America/New_York' });
    await context.addInitScript(user => {
      localStorage.setItem('token', 'forecast-ui-test');
      localStorage.setItem('user', JSON.stringify(user));
      sessionStorage.setItem('entity_access_token', 'forecast-access-test');
    }, user);
    await context.route(url => url.pathname.startsWith('/api/'), async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        saved.push(body);
        const entity = entities.find(entity => entity.id === Number(pathname.split('/').at(-1)));
        Object.assign(entity, body, { externalContactForecast: { status: 'insufficient_history', estimatedPurchaseDate: null } });
        await route.fulfill({ json: entity });
        return;
      }
      await route.fulfill({ json: pathname === '/api/auth/me' ? user
        : pathname === '/api/entities/access' ? { valid: true }
        : pathname === '/api/entities/manage' ? entities : [] });
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(timestamp));
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/entities`);
    const header = page.getByRole('columnheader', { name: '外部联系人规模预计增购时间', exact: true });
    await header.waitFor();
    const headers = await page.locator('.ant-table-thead th').allTextContents();
    const index = headers.findIndex(text => text.includes('去重已服务人数'));
    assert.ok(headers[index + 1].includes('外部联系人有效时长'));
    assert.ok(headers[index + 2].includes('外部联系人规模预计增购时间'));
    const durationHeader = page.getByRole('columnheader', { name: '外部联系人有效时长', exact: true });
    await durationHeader.scrollIntoViewIfNeeded();
    await page.getByText('续期至 2027/11/24 10:03', { exact: true }).click({ trial: true });
    assert.equal(await page.locator('.ant-table-tbody tr[data-row-key="1"] td').nth(index + 1).innerText(), '未录入');
    assert.equal(await page.getByText('已到期', { exact: true }).count(), 1);
    await durationHeader.click();
    await page.waitForFunction(() => [...document.querySelectorAll('.ant-table-tbody tr[data-row-key]')]
      .map(row => row.getAttribute('data-row-key')).join(',') === '3,2,1');
    await page.screenshot({ path: path.join(artifacts, `duration-${width}.png`), fullPage: true, animations: 'disabled' });
    await header.scrollIntoViewIfNeeded();
    assert.equal(await page.getByText('未设置已购档位', { exact: true }).count(), 1);
    assert.equal(await page.getByText('2026-12-01', { exact: true }).count(), 1);
    await page.getByText('2026-12-01', { exact: true }).click({ trial: true });
    assert.equal(await page.getByText('已达上限，建议增购', { exact: true }).count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(artifacts, `forecast-${width}.png`), fullPage: true, animations: 'disabled' });

    const row = page.locator('.ant-table-tbody tr').filter({ hasText: '测试主体1' });
    await row.getByRole('button', { name: /编\s*辑/ }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('外部联系人有效期开始时间（北京时间）', { exact: true }).click();
    const pickerPopup = page.locator('.ant-picker-dropdown:visible .ant-picker-panel-container');
    await pickerPopup.locator('.ant-picker-cell-in-view').first().click({ trial: true });
    const pickerBounds = await pickerPopup.boundingBox();
    await page.screenshot({ path: path.join(artifacts, `validity-picker-${width}.png`), fullPage: true, animations: 'disabled' });
    assert.ok(pickerBounds.x >= 0 && pickerBounds.x + pickerBounds.width <= width + 1, 'Date/time picker should fit the screen');
    assert.ok(pickerBounds.y >= 0 && pickerBounds.y + pickerBounds.height <= 1001, `Date/time picker should be vertically reachable: ${JSON.stringify(pickerBounds)}`);
    await modal.getByLabel('外部联系人有效期开始时间（北京时间）', { exact: true }).press('Escape');
    await modal.getByLabel('外部联系人有效期开始时间（北京时间）', { exact: true }).fill('2026/11/24 10:03');
    await modal.getByLabel('外部联系人有效期开始时间（北京时间）', { exact: true }).press('Enter');
    await modal.getByLabel('外部联系人有效期截止时间（北京时间）', { exact: true }).fill('2027/11/24 10:03');
    await modal.getByLabel('外部联系人有效期截止时间（北京时间）', { exact: true }).press('Enter');
    await modal.getByRole('combobox', { name: '外部联系人规模（已购档位）', exact: true }).click();
    await page.getByText('50,000 位', { exact: true }).click();
    await modal.getByRole('button', { name: /确.*定/ }).click();
    await modal.waitFor({ state: 'hidden' });
    assert.equal(saved.at(-1).externalContactCapacity, 50000);
    assert.equal(saved.at(-1).externalContactValidFrom, '2026-11-24T10:03:00+08:00');
    assert.equal(saved.at(-1).externalContactValidUntil, '2027-11-24T10:03:00+08:00');
    await row.getByRole('button', { name: /编\s*辑/ }).click();
    assert.equal(await modal.getByLabel('外部联系人有效期开始时间（北京时间）', { exact: true }).inputValue(), '2026/11/24 10:03');
    assert.equal(await modal.getByLabel('外部联系人有效期截止时间（北京时间）', { exact: true }).inputValue(), '2027/11/24 10:03');
    await modal.getByRole('combobox', { name: '外部联系人规模（已购档位）', exact: true }).click();
    await page.getByText('更大规模（自定义，200万位起）', { exact: true }).click();
    await modal.getByLabel('已购规模人数', { exact: true }).fill('2500000');
    const bounds = await modal.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'Modal should fit the screen');
    await page.screenshot({ path: path.join(artifacts, `edit-${width}.png`), fullPage: true, animations: 'disabled' });
    await modal.getByRole('button', { name: /确.*定/ }).click();
    await modal.waitFor({ state: 'hidden' });
    assert.equal(saved.at(-1).externalContactCapacity, 2500000);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${width}px: actual validity period, sorting, Beijing timezone, saved dates and responsive modal`);
  }
} finally {
  await browser.close();
}
