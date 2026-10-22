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
  for (const width of [1440, 390]) {
    const timestamp = new Date().toISOString();
    const entities = [1, 2, 3].map(id => ({ id, name: `测试主体${id}`, sku: '声乐', corpid: `test-corp-${id}`, secret: 'test-only',
      wecomApiBaseUrl: null, status: 'active', quotaTotal: 5000, quotaBalance: 4000, userCount: 20,
      lastSyncAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
      servedUserCount: id === 3 ? 5000 : 1000, servedUserCountUpdatedAt: timestamp,
      externalContactCapacity: id === 1 ? null : id === 2 ? 20000 : 5000,
      externalContactForecast: { status: id === 1 ? 'unconfigured' : id === 2 ? 'forecast' : 'limit_reached',
        capacity: id === 1 ? null : id === 2 ? 20000 : 5000, dailyNetGrowth: id === 2 ? 1000 : null,
        estimatedPurchaseDate: id === 2 ? '2026-12-01' : null } }));
    const saved = [];
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
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
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/entities`);
    const header = page.getByRole('columnheader', { name: '外部联系人规模预计增购时间', exact: true });
    await header.waitFor();
    const headers = await page.locator('.ant-table-thead th').allTextContents();
    const index = headers.findIndex(text => text.includes('去重已服务人数'));
    assert.ok(headers[index + 1].includes('外部联系人规模预计增购时间'));
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
    await modal.getByRole('combobox', { name: '外部联系人规模（已购档位）', exact: true }).click();
    await page.getByText('50,000 位', { exact: true }).click();
    await modal.getByRole('button', { name: /确.*定/ }).click();
    await modal.waitFor({ state: 'hidden' });
    assert.equal(saved.at(-1).externalContactCapacity, 50000);
    await row.getByRole('button', { name: /编\s*辑/ }).click();
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
    console.log(`PASS ${width}px: forecast column, states, capacity presets, custom capacity and modal layout`);
  }
} finally {
  await browser.close();
}
