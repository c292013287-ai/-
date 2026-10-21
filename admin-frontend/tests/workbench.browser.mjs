import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseURL = process.env.APP_URL || 'http://127.0.0.1:5173';
const artifacts = process.env.BROWSER_ARTIFACTS || '/private/tmp/resource-admin-workbench';
const user = { id: 1, username: 'test', name: '测试用户', role: 'admin' };
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL });
await mkdir(artifacts, { recursive: true });

try {
  for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(user => {
      localStorage.setItem('token', 'workbench-ui-test');
      localStorage.setItem('user', JSON.stringify(user));
    }, user);
    let accessValid = false;
    let accessChecks = 0;
    await context.route(url => url.pathname.startsWith('/api/'), async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/entities/access') {
        if (route.request().method() === 'POST') {
          const credentials = route.request().postDataJSON();
          if (credentials.username !== 'access-test' || credentials.password !== 'test-access-password') {
            await route.fulfill({ status: 403, json: { error: '账号或密码错误' } });
            return;
          }
          accessValid = true;
          await route.fulfill({ json: { accessToken: 'workbench-access-test', expiresIn: 7200 } });
          return;
        }
        accessChecks++;
        const valid = accessValid && route.request().headers()['x-entity-access-token'] === 'workbench-access-test';
        await route.fulfill({ status: valid ? 200 : 403, json: valid ? { valid: true } : { error: '访问验证已失效' } });
        return;
      }
      const value = pathname === '/api/auth/me' ? user : [];
      await route.fulfill({ json: value });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseURL);
    const menuItem = page.locator('.app-menu .ant-menu-item').filter({ hasText: '我的工作台' });
    await menuItem.click();
    await page.waitForURL('**/workbench');
    const accessHeading = page.getByRole('heading', { name: '我的工作台访问验证', exact: true });
    await accessHeading.waitFor();
    assert.equal(await page.locator('.workbench-shortcut').count(), 0);
    await page.screenshot({ path: path.join(artifacts, `workbench-access-${width}.png`), fullPage: true });
    await page.getByLabel('访问账号', { exact: true }).fill('access-test');
    await page.getByLabel('访问密码', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: '验证并进入' }).click();
    await page.getByText('账号或密码错误', { exact: true }).waitFor();
    assert.equal(await accessHeading.isVisible(), true);
    assert.equal(await page.locator('.workbench-shortcut').count(), 0);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('entity_access_token')), null);
    await page.getByLabel('访问密码', { exact: true }).fill('test-access-password');
    await page.getByRole('button', { name: '验证并进入' }).click();
    await page.getByRole('heading', { name: '我的工作台', exact: true }).waitFor();
    assert.match(await page.locator('.ant-menu-item-selected').innerText(), /我的工作台/);
    assert.match(await page.locator('.app-header .ant-breadcrumb').innerText(), /我的工作台/);
    await page.getByRole('tab', { name: '常用功能' }).click();
    const links = await page.locator('.workbench-shortcut').evaluateAll(items => items.map(item => item.getAttribute('href')));
    assert.deepEqual(links, ['/entities', '/customers', '/migration', '/handover', '/warnings', '/consumption', '/recharges']);
    await page.reload();
    await page.getByRole('heading', { name: '我的工作台', exact: true }).waitFor();
    assert.ok(accessChecks > 0, 'Reload must validate access with the server');
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(dimensions.content <= dimensions.viewport, `Horizontal overflow at ${width}px`);
    assert.equal(await page.locator('.app-logo img').evaluate(img => img.complete && img.naturalWidth > 0), true);
    await page.screenshot({ path: path.join(artifacts, `workbench-${width}.png`), fullPage: true });

    accessValid = false;
    await page.reload();
    await accessHeading.waitFor();
    assert.equal(await page.locator('.workbench-shortcut').count(), 0);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('entity_access_token')), null);
    await page.locator('.app-menu .ant-menu-item').filter({ hasText: '用户管理' }).click();
    await page.waitForURL('**/customers');
    await page.getByRole('heading', { name: '用户管理访问验证', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${width}px: access gate, invalid credentials, unlock, server revalidation, expiry and layout`);
  }
  const anonymous = await browser.newContext();
  const page = await anonymous.newPage();
  await page.goto(`${baseURL}/workbench`);
  await page.waitForURL('**/login');
  await anonymous.close();
  console.log('PASS anonymous workbench request requires login');
} finally {
  await browser.close();
}
