import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseURL = process.env.APP_URL || 'http://127.0.0.1:5173';
const artifacts = process.env.BROWSER_ARTIFACTS || '/private/tmp/resource-admin-notes-layout';
const user = { id: 1, username: 'test', name: '测试用户', role: 'admin' };
const notes = [1, 2, 3].map(id => ({
  id, title: `项目预算 ${id}`, content: Array.from({ length: [1, 12, 32][id - 1] }, (_, index) => `预算项目${index + 1}：9600元`).join('\n'),
  pinned: id === 1, version: 1, createdAt: '2026-10-21T08:02:00.000Z', updatedAt: '2026-10-21T08:02:00.000Z',
}));
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL });
await mkdir(artifacts, { recursive: true });

try {
  for (const width of [1920, 1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(user => {
      localStorage.setItem('token', 'layout-test');
      localStorage.setItem('user', JSON.stringify(user));
      sessionStorage.setItem('entity_access_token', 'layout-access-test');
    }, user);
    await context.route(url => url.pathname.startsWith('/api/'), async route => {
      const pathname = new URL(route.request().url()).pathname;
      const value = pathname === '/api/auth/me' ? user
        : pathname === '/api/entities/access' ? { valid: true }
        : pathname === '/api/workbench/notes' ? notes : [];
      await route.fulfill({ json: value });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseURL}/workbench`);
    await page.locator('.workbench-note').first().waitFor();
    const dimensions = await page.locator('.workbench-notes').evaluate(grid => {
      return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth,
        gridWidth: grid.getBoundingClientRect().width,
        cards: [...grid.querySelectorAll('.workbench-note')].map(card => {
          const current = card.getBoundingClientRect();
          const content = card.querySelector('.workbench-note-body p');
          const footer = card.querySelector('.workbench-note-footer');
          return { cardWidth: current.width, cardHeight: current.height,
            contentHeight: content.clientHeight, contentScrollHeight: content.scrollHeight,
            contentBottom: content.getBoundingClientRect().bottom, footerTop: footer.getBoundingClientRect().top,
            actionsInsideCard: [...footer.querySelectorAll('button')].every(button => {
              const bounds = button.getBoundingClientRect();
              return bounds.left >= current.left && bounds.right <= current.right && bounds.bottom <= current.bottom;
            }) };
        }) };
    });
    assert.ok(dimensions.pageWidth <= width, `Page overflow at ${width}px`);
    for (const card of dimensions.cards) {
      assert.ok(card.cardWidth <= dimensions.gridWidth + 1, `Card overflow at ${width}px`);
      assert.ok(card.cardWidth >= Math.min(300, dimensions.gridWidth) - 1);
      assert.ok(card.contentScrollHeight <= card.contentHeight, `Content clipped at ${width}px`);
      assert.ok(card.contentBottom <= card.footerTop, `Content overlaps actions at ${width}px`);
      assert.equal(card.actionsInsideCard, true, `Action overflow at ${width}px`);
    }
    const heights = dimensions.cards.map(card => card.cardHeight);
    assert.ok(heights[0] < 220, 'Short notes should not stretch to match a longer note');
    assert.ok(heights[1] > 600, 'Long notes should expand beyond the previous fixed height');
    assert.ok(heights[0] < heights[2] && heights[2] < heights[1], 'Card heights should follow content length');
    for (const button of await page.locator('.workbench-note').first().locator('.workbench-row-actions button').all()) {
      assert.equal(await button.isVisible(), true);
    }
    await page.screenshot({ path: path.join(artifacts, `notes-${width}.png`), fullPage: true, animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: ${JSON.stringify(dimensions)}`);
    await context.close();
  }
} finally {
  await browser.close();
}
