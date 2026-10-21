import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const backendRequire = createRequire(new URL('../../admin-backend/package.json', import.meta.url));
backendRequire('dotenv').config({ path: fileURLToPath(new URL('../../admin-backend/.env', import.meta.url)), quiet: true });
const { PrismaClient } = backendRequire('@prisma/client');
const jwt = backendRequire('jsonwebtoken');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseURL = process.env.APP_URL || 'http://127.0.0.1:5173';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname));
assert.ok(['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname));
const artifacts = '/private/tmp/resource-admin-workbench-tools';
await mkdir(artifacts, { recursive: true });
const prisma = new PrismaClient();
let user;
let browser;
try {
  user = await prisma.user.create({ data: { username: `workbench-browser-${randomUUID()}`, password: 'not-a-login-hash', name: '工作台测试', role: 'admin' } });
  const secret = process.env.JWT_SECRET || 'default-secret';
  const token = jwt.sign({ userId: user.id, role: 'admin' }, secret, { expiresIn: '15m' });
  const accessToken = jwt.sign({ userId: user.id, scope: 'entity-management' }, secret, { expiresIn: '15m' });
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(({ token, accessToken, user }) => {
    localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user));
    sessionStorage.setItem('entity_access_token', accessToken);
  }, { token, accessToken, user: { id: user.id, name: user.name, username: user.username, role: user.role } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const waitForEditor = () => page.waitForFunction(() => {
    const dialog = [...document.querySelectorAll('.ant-modal')].find(item => item.getBoundingClientRect().width > 0);
    if (!dialog || !dialog.getBoundingClientRect().width) return false;
    const style = getComputedStyle(dialog);
    return style.opacity === '1' && style.transform === 'none'
      && !dialog.className.includes('zoom-enter') && !dialog.className.includes('zoom-appear');
  });
  async function api(resource, body, method = 'POST') {
    const response = await context.request.fetch(`${baseURL}/api/workbench/${resource}`, {
      method, data: body, headers: { Authorization: `Bearer ${token}`, 'X-Entity-Access-Token': accessToken },
    });
    assert.ok(response.ok(), `API ${method} ${resource}: ${response.status()}`);
    return response.json();
  }
  await page.goto(`${baseURL}/workbench`);
  await page.getByRole('button', { name: /新建笔记$/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('标题', { exact: true }).fill('周一工作记录');
  await dialog.getByLabel('正文', { exact: true }).fill('核对本周迁移数据。\n整理待跟进事项与客户反馈。');
  await dialog.getByRole('switch', { name: '置顶' }).click();
  let rejectSave = true;
  await page.route(url => url.pathname === '/api/workbench/notes', async route => {
    if (rejectSave && route.request().method() === 'POST') {
      rejectSave = false;
      await route.fulfill({ status: 500, json: { error: '测试保存失败，请重试' } });
    } else await route.continue();
  });
  await dialog.getByRole('button', { name: '保存笔记' }).click();
  await dialog.getByText('测试保存失败，请重试', { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel('标题', { exact: true }).inputValue(), '周一工作记录');
  await dialog.getByRole('button', { name: '保存笔记' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.reload();
  await page.getByRole('button', { name: '编辑笔记：周一工作记录', exact: true }).waitFor();
  await page.getByRole('textbox', { name: '搜索笔记', exact: true }).fill('不存在的关键词');
  await page.getByText('没有匹配的笔记', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: '搜索笔记', exact: true }).fill('客户反馈');
  await page.getByRole('button', { name: '编辑笔记：周一工作记录', exact: true }).click();
  await dialog.getByLabel('正文', { exact: true }).fill('修改后的正文');
  await dialog.getByRole('button', { name: /取\s*消/ }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(await dialog.getByLabel('正文', { exact: true }).inputValue(), '修改后的正文');
  await dialog.getByRole('button', { name: '保存笔记' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('textbox', { name: '搜索笔记', exact: true }).fill('');
  const saved = (await api('notes', undefined, 'GET'))[0];
  assert.equal(saved.content, '修改后的正文');
  assert.equal(saved.pinned, true);

  await page.getByRole('button', { name: '编辑笔记：周一工作记录', exact: true }).click();
  await api(`notes/${saved.id}`, { ...saved, content: '来自另一窗口的新内容' }, 'PUT');
  await dialog.getByLabel('正文', { exact: true }).fill('当前窗口尚未保存的内容');
  await dialog.getByRole('button', { name: '保存笔记' }).click();
  await dialog.getByText(/此记录已被更新/).waitFor();
  assert.equal(await dialog.getByLabel('正文', { exact: true }).inputValue(), '当前窗口尚未保存的内容');
  await dialog.getByRole('button', { name: /取\s*消/ }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.reload();

  await page.getByRole('tab', { name: '待办清单' }).click();
  await page.getByRole('button', { name: /新建待办$/ }).click();
  await dialog.getByLabel('待办事项', { exact: true }).fill('核对本周用户迁移数据');
  await dialog.getByLabel('优先级', { exact: true }).click();
  await page.getByText('高优先级', { exact: true }).click();
  await dialog.getByLabel('截止日期', { exact: true }).fill('2026-10-18');
  await dialog.getByLabel('截止日期', { exact: true }).press('Enter');
  await dialog.getByRole('button', { name: '保存待办' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('checkbox', { name: '完成待办：核对本周用户迁移数据' }).click();
  await page.getByText('已完成 1', { exact: true }).click();
  await page.getByRole('checkbox', { name: '恢复待办：核对本周用户迁移数据' }).waitFor();
  await page.reload();
  await page.getByRole('tab', { name: '待办清单' }).click();
  await page.getByText('已完成 1', { exact: true }).click();
  await page.getByRole('checkbox', { name: '恢复待办：核对本周用户迁移数据' }).click();
  await page.getByText('未完成 1', { exact: true }).click();
  await page.getByRole('textbox', { name: '搜索待办', exact: true }).fill('不匹配的待办');
  await page.getByText('没有匹配的待办', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: '搜索待办', exact: true }).fill('');
  await page.getByRole('button', { name: '编辑待办', exact: true }).click();
  await dialog.getByLabel('待办事项', { exact: true }).fill('核对本周用户迁移数据（已调整）');
  await dialog.getByRole('button', { name: '保存待办' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '删除待办', exact: true }).click();
  await page.getByRole('button', { name: /取\s*消/ }).click();
  assert.equal(await page.getByRole('checkbox', { name: '完成待办：核对本周用户迁移数据（已调整）' }).count(), 1);
  await page.getByRole('button', { name: '删除待办', exact: true }).click();
  await page.getByRole('button', { name: /^删\s*除$/ }).click();
  await page.getByText('暂无待办', { exact: true }).waitFor();
  assert.deepEqual(await api('todos', undefined, 'GET'), []);

  await api('notes', { title: '客户反馈整理', content: '记录本周反馈与需要协调的事项。\n周三复核处理结果。', pinned: false });
  await api('notes', { title: '会议纪要', content: '本周重点\n1. 核对迁移数据\n2. 跟进主体认证时间\n3. 完成周报', pinned: false });
  await api('todos', { title: '整理本周用户迁移周报', priority: 'high', completed: false, dueDate: '2026-10-18' });
  await api('todos', { title: '确认主体认证到期日期', priority: 'normal', completed: false, dueDate: '2026-10-21' });
  await api('todos', { title: '整理工作记录', priority: 'low', completed: false, dueDate: null });

  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.reload();
    await page.getByRole('button', { name: '编辑笔记：客户反馈整理', exact: true }).waitFor();
    for (const [tab, suffix] of [['记事本', 'notes'], ['待办清单', 'todos']]) {
      await page.getByRole('tab', { name: tab }).click();
      const dimensions = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
      assert.ok(dimensions.content <= dimensions.width, `Overflow at ${width} ${tab}`);
      await page.screenshot({ path: path.join(artifacts, `${suffix}-${width}.png`), fullPage: true, animations: 'disabled' });
    }
    await page.getByRole('button', { name: /新建待办$/ }).click();
    await dialog.waitFor();
    await waitForEditor();
    await page.screenshot({ path: path.join(artifacts, `todo-editor-${width}.png`), fullPage: true, animations: 'disabled' });
    await dialog.getByRole('button', { name: /取\s*消/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('tab', { name: '记事本' }).click();
    await page.getByRole('button', { name: '编辑笔记：客户反馈整理', exact: true }).click();
    await dialog.waitFor();
    await waitForEditor();
    await page.screenshot({ path: path.join(artifacts, `note-editor-${width}.png`), fullPage: true, animations: 'disabled' });
    await dialog.getByRole('button', { name: /取\s*消/ }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('tab', { name: '记事本' }).click();
  const count = await page.locator('.workbench-note').count();
  await page.locator('.workbench-note').first().getByRole('button', { name: '删除笔记', exact: true }).click();
  await page.getByRole('button', { name: /^删\s*除$/ }).click();
  await page.getByText('笔记已删除', { exact: true }).waitFor();
  assert.equal(await page.locator('.workbench-note').count(), count - 1);
  assert.deepEqual(errors, []);
  console.log('PASS real database UI: create/edit/delete/search/pin notes, failed saves retain drafts, conflict protection, todo priority/date/complete/reopen, reload persistence, four responsive widths');
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    console.error('Failure URL:', page.url());
    console.error((await page.locator('body').innerText()).slice(0, 4000));
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true });
  }
  throw error;
} finally {
  await browser?.close();
  if (user) await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
}
